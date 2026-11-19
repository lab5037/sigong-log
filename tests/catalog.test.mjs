// catalog.js(화면 표시용)와 demo-result.js(고정 예시)가 engine.js와 어긋나지 않는지 검사한다.
// 업종·채널 이름이나 예시 결과가 조용히 달라지면 여기서 잡힌다.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../engine.js');
const CAT = require('../catalog.js');
const DEMO = require('../demo-result.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log(' ✗', name + (extra ? ' → ' + extra : '')); }
}

// 1) 말투 이름
ok(JSON.stringify(CAT.STYLE_LABEL) === JSON.stringify(E.STYLE_LABEL), 'STYLE_LABEL 동일');

// 2) 채널
const chFields = ['id', 'label', 'emoji', 'short', 'hint'];
ok(CAT.CHANNELS.length === E.CHANNELS.length, '채널 개수 동일');
E.CHANNELS.forEach((c) => {
  const hit = CAT.CHANNELS.find((x) => x.id === c.id);
  ok(!!hit, '카탈로그에 채널 있음: ' + c.id);
  if (hit) chFields.forEach((f) => ok(hit[f] === c[f], c.id + ' 채널 ' + f));
});

// 3) 업종
ok(CAT.INDUSTRIES.length === E.INDUSTRIES.length, '업종 개수 동일');
E.INDUSTRIES.forEach((ind) => {
  const hit = CAT.getIndustry(ind.id);
  ok(!!hit, '카탈로그에 업종 있음: ' + ind.id);
  if (!hit) return;
  ['label', 'emoji', 'short', 'keyword', 'scope'].forEach((f) => ok(hit[f] === ind[f], ind.id + ' ' + f));
  ok(JSON.stringify(hit.quickTags) === JSON.stringify(ind.quickTags), ind.id + ' 빠른 태그');
  ok(JSON.stringify(hit.extra || null) === JSON.stringify(ind.extra || null), ind.id + ' 추가 입력칸');
  ok(JSON.stringify(hit.processes.map((p) => p.name)) === JSON.stringify(ind.processes.map((p) => p.name)), ind.id + ' 공정 이름');
});

// 4) 카탈로그에는 생성기가 없다
ok(typeof CAT.generate === 'undefined', '카탈로그에 generate 없음');
['parsePlace', 'buildBody', 'blogBody'].forEach((k) => ok(typeof CAT[k] === 'undefined', '카탈로그에 ' + k + ' 없음'));

// 5) 고정 예시 결과 = engine.generate(같은 입력, 각 채널)
ok(DEMO.input && DEMO.input.industryId === 'grout', '예시 입력 업종 grout');
ok(DEMO.input.place === 'OO구 OO아파트 34평', '예시 현장 이름(가상)');
E.CHANNELS.forEach((c) => {
  const expected = E.generate(Object.assign({}, DEMO.input, { channel: c.id }));
  ok(JSON.stringify(DEMO.get(c.id)) === JSON.stringify(expected), '예시 결과 일치: ' + c.id,
    DEMO.get(c.id) && expected ? '길이 ' + (DEMO.get(c.id).body || '').length + ' vs ' + expected.body.length : '');
});
ok(DEMO.get('없는채널') === DEMO.get('blog'), '없는 채널은 블로그로 대체');

// 6) 예시 결과는 가상 이름만 쓴다
const demoText = JSON.stringify(DEMO.posts);
ok(!/\d{2,3}-\d{3,4}-\d{4}/.test(demoText.replace(/010-0000-0000/g, '')), '예시에 실제 전화번호 없음');
ok(!/실제|고객님 성함/.test(demoText), '예시에 실제 고객 정보 없음');

console.log('통과:', pass, ' 실패:', fail);
if (fail) process.exit(1);
console.log('카탈로그·예시 결과 일치 ✅');
