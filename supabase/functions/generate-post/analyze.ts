// 현장로그 사진 정밀 분석 — 서버 전용 Gemini 호출 (원고 1건당 1회)
//
// 원고를 쓰기 전에 사진에서 보이는 상태를 한 번 구조화해 둔다.
//   1단계 analyzeSite() : 사진 → 구조화된 현장 진단(보이는 상태·부위·원인·시공 포인트)
//   2단계 polishDraft() : 그 진단을 채널별 프롬프트에 넣어 이 현장에 맞는 문장을 만든다.
//
// · 키는 Supabase Secrets의 GEMINI_API_KEY 하나만 쓴다(브라우저에는 내려가지 않는다).
// · 분석이 실패하면 이 함수는 ok:false 를 돌려주고, 호출부는 사진을 그대로 넘기는 예전 방식으로 돌아간다.
// · 사진에 없는 것은 쓰지 않는다. 특히 시공 후 사진이 없으면 '완료·해결·깨끗해짐' 을 만들지 않는다.

import { sanitize } from './engine.ts';
import { PHOTO_LABEL, modelChain, type PolishPhoto } from './polish.ts';

export type PhotoSlot = 'before' | 'during' | 'after';

/** 사진에서 읽어낸 현장 진단. 모두 짧은 구(句) 단위다. */
export interface SiteAnalysis {
  /** 눈에 보이는 상태 — 오염·변색·곰팡이·들뜸·벌어짐·긁힘 등 */
  observed: string[];
  /** 부위와 재질 — 예: '욕실 바닥 줄눈', '창틀 알루미늄' */
  locations: string[];
  /** 추정 원인 — '...로 보임' 형태 */
  causes: string[];
  /** 시공할 때 신경 써야 할 점 */
  keyPoints: string[];
  /** 사진으로 확인하기 어려운 부분 */
  limits: string[];
  /** 사장님이 읽을 1~2문장 요약 (응답 ai.analysis 로 나간다) */
  summary: string;
  /** 분석에 쓰인 사진 자리 */
  photoSlots?: PhotoSlot[];
}

export interface AnalyzeInput {
  photos: PolishPhoto[];
  apiKey: string;
  models?: string[];
  timeoutMs?: number;
  /** 업종 라벨 — 진단 어휘를 업종에 맞춘다 */
  industry?: string;
  /** 사장님이 적은 증상 (사진에서 확인될 때만 반영) */
  detail?: string;
  /** 테스트에서 갈아끼우는 fetch(기본값은 전역 fetch) */
  fetchImpl?: typeof fetch;
}

export type AnalyzeResult =
  | { ok: true; value: SiteAnalysis; model: string }
  | { ok: false; reason: string };

const MAX_ITEMS = { observed: 6, locations: 4, causes: 3, keyPoints: 4, limits: 2 } as const;
const MAX_ITEM_CHARS = 48;
const MAX_SUMMARY_CHARS = 160;

export function buildAnalysisPrompt(
  req: { industry?: string; detail?: string; slots: PhotoSlot[] },
): string {
  const slots = req.slots.filter((s) => !!PHOTO_LABEL[s]);
  const slotText = slots.map((s) => PHOTO_LABEL[s]).join(', ');
  const hasAfter = slots.indexOf('after') >= 0;
  const industry = String(req.industry || '').trim();
  const detail = String(req.detail || '').trim();

  const head = ['너는 한국 시공·청소 업체의 현장 사진을 읽는 현장 진단 담당자다.'];
  if (industry) head.push('업종: ' + industry);
  if (detail) head.push('사장님이 적어 준 증상: ' + detail);

  const lines: string[] = head.concat([
    '첨부한 사진은 ' + slotText + ' 이다. 사진에 실제로 보이는 것만 근거로 현장 상태를 정리해 JSON 하나로만 답한다.',
    '',
    '지킬 것:',
    '1. 사진에서 실제로 보이는 것만 쓴다. 보이지 않는 부위·냄새·소리·이력은 쓰지 않는다.',
    hasAfter
      ? '2. 사진에 시공 후 사진이 있다. 시공 후 사진에서 확인되는 상태만 결과로 쓴다.'
      : '2. 사진에 시공 후 사진이 없다. 완료·해결·깨끗해졌다는 표현과 결과 묘사를 쓰지 않는다.',
    '3. 개수·면적·비율·기간을 세지 않는다(2곳, 30%, 3일 같은 값 금지).',
    '4. 업체명·브랜드·가격·연락처·평수는 쓰지 않는다.',
    '5. observed는 눈에 보이는 상태, locations는 부위와 재질, causes는 원인 추정, keyPoints는 시공할 때 신경 써야 할 점, limits는 사진으로 확인하기 어려운 부분이다.',
    '6. 각 항목은 12~40자의 짧은 구로 쓴다. 같은 말을 두 번 쓰지 않는다.',
    '7. summary는 1~2문장 60~120자. 무엇이 어디에 어떻게 보이는지 구체적으로 써서, 사장님이 읽고 자기 사진을 봤다고 느낄 정도여야 한다.',
    '8. 줄표(—, –), 이모지, 광고 문구, 인사말, 인공지능 티 나는 말투를 쓰지 않는다.',
    '9. JSON만 출력한다. 코드블록이나 설명을 붙이지 않는다.',
    '',
    '출력 형식:',
    '{"observed":["..."],"locations":["..."],"causes":["..."],"keyPoints":["..."],"limits":["..."],"summary":"..."}',
  ]);
  if (detail) {
    lines.push(
      '',
      '사장님이 적은 증상은 사진에서 확인되면 observed 에 반영한다. 사진에서 확인되지 않으면 limits 에 "적어 준 증상은 사진으로 확인되지 않음"처럼 적고 observed 에는 넣지 않는다.',
    );
  }
  return lines.join('\n');
}

