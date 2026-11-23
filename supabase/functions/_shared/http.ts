// 현장로그 Edge Function 공통 HTTP 도우미 (CORS · JSON 응답)
//
// 배포 도메인은 GitHub Pages 오리진입니다. 허용 오리진은 Edge Function Secrets의
// ALLOWED_ORIGINS(쉼표 구분)로 바꿀 수 있고, 없으면 아래 기본값을 씁니다.

const DEFAULT_ORIGINS = [
  'https://lab5037.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function allowedOrigins(): string[] {
  const raw = (Deno.env.get('ALLOWED_ORIGINS') || '').trim();
  const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  return list.length ? list : DEFAULT_ORIGINS;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const list = allowedOrigins();
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && list.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  else if (!origin) headers['Access-Control-Allow-Origin'] = list[0];
  // 허용 목록에 없는 오리진에는 ACAO를 붙이지 않는다 → 브라우저가 응답을 읽지 못한다.
  return headers;
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** 요청 본문을 안전하게 읽는다. 너무 크거나 JSON이 아니면 null. */
export async function readJson(req: Request, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  const declared = Number(req.headers.get('Content-Length') || '0');
  if (declared && declared > maxBytes) return null;
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    return null;
  }
  if (!raw || raw.length > maxBytes) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 같은 오류 문구를 여러 곳에서 쓰지 않도록 한 곳에 둔다. 내부 예외 내용은 절대 넣지 않는다. */
export function logInternal(tag: string, err: unknown): void {
  const name = (err && typeof err === 'object' && 'name' in err) ? String((err as { name?: string }).name) : 'Error';
  const code = (err && typeof err === 'object' && 'code' in err) ? String((err as { code?: string }).code) : '';
  // 메시지에는 요청 URL(토큰 포함)이 찍힐 수 있으므로 길이와 종류만 남긴다.
  console.error('[fieldlog]', tag, name, code);
}
