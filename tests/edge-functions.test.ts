// Edge Function 순수 로직 테스트 (Deno)
//   실행: deno test tests/edge-functions.test.ts
// 생성 요청 입력 검증과 신청서 검증·스팸 판정·텔레그램 문구를 네트워크 없이 확인한다.

import { assertEquals, assert } from 'jsr:@std/assert@1';
import { cleanImage, parseGenerateInput } from '../supabase/functions/generate-post/input.ts';
import { acceptPolished, buildPrompt, collapseMarkers, dropOrphanArrows, modelChain, restoreMarkers, stripPhotoArrows } from '../supabase/functions/generate-post/polish.ts';
import { buildAnalysisPrompt, describeAnalysis, parseAnalysis, usableAnalysis, type SiteAnalysis } from '../supabase/functions/generate-post/analyze.ts';
import { generate, sanitize } from '../supabase/functions/generate-post/engine.ts';
import { decideSpam, isPhoneLike, nowKst, parseLead, telegramText } from '../supabase/functions/submit-lead/lead.ts';

function gen(body: Record<string, unknown>) {
  const r = parseGenerateInput(body);
  if (!r.ok) throw new Error('invalid: ' + r.field);
  return r.value;
}

Deno.test('generate-post: 정상 입력', () => {
  const v = gen({
    industryId: 'movein',
    place: '송파구 헬리오시티 34평',
    detail: '주방 기름때 심함',
    price: '35~40만 원',
    business: { name: 'OO클린', contact: '010-0000-0000', style: 'hapsio', closing: '감사합니다' },
    photos: { before: true, during: false, after: true },
    seed: 7,
  });
  assertEquals(v.channel, 'blog');
  assertEquals(v.business.style, 'hapsio');
  assertEquals(v.photos.before, true);
  assertEquals(v.photos.during, false);
  assertEquals(v.seed, 7);
  assert(v.place === '송파구 헬리오시티 34평');
});

Deno.test('generate-post: 업종·채널·말투 화이트리스트', () => {
  const bad = (body: Record<string, unknown> | null) => parseGenerateInput(body);
  assertEquals(bad({ industryId: 'hack', place: '송파구 34평' }).ok, false);
  assertEquals(bad({ industryId: 'movein', channel: 'tiktok', place: '송파구 34평' }).ok, false);
  assertEquals(bad({ industryId: 'movein', place: '송파구 34평', business: { style: 'rude' } }).ok, false);
  assertEquals(bad({ industryId: 'movein', place: '' }).ok, false);
  assertEquals(bad(null).ok, false);
});

Deno.test('generate-post: 길이 제한·제어문자 제거', () => {
  const v = gen({ industryId: 'grout', place: '  강남구\u0000  역삼동   래미안 24평  ', detail: '가'.repeat(500) });
  assertEquals(v.place, '강남구 역삼동 래미안 24평');
  assertEquals(v.detail.length, 200);
});

Deno.test('generate-post: seed 없거나 이상하면 서버가 만든다', () => {
  const a = gen({ industryId: 'grout', place: '강남구 24평' });
  const b = gen({ industryId: 'grout', place: '강남구 24평', seed: -5 });
  assert(Number.isInteger(a.seed) && a.seed >= 0);
  assert(Number.isInteger(b.seed) && b.seed >= 0);
});

Deno.test('submit-lead: 정상 신청', () => {
  const r = parseLead({
    name: '반짝클린', industry: '입주·이사청소', region: '송파구', contact: '010-1234-5678',
    plan: '라이트', agree: true, page: 'https://lab5037.github.io/sigong-log/',
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.value.contact, '010-1234-5678');
    assertEquals(r.value.plan, '라이트');
  }
});

Deno.test('submit-lead: 알 수 없는 요금제는 미정으로', () => {
  const r = parseLead({ name: '반짝클린', industry: '줄눈', contact: '01012345678', plan: '<script>', agree: true });
  assert(r.ok);
  if (r.ok) assertEquals(r.value.plan, '미정');
});

