// 생성 파이프라인 테스트 (Deno) — 사진 분석 1회 → 분석을 넣은 4채널 다듬기
//   실행: deno test tests/pipeline.test.ts
// Gemini는 가짜 fetch로 대신한다. 실제 호출·키 없이 두 단계 흐름과 폴백을 그대로 확인한다.

import { assertEquals, assert } from 'jsr:@std/assert@1';
import { generate } from '../supabase/functions/generate-post/engine.ts';
import { parseGenerateInput, type GenerateInput } from '../supabase/functions/generate-post/input.ts';
import { writePosts, type Post } from '../supabase/functions/generate-post/compose.ts';

const B64 = 'A'.repeat(200);

function makeInput(extra: Record<string, unknown> = {}): GenerateInput {
  const r = parseGenerateInput({
    industryId: 'grout',
    place: '송파구 잠실 엘스 34평',
    detail: '욕실 줄눈 곰팡이',
    price: '35~40만 원',
    business: { name: 'OO클린', contact: '010-0000-0000', style: 'haeyo', closing: '감사합니다' },
    seed: 7,
    ...extra,
  });
  if (!r.ok) throw new Error('invalid input: ' + r.field);
  return r.value;
}

function drafts(input: GenerateInput): Record<string, Post> {
  const posts: Record<string, Post> = {};
  for (const id of ['blog', 'danggeun', 'insta', 'threads']) {
    posts[id] = generate({ ...input, channel: id }) as Post;
  }
  return posts;
}

const SUMMARY = '욕실 바닥 줄눈에 검은 곰팡이가 번져 있습니다. 샤워기 쪽 줄눈은 벌어져 있습니다.';

type Call = { kind: 'analysis' | 'polish'; model: string; prompt: string; images: number; json: boolean };

function fakeGemini(opts: { analysis?: 'ok' | 'fail' | 'json_unsupported'; polish?: 'ok' | 'fail' } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body || '{}'));
    const parts: { text?: string; inline_data?: unknown }[] = body.contents?.[0]?.parts || [];
    const images = parts.filter((p) => !!p.inline_data).length;
    const prompt = String(parts[0]?.text || '');
    const isAnalysis = prompt.includes('현장 진단 담당자');
    const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
    calls.push({ kind: isAnalysis ? 'analysis' : 'polish', model, prompt, images, json: !!body.generationConfig?.responseMimeType });

    if (isAnalysis) {
      if (opts.analysis === 'fail') return new Response('{}', { status: 500 });
      if (opts.analysis === 'json_unsupported' && body.generationConfig?.responseMimeType) {
        return new Response('{}', { status: 400 });
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                observed: ['욕실 바닥 줄눈에 검은 곰팡이가 번짐', '샤워기 쪽 줄눈이 벌어짐'],
                locations: ['욕실 바닥 줄눈'],
                causes: ['물이 고인 채 마른 탓으로 보임'],
                keyPoints: ['줄눈 깊이까지 긁어내고 건조 후 채움'],
                limits: [],
                summary: SUMMARY,
              }),
            }],
          },
        }],
      }), { status: 200 });
    }
    if (opts.polish === 'fail') return new Response('{}', { status: 500 });
    // 초안을 그대로 돌려준다(다듬기 형식 검사를 통과하는 최소 응답).
    const draft = prompt.split('─ 초안 ─\n')[1] ?? '';
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: draft }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

Deno.test('pipeline: 비포 사진 1장 → 분석 1회 + 진단을 넣은 4채널(사진 재전송 없음)', async () => {
  const input = makeInput({ images: { before: B64 }, photos: { before: true } });
  const posts = drafts(input);
  const { calls, fetchImpl } = fakeGemini();

  const ai = await writePosts(input, posts, { apiKey: 'test-key', fetchImpl });

  const analysisCalls = calls.filter((c) => c.kind === 'analysis');
  const polishCalls = calls.filter((c) => c.kind === 'polish');
  assertEquals(analysisCalls.length, 1, '사진 분석은 한 번만');
  assertEquals(analysisCalls[0].images, 1, '분석에는 비포 사진이 실린다');
  assertEquals(analysisCalls[0].model, 'gemini-3.1-flash-lite');
  assertEquals(polishCalls.length, 4, '채널 4개를 다듬는다');
  assertEquals(polishCalls.every((c) => c.images === 0), true, '분석 뒤에는 사진을 다시 보내지 않는다');
  assert(polishCalls.every((c) => c.prompt.includes('─ 사진 분석 ─')), '프롬프트에 진단이 들어간다');
  assert(polishCalls.every((c) => c.prompt.includes('검은 곰팡이가 번짐')), '진단 내용이 문장에 반영된다');
  assert(polishCalls.every((c) => c.prompt.includes('시공 후 사진이 없다')), '애프터가 없으면 결과 묘사를 막는다');

  assertEquals(ai.analysisUsed, true);
  assertEquals(ai.analysis, SUMMARY, '응답 ai.analysis 는 1~2문장 요약');
  assertEquals(ai.analysisModel, 'gemini-3.1-flash-lite');
  assertEquals(ai.channels.blog, 'ai');
  assertEquals(ai.channels.danggeun, 'ai');
  assertEquals(ai.reason, 'ok');
});

