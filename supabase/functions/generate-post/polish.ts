// 현장로그 원고 다듬기 — 서버 전용 Gemini 호출
//
// · 키는 Supabase Secrets의 GEMINI_API_KEY 하나만 쓴다. 브라우저에는 어떤 키도 내려가지 않는다.
// · 규칙 기반 원고(engine.ts)를 초안으로 주고, 사진이 같이 왔으면 사진에서 보이는 상태만 반영해
//   문장을 다듬게 한다. 실패·시간 초과·형식 이탈이면 초안을 그대로 쓴다(안전한 폴백).
// · 결과는 engine.sanitize()를 거쳐 줄표·이모지·상투적 문구를 다시 지운 뒤 검사한다.

import { getChannel, sanitize } from './engine.ts';

/** 다듬기 요청에 실리는 사진 (긴 변 1024px JPEG base64). */
export interface PolishPhoto {
  slot: 'before' | 'during' | 'after';
  mime: string;
  data: string;
}

export interface PolishRequest {
  channel: string;
  draft: string;
  tone: string;
  photos: PolishPhoto[];
  apiKey: string;
  models?: string[];
  timeoutMs?: number;
}

export type PolishResult =
  | { ok: true; body: string; model: string }
  | { ok: false; reason: string };

const PHOTO_LABEL: Record<string, string> = {
  before: '시공 전 사진',
  during: '작업 중 사진',
  after: '시공 후 사진',
};

/** 2026-11 기준 이 키에서 실제로 응답하는 모델. 앞에서부터 시도한다. */
const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];

export function modelChain(envModel?: string): string[] {
  const head = String(envModel || '').trim();
  const list = head ? [head].concat(DEFAULT_MODELS) : DEFAULT_MODELS.slice();
  return list.filter((m, i) => list.indexOf(m) === i);
}

function photoRule(channel: string, withPhotos: boolean): string {
  if (withPhotos) {
    return '2. 첨부한 현장 사진(시공 전·작업 중·시공 후)을 실제로 보고, 사진에서 확인되는 상태만 묘사한다. 사진에 없으면 언급하지 않는다.';
  }
  return '2. 사진은 첨부되지 않았다. 초안에 있는 내용만 다듬고, 사진 묘사나 [사진 : ...] 줄을 새로 넣지 않는다.';
}

function channelRules(channel: string, tone: string, withPhotos: boolean): string[] {
  const ch = getChannel(channel);
  void withPhotos;

  if (ch.id === 'blog') {
    return [
      '3. \'[사진 : ...]\' 줄은 글자 그대로 유지한다. 그 줄이 가리키는 부위(예: 창틀·샤시, 욕실 줄눈)가 첨부 사진에 실제로 보이면 바로 아래 줄에 \'→ \' 로 시작하는 설명 한 줄을 넣는다. 사진에 그 부위가 없거나 다른 부위만 보이면 설명 줄을 넣지 않는다. 다른 공정의 사진 설명을 그 줄 밑에 붙이지 않는다.',
      '4. \'→ \' 줄에는 사진에서 실제로 보이는 것만 쓴다. 사진에 찍힌 부위와 그 줄의 공정 이름이 다르면 아무것도 쓰지 않는다.',
      '5. \'■\' 로 시작하는 소제목 구조와 \'■ 현장 요약\' 항목은 유지한다.',
      '6. 분량은 900~1,200자를 유지한다.',
      '7. 말투는 ' + tone + '로 통일한다.',
    ];
  }
  return [
    '3. \'' + ch.label + '\' 형식(첫 줄·줄바꿈·문단 순서·마지막 문의 유도 문장)을 그대로 유지한다. \'[사진 : ...]\'나 \'■\' 소제목은 새로 넣지 않는다.',
    '4. 분량은 초안과 비슷하게 유지한다' + (ch.id === 'threads' ? ' (500자 이내).' : '.'),
    '5. 말투는 초안의 구어체를 유지한다.',
    '6. 사진에 찍힌 부위와 다른 공정 이야기를 사진 근거로 쓰지 않는다.',
  ];
}

export function buildPrompt(req: Pick<PolishRequest, 'channel' | 'draft' | 'tone' | 'photos'>): string {
  const ch = getChannel(req.channel);
  const withPhotos = req.photos.length > 0;
  const head = withPhotos
    ? '아래 초안은 규칙 기반으로 만든 원고다. 첨부한 현장 사진을 실제로 보고, 사진에서 확인되는 상태만 반영해 문장을 다듬어라.'
    : '아래 초안은 규칙 기반으로 만든 원고다. 사진 없이 문장만 자연스럽게 다듬어라.';
  return [
    '너는 한국 시공·청소 업체 사장님의 ' + ch.label + ' 후기를 다듬는 편집자다.',
    head,
    '',
    '지킬 것:',
    '1. 지역, 평수, 업종, 공정 이름, 견적, 업체명, 연락처 같은 사실은 초안 그대로 둔다. 없는 내용을 지어내지 않는다.',
    photoRule(req.channel, withPhotos),
  ]
    .concat(channelRules(req.channel, req.tone, withPhotos))
    .concat([
      '- 금지 표현: ~에 대해 알아보겠습니다, 살펴보겠습니다, 다음과 같습니다, 결론적으로, 요약하면, 시사하는 바, 본질적으로, 도움이 되셨길, 지금부터, 최고, 완벽, 100%',
      '- 줄표(—, –)를 쓰지 않는다. 나열이 필요하면 쉼표나 마침표로 끊는다.',
      '- 연결어미(-고, -며, -서, -는데, -니까) 바로 뒤에 쉼표를 넣지 않는다.',
      '- 광고 문구나 이모지를 새로 넣지 않는다. "저희가 최선을 다해" 같은 뻔한 문장도 넣지 않는다.',
      '- 다 쓰고 나서 스스로 확인한다: ① 지역·평수·공정·견적·연락처가 초안과 같은가 ② 줄표가 없는가 ③ 이모지가 없는가 ④ 연결어미 뒤에 쉼표가 없는가 ⑤ 초안에 없던 사실이나 수치를 넣지 않았는가.',
      '- 출력은 다듬은 본문 전체만. 설명, 인사말, 코드블록 표시 없이.',
      '',
      '─ 초안 ─',
      req.draft,
    ])
    .join('\n');
}

