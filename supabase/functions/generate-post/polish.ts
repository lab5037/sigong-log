// 현장로그 원고 다듬기 — 서버 전용 Gemini 호출
//
// · 키는 Supabase Secrets의 GEMINI_API_KEY 하나만 쓴다. 브라우저에는 어떤 키도 내려가지 않는다.
// · 규칙 기반 원고(engine.ts)를 초안으로 주고, 사진이 같이 왔으면 사진에서 보이는 상태만 반영해
//   문장을 다듬게 한다. 실패·시간 초과·형식 이탈이면 초안을 그대로 쓴다(안전한 폴백).
// · 결과는 engine.sanitize()를 거쳐 줄표·이모지·상투적 문구를 다시 지운 뒤 검사한다.

import { getChannel, sanitize } from './engine.ts';
import { describeAnalysis, type SiteAnalysis } from './analyze.ts';

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
  /** 동네 이름 — 다듬은 본문의 키워드 반복이 3~7회를 벗어나면 초안을 쓴다. */
  region?: string;
  /** 1단계 사진 분석 결과. 있으면 사진을 다시 보내지 않고 이 진단을 근거로 쓴다. */
  analysis?: SiteAnalysis | null;
  /** 테스트에서 갈아끼우는 fetch(기본값은 전역 fetch) */
  fetchImpl?: typeof fetch;
}

export type PolishResult =
  | { ok: true; body: string; model: string }
  | { ok: false; reason: string };

