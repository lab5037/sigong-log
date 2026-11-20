// 현장로그 원고 생성 — Supabase Edge Function
//
// POST /functions/v1/generate-post
//   Authorization: Bearer <사용자 access token>
//   { industryId, channel, place, detail, extra, price, pricePrivate, seed,
//     business:{name,contact,style,closing}, photos:{before,during,after} }
//
// 처리 순서
//   1) 입력 검증(화이트리스트·길이 제한)
//   2) Authorization 헤더의 JWT를 auth.getUser()로 검증 → 사용자 확인
//   3) consume_generation_for_user RPC(service_role 전용)로 잔여 횟수 원자 차감
//   4) allowed === true 일 때만 원고 생성(4채널 전부) 후 반환
//
// 응답
//   200 { ok:true, quota:{plan,used,limit}, posts:{blog,danggeun,insta,threads} }
//   400 { ok:false, reason:'invalid_input', field }
//   401 { ok:false, reason:'not_authenticated' }
//   402 { ok:false, reason:'trial_exhausted'|'monthly_limit', plan, used, limit }
//   503 { ok:false, reason:'schema_not_installed' }
//   500 { ok:false, reason:'server_error' }
//
// 원고 생성 로직(engine.ts)은 이 서버에만 있고, 브라우저에는 배포되지 않는다.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { CHANNELS, INDUSTRIES, STYLE_LABEL, generate, parsePlace } from './engine.ts';
import { type GenerateInput, parseGenerateInput } from './input.ts';
import { modelChain, polishDraft, type PolishPhoto } from './polish.ts';
import { json, logInternal, preflight, readJson } from '../_shared/http.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// Gemini 키는 Supabase Secrets에만 있다. 브라우저·저장소에는 절대 내려가지 않는다.
const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || '';
// always(사진 유무와 상관없이 다듬기) | photos(사진이 있을 때만) | off
const POLISH_MODE = (Deno.env.get('GEMINI_POLISH') || 'always').toLowerCase();

/** 사진 base64 + JSON 본문 전체를 받을 수 있는 크기(2MB base64 한도 + 여유). */
const MAX_BODY_CHARS = 2500000;

type Post = { body?: string; [key: string]: unknown };

type PolishSummary = {
  used: boolean;
  reason: string;
  model: string | null;
  channels: Record<string, 'ai' | 'draft'>;
};

/** 생성된 원고 4채널을 Gemini로 다듬는다. 실패한 채널은 규칙 기반 원고를 그대로 둔다. */
async function polishPosts(input: GenerateInput, posts: Record<string, Post>): Promise<PolishSummary> {
  const photos: PolishPhoto[] = (['before', 'during', 'after'] as const)
    .filter((slot) => !!input.images[slot])
    .map((slot) => ({ slot, mime: 'image/jpeg', data: input.images[slot] }));

  const channels: Record<string, 'ai' | 'draft'> = {};
  for (const ch of CHANNELS) channels[ch.id] = 'draft';

  if (!GEMINI_KEY) return { used: false, reason: 'no_key', model: null, channels };
  if (POLISH_MODE === 'off') return { used: false, reason: 'mode_off', model: null, channels };
  if (POLISH_MODE === 'photos' && photos.length === 0) {
    return { used: false, reason: 'no_photos', model: null, channels };
  }

  const tone = STYLE_LABEL[input.business.style as keyof typeof STYLE_LABEL] || STYLE_LABEL.haeyo;
  const region = String(parsePlace(input.place).region || '');
  const models = modelChain(GEMINI_MODEL);
  const results = await Promise.all(CHANNELS.map(async (ch) => {
    const draft = String(posts[ch.id]?.body || '');
    if (!draft) return { id: ch.id, ok: false as const, reason: 'empty_draft', body: '', model: '' };
    const r = await polishDraft({
      channel: ch.id,
      draft,
      tone,
      photos,
      apiKey: GEMINI_KEY,
      models,
      timeoutMs: 18000,
      region,
    });
    return r.ok
      ? { id: ch.id, ok: true as const, reason: '', body: r.body, model: r.model }
      : { id: ch.id, ok: false as const, reason: r.reason, body: '', model: '' };
  }));

  let used = false;
  let model: string | null = null;
  const failed: string[] = [];
  for (const r of results) {
    if (r.ok) {
      const post = posts[r.id];
      if (post) post.body = r.body;
      channels[r.id] = 'ai';
      used = true;
      model = model || r.model;
    } else {
      failed.push(r.id + ':' + r.reason);
    }
  }
  if (failed.length) console.error('[fieldlog] polish fallback', failed.join(','));
  return { used, reason: used ? 'ok' : 'fallback', model, channels };
}

