// 현장로그 무료 체험 신청 접수 — Supabase Edge Function
//
// POST /functions/v1/submit-lead   (JWT 검증 없이 호출 가능: --no-verify-jwt)
//   { name, industry, region, contact, plan, agree:true, page?, website? }
//
// 처리 순서
//   1) 입력 검증(길이·형식·동의) + 허니팟
//   2) 같은 IP 반복 접수 · 시간당 전체 건수 제한(스팸/알림 폭주 방지)
//   3) 같은 연락처 5분 내 중복 접수는 저장하지 않고 성공으로 응답
//   4) service_role로만 public.leads 에 저장 (RLS로 anon/authenticated 직접 접근 차단)
//   5) TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 로 알림 — 실패해도 접수는 유지,
//      내부 예외 문자열·토큰이 들어간 URL은 클라이언트에 절대 돌려주지 않는다.
//
// 응답
//   200 { ok:true, id, notified }
//   200 { ok:true, duplicate:true }
//   200 { ok:true, accepted:false }            (허니팟)
//   400 { ok:false, reason:'invalid_input', field }
//   429 { ok:false, reason:'rate_limited'|'hourly_cap' }
//   500 { ok:false, reason:'server_error' }

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, logInternal, preflight, readJson } from '../_shared/http.ts';
import { decideSpam, nowKst, parseLead, telegramText } from './lead.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') || '';
const IP_SALT = Deno.env.get('LEAD_IP_SALT') || SERVICE_KEY || 'fieldlog';
const HOURLY_CAP = Number(Deno.env.get('MAX_LEADS_PER_HOUR') || '30') || 30;
const PER_IP_LIMIT = Number(Deno.env.get('MAX_LEADS_PER_IP') || '5') || 5;

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') || '';
  const first = xff.split(',')[0].trim();
  if (first) return first;
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || '0.0.0.0';
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function notifyTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) {
    logInternal('submit-lead telegram', new Error('not configured'));
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logInternal('submit-lead telegram', new Error('status ' + res.status));
      return false;
    }
    return true;
  } catch (err) {
    logInternal('submit-lead telegram', err);
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return json(req, { ok: false, reason: 'method_not_allowed' }, 405);

  if (!SUPABASE_URL || !SERVICE_KEY) {
    logInternal('submit-lead env', new Error('missing env'));
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }

  const body = await readJson(req, 4096);
  const parsed = parseLead(body);
  if (!parsed.ok) {
    if ('honeypot' in parsed) return json(req, { ok: true, accepted: false }, 200);
    return json(req, { ok: false, reason: 'invalid_input', field: parsed.field }, 400);
  }
  const lead = parsed.value;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ipHash = await sha256Hex(`${IP_SALT}:${clientIp(req)}`);
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  try {
    const [byIp, hourly, dup] = await Promise.all([
      admin.from('leads').select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).gte('created_at', iso(10 * 60 * 1000)),
      admin.from('leads').select('id', { count: 'exact', head: true })
        .gte('created_at', iso(60 * 60 * 1000)),
      admin.from('leads').select('id').eq('contact', lead.contact)
        .gte('created_at', iso(5 * 60 * 1000)).limit(1),
    ]);

    if (byIp.error || hourly.error || dup.error) {
      const err = byIp.error || hourly.error || dup.error;
      logInternal('submit-lead count', err);
      if (String((err as { code?: string }).code || '') === 'PGRST205') {
        return json(req, { ok: false, reason: 'server_error' }, 500);
      }
      return json(req, { ok: false, reason: 'server_error' }, 500);
    }

    if (dup.data && dup.data.length) {
      return json(req, { ok: true, duplicate: true }, 200);
    }

    const spam = decideSpam(byIp.count || 0, hourly.count || 0, { perIpLimit: PER_IP_LIMIT, hourlyCap: HOURLY_CAP });
    if (spam.blocked) {
      return json(req, { ok: false, reason: spam.reason }, 429);
    }

    const { data: inserted, error: insertError } = await admin.from('leads').insert({
      name: lead.name,
      industry: lead.industry,
      region: lead.region,
      contact: lead.contact,
      plan: lead.plan,
      page: lead.page,
      source: 'web',
      ip_hash: ipHash,
      user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
    }).select('id').single();

    if (insertError || !inserted) {
      logInternal('submit-lead insert', insertError);
      return json(req, { ok: false, reason: 'server_error' }, 500);
    }

    const notified = await notifyTelegram(telegramText(lead, nowKst()));
    return json(req, { ok: true, id: inserted.id, notified }, 200);
  } catch (err) {
    logInternal('submit-lead', err);
    return json(req, { ok: false, reason: 'server_error' }, 500);
  }
});