export const PHOTO_LABEL: Record<string, string> = {
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

function photoRule(withEvidence: boolean, analysis: SiteAnalysis | null): string {
  if (analysis) {
    return '2. 사진에서 확인된 상태는 [사진 분석]에 적힌 것만 쓴다. [사진 분석]에 없는 부위·오염·원인·완료 결과를 새로 만들지 않는다.';
  }
  if (withEvidence) {
    return '2. 첨부한 현장 사진(시공 전·작업 중·시공 후)을 실제로 보고, 사진에서 확인되는 상태만 묘사한다. 사진에 없으면 언급하지 않는다.';
  }
  return '2. 사진은 첨부되지 않았다. 초안에 있는 내용만 다듬고, 사진 묘사나 [사진 : ...] 줄을 새로 넣지 않는다.';
}

/** 분석에 시공 후 사진이 없으면 결과를 사진으로 확인했다는 표현을 막는다. */
function noAfterRule(analysis: SiteAnalysis | null): string {
  if (!analysis) return '';
  const slots = analysis.photoSlots || [];
  if (!slots.length || slots.indexOf('after') >= 0) return '';
  return '2-2. 시공 후 사진이 없다. 사진으로 결과를 확인했다는 표현(사진에서 보시면, 사진으로 확인되듯, 사진 속 마감)을 쓰지 않고, 끝난 일은 초안에 적힌 작업 내용으로만 설명한다.';
}

function analysisRule(channel: string, analysis: SiteAnalysis | null): string[] {
  if (!analysis) return [];
  const ch = getChannel(channel);
  const out = [
    '2-1. [사진 분석]의 내용은 ① 이 현장의 상태를 설명하는 문장 ② 왜 그런 상태가 생겼는지 설명하는 문장 ③ 사후 관리 팁, 이 세 곳에만 반영한다. 견적·평수·연락처·지역 이름은 초안 그대로 둔다.',
  ];
  if (ch.id === 'blog') {
    out.push(
      '10. ■ 작업 전 상태 목록에 [사진 분석]에서 확인된 상태를 1~2줄(\'· \' 로 시작) 더한다. 기존 항목은 지우지 않는다.',
      '11. 본문 어딘가에 [사진 분석]의 추정 원인을 한 문장으로 설명한다. 원인을 단정하지 말고 \'...로 보입니다\'처럼 쓴다.',
      '12. ■ 셀프로 확인할 포인트에는 이 현장 상태에 맞는 관리 팁을 하나 더한다. 기존 항목은 지우지 않는다.',
      '13. [사진 분석]에 없는 공정을 새로 만들지 않는다. 초안의 공정 이름과 순서를 그대로 둔다.',
    );
  } else {
    out.push(
      '8. [사진 분석]에서 가장 눈에 띄는 상태 하나를 첫 두 문단 안에 이 현장의 상태로 녹인다. 사진에 없는 부위는 넣지 않는다.',
      '9. [사진 분석]에 없는 공정을 새로 만들지 않고, 초안의 형식과 순서를 그대로 둔다.',
    );
  }
  return out;
}

function channelRules(channel: string, tone: string, withPhotos: boolean, analysis: SiteAnalysis | null): string[] {
  const ch = getChannel(channel);
  void withPhotos;

  if (ch.id === 'blog') {
    const marker3 = analysis
      ? '3. \'[사진 : ...]\' 줄은 글자 그대로 유지한다. [사진 분석]에서 그 줄이 가리키는 부위(예: 창틀·샤시, 욕실 줄눈)가 확인되면 바로 아래 줄에 \'→ \' 로 시작하는 설명 한 줄을 넣는다. [사진 분석]에 그 부위가 없으면 넣지 않는다.'
      : '3. \'[사진 : ...]\' 줄은 글자 그대로 유지한다. 그 줄이 가리키는 부위(예: 창틀·샤시, 욕실 줄눈)가 첨부 사진에 실제로 보이면 바로 아래 줄에 \'→ \' 로 시작하는 설명 한 줄을 넣는다. 사진에 그 부위가 없거나 다른 부위만 보이면 설명 줄을 넣지 않는다. 다른 공정의 사진 설명을 그 줄 밑에 붙이지 않는다.';
    const marker4 = analysis
      ? '4. \'→ \' 줄에는 [사진 분석]에 적힌 것만 쓴다. 그 줄의 공정과 분석한 부위가 다르면 아무것도 쓰지 않는다.'
      : '4. \'→ \' 줄에는 사진에서 실제로 보이는 것만 쓴다. 사진에 찍힌 부위와 그 줄의 공정 이름이 다르면 아무것도 쓰지 않는다.';
    return [
      marker3,
      marker4,
      '5. \'■\' 로 시작하는 소제목 구조와 \'■ 현장 요약\' 항목은 유지한다. \'■ 작업 전 상태\', \'■ 작업 순서\', \'■ 달라진 점\', \'■ 셀프로 확인할 포인트\' 소제목과 그 아래 목록은 지우지 않는다.',
      '6. 첫 문단에서 지역명과 업종 키워드를 빼지 않는다. 제목과 첫 문단만 봐도 무엇을 하는 곳인지 알 수 있어야 한다.',
      '7. 지역·업종 키워드는 초안에 나온 자리에서 3~7회 안으로 자연스럽게 둔다. 같은 키워드를 문장마다 반복하거나 소제목에 도배하지 않는다.',
      '8. 분량은 초안과 비슷하게 유지한다(1,500자 이상, 3,500자 이하).',
      '9. 말투는 ' + tone + '로 통일한다.',
    ];
  }
  return [
    '3. \'' + ch.label + '\' 형식(첫 줄·줄바꿈·문단 순서·마지막 문의 유도 문장)을 그대로 유지한다. \'[사진 : ...]\'나 \'■\' 소제목은 새로 넣지 않는다.',
    '4. 분량은 초안과 비슷하게 유지한다' + (ch.id === 'threads' ? ' (500자 이내).' : '.'),
    '5. 첫 줄과 첫 문단에서 지역명·업종 키워드를 빼지 않고, 초안에 나온 자리에서 3~7회 안으로 둔다. 도배하지 않는다.',
    '6. 말투는 초안의 구어체를 유지한다.',
    '7. 사진에 찍힌 부위와 다른 공정 이야기를 사진 근거로 쓰지 않는다.',
  ];
}

export function buildPrompt(req: Pick<PolishRequest, 'channel' | 'draft' | 'tone' | 'photos' | 'analysis'>): string {
  const ch = getChannel(req.channel);
  const withPhotos = req.photos.length > 0;
  const analysis = req.analysis || null;
  const head = analysis
    ? '아래 초안은 규칙 기반으로 만든 원고다. 첨부한 현장 사진을 먼저 분석한 결과가 [사진 분석]에 있다. 분석에서 확인된 상태만 근거로, 이 현장에만 맞는 문장으로 다듬어라.'
    : withPhotos
      ? '아래 초안은 규칙 기반으로 만든 원고다. 첨부한 현장 사진을 실제로 보고, 사진에서 확인되는 상태만 반영해 문장을 다듬어라.'
      : '아래 초안은 규칙 기반으로 만든 원고다. 사진 없이 문장만 자연스럽게 다듬어라.';
  return [
    '너는 한국 시공·청소 업체 사장님의 ' + ch.label + ' 후기를 다듬는 편집자다.',
    head,
    '',
    '지킬 것:',
    '1. 지역, 평수, 업종, 공정 이름, 견적, 업체명, 연락처 같은 사실은 초안 그대로 둔다. 없는 내용을 지어내지 않는다.',
    photoRule(withPhotos, analysis),
  ]
    .concat(noAfterRule(analysis) ? [noAfterRule(analysis)] : [])
    .concat(analysisRule(req.channel, analysis))
    .concat(channelRules(req.channel, req.tone, withPhotos, analysis))
    .concat([
      '- 금지 표현: ~에 대해 알아보겠습니다, 살펴보겠습니다, 다음과 같습니다, 다음과 같은, 결론적으로, 요약하면, 시사하는 바, 본질적으로, 도움이 되셨길, 지금부터, 최고, 완벽, 100%',
      '- 줄표(—, –)를 쓰지 않는다. 나열이 필요하면 쉼표나 마침표로 끊는다.',
      '- 연결어미(-고, -며, -서, -는데, -니까) 바로 뒤에 쉼표를 넣지 않는다.',
      '- 광고 문구나 이모지를 새로 넣지 않는다. "저희가 최선을 다해" 같은 뻔한 문장도 넣지 않는다.',
      '- 다 쓰고 나서 스스로 확인한다: ① 지역·평수·공정·견적·연락처가 초안과 같은기 ② 줄표가 없는가 ③ 이모지가 없는가 ④ 연결어미 뒤에 쉼표가 없는가 ⑤ ' + (analysis ? '초안과 [사진 분석]에 없던 사실·수치를 넣지 않았는가' : '초안에 없던 사실이나 수치를 넣지 않았는가') + '.',
      '- 출력은 다듬은 본문 전체만. 설명, 인사말, 코드블록 표시 없이.',
    ])
    .concat(analysis ? ['', '─ 사진 분석 ─', describeAnalysis(analysis)] : [])
    .concat(['', '─ 초안 ─', req.draft])
    .join('\n');
}

function stripFence(text: string): string {
  return String(text || '')
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*(다듬은\s*본문|본문)\s*[:：]\s*/i, '')
    .trim();
}

