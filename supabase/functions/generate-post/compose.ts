// 현장로그 생성 파이프라인 — Edge Function 의 본체(index.ts)에서 분리한 순수 로직
//
//   1) 사진 정밀 분석 (사진이 있을 때 1회)  → analyze.ts
//   2) 규칙 기반 초안 4채널                 → engine.ts (호출부에서 만든 posts 를 받는다)
//   3) 분석을 넣은 프롬프트로 채널별 다듬기 → polish.ts
//
// HTTP·인증·횟수 차감은 index.ts 가 맡고, 여기서는 Gemini 호출과 폴백만 다룬다.
// 테스트는 fetchImpl 을 갈아끼워 네트워크 없이 두 단계 흐름을 그대로 확인한다.

import { INDUSTRIES, STYLE_LABEL, parsePlace } from './engine.ts';
import type { GenerateInput } from './input.ts';
import { modelChain, polishDraft, type PolishPhoto } from './polish.ts';
import { analyzeSite, type SiteAnalysis } from './analyze.ts';

export type Post = { body?: string; [key: string]: unknown };

/** 서버 환경(Secrets)에서 오는 값. 테스트에서는 직접 채운다. */
export interface AiEnv {
  apiKey: string;
  /** GEMINI_MODEL — 앞에 두고 기본 모델을 뒤에 붙인다. */
  model?: string;
  /** always | photos | off */
  mode?: string;
  fetchImpl?: typeof fetch;
}

export interface AiSummary {
  used: boolean;
  reason: string;
  model: string | null;
  channels: Record<string, 'ai' | 'draft'>;
  /** 사진에서 읽어낸 핵심 관찰 1~2문장 — 결과 화면 'AI 사진 분석' */
  analysis: string | null;
  analysisUsed: boolean;
  analysisModel: string | null;
}

const CHANNEL_IDS = ['blog', 'danggeun', 'insta', 'threads'];

export function photoList(input: GenerateInput): PolishPhoto[] {
  return (['before', 'during', 'after'] as const)
    .filter((slot) => !!input.images[slot])
    .map((slot) => ({ slot, mime: 'image/jpeg', data: input.images[slot] }));
}

function idleChannels(): Record<string, 'ai' | 'draft'> {
  const out: Record<string, 'ai' | 'draft'> = {};
  for (const id of CHANNEL_IDS) out[id] = 'draft';
  return out;
}

export interface AnalysisOutcome {
  value: SiteAnalysis | null;
  model: string | null;
  reason: string;
}

/** 1단계: 사진 정밀 분석(1회). 실패하면 value:null 로 두고 다듬기는 사진을 직접 넘긴다. */
export async function analyzePhotos(input: GenerateInput, env: AiEnv): Promise<AnalysisOutcome> {
  if (!env.apiKey) return { value: null, model: null, reason: 'no_key' };
  if ((env.mode || 'always') === 'off') return { value: null, model: null, reason: 'mode_off' };
  const photos = photoList(input);
  if (!photos.length) return { value: null, model: null, reason: 'no_photos' };

  const note = [input.detail, input.extra].filter(Boolean).join(', ');
  const hit = INDUSTRIES.find((i) => i.id === input.industryId);
  const r = await analyzeSite({
    photos,
    apiKey: env.apiKey,
    models: modelChain(env.model),
    timeoutMs: 16000,
    industry: hit ? hit.label : input.industryId,
    detail: note,
    fetchImpl: env.fetchImpl,
  });
  if (!r.ok) return { value: null, model: null, reason: r.reason };
  return { value: r.value, model: r.model, reason: 'ok' };
}

/** 2·3단계: 분석을 넣어 4채널을 다듬는다. 실패한 채널은 규칙 기반 초안을 그대로 둔다. */
export async function polishPosts(
  input: GenerateInput,
  posts: Record<string, Post>,
  analysis: SiteAnalysis | null,
  env: AiEnv,
): Promise<AiSummary> {
  // 분석이 있으면 사진을 다시 보내지 않는다(진단 문장으로 근거가 충분하다).
  const photos: PolishPhoto[] = analysis ? [] : photoList(input);
  const uploaded = photoList(input);
  const channels = idleChannels();
  const skipped: AiSummary = {
    used: false,
    reason: '',
    model: null,
    channels,
    analysis: analysis ? analysis.summary : null,
    analysisUsed: !!analysis,
    analysisModel: null,
  };
  if (!env.apiKey) return { ...skipped, reason: 'no_key' };
  if ((env.mode || 'always') === 'off') return { ...skipped, reason: 'mode_off' };
  if (env.mode === 'photos' && uploaded.length === 0) return { ...skipped, reason: 'no_photos' };

  const tone = STYLE_LABEL[input.business.style as keyof typeof STYLE_LABEL] || STYLE_LABEL.haeyo;
  const region = String(parsePlace(input.place).region || '');
  const models = modelChain(env.model);
  const results = await Promise.all(CHANNEL_IDS.map(async (id) => {
    const draft = String(posts[id]?.body || '');
    if (!draft) return { id, ok: false as const, reason: 'empty_draft', body: '', model: '' };
    const r = await polishDraft({
      channel: id,
      draft,
      tone,
      photos,
      analysis,
      apiKey: env.apiKey,
      models,
      timeoutMs: 18000,
      region,
      fetchImpl: env.fetchImpl,
    });
    return r.ok
      ? { id, ok: true as const, reason: '', body: r.body, model: r.model }
      : { id, ok: false as const, reason: r.reason, body: '', model: '' };
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
  return { ...skipped, used, reason: used ? 'ok' : 'fallback', model, channels };
}

/** 두 단계를 이어 붙인다: 분석 1회 → 채널별 다듬기. */
export async function writePosts(
  input: GenerateInput,
  posts: Record<string, Post>,
  env: AiEnv,
): Promise<AiSummary> {
  const outcome = await analyzePhotos(input, env);
  if (!outcome.value && outcome.reason !== 'no_photos' && outcome.reason !== 'no_key') {
    console.error('[fieldlog] photo analysis fallback', outcome.reason);
  }
  const ai = await polishPosts(input, posts, outcome.value, env);
  return { ...ai, analysisModel: outcome.model };
}