Deno.test('pipeline: 사진 3장이어도 분석은 한 번, 진단은 시공 후 사진이 있다고 알린다', async () => {
  const input = makeInput({ images: { before: B64, during: B64, after: B64 } });
  const posts = drafts(input);
  const { calls, fetchImpl } = fakeGemini();

  const ai = await writePosts(input, posts, { apiKey: 'test-key', fetchImpl });

  const analysisCalls = calls.filter((c) => c.kind === 'analysis');
  assertEquals(analysisCalls.length, 1);
  assertEquals(analysisCalls[0].images, 3, '세 장을 한 번에 읽는다');
  const polishCalls = calls.filter((c) => c.kind === 'polish');
  assert(polishCalls.every((c) => !c.prompt.includes('시공 후 사진이 없다')), '애프터가 있으면 결과 표현을 막지 않는다');
  assertEquals(ai.analysisUsed, true);
});

Deno.test('pipeline: 분석이 실패하면 사진을 직접 넘기는 예전 방식으로 폴백한다', async () => {
  const input = makeInput({ images: { before: B64 }, photos: { before: true } });
  const posts = drafts(input);
  const { calls, fetchImpl } = fakeGemini({ analysis: 'fail' });

  const ai = await writePosts(input, posts, { apiKey: 'test-key', fetchImpl });

  const analysisCalls = calls.filter((c) => c.kind === 'analysis');
  assertEquals(analysisCalls.length, 2, '모델 두 개를 한 번씩만 시도하고 끝낸다');
  assertEquals(analysisCalls[0].model, 'gemini-3.1-flash-lite');
  assertEquals(analysisCalls[1].model, 'gemini-3.8-flash');
  const polishCalls = calls.filter((c) => c.kind === 'polish');
  assertEquals(polishCalls.length, 4);
  assertEquals(polishCalls.every((c) => c.images === 1), true, '사진이 다듬기 요청에 실린다');
  assert(polishCalls.every((c) => !c.prompt.includes('─ 사진 분석 ─')));
  assert(polishCalls.every((c) => c.prompt.includes('첨부한 현장 사진')));
  assertEquals(ai.analysis, null, '분석이 없으면 ai.analysis 는 null');
  assertEquals(ai.analysisUsed, false);
  assertEquals(ai.channels.blog, 'ai', '원고는 정상적으로 다듬어진다');
});

Deno.test('pipeline: JSON 모드를 모르는 모델(400)이면 일반 텍스트로 한 번 더 시도한다', async () => {
  const input = makeInput({ images: { before: B64 } });
  const posts = drafts(input);
  const { calls, fetchImpl } = fakeGemini({ analysis: 'json_unsupported' });

  const ai = await writePosts(input, posts, { apiKey: 'test-key', fetchImpl });

  const analysisCalls = calls.filter((c) => c.kind === 'analysis');
  assertEquals(analysisCalls.length, 2, 'JSON 모드 1회 + 일반 모드 1회');
  assertEquals(analysisCalls[0].model, analysisCalls[1].model, '같은 모델로 다시');
  assertEquals(ai.analysisUsed, true);
  assertEquals(ai.analysis, SUMMARY);
});

Deno.test('pipeline: 사진이 없으면 분석을 부르지 않는다', async () => {
  const input = makeInput();
  const posts = drafts(input);
  const { calls, fetchImpl } = fakeGemini();

  const ai = await writePosts(input, posts, { apiKey: 'test-key', fetchImpl });

  assertEquals(calls.filter((c) => c.kind === 'analysis').length, 0, '사진이 없으면 분석 없음');
  const polishCalls = calls.filter((c) => c.kind === 'polish');
  assertEquals(polishCalls.length, 4);
  assert(polishCalls.every((c) => c.prompt.includes('사진은 첨부되지 않았다')));
  assertEquals(ai.analysis, null);
});

Deno.test('pipeline: GEMINI_POLISH=off 면 Gemini 를 부르지 않고 규칙 기반 원고를 그대로 쓴다', async () => {
  const input = makeInput({ images: { before: B64 } });
  const posts = drafts(input);
  const before = posts.blog.body;
  const { calls, fetchImpl } = fakeGemini();

  const ai = await writePosts(input, posts, { apiKey: 'test-key', mode: 'off', fetchImpl });

  assertEquals(calls.length, 0, 'Gemini 호출 없음');
  assertEquals(ai.reason, 'mode_off');
  assertEquals(ai.used, false);
  assertEquals(ai.analysis, null);
  assertEquals(posts.blog.body, before, '초안 그대로');
});

Deno.test('pipeline: 다듬기가 실패해도 초안이 남고 채널 표시는 draft 다', async () => {
  const input = makeInput({ images: { before: B64 } });
  const posts = drafts(input);
  const before = posts.blog.body;
  const { fetchImpl } = fakeGemini({ polish: 'fail' });

  const ai = await writePosts(input, posts, { apiKey: 'test-key', fetchImpl });

  assertEquals(ai.used, false);
  assertEquals(ai.reason, 'fallback');
  assertEquals(ai.channels.blog, 'draft');
  assertEquals(posts.blog.body, before, '초안 그대로');
  assertEquals(ai.analysis, SUMMARY, '분석은 성공했으므로 요약은 남는다');
});

Deno.test('pipeline: 키가 없으면 아무것도 부르지 않는다', async () => {
  const input = makeInput({ images: { before: B64 } });
  const posts = drafts(input);
  const { calls, fetchImpl } = fakeGemini();

  const ai = await writePosts(input, posts, { apiKey: '', fetchImpl });

  assertEquals(calls.length, 0);
  assertEquals(ai.reason, 'no_key');
  assertEquals(ai.analysis, null);
});
