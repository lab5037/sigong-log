// Edge Function 순수 로직 테스트 (Deno)
//   실행: deno test tests/edge-functions.test.ts
// 생성 요청 입력 검증과 신청서 검증·스팸 판정·텔레그램 문구를 네트워크 없이 확인한다.

import { assertEquals, assert } from 'jsr:@std/assert@1';
import { cleanImage, parseGenerateInput } from '../supabase/functions/generate-post/input.ts';
import { acceptPolished, buildPrompt, modelChain, stripPhotoArrows } from '../supabase/functions/generate-post/polish.ts';
import { sanitize } from '../supabase/functions/generate-post/engine.ts';
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
    plan: '라이트', agree: true, page: 'https://ulyeol-lab.github.io/sigong-log/',
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
  assert(acceptPolished('blog', '■ 현장 요약\n[사진 : 창틀 · 시공 전]\n본문 내용입니다. '.repeat(12) + '34평', blogDraft).ok);
  assertEquals(acceptPolished('blog', '짧음', blogDraft).reason, 'too_short');
  assertEquals(acceptPolished('blog', '요약 없이 긴 글 '.repeat(40) + '34평', blogDraft).reason, 'format');
  assertEquals(acceptPolished('blog', ('■ 현장 요약 ' + '본문 내용입니다. '.repeat(30) + '34평'), blogDraft).reason, 'photo_markers');
  assertEquals(acceptPolished('insta', '가'.repeat(200) + '\n[사진 : 창틀 · 시공 전]', '가'.repeat(200)).reason, 'format');
  assertEquals(acceptPolished('insta', '가'.repeat(200), '가'.repeat(200)).ok, true, '짧은 채널은 사진·소제목만 없으면 받는다');
  assertEquals(acceptPolished('insta', '짧음', '짧음').reason, 'too_short');
  // 초안의 숫자 사실이 사라지면 거부
  assertEquals(acceptPolished('insta', '송파구 입주청소 후기입니다. '.repeat(8), '송파구 34평 35~40만 원 작업').reason, 'facts');
});

Deno.test('polish: 모델 목록은 환경변수를 앞에 두고 중복을 지운다', () => {
  assertEquals(modelChain(''), ['gemini-3.1-flash-lite', 'gemini-3.8-flash']);
  assertEquals(modelChain('gemini-3.1-flash-lite')[0], 'gemini-3.1-flash-lite');
  assertEquals(modelChain('gemini-3.1-flash-lite').length, 2);
  assertEquals(modelChain('gemini-x')[0], 'gemini-x');
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
