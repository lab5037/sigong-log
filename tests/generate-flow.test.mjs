// 원고 생성 흐름 테스트 (jsdom + 가짜 Supabase)
//   실행: node tests/generate-flow.test.mjs
// 비포 사진 1장만 올린 현장이 막힘 없이 생성되고, 서버가 돌려준 AI 사진 분석 요약이
// 결과 화면에 보이는지, 비교 카드가 '현장 진단' 단독 카드로 바뀌는지 확인한다.
// (실제 Gemini·Supabase는 부르지 않는다. 서버 동작은 tests/edge-functions.test.ts 가 본다.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const html = read('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://lab5037.github.io/sigong-log/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push('error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.message)));
window.console.warn = (...a) => errors.push('warn: ' + a.join(' '));

// ── 가짜 Supabase ──────────────────────────────────────────────────────────
const SESSION = { user: { id: 'user-1', email: 'owner@example.com' }, access_token: 'jwt' };
const PROFILE = { id: 'user-1', plan: 'trial', monthly_limit: 3, used_count: 1, shop_name: 'OO클린', shop_contact: '010-0000-0000', tone: 'haeyo', closing: '감사합니다' };

const SUMMARY = '욕실 바닥 줄눈 세 곳에 검은 곰팡이가 번져 있고, 샤워기 쪽 줄눈은 벌어져 있습니다. 물때가 타일 아래쪽에 몰려 있습니다.';
const MARK = '[사진 : 송파구 잠실 엘스 현장 전경 · 시공 전]';
const BLOG_BODY = [
  '■ 현장 요약', '· 지역 : 송파구 잠실 엘스 34평', '· 평수 : 34평', '· 작업 범위 : 줄눈 제거와 재시공', '· 소요 시간 : 3시간', '· 견적 : 35~40만 원', '',
  '송파구 잠실 엘스 욕실 줄눈 시공하고 왔습니다. 송파구에서 줄눈 일을 합니다.', '', MARK, '→ 바닥 줄눈에 곰팡이가 번져 있습니다.', '',
  '■ 작업 전 상태', '· 기존 줄눈이 검게 변색됨', '· 샤워기 쪽 줄눈이 벌어짐', '',
  '■ 작업 순서', '기존 줄눈 제거 → 홈 청소·건조 → 줄눈재 시공 → 탄성코트·양생 순서로 진행했습니다.',
  '■ 기존 줄눈 제거', '줄눈 칼로 기존 줄눈을 긁어냈습니다.', '', '■ 달라진 점', '· 줄눈 색이 균일해짐', '',
  '■ 셀프로 확인할 포인트', '· 시공 후 하루는 물을 묻히지 않습니다.', '',
  '이번 현장 견적은 35~40만 원 정도였어요. 송파구 쪽 일정도 바로 확인해 드려요.',
].join('\n');

function makePosts() {
  const summary = [{ k: '지역', v: '송파구 잠실 엘스 34평' }, { k: '평수', v: '34평' }];
  const blog = {
    channel: 'blog', channelLabel: '네이버 블로그', channelHint: '', industryId: 'grout', industryLabel: '욕실 줄눈·탄성코트',
    style: 'haeyo', styleLabel: '친근한 해요체',
    titles: ['송파구 욕실 줄눈 후기 | 잠실 엘스 34평', '송파구 욕실 줄눈 | 곰팡이 해결, 사진으로 비교', '송파구 욕실 줄눈 견적 35~40만 원'],
    summary, summaryText: '■ 현장 요약\n· 지역 : 송파구 잠실 엘스 34평\n· 평수 : 34평',
    body: BLOG_BODY, hashtags: ['#줄눈', '#송파구줄눈', '#욕실줄눈', '#탄성코트', '#줄눈시공'],
    hashtagText: '#줄눈 #송파구줄눈 #욕실줄눈 #탄성코트 #줄눈시공', seoKeywords: ['송파구 줄눈', '잠실 줄눈'], seed: 7,
  };
  blog.fullText = blog.titles[0] + '\n\n' + blog.body + '\n\n' + blog.hashtagText;
  const other = (id, label) => ({
    channel: id, channelLabel: label, channelHint: '', industryId: 'grout', industryLabel: '욕실 줄눈·탄성코트',
    style: 'haeyo', styleLabel: '친근한 해요체', titles: [], summary, summaryText: blog.summaryText,
    body: '송파구 잠실 엘스 욕실 줄눈 다녀왔습니다. ' + '기존 줄눈을 걷어내고 새로 채웠어요. '.repeat(4),
    hashtags: ['#줄눈'], hashtagText: '#줄눈', seoKeywords: [], seed: 7, fullText: '',
  });
  return { blog, danggeun: other('danggeun', '당근'), insta: other('insta', '인스타그램'), threads: other('threads', '스레드') };
}

let lastInvoke = null;
function fakeClient() {
  const chain = (data) => {
    const p = Promise.resolve({ data, error: null });
    const obj = {
      select: () => obj, eq: () => obj, maybeSingle: () => p, single: () => p,
      update: () => obj, insert: () => p, then: (res, rej) => p.then(res, rej), catch: (c) => p.catch(c),
    };
    return obj;
  };
  return {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: SESSION }, error: null }),
      signOut: async () => ({ error: null }),
    },
    from: () => chain(PROFILE),
    functions: {
      invoke: async (name, opts) => {
        lastInvoke = { name, body: opts && opts.body };
        if (name === 'generate-post') {
          return {
            data: {
              ok: true,
              quota: { plan: 'trial', used: 2, limit: 3 },
              ai: {
                used: true, reason: 'ok', model: 'gemini-3.1-flash-lite',
                channels: { blog: 'ai', danggeun: 'ai', insta: 'ai', threads: 'ai' },
                analysis: SUMMARY, analysisUsed: true, analysisModel: 'gemini-3.1-flash-lite',
              },
              posts: makePosts(),
            },
            error: null,
          };
        }
        return { data: { ok: true }, error: null };
      },
    },
  };
}
window.supabase = { createClient: () => fakeClient() };

