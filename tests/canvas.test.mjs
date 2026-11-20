// canvas.js — 비포·애프터 카드 합성 테스트 (jsdom + 기록용 2D 컨텍스트)
//   실행: node tests/canvas.test.mjs
// 실제 배포본과 같은 canvas.js 를 읽어, 사진이 한 장뿐일 때도 카드가 깨지지 않고
// '현장 진단 · 시공 전 기록' 단독 카드로 만들어지는지 확인한다.

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

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/', runScripts: 'outside-only' });
const { window } = dom;

// 이미지 로드 대체 — 실제 픽셀은 필요 없고 '몇 장을 그렸는지'만 본다.
class FakeImage {
  constructor() { this.width = 800; this.height = 600; }
  set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._src || ''; }
}
window.Image = FakeImage;

const drawLog = [];
function makeCtx() {
  const target = {
    measureText: (t) => ({ width: String(t).length * 9 }),
    fillText: (t) => drawLog.push('text:' + String(t)),
    drawImage: () => drawLog.push('drawImage'),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(target, {
    get(o, p) { return p in o ? o[p] : () => {}; },
    set(o, p, v) { o[p] = v; return true; },
  });
}
window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA';

window.eval(read('canvas.js'));
const C = window.FieldLogCanvas;
ok(!!C && typeof C.compose === 'function', 'canvas.js 로드');

const TEXT = 'data:image/jpeg;base64,AA';
const base = { place: '송파구 잠실 엘스 34평', industryLabel: '욕실 줄눈·탄성코트', businessName: 'OO클린' };

function texts() { return drawLog.filter((l) => l.startsWith('text:')).map((l) => l.slice(5)); }
function images() { return drawLog.filter((l) => l === 'drawImage').length; }

// 1) 시공 전 사진 한 장 → '현장 진단 · 시공 전 기록' 단독 카드
drawLog.length = 0;
let cv = await C.compose({ ...base, before: TEXT, during: null, after: null });
ok(cv.width === 1080 && cv.height === 1080, '카드 크기 1080×1080', cv.width + '×' + cv.height);
ok(images() === 1, '사진 한 장만 그린다', String(images()));
ok(texts().includes('현장 진단 · 시공 전 기록'), '단독 카드 라벨', texts().join(' | '));
ok(!texts().includes('AFTER'), '없는 애프터 라벨을 만들지 않는다');
ok(texts().includes('송파구 잠실 엘스 34평'), '지역 문구가 들어간다');
ok(texts().includes('욕실 줄눈·탄성코트'), '업종 문구가 들어간다');

// 2) 시공 전 + 시공 후 → 2분할 카드 유지
drawLog.length = 0;
cv = await C.compose({ ...base, before: TEXT, during: TEXT, after: TEXT, layout: 'h' });
ok(images() === 2, '두 장을 나눠 그린다', String(images()));
ok(texts().includes('BEFORE') && texts().includes('AFTER'), 'BEFORE/AFTER 라벨', texts().join(' | '));

// 상하 배치도 같은 라벨을 쓴다
drawLog.length = 0;
await C.compose({ ...base, before: TEXT, after: TEXT, layout: 'v' });
ok(images() === 2 && texts().includes('BEFORE') && texts().includes('AFTER'), '상하 배치도 동작');

// 3) 작업 중 사진만 → '작업 중' 단독 카드
drawLog.length = 0;
await C.compose({ ...base, before: null, after: null, during: TEXT });
ok(images() === 1 && texts().includes('작업 중'), '작업 중 사진만 있어도 카드가 나온다', texts().join(' | '));

// 4) 사진이 없으면 안내 카드(깨지지 않음)
drawLog.length = 0;
await C.compose({ ...base });
ok(images() === 0, '사진이 없으면 그리지 않는다');
ok(texts().some((t) => t.indexOf('비교 카드가 자동으로') >= 0), '안내 문구 표시', texts().join(' | '));

console.log('통과:', pass, ' 실패:', fail);
if (fails.length) { console.log('실패 목록:'); fails.forEach((f) => console.log(' -', f)); }
if (fail) process.exit(1);
console.log('현장로그 카드 합성 테스트 통과 ✅');