Deno.test('submit-lead: 거부 조건', () => {
  const base = { name: '반짝클린', industry: '줄눈', contact: '010-1234-5678', agree: true };
  assertEquals(parseLead({ ...base, name: 'ㄱ' }).ok, false);
  assertEquals(parseLead({ ...base, industry: '' }).ok, false);
  assertEquals(parseLead({ ...base, contact: '1234' }).ok, false);
  assertEquals(parseLead({ ...base, contact: '전화주세요' }).ok, false);
  assertEquals(parseLead({ ...base, agree: false }).ok, false);
  assertEquals(parseLead({ ...base, agree: 'true' }).ok, false);
  assertEquals(parseLead({ ...base, website: 'http://spam' }).ok, false);
  assertEquals(parseLead(null).ok, false);
});

Deno.test('submit-lead: 전화번호 형식', () => {
  ['010-1234-5678', '01012345678', '02-123-4567', '+82 10 1234 5678'].forEach((v) => assert(isPhoneLike(v), v));
  ['1234', 'abc-defg-hijk', '010-1234-5678<script>', ''].forEach((v) => assertEquals(isPhoneLike(v), false, v));
});

Deno.test('submit-lead: 텔레그램 문구 HTML 이스케이프', () => {
  const text = telegramText({
    name: '<b>해킹</b>', industry: '줄눈 & 코트', region: '', contact: '010-1234-5678', plan: '미정', page: '', agree: true,
  }, '2026-11-19 19:05');
  assert(!text.includes('<b>해킹</b>'));
  assert(text.includes('&lt;b&gt;해킹&lt;/b&gt;'));
  assert(text.includes('&amp;'));
  assert(text.includes('2026-11-19 19:05'));
  assert(text.includes('010-1234-5678'));
});

Deno.test('submit-lead: 스팸 판정', () => {
  assertEquals(decideSpam(0, 0).blocked, false);
  assertEquals(decideSpam(5, 5).blocked, true);
  assertEquals(decideSpam(5, 5).reason, 'rate_limited');
  assertEquals(decideSpam(4, 5).blocked, false);
  assertEquals(decideSpam(3, 5, { perIpLimit: 3 }).blocked, true);
  assertEquals(decideSpam(1, 30).blocked, true);
  assertEquals(decideSpam(1, 30).reason, 'hourly_cap');
});

Deno.test('submit-lead: 한국 시간 표기', () => {
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(nowKst()), nowKst());
});

Deno.test('generate-post: 사진 base64는 다듬기용으로만 받는다', () => {
  const b64 = 'A'.repeat(120) + '/+==';
  const v = gen({
    industryId: 'movein',
    place: '송파구 헬리오시티 34평',
    images: { before: 'data:image/jpeg;base64,' + b64, during: '', after: 'not-base64!' },
  });
  assertEquals(v.images.before, b64, 'data URL prefix를 떼고 base64만 남긴다');
  assertEquals(v.images.during, '');
  assertEquals(v.images.after, '', '형식이 틀린 값은 버린다');
  assertEquals(v.photos.before, true, '사진이 오면 photos 플래그도 켜진다');
  assertEquals(v.photos.after, false);
});

Deno.test('generate-post: 사진 크기 한도', () => {
  assertEquals(cleanImage('A'.repeat(900000)), '', '한 장 한도를 넘으면 버린다');
  const big = 'A'.repeat(700000);
  const v = gen({
    industryId: 'movein',
    place: '송파구 34평',
    images: { before: big, during: big, after: big },
  });
  const total = v.images.before.length + v.images.during.length + v.images.after.length;
  assert(total <= 2000000, '세 장 합계 한도');
  assertEquals(v.images.after, '', '한도를 넘긴 뒤쪽 사진은 버린다');
});

Deno.test('polish: 프롬프트에 사진·말투·금지 규칙이 들어간다', () => {
  const withPhoto = buildPrompt({
    channel: 'blog', draft: '초안', tone: '친근한 해요체',
    photos: [{ slot: 'before', mime: 'image/jpeg', data: 'x' }],
  });
  assert(withPhoto.includes('첨부한 현장 사진'));
  assert(withPhoto.includes('친근한 해요체'));
  assert(withPhoto.includes('줄표'));
  assert(withPhoto.includes('─ 초안 ─'));
  const noPhoto = buildPrompt({ channel: 'threads', draft: '초안', tone: '친근한 해요체', photos: [] });
  assert(noPhoto.includes('사진은 첨부되지 않았다'));
});