function industryLabel(id: string): string {
  const hit = INDUSTRIES.find((i) => i.id === id);
  return hit ? hit.label : id;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, { ok: false, reason: 'method_not_allowed' }, 405);

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    logInternal('generate-post env', new Error('missing env'));
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  if (!jwt) return json(req, { ok: false, reason: 'not_authenticated' }, 401);

  const body = await readJson(req, MAX_BODY_CHARS);
  const parsed = parseGenerateInput(body);
  if (!parsed.ok) {
    return json(req, { ok: false, reason: 'invalid_input', field: parsed.field }, 400);
  }
  const input = parsed.value;

  // 1) 사용자 JWT 검증 — 토큰을 그대로 넘겨 GoTrue에서 확인한다.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  let userId = '';
  try {
    const { data, error } = await userClient.auth.getUser(jwt);
    if (error || !data || !data.user) {
      return json(req, { ok: false, reason: 'not_authenticated' }, 401);
    }
    userId = data.user.id;
  } catch (err) {
    logInternal('generate-post auth', err);
    return json(req, { ok: false, reason: 'not_authenticated' }, 401);
  }

  // 2) 서버 측 횟수 차감 — service_role 전용 RPC. 브라우저는 이 함수를 직접 부를 수 없다.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let quota: Record<string, unknown> | null = null;
  try {
    const { data, error } = await admin.rpc('consume_generation_for_user', {
      p_user_id: userId,
      p_industry: industryLabel(input.industryId),
      p_channel: input.channel,
      p_region: input.place,
    });
    if (error) {
      const code = String((error as { code?: string }).code || '');
      logInternal('generate-post rpc', error);
      if (code === 'PGRST202' || /Could not find the function/i.test(String(error.message || ''))) {
        return json(req, { ok: false, reason: 'schema_not_installed' }, 503);
      }
      return json(req, { ok: false, reason: 'server_error' }, 500);
    }
    quota = (data || null) as Record<string, unknown> | null;
  } catch (err) {
    logInternal('generate-post rpc', err);
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }

  const q = quota as Record<string, unknown> | null;
  if (!q) return json(req, { ok: false, reason: 'server_error' }, 500);
  if (q.allowed !== true) {
    const reason = String(q.reason || 'server_error');
    if (reason === 'not_authenticated') {
      return json(req, { ok: false, reason: 'not_authenticated' }, 401);
    }
    if (reason === 'trial_exhausted' || reason === 'monthly_limit') {
      return json(req, {
        ok: false,
        reason,
        plan: q.plan || 'trial',
        used: typeof q.used === 'number' ? q.used : null,
        limit: typeof q.limit === 'number' ? q.limit : null,
      }, 402);
    }
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }
  const quotaUsed = q;

  // 3) 원고 생성 — 채널 4종을 한 번에 만들어 1건으로 차감한다(채널 전환은 무료).
  const posts: Record<string, Post> = {};
  try {
    for (const ch of CHANNELS) {
      posts[ch.id] = generate({ ...input, channel: ch.id }) as Post;
    }
  } catch (err) {
    logInternal('generate-post engine', err);
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }

  // 4) 서버 측 Gemini 다듬기 — 실패·시간 초과면 위 규칙 기반 원고가 그대로 나간다.
  const ai = await polishPosts(input, posts);

  return json(req, {
    ok: true,
    quota: {
      plan: quotaUsed.plan || 'trial',
      used: typeof quotaUsed.used === 'number' ? quotaUsed.used : null,
      limit: typeof quotaUsed.limit === 'number' ? quotaUsed.limit : null,
    },
    ai,
    posts,
  }, 200);
});