/** 사진 설명 줄([사진 : ...])의 기준 키 — 공정 이름 부분. */
const MARKER_RE = /^\[사진\s*:\s*([^\]]*)\]\s*$/;

function markerKey(line: string): string {
  return line.replace(/^\[사진\s*:\s*/, '').replace(/\]$/, '').split('·')[0].trim();
}

/** 모델이 사진 위치 줄을 줄이거나 바꿔 썼으면 초안의 줄 그대로 되돌린다. */
export function restoreMarkers(polished: string, draft: string): string {
  const draftMarkers = String(draft)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => MARKER_RE.test(l));
  if (!draftMarkers.length) return polished;
  const byKey = new Map<string, string>();
  for (const m of draftMarkers) {
    const k = markerKey(m);
    if (!byKey.has(k)) byKey.set(k, m);
  }
  return String(polished)
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (!MARKER_RE.test(t)) return line;
      if (draftMarkers.indexOf(t) >= 0) return t;
      const cand = byKey.get(markerKey(t));
      return cand || line;
    })
    .join('\n');
}

/** 같은 사진 위치 줄을 모델이 여러 번 반복하면 첫 줄만 남긴다(사진 한 장에 설명 한 줄). */
export function collapseMarkers(text: string): string {
  const lines = String(text || '').split('\n');
  const out: string[] = [];
  let lastMarker = '';
  let arrowKept = false;
  for (const line of lines) {
    const t = line.trim();
    if (MARKER_RE.test(t)) {
      if (t === lastMarker) {
        // 반복된 위치 줄은 버린다. 이미 설명 줄을 남겼으면 그 아래 설명도 버린다.
        continue;
      }
      lastMarker = t;
      arrowKept = false;
      out.push(line);
      continue;
    }
    if (/^→/.test(t)) {
      if (arrowKept) continue;
      arrowKept = true;
      out.push(line);
      continue;
    }
    if (t) arrowKept = false;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

/** AI 상투어의 변형(초안에는 없는 말) — sanitize가 지우지 못하는 형태. */
const SLOP = ['다음과 같', '라고 할 수 있', '요약하자면', '정리하자면', '도움이 되셨', '도움이 되었'];

export function acceptPolished(channel: string, polished: string, draft: string, region?: string): { ok: boolean; reason: string } {
  const ch = getChannel(channel);
  const text = String(polished || '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > 6000) return { ok: false, reason: 'too_long' };
  if (SLOP.some((s) => text.includes(s))) return { ok: false, reason: 'slop' };
  // 동네 이름이 3~7회를 벗어나면(도배 또는 누락) 초안을 그대로 쓴다.
  const area = String(region || '').trim();
  if (ch.id === 'blog' && area) {
    const hits = (s: string) => s.split(area).length - 1;
    const inRange = (n: number) => n >= 3 && n <= 7;
    if (inRange(hits(String(draft))) && !inRange(hits(text))) return { ok: false, reason: 'keyword_count' };
  }
  if (ch.id === 'blog') {
    if (text.length < 300) return { ok: false, reason: 'too_short' };
    // 초안보다 크게 줄어든 결과는 받지 않는다(분량이 줄면 검색 노출에 불리하다).
    if (text.length < Math.floor(String(draft || '').length * 0.8)) return { ok: false, reason: 'too_short' };
    if (text.indexOf('■') < 0) return { ok: false, reason: 'format' };
    const draftMarkers = String(draft)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => MARKER_RE.test(l));
    if (draftMarkers.some((m) => text.indexOf(m) < 0)) return { ok: false, reason: 'photo_markers' };
    const gotMarkers = text.split('\n').map((l) => l.trim()).filter((l) => MARKER_RE.test(l));
    if (gotMarkers.length !== draftMarkers.length) return { ok: false, reason: 'photo_markers' };
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
    const doFetch = req.fetchImpl || fetch;
    const res = await doFetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.75, topP: 0.95, maxOutputTokens: req.channel === 'blog' ? 4000 : 1200 },
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
    const clean = collapseMarkers(restoreMarkers(sanitize(stripFence(raw)), req.draft));
    const withEvidence = req.photos.length > 0 || !!req.analysis;
    return withEvidence ? clean : stripPhotoArrows(clean);
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
          const check = acceptPolished(req.channel, clean, req.draft, req.region);
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