function stripFence(text: string): string {
  return String(text || '')
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*(다듬은\s*본문|본문)\s*[:：]\s*/i, '')
    .trim();
}

/** 사진이 없을 때는 모델이 지어낸 사진 설명(→ 줄)을 남기지 않는다. */
export function stripPhotoArrows(text: string): string {
  return String(text || '')
    .split('\n')
    .filter((line) => !/^\s*→/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 다듬은 글이 형식을 지켰는지 검사한다. 어긋나면 초안을 그대로 쓴다. */
export function acceptPolished(channel: string, polished: string, draft: string): { ok: boolean; reason: string } {
  const ch = getChannel(channel);
  const text = String(polished || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > 6000) return { ok: false, reason: 'too_long' };
  if (ch.id === 'blog') {
    if (text.length < 300) return { ok: false, reason: 'too_short' };
    if (text.indexOf('■') < 0) return { ok: false, reason: 'format' };
    const need = (String(draft).match(/\[사진\s*:/g) || []).length;
    const got = (text.match(/\[사진\s*:/g) || []).length;
    if (need > 0 && got < need) return { ok: false, reason: 'photo_markers' };
  } else {
    if (text.length < 80) return { ok: false, reason: 'too_short' };
    if (/\[사진\s*:/.test(text) || /^■/m.test(text)) return { ok: false, reason: 'format' };
  }
  // 초안에 있던 숫자 사실(평수·금액·연락처)이 사라지면 받지 않는다.
  const numsOf = (s: string) => (String(s).match(/\d[\d,]*/g) || [])
    .map((n) => n.replace(/,/g, ''))
    .filter((n) => n.length >= 2);
  const have = new Set(numsOf(text));
  const lost = numsOf(draft).filter((n) => !have.has(n));
  if (lost.length) return { ok: false, reason: 'facts' };
  return { ok: true, reason: '' };
}

async function callModel(model: string, req: PolishRequest, timeoutMs: number): Promise<{ status: number; text: string }> {
  const parts: Record<string, unknown>[] = [{ text: buildPrompt(req) }];
  for (const ph of req.photos) {
    parts.push({ text: PHOTO_LABEL[ph.slot] || '현장 사진' });
    parts.push({ inline_data: { mime_type: ph.mime || 'image/jpeg', data: ph.data } });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.75, topP: 0.95, maxOutputTokens: req.channel === 'blog' ? 3000 : 1200 },
        }),
        signal: controller.signal,
      },
    );
    const raw = await res.text();
    if (!res.ok) return { status: res.status, text: '' };
    const data = JSON.parse(raw || '{}');
    const cand = data && data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts
      ? cand.content.parts.map((p: { text?: string }) => p.text || '').join('\n')
      : '';
    return { status: 200, text };
  } finally {
    clearTimeout(timer);
  }
}

/** 초안 하나를 다듬는다. 모델을 차례로 시도하고, 전부 실패하면 ok:false 로 폴백을 알린다.
 *
 * timeoutMs는 이 채널 전체에 주는 시간 예산이다. 남은 시간 안에서만 다음 시도를 건다.
 */
export async function polishDraft(req: PolishRequest): Promise<PolishResult> {
  if (!req.apiKey) return { ok: false, reason: 'no_key' };
  const models = (req.models && req.models.length ? req.models : modelChain()).slice(0, 3);
  const budget = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 18000;
  const deadline = Date.now() + budget;
  const left = () => deadline - Date.now();
  const finish = (raw: string) => {
    const clean = sanitize(stripFence(raw));
    return req.photos.length ? clean : stripPhotoArrows(clean);
  };
  let last = 'failed';
  let attempts = 0;
  for (const model of models) {
    // 같은 모델을 최대 2번(503·429·시간 초과 대비), 전체 시도는 4번까지만.
    for (let i = 0; i < 2 && attempts < 4 && left() > 1500; i++) {
      attempts++;
      let status = 0;
      try {
        const r = await callModel(model, req, Math.min(12000, left()));
        status = r.status;
        if (status === 200) {
          const clean = finish(r.text);
          const check = acceptPolished(req.channel, clean, req.draft);
          if (check.ok) return { ok: true, body: clean, model };
          last = 'reject_' + check.reason;
          break; // 형식이 어긋난 결과는 같은 모델로 다시 받아도 같다 → 다음 모델
        }
        last = 'http_' + status;
      } catch (err) {
        status = (err as { name?: string }).name === 'AbortError' ? -1 : -2;
        last = status === -1 ? 'timeout' : 'error';
      }
      // 서버 혼잡·한도·날씨 같은 일시 오류만 같은 모델로 한 번 더.
      if (status === 503 || status === 429 || status === -1 || status === -2) continue;
      break;
    }
  }
  return { ok: false, reason: last };
}
