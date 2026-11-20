// app.js 브라우저 로직 스모크 테스트 (jsdom)
// 실제 화면 파일(index.html)을 그대로 읽어 catalog.js·demo-result.js·app.js를 실행하고,
// 예시 체험 → 결과 화면 → 채널 전환 → 비로그인 생성 차단 → 신청서 제출 흐름을 확인한다.
// Supabase CDN·canvas는 실행하지 않고 필요한 부분만 대체한다(서버·이미지는 실제 배포에서 확인).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom이 설치되어 있지 않아 화면 스모크 테스트를 건너뜁니다.  (npm i jsdom)');
  process.exit(0);
}

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
const dom = new JSDOM(html, { url: 'https://ulyeol-lab.github.io/sigong-log/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

const errors = [];
window.addEventListener('error', (e) => errors.push('error: ' + (e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + (e.reason && e.reason.message)));
const origWarn = window.console.warn;
window.console.warn = (...a) => { errors.push('warn: ' + a.join(' ')); };

// canvas는 이 테스트에서 쓰지 않는다(별도 파일, 시각 확인 완료)
window.FieldLogCanvas = {
  compose: async () => ({ toDataURL: () => 'data:image/jpeg;base64,AA' }),
  canvasToBlob: async () => null,
  makeSamplePhotos: () => ({ before: 'b', during: 'd', after: 'a' }),
};

// jsdom은 이미지를 불러오지 않으므로 즉시 로드된 것으로 대체
class FakeImage {
  constructor() { this.width = 1000; this.height = 1000; }
  set src(v) { setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return ''; }
}
window.Image = FakeImage;
window.HTMLCanvasElement.prototype.getContext = function () {
  return { fillStyle: '', fillRect() {}, drawImage() {}, getImageData: () => ({ data: [] }), putImageData() {}, measureText: () => ({ width: 10 }), fillText() {} };
};
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA';
window.Element.prototype.scrollIntoView = function () {};

// 스크립트 실행
for (const f of ['catalog.js', 'demo-result.js', 'app.js']) {
  try { window.eval(read(f)); } catch (e) { errors.push('load ' + f + ': ' + e.message); }
}

const $ = (s) => window.document.querySelector(s);
const $$ = (s) => Array.from(window.document.querySelectorAll(s));

await sleep(120);

ok(!!window.FieldLogCatalog, 'catalog.js 로드');
ok(!!window.FieldLogDemo, 'demo-result.js 로드');
ok($$('#landIndustryGrid .industry-card').length === 6, '랜딩 업종 카드 6개', String($$('#landIndustryGrid .industry-card').length));
ok($$('#industryChips .chip').length === 6, '작성 업종 칩 6개');
ok($$('.channel-chips').length >= 1 && $$('.channel-chips').every((b) => b.querySelectorAll('.channel-chip').length === 4), '채널 칩 4개씩');
ok($('#coIndustry').options.length === 7, '신청 폼 업종 옵션 7개(빈 값 포함)');
ok(!$('#geminiKey'), 'Gemini API 키 입력칸이 화면에 없다');
ok(!$('#aiBtn'), 'AI 다듬기 버튼이 화면에 없다(서버가 자동 처리)');

// 예시로 바로 체험하기
$('#sampleBtn').click();
await sleep(300);
ok(!$('#viewResult').hidden, '예시 체험 후 결과 화면 표시');
ok($('#resultMeta').textContent.includes('네이버 블로그'), '결과 메타에 블로그 표시', $('#resultMeta').textContent);
ok(($('#bodyText').textContent || '').length > 800, '예시 본문 표시', String(($('#bodyText').textContent || '').length));
ok($$('#titleList li').length === 3, '예시 제목 3안', String($$('#titleList li').length));
ok($$('#tagList span').length === 5, '예시 해시태그 5개', String($$('#tagList span').length));
const blogBody = $('#bodyText').textContent;

// 네이버 상위 노출 체크리스트 — 비로그인 예시에서도 보인다
ok(!$('#seoCheckCard').hidden, '예시 결과에 체크리스트 카드 표시');
ok($$('#seoRows .seo-row').length === 5, '체크리스트 5항목', String($$('#seoRows .seo-row').length));
ok($$('#seoRows .seo-row.is-ok').length === 5, '예시 원고는 5항목 모두 통과', $$('#seoRows .is-warn').length + '개 경고');
ok($('#seoScore').textContent === '5/5', '체크리스트 점수 표시', $('#seoScore').textContent);
const seoText = $('#seoRows').textContent;
ok(seoText.includes('제목 핵심 키워드 앞배치') && seoText.includes('본문 분량') && seoText.includes('사진 삽입 자리') && seoText.includes('핵심 키워드 반복') && seoText.includes('해시태그 개수'), '체크리스트 항목 이름', seoText.slice(0, 80));
ok(/1,5\d\d자|1,\d{3}자/.test(seoText), '본문 실제 글자수 표시', (seoText.match(/\d,\d{3}자/) || [])[0]);
ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test($('#seoCheckCard').innerHTML), '체크리스트에 이모지 없음(라인 아이콘)');

// 채널 전환(서버 호출 없이 고정 예시에서 바뀐다)
$$('.channel-chip').find((b) => b.getAttribute('data-channel') === 'insta').click();
await sleep(80);
ok($('#resultMeta').textContent.includes('인스타그램'), '채널 전환 → 인스타그램', $('#resultMeta').textContent);
ok(($('#bodyText').textContent || '').includes('바뀐 포인트'), '인스타 형식 본문');
ok($('#bodyText').textContent !== blogBody, '채널별 본문 상이');
ok($('#seoCheckCard').hidden, '블로그가 아닌 채널에서는 체크리스트를 숨긴다');

// 블로그로 돌아오면 다시 보인다
$$('.channel-chip').find((b) => b.getAttribute('data-channel') === 'blog').click();
await sleep(80);
ok(!$('#seoCheckCard').hidden && $('#seoScore').textContent === '5/5', '블로그 복귀 시 체크리스트 재계산');
// 본문을 고치면 체크리스트도 다시 센다(사진 자리 줄이 줄면 경고)
const editedBody = $('#bodyText').textContent.replace(/\[사진[^\]]*\]/g, '');
$('#editBodyBtn').click();
await sleep(20);
$('#bodyEdit').value = editedBody;
$('#editBodyBtn').click();
await sleep(40);
ok($$('#seoRows .seo-row.is-warn').length >= 1, '본문 수정 시 체크리스트 경고로 바뀜');
ok($('#seoScore').textContent !== '5/5', '점수도 다시 계산', $('#seoScore').textContent);

// 비로그인 상태에서 새 현장으로 [후기 만들기] → 로그인 요구(클라이언트 생성 없음)
const ev = new window.Event('input', { bubbles: true });
$('#placeInput').value = '강남구 역삼동 24평';
$('#placeInput').dispatchEvent(ev);
await sleep(20);
$('#generateBtn').click();
await sleep(80);
ok(!$('#authModal').hidden, '비로그인 생성 시 로그인 모달');

// 신청서 제출 → 서버 없음(auth.sb=null) → 복사 안내 상태로 전환
$('#coName').value = '반짝클린';
$('#coIndustry').value = '줄눈·탄성코트';
$('#coContact').value = '010-1234-5678';
$('#coAgree').checked = true;
$('#applyForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await sleep(120);
ok(!$('#applyDone').hidden, '신청서 제출 후 완료 화면');
ok($('#applyDoneTitle').textContent.length > 0, '완료 화면 제목 표시', $('#applyDoneTitle').textContent);
ok(/신청을 보내지 못했어요|신청을 보내고 있어요/.test($('#applyDoneTitle').textContent), '서버 없으면 실패/진행 안내', $('#applyDoneTitle').textContent);
ok($('#applyPreview').textContent.includes('010-1234-5678'), '복사용 신청 내용');

const fatal = errors.filter((e) => !/로그인 모듈|supabase|Not implemented|gemini|compose/i.test(e));
ok(fatal.length === 0, '치명적 스크립트 오류 없음', fatal.join(' | '));

console.log('통과:', pass, ' 실패:', fail);
if (fails.length) { console.log('실패 목록:'); fails.forEach((f) => console.log(' -', f)); }
if (errors.length) { console.log('콘솔 기록:'); errors.slice(0, 12).forEach((e) => console.log(' ·', e)); }
if (fail) process.exit(1);
console.log('화면 로직 스모크 테스트 통과 ✅');
