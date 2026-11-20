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
//   4) allowed === true 일 때만
//      (a) 사진이 있으면 사진 정밀 분석 1회(analyze.ts) → 구조화된 현장 진단
//      (b) 규칙 기반 초안 4채널 생성(engine.ts)
//      (c) 진단을 넣은 프롬프트로 채널별 다듬기(polish.ts) — 실패하면 초안 그대로
//
// 응답
//   200 { ok:true, quota:{plan,used,limit}, ai:{used,channels,analysis,...}, posts:{blog,danggeun,insta,threads} }
//   400 { ok:false, reason:'invalid_input', field }
//   401 { ok:false, reason:'not_authenticated' }
//   402 { ok:false, reason:'trial_exhausted'|'monthly_limit', plan, used, limit }
//   503 { ok:false, reason:'schema_not_installed' }
//   500 { ok:false, reason:'server_error' }
//
// 원고 생성 로직(engine.ts)은 이 서버에만 있고, 브라우저에는 배포되지 않는다.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { CHANNELS, INDUSTRIES, generate } from './engine.ts';
import { parseGenerateInput } from './input.ts';
import { writePosts } from './compose.ts';
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

  // 3) 규칙 기반 초안 4채널 — 채널 4종을 한 번에 만들어 1건으로 차감한다(채널 전환은 무료).
  const posts: Record<string, Post> = {};
  try {
    for (const ch of CHANNELS) {
      posts[ch.id] = generate({ ...input, channel: ch.id }) as Post;
    }
  } catch (err) {
    logInternal('generate-post engine', err);
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }

  // 4) 사진 정밀 분석(1회) → 분석을 넣은 프롬프트로 채널별 다듬기.
  //    분석·다듬기가 실패하거나 시간 초과면 위 규칙 기반 원고가 그대로 나간다.
  const ai = await writePosts(input, posts, {
    apiKey: GEMINI_KEY,
    model: GEMINI_MODEL,
    mode: POLISH_MODE,
  });

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
