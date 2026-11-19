// 현장로그 원고 엔진 테스트 (Node 18+)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../engine.js');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}

const BIZ = { name: '반짝입주청소', contact: '010-1234-5678', style: 'haeyo', closing: '다음에도 깔끔하게 모시겠습니다.' };
const PHOTOS = { before: true, during: true, after: true };

// 1) 6개 업종 × 3말투 전체 생성
const styles = ['haeyo', 'hapsio', 'ilji'];
let totalChars = [];
for (const ind of E.INDUSTRIES) {
  for (const style of styles) {
    const r = E.generate({
      industryId: ind.id, place: '송파구 헬리오시티 34평', detail: '주방 기름때 심함, 4시간 소요',
      extra: ind.extra ? '4대 · 천장형 4WAY' : '',
      price: '35~40만 원', pricePrivate: false,
      business: { ...BIZ, style }, photos: PHOTOS, seed: 7
    });
    const tag = ind.id + '/' + style;
    ok(r.titles.length === 3, tag + ' 제목 3안');
    ok(r.titles.every(t => t.length > 8 && t.length <= 48), tag + ' 제목 길이', JSON.stringify(r.titles));
    ok(r.titles[0].includes('송파구'), tag + ' 제목1 지역 포함', r.titles[0]);
    ok(r.body.includes('송파구'), tag + ' 본문 지역 포함');
    ok(r.body.includes('■ 현장 요약'), tag + ' 요약 섹션');
    ok(r.body.includes('· 견적 : 35~40만 원'), tag + ' 요약 견적');
    ok((r.body.match(/\[📸 사진 위치/g) || []).length >= 4, tag + ' 사진 위치 4개 이상',
      String((r.body.match(/\[📸 사진 위치/g) || []).length));
    ok(ind.processes.every(p => r.body.includes('■ ' + p.name)), tag + ' 모든 공정 포함');
    ok(r.hashtags.length === 5, tag + ' 해시태그 5개', JSON.stringify(r.hashtags));
    ok(r.hashtags.every(h => h.startsWith('#') && h.length > 2), tag + ' 해시태그 형식');
    ok(new Set(r.hashtags).size === 5, tag + ' 해시태그 중복 없음');
    const bannedHit = E.BANNED.filter(b => r.body.includes(b));
    ok(bannedHit.length === 0, tag + ' 금지어 없음', bannedHit.join(','));
    ok(r.body.includes(BIZ.name), tag + ' 업체명 포함');
    ok(r.body.includes(BIZ.contact), tag + ' 연락처 포함');
    ok(!/\{place\}|\{region\}|\{pyeong\}/.test(r.body + r.titles.join(' ')), tag + ' 미치환 토큰 없음');
    ok(r.seoKeywords.length >= 3, tag + ' SEO 키워드', JSON.stringify(r.seoKeywords));
    ok(r.fullText.includes(r.titles[0]) && r.fullText.includes(r.hashtags[0]), tag + ' 전체 복사 텍스트');
    totalChars.push(r.body.length);
  }
}

// 2) 말투가 실제로 달라지는지
const haeyo = E.generate({ industryId: 'movein', place: '송파구 헬리오시티 34평', business: { ...BIZ, style: 'haeyo' }, photos: PHOTOS, seed: 3 });
const hapsio = E.generate({ industryId: 'movein', place: '송파구 헬리오시티 34평', business: { ...BIZ, style: 'hapsio' }, photos: PHOTOS, seed: 3 });
const ilji = E.generate({ industryId: 'movein', place: '송파구 헬리오시티 34평', business: { ...BIZ, style: 'ilji' }, photos: PHOTOS, seed: 3 });
ok(haeyo.body !== hapsio.body && hapsio.body !== ilji.body, '말투별 본문 상이');
ok(/(어요|니다)\./.test(haeyo.body) && haeyo.body.includes('어요'), '해요체 종결', haeyo.body.slice(0, 40));
ok((hapsio.body.match(/습니다/g) || []).length >= 3, '하십시오체 종결');
ok(/(완료|진행|확인)\./.test(ilji.body), '일지체 종결');
ok(ilji.body.length < hapsio.body.length, '일지체가 더 간결', ilji.body.length + ' vs ' + hapsio.body.length);

// 3) 견적 비공개
const priv = E.generate({ industryId: 'grout', place: '강남구 역삼동 래미안 24평', price: '35~40만 원', pricePrivate: true, business: BIZ, photos: PHOTOS, seed: 11 });
ok(priv.body.includes('현장 확인 후 안내'), '비공개 시 견적 미노출');
ok(!priv.body.includes('35~40만 원'), '비공개 시 금액 숨김');
ok(priv.titles[2].includes('비용'), '비공개 제목3 비용 키워드', priv.titles[2]);

// 4) 사진 종류에 따라 마커 수가 달라진다
const only = E.generate({ industryId: 'movein', place: '송파구 헬리오시티 34평', business: BIZ, photos: { before: true, after: true }, seed: 5 });
ok(!only.body.includes('작업 중'), '작업 중 사진 없으면 마커 없음');
ok((only.body.match(/\[📸 사진 위치/g) || []).length >= 3, '전/후만 있어도 마커 3개 이상');

// 5) 재생성(seed) 시 표현이 달라진다
const s1 = E.generate({ industryId: 'aircon', place: '마포구 상암동 30평', business: BIZ, photos: PHOTOS, seed: 100 });
const s2 = E.generate({ industryId: 'aircon', place: '마포구 상암동 30평', business: BIZ, photos: PHOTOS, seed: 101 });
ok(s1.body !== s2.body, 'seed 변경 시 다른 원고');
ok(s1.titles.join('|') === s2.titles.join('|'), '제목은 seed와 무관하게 동일');

// 6) 시스템에어컨 대수·모델명 반영
const ac = E.generate({ industryId: 'aircon', place: '송파구 사무실 40평', extra: '5대 · 천장형 4WAY', business: BIZ, photos: PHOTOS, seed: 2 });
ok(ac.body.includes('5대 · 천장형 4WAY'), '대수·모델명 본문 반영');
ok(ac.summary.some(r => r.k === '대수·모델명' && r.v === '5대 · 천장형 4WAY'), '요약표 대수 행');
ok(ac.summary.some(r => r.k === '소요 시간' && r.v.includes('5대')), '대수 기반 소요시간', JSON.stringify(ac.summary));
ok(ac.body.includes('드레인판') && ac.body.includes('열교환기'), '시스템에어컨 전용 공정');

// 7) 업종 전용 공정 확인
const leakBody = E.generate({ industryId: 'leak', place: '은평구 아파트 32평', business: BIZ, photos: PHOTOS, seed: 9 }).body;
ok(leakBody.includes('담수'), '누수 업종 담수 테스트 포함');
const sil = E.generate({ industryId: 'silicon', place: '노원구 24평', business: BIZ, photos: PHOTOS, seed: 9 }).body;
ok(sil.includes('실리콘') && sil.includes('양생'), '욕실·실리콘 전용 공정');
const scr = E.generate({ industryId: 'screen', place: '일산 34평', business: BIZ, photos: PHOTOS, seed: 9 }).body;
ok(scr.includes('방충망') && scr.includes('중문'), '방충망·중문 전용 공정');

// 8) 지역 파싱
const p1 = E.parsePlace('송파구 헬리오시티 34평');
ok(p1.region === '송파구' && p1.building === '헬리오시티' && p1.pyeong === '34', '지역 파싱 기본', JSON.stringify(p1));
const p2 = E.parsePlace('강남구 역삼동 래미안 24평');
ok(p2.region === '강남구' && p2.building === '역삼동 래미안', '지역 파싱 3토큰', JSON.stringify(p2));
const p3 = E.parsePlace('헬리오시티 34평');
ok(p3.pyeong === '34', '지역 파싱 건물만', JSON.stringify(p3));

// 9) 업체 정보 없이도 동작
const noBiz = E.generate({ industryId: 'movein', place: '송파구 30평', photos: { before: true, after: true }, seed: 4 });
ok(noBiz.body.length > 300 && !noBiz.body.includes('undefined'), '업체정보 없이 생성');
ok(!noBiz.body.includes('입니다. 송파구'), '업체명 없으면 자연스럽게 시작', noBiz.body.slice(-120));

// 10) 본문 길이 (블로그 분량)
const avg = Math.round(totalChars.reduce((a, b) => a + b, 0) / totalChars.length);
ok(avg > 950 && avg < 3000, '본문 평균 길이 적정', avg);

console.log('\n본문 평균 길이:', avg, '자');
console.log('통과:', pass, ' 실패:', fail);
if (fails.length) { console.log('\n실패 목록:'); fails.forEach(f => console.log(' -', f)); process.exit(1); }
console.log('\n전체 테스트 통과 ✅');
