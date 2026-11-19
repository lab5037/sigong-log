// 서버 원고 엔진(engine.ts)과 프론트 엔진(engine.js)의 CORE 본문이 같은지 검사한다.
// 두 파일의 CORE 사이 본문은 글자 단위로 같아야 서버와 브라우저가 같은 결과를 낸다.
// (프론트는 이제 engine.js를 배포하지 않지만, engine.js는 테스트·서버 사본 동기화의 기준이다.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;

function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log(' ✗', name + (extra ? ' → ' + extra : '')); }
}

function coreOf(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const a = src.indexOf('/* ===== ENGINE CORE START');
  const b = src.indexOf('/* ===== ENGINE CORE END ===== */');
  if (a < 0 || b < 0 || b <= a) return null;
  return src.slice(a, b);
}

const front = coreOf('engine.js');
const server = coreOf('supabase/functions/generate-post/engine.ts');

ok(!!front, 'engine.js 에 CORE 마커가 있다');
ok(!!server, 'engine.ts 에 CORE 마커가 있다');
ok(front === server, 'CORE 본문이 글자 단위로 같다',
  front && server ? firstDiff(front, server) : '');

function firstDiff(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return `처음 다른 위치 ${i}: ${JSON.stringify(a.slice(i - 20, i + 20))} ≠ ${JSON.stringify(b.slice(i - 20, i + 20))}`;
  }
  return a.length === b.length ? '' : `길이 다름 ${a.length} vs ${b.length}`;
}

// 서버 사본이 실제로 모듈로 노출하는지(문자열 기준)
const ts = fs.readFileSync(path.join(root, 'supabase/functions/generate-post/engine.ts'), 'utf8');
ok(/export \{[\s\S]*\bgenerate\b[\s\S]*\};/.test(ts), 'engine.ts 가 generate 를 export 한다');

// 프론트에는 생성기가 남아 있지 않다
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
ok(!/engine\.js/.test(page), 'index.html 이 engine.js 를 불러오지 않는다');
ok(/catalog\.js/.test(page) && /demo-result\.js/.test(page), 'index.html 이 catalog.js·demo-result.js 를 불러온다');

const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
ok(!/FieldLogEngine/.test(app), 'app.js 가 원고 엔진 전역을 쓰지 않는다');
ok(!/E\.generate\(/.test(app), 'app.js 에 클라이언트 생성 호출이 없다');
ok(/functions\.invoke\('generate-post'/.test(app), 'app.js 가 generate-post Edge Function 을 호출한다');
ok(/functions\.invoke\('submit-lead'/.test(app), 'app.js 가 submit-lead Edge Function 을 호출한다');
ok(!/script\.google\.com/.test(app), 'app.js 에 GAS 웹훅 URL 이 없다');
ok(!/sb_secret_[A-Za-z0-9_-]{6,}/.test(app), 'app.js 에 비밀키가 없다');
ok(!/generativelanguage\.googleapis\.com/.test(app), '브라우저가 Gemini를 직접 부르지 않는다(서버 내장)');
ok(!/geminiKey|fieldlog\.gemini/.test(app), 'app.js 에 Gemini 키 입력·저장 로직이 없다');
const page2 = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
ok(!/geminiKey|Gemini API 키/.test(page2), 'index.html 에 API 키 입력칸이 없다');

console.log('통과:', pass, ' 실패:', fail);
if (fail) process.exit(1);
console.log('서버/프론트 엔진 동기화 확인 ✅');