Deno.test('polish: 형식이 어긋난 결과는 받지 않는다(폴백 신호)', () => {
  const blogDraft = '■ 현장 요약\n· 평수 : 34평\n\n[사진 : 창틀 · 시공 전]\n\n본문 내용입니다.';
  assert(acceptPolished('blog', '■ 현장 요약\n[사진 : 창틀 · 시공 전]\n' + '본문 내용입니다. '.repeat(30) + '\n34평', blogDraft).ok);
  assertEquals(acceptPolished('blog', '짧음', blogDraft).reason, 'too_short');
  assertEquals(acceptPolished('blog', '요약 없이 긴 글 '.repeat(40) + '34평', blogDraft).reason, 'format');
  assertEquals(acceptPolished('blog', ('■ 현장 요약 [사진 : 창틀 · 시공 전] ' + '본문 내용입니다. '.repeat(30) + '34평'), blogDraft).reason, 'photo_markers');
  assertEquals(acceptPolished('insta', '가'.repeat(200) + '\n[사진 : 창틀 · 시공 전]', '가'.repeat(200)).reason, 'format');
  assertEquals(acceptPolished('insta', '가'.repeat(200), '가'.repeat(200)).ok, true, '짧은 채널은 사진·소제목만 없으면 받는다');
  assertEquals(acceptPolished('insta', '짧음', '짧음').reason, 'too_short');
  // 초안의 숫자 사실이 사라지면 거부
  assertEquals(acceptPolished('insta', '송파구 입주청소 후기입니다. '.repeat(8), '송파구 34평 35~40만 원 작업').reason, 'facts');
});

Deno.test('polish: 네이버 노출 규칙(키워드 3~7회·분량)이 프롬프트에 들어간다', () => {
  const p = buildPrompt({ channel: 'blog', draft: '초안', tone: '친근한 해요체', photos: [] });
  assert(p.includes('3~7회'));
  assert(p.includes('1,500자'));
  assert(p.includes('■ 작업 전 상태'));
});

Deno.test('polish: 초안보다 크게 줄어든 블로그 결과는 받지 않는다', () => {
  const draft = '■ 현장 요약\n' + '본문 내용입니다. '.repeat(120) + '\n[사진 : 창틀 · 시공 전]';
  const short = '■ 현장 요약\n' + '본문 내용입니다. '.repeat(40) + '\n[사진 : 창틀 · 시공 전]';
  assertEquals(acceptPolished('blog', short, draft).reason, 'too_short');
  assert(acceptPolished('blog', draft, draft).ok);
});

Deno.test('polish: AI 상투어 변형이 섞이면 초안으로 폴백한다', () => {
  const draft = '■ 현장 요약\n' + '본문 내용입니다. '.repeat(120) + '\n[사진 : 창틀 · 시공 전]';
  const sloppy = '■ 현장 요약\n' + '현장에 도착해서 확인한 상태는 다음과 같았어요. ' + '본문 내용입니다. '.repeat(110) + '\n[사진 : 창틀 · 시공 전]';
  assertEquals(acceptPolished('blog', sloppy, draft).reason, 'slop');
  assert(acceptPolished('blog', draft, draft).ok);
});

Deno.test('polish: 동네 이름이 3~7회를 벗어나면 초안으로 폴백한다', () => {
  const line = '송파구 잠실 엘스 줄눈 시공 현장입니다. ';
  const filler = '본문 내용입니다. '.repeat(60);
  const draft = '■ 현장 요약\n' + line.repeat(5) + filler + '\n[사진 : 창틀 · 시공 전]';
  const tooMany = '■ 현장 요약\n' + line.repeat(9) + filler + '\n[사진 : 창틀 · 시공 전]';
  assertEquals(acceptPolished('blog', tooMany, draft, '송파구').reason, 'keyword_count');
  assertEquals(acceptPolished('blog', draft, draft, '송파구').ok, true);
  assertEquals(acceptPolished('blog', tooMany, tooMany, '송파구').ok, true, '초안부터 범위를 벗어나면 막지 않는다');
  });