function cleanItem(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = sanitize(value)
    .replace(/\s+/g, ' ')
    .replace(/^[·•\-*\s]+/, '')
    .replace(/[.。]+$/, '')
    .trim();
  return text.slice(0, MAX_ITEM_CHARS).trim();
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = cleanItem(item);
    if (!text) continue;
    if (out.indexOf(text) >= 0) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function cleanSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = sanitize(value).replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS).trim();
  if (!text) return '';
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 2).join(' ').trim();
}

/** 모델 응답(JSON 문자열)을 진단 객체로 바꾼다. 형식이 어긋나면 null(폴백 신호). */
export function parseAnalysis(raw: string): SiteAnalysis | null {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const value: SiteAnalysis = {
    observed: cleanList(data.observed, MAX_ITEMS.observed),
    locations: cleanList(data.locations, MAX_ITEMS.locations),
    causes: cleanList(data.causes, MAX_ITEMS.causes),
    keyPoints: cleanList(data.keyPoints, MAX_ITEMS.keyPoints),
    limits: cleanList(data.limits, MAX_ITEMS.limits),
    summary: cleanSummary(data.summary),
  };
  if (!value.observed.length && !value.keyPoints.length && !value.summary) return null;
  if (!value.summary) {
    // 요약이 비면 관찰에서 만든다(사진에서 읽은 것만으로).
    const seed = value.observed.length ? value.observed : value.keyPoints;
    value.summary = seed.slice(0, 2).join('. ').slice(0, MAX_SUMMARY_CHARS).trim();
  }
  return value;
}

/** 프롬프트·화면에 넣을 진단 요약 블록. */
export function describeAnalysis(a: SiteAnalysis | null | undefined): string {
  if (!a) return '';
  const rows: string[] = [];
  const add = (label: string, items: string[]) => {
    if (items && items.length) rows.push('· ' + label + ' : ' + items.join(' / '));
  };
  add('보이는 상태', a.observed);
  add('부위·재질', a.locations);
  add('추정 원인', a.causes);
  add('시공 시 핵심', a.keyPoints);
  add('확인 어려움', a.limits);
  if (a.summary) rows.push('· 요약 : ' + a.summary);
  return rows.join('\n');
}

/** 진단이 원고에 쓸 만큼 내용이 있는지. */
export function usableAnalysis(a: SiteAnalysis | null | undefined): boolean {
  if (!a) return false;
  return !!(a.summary || a.observed.length || a.keyPoints.length);
}

async function callAnalysisModel(
  model: string,
  prompt: string,
  photos: PolishPhoto[],
  apiKey: string,
  timeoutMs: number,
  fetchImpl?: typeof fetch,
  jsonMode = true,
): Promise<{ status: number; text: string }> {
  const parts: Record<string, unknown>[] = [{ text: prompt }];
  for (const ph of photos) {
    parts.push({ text: PHOTO_LABEL[ph.slot] || '현장 사진' });
    parts.push({ inline_data: { mime_type: ph.mime || 'image/jpeg', data: ph.data } });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const doFetch = fetchImpl || fetch;
    const res = await doFetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: jsonMode
            ? { temperature: 0.35, topP: 0.9, maxOutputTokens: 900, responseMimeType: 'application/json' }
            : { temperature: 0.35, topP: 0.9, maxOutputTokens: 900 },
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

/** 사진 1장 이상을 한 번에 읽어 구조화된 진단을 만든다. */
export async function analyzeSite(req: AnalyzeInput): Promise<AnalyzeResult> {
  if (!req.apiKey) return { ok: false, reason: 'no_key' };
  if (!req.photos.length) return { ok: false, reason: 'no_photos' };

  const slots = req.photos.map((p) => p.slot);
  const prompt = buildAnalysisPrompt({ industry: req.industry, detail: req.detail, slots });
  const models = (req.models && req.models.length ? req.models : modelChain()).slice(0, 2);
  const budget = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 16000;
  const deadline = Date.now() + budget;
  const left = () => deadline - Date.now();

  let last = 'failed';
  let attempts = 0;

  /** 모델 한 번 호출. JSON 모드를 모르는 모델(400)이면 일반 텍스트로 한 번 더 시도한다. */
  const run = async (model: string, jsonMode: boolean) => {
    attempts++;
    try {
      const r = await callAnalysisModel(
        model, prompt, req.photos, req.apiKey, Math.min(12000, left()), req.fetchImpl, jsonMode,
      );
      if (r.status === 200) {
        const value = parseAnalysis(r.text);
        if (value) {
          value.photoSlots = slots;
          return { ok: true as const, value, model };
        }
        return { ok: false as const, status: 200, reason: 'reject_format' };
      }
      return { ok: false as const, status: r.status, reason: 'http_' + r.status };
    } catch (err) {
      const aborted = (err as { name?: string }).name === 'AbortError';
      return { ok: false as const, status: aborted ? -1 : -2, reason: aborted ? 'timeout' : 'error' };
    }
  };

  for (const model of models) {
    // 서버 혼잡·한도·시간 초과는 같은 모델로 한 번 더, 전체 시도는 4번까지.
    for (let i = 0; i < 2 && attempts < 4 && left() > 2000; i++) {
      const first = await run(model, true);
      if (first.ok) return first;
      last = first.reason;
      if (first.status === 400 && left() > 2000) {
        const plain = await run(model, false);
        if (plain.ok) return plain;
        last = plain.reason;
        break;
      }
      // 형식이 깨진 응답은 같은 모델로 다시 받아도 같다 → 다음 모델
      if (first.status === 200) break;
      if (first.status === 503 || first.status === 429 || first.status === -1 || first.status === -2) continue;
      break;
    }
  }
  return { ok: false, reason: last };
}
