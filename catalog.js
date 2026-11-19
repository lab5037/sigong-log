/*!
 * 현장로그 카탈로그 — 화면 표시용 메타데이터
 * 원고 생성 로직은 서버(Supabase Edge Function generate-post)에만 있습니다.
 * 이 파일에는 업종·채널 이름, 이모지, 설명, 빠른 태그, 말투 이름처럼 화면에 보이는 값만 담습니다.
 * (업종/채널 데이터가 바뀌면 engine.js와 이 파일을 함께 고치고 tests/catalog.test.mjs로 확인합니다.)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FieldLogCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STYLE_LABEL = {
    "haeyo": "친근한 해요체",
    "hapsio": "정중한 하십시오체",
    "ilji": "간결한 현장일지체"
  };

  const CHANNELS = [
    {
      "id": "blog",
      "label": "네이버 블로그",
      "short": "제목 3안 · 요약표 · 공정 본문",
      "hint": "지역 키워드로 검색 유입을 노리는 상세 후기"
    },
    {
      "id": "danggeun",
      "label": "당근",
      "short": "동네 이웃 소식",
      "hint": "이웃에게 말 거는 짧은 소식 + 채팅 문의"
    },
    {
      "id": "insta",
      "label": "인스타그램",
      "short": "후킹 첫 줄 · 3포인트",
      "hint": "피드·릴스 캡션, 저장 유도 + 해시태그"
    },
    {
      "id": "threads",
      "label": "스레드",
      "short": "500자 1인칭",
      "hint": "짧은 호흡의 담백한 구어체"
    }
  ];

  const INDUSTRIES = [
    {
      "id": "movein",
      "label": "입주·이사청소",
      "short": "이사 전날 하루로 끝내는 새집 정리",
      "keyword": "입주청소",
      "scope": "입주·이사청소 (주방·욕실·창틀·바닥)",
      "quickTags": [
        "주방 기름때",
        "욕실 곰팡이",
        "창틀 먼지",
        "새집 냄새",
        "베란다 물때"
      ],
      "extra": null,
      "processes": [
        {
          "name": "창틀·샤시"
        },
        {
          "name": "주방 상부장·후드"
        },
        {
          "name": "욕실 줄눈·수전"
        },
        {
          "name": "바닥·몰딩"
        },
        {
          "name": "현관·유리 마감"
        }
      ]
    },
    {
      "id": "aircon",
      "label": "시스템에어컨 청소",
      "short": "천장형 실내기 보양부터 조립까지",
      "keyword": "시스템에어컨 청소",
      "scope": "시스템에어컨 청소 (보양·완전분해·고압세척·살균)",
      "quickTags": [
        "천장형 4WAY",
        "냄새 심함",
        "송풍 약함",
        "곰팡이",
        "매장 4대"
      ],
      "extra": {
        "label": "대수·모델명",
        "placeholder": "4대 · 천장형 4WAY"
      },
      "processes": [
        {
          "name": "보양"
        },
        {
          "name": "완전분해 (필터·그릴·드레인판·송풍팬)"
        },
        {
          "name": "열교환기 고압세척·오염수 배출"
        },
        {
          "name": "살균·건조"
        },
        {
          "name": "조립·시운전"
        }
      ]
    },
    {
      "id": "grout",
      "label": "줄눈·탄성코트",
      "short": "파내고 다시 채워야 오래 갑니다",
      "keyword": "줄눈",
      "scope": "줄눈 재시공·욕실 탄성코트",
      "quickTags": [
        "욕실 줄눈 변색",
        "바닥 들뜸",
        "곰팡이 줄눈",
        "탄성코트",
        "베란다 줄눈"
      ],
      "extra": null,
      "processes": [
        {
          "name": "기존 줄눈 제거"
        },
        {
          "name": "홈 청소·건조"
        },
        {
          "name": "줄눈재 시공"
        },
        {
          "name": "탄성코트·양생"
        }
      ]
    },
    {
      "id": "leak",
      "label": "누수·방수",
      "short": "뜯기 전에 원인부터 찾습니다",
      "keyword": "누수탐지",
      "scope": "누수 탐지·방수 보강·타일 복구",
      "quickTags": [
        "아래집 물자국",
        "욕실 누수",
        "수압 저하",
        "방수 보수",
        "베란다 누수"
      ],
      "extra": null,
      "processes": [
        {
          "name": "누수 지점 탐지"
        },
        {
          "name": "철거·방수 보강"
        },
        {
          "name": "타일·줄눈 복구"
        },
        {
          "name": "담수 테스트"
        }
      ]
    },
    {
      "id": "silicon",
      "label": "욕실·실리콘 시공",
      "short": "덧바르지 않고 걷어내고 다시",
      "keyword": "욕실 실리콘",
      "scope": "욕실 실리콘 재시공·줄눈 마감",
      "quickTags": [
        "실리콘 곰팡이",
        "욕조 실리콘",
        "세면대 실리콘",
        "줄눈 마감",
        "물 샘"
      ],
      "extra": null,
      "processes": [
        {
          "name": "기존 실리콘 제거"
        },
        {
          "name": "세척·건조"
        },
        {
          "name": "실리콘 시공"
        },
        {
          "name": "마감·양생"
        }
      ]
    },
    {
      "id": "screen",
      "label": "방충망·단열필름·중문",
      "short": "틈새 하나까지 막는 시공",
      "keyword": "방충망교체",
      "scope": "방충망 교체·단열필름·중문 설치",
      "quickTags": [
        "방충망 찢어짐",
        "벌레 들어옴",
        "단열필름",
        "중문 설치",
        "베란다 결로"
      ],
      "extra": null,
      "processes": [
        {
          "name": "실측"
        },
        {
          "name": "방충망 시공"
        },
        {
          "name": "단열필름 시공"
        },
        {
          "name": "중문 설치"
        },
        {
          "name": "마감·점검"
        }
      ]
    }
  ];

  const BANNED = [
    "에 대해 알아보겠습니다",
    "알아보겠습니다",
    "살펴보겠습니다",
    "정리해보겠습니다",
    "다음과 같습니다",
    "도움이 되셨길",
    "도움이 되셨으면",
    "결론적으로",
    "이번 포스팅에서는",
    "참고하시기 바랍니다",
    "라고 할 수 있습니다",
    "지금부터",
    "많은 도움이",
    "요약하면",
    "정리하면",
    "시사하는 바",
    "주목할 만한",
    "주목할 만",
    "본질적으로",
    "핵심적으로",
    "궁극적으로",
    "다채로운",
    "진정한",
    "중추적인",
    "필수적인",
    "혁신적인",
    "독보적인",
    "파격적인",
    "압도적인",
    "획기적인",
    "자리매김",
    "발돋움",
    "방증",
    "향연",
    "명심하셔야",
    "명심해야"
  ];

  function getIndustry(id) {
    return INDUSTRIES.filter(function (x) { return x.id === id; })[0] || null;
  }

  function getChannel(id) {
    return CHANNELS.filter(function (c) { return c.id === id; })[0] || CHANNELS[0];
  }

  // AI 다듬기 결과에서 걸러 낼 상투적 문구와 S1 흔적(줄표·이모지) (생성 로직 아님 · 글자 정리만)
  // engine.js의 sanitize()와 같은 규칙을 쓴다.
  const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu;

  function sanitize(text) {
    let out = String(text || '');
    BANNED.forEach(function (b) { if (out.indexOf(b) >= 0) out = out.split(b).join(''); });
    out = out.replace(/[ \t]*[\u2014\u2013]+[ \t]*/g, ' : ');
    out = out.replace(EMOJI_RE, '');
    return out
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ :[ \t]*:/g, ' :')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // 본문을 직접 수정했을 때 '전체 복사' 텍스트를 다시 조립한다. (서버가 만든 결과 형식 그대로)
  function fullTextOf(r) {
    if (!r) return '';
    const tags = r.hashtagText || '';
    if (r.channel && r.channel !== 'blog') {
      return [r.titles && r.titles[0] ? r.titles[0] : '', String(r.body || '').replace(r.summaryText || '', '').trim(), tags]
        .filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    const rest = String(r.body || '').replace(r.summaryText || '', '').replace(/\n{3,}/g, '\n\n').trim();
    return [r.titles && r.titles[0] ? r.titles[0] : '', '', r.summaryText || '', '', rest, '', tags].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  return {
    STYLE_LABEL: STYLE_LABEL,
    CHANNELS: CHANNELS,
    INDUSTRIES: INDUSTRIES,
    BANNED: BANNED,
    getIndustry: getIndustry,
    getChannel: getChannel,
    sanitize: sanitize,
    fullTextOf: fullTextOf
  };
});