// ── canvas·이미지 대체 ────────────────────────────────────────────────────
const composeArgs = [];
window.FieldLogCanvas = {
  compose: async (o) => { composeArgs.push(o); return { toDataURL: () => 'data:image/jpeg;base64,AA' }; },
  canvasToBlob: async () => null,
  makeSamplePhotos: () => ({ before: 'b', during: 'd', after: 'a' }),
};
class FakeImage {
  constructor() { this.width = 1000; this.height = 1000; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src || ''; }
}
window.Image = FakeImage;
window.HTMLCanvasElement.prototype.getContext = function () {
  return { fillStyle: '', fillRect() {}, drawImage() {}, measureText: () => ({ width: 10 }), fillText() {} };
};
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA';
window.Element.prototype.scrollIntoView = function () {};
window.scrollTo = function () {};

for (const f of ['catalog.js', 'demo-result.js', 'app.js']) {
  try { window.eval(read(f)); } catch (e) { errors.push('load ' + f + ': ' + e.message); }
}

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => Array.from(window.document.querySelectorAll(s));
await sleep(150);

ok($('#sysState').textContent.indexOf('계정 서버 연결됨') >= 0, '가짜 Supabase 로그인 상태', $('#sysState').textContent);

// ── 업종·동네·비포 사진 1장만 넣고 생성 ────────────────────────────────────
$$('#industryChips .chip').find((c) => c.getAttribute('data-id') === 'grout').click();
$('#placeInput').value = '송파구 잠실 엘스 34평';
$('#placeInput').dispatchEvent(new window.Event('input', { bubbles: true }));

const file = new window.File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'before.jpg', { type: 'image/jpeg' });
const beforeInput = $('.photo-tile[data-slot="before"] input[type=file]');
Object.defineProperty(beforeInput, 'files', { value: [file], configurable: true });
beforeInput.dispatchEvent(new window.Event('change', { bubbles: true }));
await sleep(200);

ok($('.photo-tile[data-slot="before"]').classList.contains('has-photo'), '비포 사진이 올라갔다');
ok(!$('.photo-tile[data-slot="after"]').classList.contains('has-photo'), '애프터 사진은 없다');

$('#generateBtn').click();
await sleep(400);

const body = lastInvoke && lastInvoke.body ? lastInvoke.body : {};
ok(lastInvoke && lastInvoke.name === 'generate-post', 'generate-post 를 부른다');
ok(body.photos && body.photos.before === true, '비포 사진 플래그 전달', JSON.stringify(body.photos));
ok(body.photos && body.photos.after === false, '애프터 사진 플래그는 false', JSON.stringify(body.photos));
ok(body.images && typeof body.images.before === 'string' && body.images.before.length > 0, '비포 사진 base64 전달');
ok(!body.images || !body.images.after, '없는 애프터 사진은 보내지 않는다');

ok(!$('#viewResult').hidden, '비포 1장으로도 결과 화면이 열린다');
ok($('#resultMeta').textContent.includes('네이버 블로그'), '결과 메타 표시', $('#resultMeta').textContent);
ok(($('#bodyText').textContent || '').length > 300, '본문 표시', String(($('#bodyText').textContent || '').length));

// AI 사진 분석 요약
ok(!$('#analysisRow').hidden, 'AI 사진 분석 카드가 보인다');
ok($('#analysisText').textContent === SUMMARY, '분석 요약이 그대로 보인다', $('#analysisText').textContent);
ok($('#analysisRow').textContent.includes('AI 사진 분석'), '카드에 AI 사진 분석 라벨');
ok($('#aiHint').textContent.includes('사진을 분석한 내용을 바탕으로'), '안내 문구가 분석 기반임을 알린다', $('#aiHint').textContent);

// 비교 카드 — 애프터가 없으니 현장 진단 단독 카드
ok($('#compareCardSub').textContent.includes('현장 진단 카드'), '비교 카드 안내가 현장 진단으로', $('#compareCardSub').textContent);
ok($('#layoutBtn').hidden, '한 장일 때 좌우/상하 버튼을 숨긴다');
const last = composeArgs[composeArgs.length - 1] || {};
ok(!!last.before && !last.after, '카드 합성에 비포만 넘긴다', JSON.stringify({ before: !!last.before, after: !!last.after }));

const fatal = errors.filter((e) => !/supabase|Not implemented|gemini/i.test(e));
ok(fatal.length === 0, '치명적 스크립트 오류 없음', fatal.join(' | '));

console.log('통과:', pass, ' 실패:', fail);
if (fails.length) { console.log('실패 목록:'); fails.forEach((f) => console.log(' -', f)); }
if (errors.length) { console.log('콘솔 기록:'); errors.slice(0, 8).forEach((e) => console.log(' ·', e)); }
if (fail) process.exit(1);
console.log('원고 생성 흐름 테스트 통과 ✅');