Deno.test('engine.ts: 블로그 원고에 SEO 섹션·1,500자·제목 앞배치', () => {
  const r = generate({
    industryId: 'grout',
    place: '송파구 잠실 엘스 34평',
    detail: '욕실 줄눈 곰팡이, 탄성코트 희망',
    price: '35~40만 원',
    business: { name: 'OO클린', contact: '010-0000-0000', style: 'haeyo', closing: '감사합니다' },
    photos: { before: true, during: true, after: true },
    seed: 7,
  });
  assert(r.body.length >= 1500, '본문 1,500자 이상: ' + r.body.length);
  assert(r.body.includes('■ 작업 전 상태'));
  assert(r.body.includes('■ 작업 순서'));
  assert(r.body.includes('■ 달라진 점'));
  assert((r.body.match(/\[사진 : /g) || []).length >= 4);
  assert(r.titles[0].startsWith('송파구') && r.titles[1].startsWith('송파구'));
  assert(r.titles[1].includes('줄눈'));
});

Deno.test('polish: 모델 목록은 환경변수를 앞에 두고 중복을 지운다', () => {
  assertEquals(modelChain(''), ['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
  assertEquals(modelChain('gemini-3.1-flash-lite')[0], 'gemini-3.1-flash-lite');
  assertEquals(modelChain('gemini-3.1-flash-lite').length, 2);
  assertEquals(modelChain('gemini-x')[0], 'gemini-x');
});

Deno.test('polish: 과장 표현(완벽)은 결과에서 지운다', () => {
  const out = sanitize('오염물질을 완벽하게 제거한 뒤 마감했습니다. 완벽한 마감입니다.');
  assertEquals(out.includes('완벽'), false, out);
  assert(out.includes('제거한 뒤 마감했습니다'));
});

Deno.test('polish: 줄표·이모지는 결과에서 지운다', () => {
  const out = sanitize('줄표 — 테스트 😀 문장입니다.');
  assert(!/[\u2014\u2013]/.test(out));
  assert(!/[\u{1F000}-\u{1FAFF}]/u.test(out));
});

Deno.test('polish: 사진이 없으면 지어낸 사진 설명(→)을 지운다', () => {
  const src = '■ 현장 요약\n[사진 : 창틀 · 시공 전]\n→ 창틀에 먼지가 많아요.\n본문입니다.';
  const out = stripPhotoArrows(src);
  assertEquals(out.includes('→'), false);
  assert(out.includes('[사진 : 창틀 · 시공 전]'));
  assert(out.includes('본문입니다.'));
});

Deno.test('polish: 사진 위치 줄이 줄어들면 초안 그대로 되돌린다', () => {
  const filler = '욕실 타일과 줄눈을 하나씩 확인하고 약품을 발라 두었습니다. '.repeat(12);
  const draft = '■ 현장 요약\n[사진 : 송파구 헬리오시티 현장 전경 · 시공 전]\n' + filler + '\n[사진 : 욕실 줄눈·수전 · 시공 전]\n본문2';
  const polished = '■ 현장 요약\n[사진 : 송파구 헬리오시티 현장 전경 · 시공 전]\n' + filler + '\n[사진 : 욕실 줄눈·수전]\n→ 곰팡이가 있어요.\n본문2';
  const out = restoreMarkers(polished, draft);
  assert(out.includes('[사진 : 욕실 줄눈·수전 · 시공 전]'), out);
  assert(!/\[사진 : 욕실 줄눈·수전\]$/m.test(out));
  assert(out.includes('→ 곰팡이가 있어요.'));
  // 복원 후 형식 검사를 통과해야 한다
  assertEquals(acceptPolished('blog', out, draft).ok, true);
  // 초안에 없는 사진 줄을 새로 넣으면 거부
  assertEquals(acceptPolished('blog', out + '\n[사진 : 없는 부위 · 시공 후]', draft).reason, 'photo_markers');
});

Deno.test('polish: 반복된 사진 위치 줄은 하나만 남긴다', () => {
  const src = '[사진 : 욕실 · 작업 중]\n→ 곰팡이.\n[사진 : 욕실 · 작업 중]\n→ 물때.\n[사진 : 바닥 · 시공 후]\n→ 마감.';
  const out = collapseMarkers(src);
  assertEquals((out.match(/\[사진 : 욕실 · 작업 중\]/g) || []).length, 1);
  assertEquals((out.match(/^→ /gm) || []).length, 2);
  assert(out.includes('→ 곰팡이.') && out.includes('→ 마감.'));
  assertEquals(out.includes('→ 물때.'), false);
});

Deno.test('polish: 사진 자리 밑이 아닌 → 줄은 지운다', () => {
  const src = [
    '[사진 : 욕실 바닥 · 시공 전]',
    '→ 바닥 줄눈에 곰팡이가 번져 있습니다.',
    '',
    '■ 기존 줄눈 제거',
    '',
    '기존 줄눈은 그라인더로 파냈어요.',
    '',
    '→ 샤워기 수전에 석회질이 침착되어 세제가 필요합니다.',
    '',
    '[사진 : 탄성코트 · 시공 후]',
    '→ 바닥 마감이 균일합니다.',
  ].join('\n');
  const out = dropOrphanArrows(src);
  assert(out.includes('→ 바닥 줄눈에 곰팡이가 번져 있습니다.'), '사진 자리 밑 설명은 남긴다');
  assert(out.includes('→ 바닥 마감이 균일합니다.'), '두 번째 사진 자리 설명도 남긴다');
  assertEquals(out.includes('석회질이 침착되어 세제가 필요합니다'), false, '떠 있는 설명은 지운다');
  assertEquals((out.match(/^→/gm) || []).length, 2);
});

/* ── 1단계: 사진 정밀 분석 ───────────────────────────────────────── */

Deno.test('analyze: 사진이 없으면 진단 프롬프트에 시공 후 결과를 쓰지 말라고 넣는다', () => {
  const p = buildAnalysisPrompt({ industry: '욕실 줄눈·탄성코트', detail: '욕실 줄눈 곰팡이', slots: ['before'] });
  assert(p.includes('시공 전 사진'));
  assert(p.includes('시공 후 사진이 없다'), p);
  assert(p.includes('완료·해결·깨끗해졌다는 표현과 결과 묘사를 쓰지 않는다'));
  assert(p.includes('업종: 욕실 줄눈·탄성코트'));
  assert(p.includes('사장님이 적어 준 증상: 욕실 줄눈 곰팡이'));
  assert(p.includes('"observed"') && p.includes('"keyPoints"') && p.includes('"summary"'));
  assert(p.includes('개수·면적·비율·기간을 세지 않는다'));
});

Deno.test('analyze: 시공 후 사진이 있으면 결과 묘사를 허용한다', () => {
  const p = buildAnalysisPrompt({ slots: ['before', 'after'] });
  assert(p.includes('시공 전 사진, 시공 후 사진'));
  assert(p.includes('시공 후 사진이 있다'));
  assertEquals(p.includes('시공 후 사진이 없다'), false);
});

Deno.test('analyze: JSON 응답을 진단 객체로 파싱한다(코드블록·설명 섞임)', () => {
  const raw = '```json\n' + JSON.stringify({
    observed: ['욕실 바닥 줄눈에 검은 곰팡이가 번짐', '샤워기 쪽 줄눈이 벌어짐', '욕실 바닥 줄눈에 검은 곰팡이가 번짐'],
    locations: ['욕실 바닥 줄눈', '샤워기 주변 줄눈'],
    causes: ['물이 고인 채 마른 탓으로 보임'],
    keyPoints: ['줄눈 깊이까지 긁어내고 건조 후 채움'],
    limits: ['타일 아래 누수는 사진으로 확인 안 됨'],
    summary: '욕실 바닥 줄눈에 곰팡이가 번져 있습니다. 샤워기 쪽 줄눈은 벌어져 있습니다.',
  }) + '\n```';
  const a = parseAnalysis(raw);
  assert(!!a);
  if (a) {
    assertEquals(a.observed.length, 2, '중복 문구는 한 번만');
    assertEquals(a.locations[1], '샤워기 주변 줄눈');
    assertEquals(a.summary, '욕실 바닥 줄눈에 곰팡이가 번져 있습니다. 샤워기 쪽 줄눈은 벌어져 있습니다.');
    assert(usableAnalysis(a));
  }
});

Deno.test('analyze: 항목 수·길이를 제한하고 줄표·이모지를 지운다', () => {
  const a = parseAnalysis(JSON.stringify({
    observed: ['가'.repeat(80), '둘', '둘', '셋', '넷', '다섯', '여섯', '일곱'],
    locations: [], causes: [], keyPoints: ['줄눈 — 깊게 긁기 😀'], limits: [],
    summary: '첫 문장입니다. 둘째 문장입니다. 셋째 문장은 버립니다.',
  }));
  assert(!!a);
  if (a) {
    assertEquals(a.observed.length, 6, 'observed 최대 6개');
    assertEquals(a.observed[1], '둘');
    assertEquals(a.observed[2], '셋', '중복 제거');
    assert(a.observed[0].length <= 48, '항목 길이 제한: ' + a.observed[0].length);
    assertEquals(a.summary, '첫 문장입니다. 둘째 문장입니다.', '요약은 두 문장까지');
    assert(!/[\u{1F000}-\u{1FAFF}]/u.test(a.keyPoints[0]), '이모지 제거');
    assert(!/[\u2014\u2013]/.test(a.keyPoints[0]), '줄표 제거: ' + a.keyPoints[0]);
  }
});

Deno.test('analyze: 형식이 깨진 응답은 null(폴백 신호)', () => {
  assertEquals(parseAnalysis(''), null);
  assertEquals(parseAnalysis('JSON 아님'), null);
  assertEquals(parseAnalysis('{"observed": '), null);
  assertEquals(parseAnalysis('{}'), null);
  assertEquals(parseAnalysis('{"observed": [], "keyPoints": [], "summary": ""}'), null);
});

Deno.test('analyze: 요약이 비면 관찰에서 만든다', () => {
  const a = parseAnalysis(JSON.stringify({ observed: ['창틀 먼지가 두껍게 앉음'], summary: '' }));
  assert(!!a);
  if (a) assertEquals(a.summary, '창틀 먼지가 두껍게 앉음');
});

Deno.test('analyze: 진단 요약 블록에 항목 이름이 들어간다', () => {
  const a: SiteAnalysis = {
    observed: ['욕실 바닥 줄눈 곰팡이'], locations: ['욕실 바닥'], causes: ['물 고임으로 보임'],
    keyPoints: ['건조 후 줄눈재 채움'], limits: [], summary: '욕실 바닥 줄눈에 곰팡이가 있습니다.', photoSlots: ['before'],
  };
  const text = describeAnalysis(a);
  assert(text.includes('· 보이는 상태 : 욕실 바닥 줄눈 곰팡이'));
  assert(text.includes('· 추정 원인 : 물 고임으로 보임'));
  assert(text.includes('· 요약 : 욕실 바닥 줄눈에 곰팡이가 있습니다.'));
  assertEquals(describeAnalysis(null), '');
});

/* ── 2단계: 진단을 넣은 다듬기 프롬프트 ─────────────────────────── */

const ANALYSIS: SiteAnalysis = {
  observed: ['욕실 바닥 줄눈에 검은 곰팡이가 번짐', '샤워기 쪽 줄눈이 벌어짐'],
  locations: ['욕실 바닥 줄눈'],
  causes: ['물이 고인 채 마른 탓으로 보임'],
  keyPoints: ['줄눈 깊이까지 긁어내고 건조'],
  limits: [],
  summary: '욕실 바닥 줄눈에 곰팡이가 번져 있습니다.',
  photoSlots: ['before'],
};

Deno.test('polish: 사진 분석이 있으면 진단을 프롬프트에 넣고 사진 첨부 문구는 쓰지 않는다', () => {
  const p = buildPrompt({ channel: 'blog', draft: '■ 현장 요약\n[사진 : 욕실 · 시공 전]\n본문', tone: '친근한 해요체', photos: [], analysis: ANALYSIS });
  assert(p.includes('─ 사진 분석 ─'));
  assert(p.includes('검은 곰팡이가 번짐'));
  assert(p.includes('[사진 분석]에 적힌 것만 쓴다'));
  assert(p.includes('■ 작업 전 상태 목록에 [사진 분석]에서 확인된 상태를 1~2줄'));
  assert(p.includes('시공 후 사진이 없다'), '애프터 사진이 없으면 결과 묘사를 막는다');
  assert(p.includes('─ 초안 ─'));
  assertEquals(p.includes('사진은 첨부되지 않았다'), false);
  assertEquals(p.includes('첨부한 현장 사진을 실제로 보고'), false);
});

Deno.test('polish: 시공 후 사진까지 분석했으면 결과 표현을 막지 않는다', () => {
  const withAfter: SiteAnalysis = { ...ANALYSIS, photoSlots: ['before', 'after'] };
  const p = buildPrompt({ channel: 'blog', draft: '초안', tone: '친근한 해요체', photos: [], analysis: withAfter });
  assertEquals(p.includes('시공 후 사진이 없다'), false);
  assert(p.includes('─ 사진 분석 ─'));
});

Deno.test('polish: 블로그가 아닌 채널에는 짧은 형식으로 진단을 넣는다', () => {
  const p = buildPrompt({ channel: 'insta', draft: '인스타 초안', tone: '친근한 해요체', photos: [], analysis: ANALYSIS });
  assert(p.includes('첫 두 문단 안에 이 현장의 상태로 녹인다'));
  assertEquals(p.includes('■ 작업 전 상태 목록에'), false);
});

Deno.test('polish: 분석이 없으면 예전 프롬프트 그대로다', () => {
  const noPhoto = buildPrompt({ channel: 'blog', draft: '초안', tone: '친근한 해요체', photos: [] });
  assert(noPhoto.includes('사진은 첨부되지 않았다'));
  assertEquals(noPhoto.includes('─ 사진 분석 ─'), false);
  const withPhoto = buildPrompt({
    channel: 'blog', draft: '초안', tone: '친근한 해요체',
    photos: [{ slot: 'before', mime: 'image/jpeg', data: 'x' }],
  });
  assert(withPhoto.includes('첨부한 현장 사진'));
  assertEquals(withPhoto.includes('─ 사진 분석 ─'), false);
});

Deno.test('engine.ts: 비포 사진 한 장이면 그 사진 자리 하나만 만든다', () => {
  const r = generate({
    industryId: 'grout', place: '송파구 잠실 엘스 34평', detail: '욕실 줄눈 곰팡이',
    business: { name: 'OO클린', contact: '010-0000-0000', style: 'haeyo', closing: '감사합니다' },
    photos: { before: true, during: false, after: false }, seed: 7,
  });
  const marks = r.body.match(/\[사진 : /g) || [];
  assertEquals(marks.length, 1, '없는 애프터 사진 자리를 만들지 않는다');
  assert(r.body.includes('[사진 : 송파구 잠실 엘스 현장 전경 · 시공 전]'), r.body.slice(0, 200));
  assert(!/시공 후\]/.test(r.body), '시공 후 자리 없음');
});

Deno.test('engine.ts: 작업 중 사진만 있어도 사진 자리가 하나 생긴다', () => {
  const r = generate({
    industryId: 'grout', place: '송파구 34평', detail: '욕실 줄눈',
    business: { style: 'haeyo' },
    photos: { before: false, during: true, after: false }, seed: 3,
  });
  assertEquals((r.body.match(/\[사진 : /g) || []).length, 1);
  assert(r.body.includes('작업 중]'));
});

Deno.test('engine.ts: 애프터 사진이 있으면 공정별 사진 자리가 4곳 이상 생긴다', () => {
  const r = generate({
    industryId: 'grout', place: '송파구 34평', detail: '욕실 줄눈', business: { style: 'haeyo' },
    photos: { before: true, during: true, after: true }, seed: 5,
  });
  assert((r.body.match(/\[사진 : /g) || []).length >= 4, String((r.body.match(/\[사진 : /g) || []).length));
});
