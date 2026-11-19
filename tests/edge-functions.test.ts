// Edge Function 순수 로직 테스트 (Deno)
//   실행: deno test tests/edge-functions.test.ts
// 생성 요청 입력 검증과 신청서 검증·스팸 판정·텔레그램 문구를 네트워크 없이 확인한다.

import { assertEquals, assert } from 'jsr:@std/assert@1';
import { parseGenerateInput } from '../supabase/functions/generate-post/input.ts';
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
  assertEquals(decideSpam(3, 5).blocked, true);
  assertEquals(decideSpam(3, 5).reason, 'rate_limited');
  assertEquals(decideSpam(1, 30).blocked, true);
  assertEquals(decideSpam(1, 30).reason, 'hourly_cap');
});

Deno.test('submit-lead: 한국 시간 표기', () => {
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(nowKst()), nowKst());
});
