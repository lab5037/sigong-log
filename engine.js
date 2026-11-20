/*!
 * 현장로그(FieldLog) 원고 엔진
 * 외부 API 없이 동작하는 시공·청소 후기 원고 생성기.
 * 브라우저에서는 window.FieldLogEngine, Node에서는 module.exports 로 노출된다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FieldLogEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===== ENGINE CORE START (supabase/functions/generate-post/engine.ts와 같은 내용이어야 함 — tests/engine-parity.test.mjs가 검사) ===== */
  /* ─────────────────────────── 티어1 업종 데이터 ─────────────────────────── */

  const INDUSTRIES = [
    {
      id: 'movein',
      label: '입주·이사청소',
      keyword: '입주청소',
      scope: '입주·이사청소 (주방·욕실·창틀·바닥)',
      detailHint: '주방 기름때 심함, 욕실 곰팡이, 4시간 소요',
      quickTags: ['주방 기름때', '욕실 곰팡이', '창틀 먼지', '새집 냄새', '베란다 물때'],
      fallbackIssue: '창틀 레일과 상부장 먼지',
      short: '이사 전날 하루로 끝내는 새집 정리',
      state: [
        '창틀 레일과 상부장 위에 먼지가 그대로 남은 상태',
        '몰딩과 문턱에 실리콘 자국이 붙은 자리',
        '베란다 창과 욕실 물때까지 함께 손이 필요한 현장'
      ],
      after: [
        '창틀 레일과 상부장 위 먼지 제거',
        '주방 기름때와 후드 필터 세척',
        '욕실 물때와 수전 광택, 바닥 물걸레 마무리'
      ],
      note: {
        haeyo: '입주청소는 짐이 들어오기 전에 끝내야 해서 순서가 중요해요. 먼지가 쌓이는 창틀과 상부장을 먼저 하고 바닥을 마지막에 닦아야 짐을 들인 뒤에 다시 밟아도 깨끗해요. 냄새가 남는 집은 환기까지 하고 나서 마무리합니다.',
        hapsio: '입주청소는 짐을 들이기 전에 마쳐야 하므로 순서가 중요합니다. 먼지가 쌓이는 창틀과 상부장을 먼저 진행하고 바닥은 마지막에 닦아야 짐을 들인 뒤에도 상태가 유지됩니다. 냄새가 남는 집은 환기까지 마친 뒤 작업을 마칩니다.',
        ilji: '짐 반입 전 완료 필수. 창틀·상부장 먼저, 바닥 마지막. 냄새 심한 집은 환기 후 마무리.'
      },
      timeText: function (pyeong) {
        if (!pyeong) return '4~5시간';
        const lo = Math.max(3, Math.round(pyeong * 0.09 + 1));
        const hi = Math.max(lo + 1, Math.round(pyeong * 0.13 + 1));
        return lo + '~' + hi + '시간';
      },
      seo: ['{region} 입주청소', '{region} 이사청소', '{region} 입주청소 비용', '{building} 입주청소'],
      open: [
        {
          haeyo: '{place} 입주청소 다녀왔어요. 이사 들어오기 전날 불러주셨는데 창틀 레일과 주방 상부장 위는 새집인데도 먼지가 그대로 쌓여 있더라고요. 바닥만 봐서는 절대 알 수 없는 자리예요.',
          hapsio: '{place} 입주청소 현장을 다녀왔습니다. 이사 전날 작업을 진행했고 새집임에도 창틀 레일과 주방 상부장 위에는 먼지가 그대로 남아 있었습니다.',
          ilji: '{place} 입주청소. 이사 전날 진행. 창틀 레일·상부장 위 먼지 다량 확인.'
        },
        {
          haeyo: '오늘은 {place} 현장이었어요. 겉으로 보이는 바닥은 깨끗한데, 몰딩과 문턱, 창틀 안쪽에 손이 안 간 자국이 남아 있어서 그쪽부터 손댔어요.',
          hapsio: '오늘은 {place} 입주청소를 진행했습니다. 바닥은 깨끗했지만 몰딩, 문턱, 창틀 안쪽에 손이 닿지 않은 자국이 남아 있어 해당 부위부터 작업했습니다.',
          ilji: '현장: {place}. 바닥 양호, 몰딩·문턱·창틀 안쪽 자국 위주 작업.'
        }
      ],
      processes: [
        {
          name: '창틀·샤시',
          lines: {
            haeyo: '창틀은 레일 홈에 낀 먼지를 진공으로 먼저 빼고 남은 자국은 걸레로 두 번 닦았어요. 새집은 실리콘 잔여물이 붙어 있어서 한 번 닦아서는 잘 안 지워져요.',
            hapsio: '창틀은 레일 홈의 먼지를 진공으로 제거한 뒤 걸레로 두 번 닦았습니다. 새집에서는 실리콘 잔여물이 남아 있어 한 번의 세척으로는 지워지지 않는 경우가 많습니다.',
            ilji: '창틀 레일 진공 → 걸레 2회. 실리콘 잔여물 제거까지.'
          }
        },
        {
          name: '주방 상부장·후드',
          lines: {
            haeyo: '주방은 상부장 문짝 위와 후드 필터부터 봤어요. 기름때는 뜨거운 물에 중성세제를 풀어 불린 다음 닦아야 도장면이 상하지 않아요.',
            hapsio: '주방은 상부장 상단과 후드 필터부터 작업했습니다. 기름때는 뜨거운 물에 중성세제를 풀어 불린 뒤 닦아야 도장면 손상을 줄일 수 있습니다.',
            ilji: '상부장 상단·후드 필터. 중성세제 불림 후 세척.'
          }
        },
        {
          name: '욕실 줄눈·수전',
          lines: {
            haeyo: '욕실은 물때가 오래된 곳에 약품을 먼저 발라 두었어요. 그 사이 다른 구역을 먼저 했어요. 수전과 배수구는 마지막에 광택까지 내고 나왔어요.',
            hapsio: '욕실은 물때가 심한 부위에 약품을 먼저 도포한 뒤 대기 시간에 다른 구역을 진행했습니다. 수전과 배수구는 마지막에 광택 작업까지 마쳤습니다.',
            ilji: '욕실 물때 약품 도포 → 대기 → 세척. 수전·배수구 광택.'
          }
        },
        {
          name: '바닥·몰딩',
          lines: {
            haeyo: '바닥은 걸레를 자주 갈아 가며 닦았어요. 같은 걸레로 넓게 닦으면 먼지가 다시 묻어서 마지막에 물걸레를 한 번 더 해야 깔끔하게 끝나요.',
            hapsio: '바닥은 걸레를 자주 교체하며 닦았습니다. 같은 걸레로 넓게 닦으면 먼지가 다시 묻어 마지막에 물걸레 작업을 한 번 더 진행했습니다.',
            ilji: '바닥 걸레 교체 세척 → 물걸레 마무리.'
          }
        },
        {
          name: '현관·유리 마감',
          lines: {
            haeyo: '마무리는 현관 손잡이와 유리, 거울처럼 손이 닿는 곳을 중심으로 봤어요. 나가기 전에 한 번 같이 돌면서 확인하고 마쳤어요.',
            hapsio: '마무리 단계에서는 현관 손잡이, 유리, 거울처럼 손이 닿는 부분을 중심으로 점검했습니다. 고객님과 함께 확인한 뒤 작업을 마쳤습니다.',
            ilji: '현관 손잡이·유리·거울 점검. 고객 동석 확인 후 종료.'
          }
        }
      ],
      issues: [
        { k: ['기름', '후드', '주방'], t: '주방 기름때' },
        { k: ['곰팡이'], t: '욕실 곰팡이' },
        { k: ['물때', '석회'], t: '욕실 물때' },
        { k: ['먼지', '새집'], t: '창틀과 상부장 먼지' },
        { k: ['냄새', '담배'], t: '베인 냄새' }
      ],
      tips: [
        { haeyo: '창틀은 손가락으로 한 번 훑어보세요. 먼지가 묻으면 아직 안 끝난 거예요.', hapsio: '창틀은 손가락으로 확인하시면 됩니다. 먼지가 묻으면 미완료로 보시면 됩니다.', ilji: '창틀 손가락 확인. 먼지 묻으면 미완료.' },
        { haeyo: '주방 상부장 위는 의자에 올라가서 봐야 해요. 여기가 제일 많이 빠지는 자리예요.', hapsio: '주방 상부장 상단은 직접 확인하시는 것이 좋습니다. 누락이 가장 많은 부위입니다.', ilji: '상부장 상단 직접 확인. 누락 다발 구역.' },
        { haeyo: '청소하고 하루 지나서 물때가 다시 올라오면 그 자리는 약품이 부족했던 거예요.', hapsio: '작업 다음 날 물때가 재발하면 약품 처리가 부족했던 경우입니다.', ilji: '24시간 후 물때 재발 여부 확인.' }
      ],
      tags: ['입주청소', '입주청소후기', '이사청소', '새집청소', '입주청소비용']
    },

    {
      id: 'aircon',
      label: '시스템에어컨 청소',
      keyword: '시스템에어컨 청소',
      scope: '시스템에어컨 청소 (보양·완전분해·고압세척·살균)',
      detailHint: '4대, 천장형 4WAY, 바람에서 냄새',
      quickTags: ['천장형 4WAY', '냄새 심함', '송풍 약함', '곰팡이', '매장 4대'],
      fallbackIssue: '송풍팬과 드레인판에 낀 곰팡이',
      short: '천장형 실내기 보양부터 조립까지',
      state: [
        '필터는 깨끗한데 바람에서 냄새가 나는 상태',
        '드레인판에 물과 이물질이 고인 경우',
        '송풍팬과 열교환기 핀 사이에 낀 곰팡이'
      ],
      after: [
        '드레인판과 송풍팬 오염 제거',
        '열교환기 고압세척과 오염수 배출',
        '살균·건조 후 풍량과 냄새 확인'
      ],
      note: {
        haeyo: '에어컨은 필터만 씻어서는 냄새가 안 잡혀요. 냄새의 원인은 대부분 드레인판에 고인 물과 송풍팬에 붙은 곰팡이예요. 그 두 곳을 열어 보고 세척해야 여름 내내 냄새가 돌아오지 않습니다.',
        hapsio: '에어컨은 필터 세척만으로 냄새가 해결되지 않습니다. 원인은 대부분 드레인판에 고인 물과 송풍팬에 붙은 곰팡이입니다. 두 부위를 열어 확인하고 세척해야 여름 동안 냄새가 재발하지 않습니다.',
        ilji: '필터 세척만으로 냄새 해결 안 됨. 드레인판 고인 물·송풍팬 곰팡이 확인 필요.'
      },
      extra: { label: '대수·모델명', placeholder: '4대 · 천장형 4WAY' },
      timeText: function (pyeong, extra) {
        const m = String(extra || '').match(/(\d+)\s*대/);
        const count = m ? parseInt(m[1], 10) : 1;
        const hours = Math.max(1.5, Math.round(count * 1.2 * 2) / 2);
        return count + '대 기준 ' + hours + '시간 내외';
      },
      seo: ['{region} 시스템에어컨청소', '{region} 시스템에어컨 분해청소', '시스템에어컨 청소 비용', '{region} 사무실 에어컨청소'],
      open: [
        {
          haeyo: '{place} 시스템에어컨 청소 다녀왔어요. 바람에서 냄새가 난다고 하셨는데 필터는 깨끗해 보였고 문제는 그 안쪽 드레인판과 송풍팬에 있었어요.',
          hapsio: '{place} 시스템에어컨 청소를 진행했습니다. 냄새 문의가 있던 현장으로, 필터 상태는 양호했고 드레인판과 송풍팬에 오염이 있었습니다.',
          ilji: '{place} 시스템에어컨. 냄새 문의. 필터 양호, 드레인판·송풍팬 오염 확인.'
        },
        {
          haeyo: '{place} 천장형 실내기 청소 현장이에요. 영업 시간이나 근무 시간 전에 끝내야 해서 보양부터 순서를 정확히 나눠서 진행했어요.',
          hapsio: '{place} 천장형 실내기 청소 현장입니다. 영업 또는 근무 시간 전에 마무리해야 해 보양 단계부터 순서를 나눠 진행했습니다.',
          ilji: '현장: {place}. 천장형 실내기. 업무 전 마감 조건.'
        }
      ],
      processes: [
        {
          name: '보양',
          lines: {
            haeyo: '작업 전에 바닥과 집기부터 보양했어요. 물을 쓰는 작업이라 바닥에 한 방울만 떨어져도 그게 더 큰 문제가 돼요.',
            hapsio: '작업 전 바닥과 집기를 보양했습니다. 물을 사용하는 작업이라 바닥 오염이 발생하면 추가 문제가 생겨요.',
            ilji: '바닥·집기 보양. 물받이·비닐 설치.'
          }
        },
        {
          name: '완전분해 (필터·그릴·드레인판·송풍팬)',
          lines: {
            haeyo: '필터와 그릴, 드레인판, 송풍팬까지 다 분해했어요. 드레인판을 빼야 그 안쪽에 고인 물과 이물질이 보여요.',
            hapsio: '필터, 그릴, 드레인판, 송풍팬까지 완전 분해했습니다. 드레인판을 분리해야 내부에 고인 물과 이물질을 확인할 수 있습니다.',
            ilji: '필터·그릴·드레인판·송풍팬 완전분해.'
          }
        },
        {
          name: '열교환기 고압세척·오염수 배출',
          lines: {
            haeyo: '열교환기는 고압 세척으로 핀 사이를 밀어냈어요. 나온 오염수는 드레인으로 바로 빼서 실내에 남지 않게 했어요.',
            hapsio: '열교환기는 고압 세척으로 핀 사이 오염을 제거했습니다. 배출된 오염수는 드레인으로 즉시 배수해 실내에 남지 않도록 했습니다.',
            ilji: '열교환기 고압세척. 오염수 드레인 배출.'
          }
        },
        {
          name: '살균·건조',
          lines: {
            haeyo: '세척 후에는 살균제를 도포하고 충분히 말렸어요. 습기가 남으면 냄새가 다시 올라오니 이 시간은 줄이지 않아요.',
            hapsio: '세척 후 살균 처리를 하고 충분히 건조했습니다. 수분이 남으면 냄새가 재발하므로 건조 시간을 줄이지 않았습니다.',
            ilji: '살균 도포 → 송풍 건조.'
          }
        },
        {
          name: '조립·시운전',
          lines: {
            haeyo: '다시 조립하고 10분 이상 가동해서 풍량과 배수, 냄새를 확인했어요. 물 새는 곳까지 보고 마무리했어요.',
            hapsio: '재조립 후 10분 이상 가동해 풍량, 배수, 냄새를 확인했습니다. 누수 여부까지 점검하고 마무리했습니다.',
            ilji: '조립 → 10분 가동. 풍량·배수·냄새·누수 확인.'
          }
        }
      ],
      issues: [
        { k: ['냄새', '악취'], t: '에어컨 냄새' },
        { k: ['곰팡이'], t: '송풍팬 곰팡이' },
        { k: ['송풍', '바람', '약함'], t: '약해진 풍량' },
        { k: ['물', '누수', '결로'], t: '물 떨어짐' }
      ],
      tips: [
        { haeyo: '청소 후 일주일은 냄새를 한 번씩 맡아보세요. 살균이 부족하면 그때 드러나요.', hapsio: '청소 후 일주일간 냄새를 확인하시면 살균 상태를 판단할 수 있습니다.', ilji: '1주일 냄새 확인.' },
        { haeyo: '드레인이 막히면 실내기에서 물이 떨어져요. 작업 다음 날 한 번 확인해 보세요.', hapsio: '드레인 막힘 시 실내기에서 물이 떨어져요. 작업 다음 날 확인하시기 바랍니다.', ilji: '다음 날 드레인 물 떨어짐 확인.' },
        { haeyo: '필터는 한 달에 한 번 물로 씻고 완전히 말려서 넣으세요. 젖은 채로 넣으면 냄새가 다시 생겨요.', hapsio: '필터는 월 1회 세척 후 완전히 건조해 장착하시기 바랍니다. 습기가 남으면 냄새가 재발합니다.', ilji: '필터 월 1회 세척. 완전 건조 후 장착.' }
      ],
      tags: ['시스템에어컨청소', '시스템에어컨', '에어컨분해청소', '에어컨청소후기', '천장형에어컨청소']
    },

    {
      id: 'grout',
      label: '줄눈·탄성코트',
      keyword: '줄눈',
      scope: '줄눈 재시공·욕실 탄성코트',
      detailHint: '욕실 바닥 줄눈 변색, 탄성코트 희망',
      quickTags: ['욕실 줄눈 변색', '바닥 들뜸', '곰팡이 줄눈', '탄성코트', '베란다 줄눈'],
      fallbackIssue: '변색된 기존 줄눈',
      short: '파내고 다시 채워야 오래 갑니다',
      state: [
        '기존 줄눈이 까맣게 변색된 상태',
        '줄눈이 들떠서 물이 스며드는 자리',
        '욕실 바닥에 물이 자주 고이는 구조',
        '욕실 모서리와 배수구 주변에 물이 고인 자국'
      ],
      after: [
        '기존 줄눈 제거 후 새 줄눈재 시공',
        '욕실 바닥 탄성코트 2회 마감',
        '물 고임과 들뜸이 줄어든 마감 상태',
        '배수구 주변 마감과 물 빠짐 확인'
      ],
      note: {
        haeyo: '줄눈은 덧대는 것보다 파내는 게 오래 가요. 기존 줄눈 위에 새 줄눈재를 올리면 접착이 약해서 물이 스며들고 두 달 안에 다시 들떠요. 파낸 홈을 충분히 말린 뒤에 채워야 겨울에도 갈라지지 않습니다. 줄눈 폭이 넓은 곳은 탄성 줄눈재로 채워야 갈라짐이 적어요.',
        hapsio: '줄눈은 덧대기보다 제거가 오래 갑니다. 기존 줄눈 위에 새 줄눈재를 올리면 접착이 약해 물이 스며들고 두 달 안에 다시 들뜹니다. 파낸 홈을 충분히 건조한 뒤 채워야 겨울에도 갈라지지 않습니다. 줄눈 폭이 넓은 곳은 탄성 줄눈재로 채워야 갈라짐이 적습니다.',
        ilji: '덧대기보다 파내기가 수명 김. 홈 완전 건조 후 충전. 겨울 균열 방지.'
      },
      timeText: function () { return '3~4시간 (양생 24시간 별도)'; },
      seo: ['{region} 줄눈시공', '{region} 욕실 줄눈', '{region} 탄성코트', '줄눈 시공 비용'],
      open: [
        {
          haeyo: '{place} 줄눈 작업하고 왔어요. 기존 줄눈이 까맣게 올라와 있어서 새 줄눈만 덧대면 금방 다시 들떠요. 그래서 파내는 데 시간을 제일 많이 썼어요.',
          hapsio: '{place} 줄눈 시공을 진행했습니다. 기존 줄눈이 변색되고 들떠 있어 새 줄눈을 덧대기 전에 파내는 작업을 먼저 했습니다.',
          ilji: '{place} 줄눈. 기존 줄눈 변색·들뜸 확인. 파내기 우선 진행.'
        },
        {
          haeyo: '{place} 탄성코트 현장이었어요. 물이 자주 고이는 욕실 바닥이라, 시공 전에 바닥이 얼마나 건조한지부터 확인하고 시작했어요.',
          hapsio: '{place} 탄성코트 시공 현장이었습니다. 물이 자주 고이는 욕실 바닥이라 바닥 건조 상태를 확인한 뒤 작업을 시작했습니다.',
          ilji: '현장: {place}. 욕실 탄성코트. 건조 상태 확인 후 착수.'
        }
      ],
      processes: [
        {
          name: '기존 줄눈 제거',
          lines: {
            haeyo: '기존 줄눈은 그라인더로 파냈어요. 이 과정을 건너뛰고 덧대면 두 달도 못 가서 다시 들뜨는 경우가 많아요.',
            hapsio: '기존 줄눈은 그라인더로 제거했습니다. 이 작업을 생략하고 덧대면 두 달을 넘기지 못하고 들뜨는 경우가 많습니다.',
            ilji: '기존 줄눈 그라인더 제거.'
          }
        },
        {
          name: '홈 청소·건조',
          lines: {
            haeyo: '파낸 자리는 먼지를 다 빼고 열풍으로 말렸어요. 물기가 남아 있으면 줄눈재가 붙지 않아서 이 대기 시간이 생각보다 중요해요.',
            hapsio: '파낸 홈은 먼지를 제거한 뒤 열풍으로 건조했습니다. 수분이 남으면 줄눈재가 접착되지 않아 건조 시간이 중요합니다.',
            ilji: '홈 청소 → 열풍 건조 완료.'
          }
        },
        {
          name: '줄눈재 시공',
          lines: {
            haeyo: '줄눈재는 색을 먼저 맞춰 봤어요. 타일과 비슷한 톤으로 넣으면 줄이 덜 튀고 전체가 훨씬 깔끔해 보여요.',
            hapsio: '줄눈재는 시공 전에 색상을 먼저 확인했습니다. 타일과 유사한 톤으로 시공하면 줄이 덜 도드라져 보입니다.',
            ilji: '줄눈재 색상 확인 → 시공.'
          }
        },
        {
          name: '탄성코트·양생',
          lines: {
            haeyo: '욕실 바닥은 탄성코트를 두 번 발라 마감했어요. 완전히 굳는 데 하루는 잡으셔야 하고 그전에 물을 쓰면 들뜰 수 있어요.',
            hapsio: '욕실 바닥은 탄성코트를 두 번 도포해 마감했습니다. 완전 경화까지 하루를 확보하셔야 하며 그 전에 물을 사용하면 들뜰 수 있습니다.',
            ilji: '바닥 탄성코트 2회. 양생 24시간 필요.'
          }
        }
      ],
      issues: [
        { k: ['변색', '까맣', '검정'], t: '깊게 변색된 줄눈' },
        { k: ['들뜸', '들떠'], t: '들뜬 줄눈' },
        { k: ['곰팡이'], t: '줄눈 곰팡이' },
        { k: ['물', '누수'], t: '물 고임' }
      ],
      tips: [
        { haeyo: '줄눈은 시공 다음 날 물을 안 쓰는 게 제일 중요해요. 그 하루가 수명을 바꿔요.', hapsio: '줄눈 시공 다음 날은 물 사용을 피하셔야 합니다. 하루가 수명을 좌우합니다.', ilji: '시공 후 24시간 물 사용 금지.' },
        { haeyo: '변색이 다시 올라오면 표면이 아니라 안쪽부터 올라온 거예요. 그때는 덧대지 말고 파내야 해요.', hapsio: '변색이 재발하면 표면이 아닌 내부에서 올라온 것으로, 덧대기보다 제거가 필요합니다.', ilji: '변색 재발 시 파내기 필요.' },
        { haeyo: '주방 줄눈은 기름 때문에 욕실보다 빨리 변해요. 6개월에 한 번은 확인해 보세요.', hapsio: '주방 줄눈은 기름 영향으로 욕실보다 빨리 변색됩니다. 6개월 주기 확인을 권해드립니다.', ilji: '주방 줄눈 6개월 주기 확인.' }
      ],
      tags: ['줄눈', '줄눈시공', '욕실줄눈', '탄성코트', '줄눈후기']
    },

    {
      id: 'leak',
      label: '누수·방수',
      keyword: '누수탐지',
      scope: '누수 탐지·방수 보강·타일 복구',
      detailHint: '아래집 천장 물자국, 욕실 누수 의심',
      quickTags: ['아래집 물자국', '욕실 누수', '수압 저하', '방수 보수', '베란다 누수'],
      fallbackIssue: '누수 지점',
      short: '뜯기 전에 원인부터 찾습니다',
      state: [
        '아래집 천장에 물자국이 생긴 상태',
        '겉은 멀쩡한데 벽 안쪽 습도가 높은 경우',
        '수압이 떨어지거나 물소리가 나는 배관',
        '방수층이 오래되어 모서리부터 새는 경우'
      ],
      after: [
        '누수탐지와 원인 구분',
        '방수층 보강, 타일과 줄눈 복구',
        '담수 24시간 테스트로 재누수 확인',
        '마감 후 물 사용 재개 안내'
      ],
      note: {
        haeyo: '누수는 벽을 뜯기 전에 원인을 나눠야 해요. 배관에서 새는지 방수층에서 새는지에 따라 공사 범위가 완전히 달라져요. 탐지 없이 타일부터 뜯으면 비용만 늘고 원인은 그대로 남습니다. 아래집과 일정을 맞춰야 하는 현장은 담수 테스트 날짜를 먼저 정해 두는 게 좋아요.',
        hapsio: '누수는 철거 전에 원인을 구분해야 합니다. 배관과 방수층 중 어디서 새는지에 따라 공사 범위가 달라집니다. 탐지 없이 타일부터 철거하면 비용만 늘고 원인은 남습니다. 아래 세대와 일정을 맞춰야 하는 현장은 담수 테스트 날짜를 먼저 정하는 것이 좋습니다.',
        ilji: '철거 전 원인 구분. 배관/방수층에 따라 범위 결정. 탐지 없는 철거는 비용만 증가.'
      },
      timeText: function () { return '2~3시간 (담수 테스트 별도)'; },
      seo: ['{region} 누수탐지', '{region} 욕실 방수', '{region} 누수 보수', '누수 잡는 업체'],
      open: [
        {
          haeyo: '{place} 누수 잡으러 갔어요. 아래집 천장에 물자국이 생겼다고 하셔서 먼저 어디서 새는지부터 찾았어요. 벽을 뜯는 건 그다음이에요.',
          hapsio: '{place} 누수 보수 현장을 방문했습니다. 아래 세대 천장에 물자국이 있어 누수 지점 확인부터 진행했습니다.',
          ilji: '{place} 누수. 아래집 천장 물자국. 지점 탐지 우선.'
        },
        {
          haeyo: '{place} 화장실 누수 현장이에요. 겉으로는 멀쩡해 보여서 습도계로 벽 안쪽부터 확인했어요.',
          hapsio: '{place} 욕실 누수 현장입니다. 육안으로는 이상이 없어 습도계로 벽체 내부를 먼저 확인했습니다.',
          ilji: '현장: {place}. 욕실 누수. 습도계 측정.'
        }
      ],
      processes: [
        {
          name: '누수 지점 탐지',
          lines: {
            haeyo: '수압 테스트와 습도 측정을 같이 했어요. 물을 쓰지 않는 시간에 수압이 떨어지면 배관 쪽, 그대로면 방수 쪽 문제인 경우가 많아요.',
            hapsio: '수압 테스트와 습도 측정을 병행했습니다. 물 사용이 없는 시간에 수압이 하강하면 배관, 유지되면 방수층 문제일 가능성이 큽니다.',
            ilji: '수압 테스트 + 습도 측정. 배관/방수 구분.'
          }
        },
        {
          name: '철거·방수 보강',
          lines: {
            haeyo: '방수층이 문제였어요. 바닥 타일을 걷어내고 균열 부위를 메운 뒤 방수재를 두 번 발랐어요. 한 번만 바르면 모서리에서 다시 새요.',
            hapsio: '방수층 손상이 원인이었습니다. 바닥 타일을 철거하고 균열을 보수한 뒤 방수재를 두 번 도포했습니다. 1회 시공은 모서리 누수로 이어집니다.',
            ilji: '타일 철거 → 균열 보수 → 방수재 2회 도포.'
          }
        },
        {
          name: '타일·줄눈 복구',
          lines: {
            haeyo: '방수가 굳은 뒤 타일을 다시 붙이고 줄눈과 실리콘을 새로 넣었어요. 마감 색까지 맞춰야 티가 덜 나요.',
            hapsio: '방수층 경화 후 타일을 재시공하고 줄눈과 실리콘을 새로 시공했습니다. 마감 색상을 맞춰 이질감을 줄였습니다.',
            ilji: '타일 재시공. 줄눈·실리콘 신규.'
          }
        },
        {
          name: '담수 테스트',
          lines: {
            haeyo: '마지막에 바닥에 물을 채워 24시간 두고 확인했어요. 이 과정을 빼면 보름 뒤에 다시 물이 새도 원인을 못 찾아요.',
            hapsio: '마무리로 바닥에 물을 채워 24시간 담수 테스트를 진행했습니다. 이 과정을 생략하면 재발 시 원인 파악이 어렵습니다.',
            ilji: '담수 24시간 테스트. 재누수 여부 확인.'
          }
        }
      ],
      issues: [
        { k: ['누수', '물'], t: '누수 지점' },
        { k: ['수압'], t: '수압 저하' },
        { k: ['곰팡이', '습기'], t: '벽체 습기' },
        { k: ['배관', '소리'], t: '노후 배관' }
      ],
      tips: [
        { haeyo: '누수는 물을 안 쓰는 시간에 증상이 심해져요. 밤에 한 번 확인해 보시면 원인 찾기가 쉬워요.', hapsio: '누수는 물 사용이 없는 시간에 증상이 뚜렷해집니다. 야간 확인이 원인 파악에 도움이 됩니다.', ilji: '야간 누수 증상 확인. 원인 파악 용이.' },
        { haeyo: '담수 테스트 없이 마감한 곳은 보름 뒤에 다시 새는 경우가 많아요. 마감 전에 물 채워 두는지 꼭 확인하세요.', hapsio: '담수 테스트 없이 마감한 경우 보름 내 재발이 많습니다. 마감 전 담수 여부를 확인하시기 바랍니다.', ilji: '마감 전 담수 테스트 여부 확인.' },
        { haeyo: '아래집 천장 물자국은 마른 뒤에도 테두리가 남아요. 재발 여부는 그 테두리로 보시면 돼요.', hapsio: '아래 세대 천장 물자국은 건조 후에도 테두리가 남아요. 재발 판단은 해당 테두리로 가능합니다.', ilji: '재발 판단은 천장 물자국 테두리로.' }
      ],
      tags: ['누수탐지', '누수보수', '욕실방수', '배관수리', '누수후기']
    },

    {
      id: 'silicon',
      label: '욕실·실리콘 시공',
      keyword: '욕실 실리콘',
      scope: '욕실 실리콘 재시공·줄눈 마감',
      detailHint: '욕조·세면대 실리콘 검게 변색',
      quickTags: ['실리콘 곰팡이', '욕조 실리콘', '세면대 실리콘', '줄눈 마감', '물 샘'],
      fallbackIssue: '검게 변색된 실리콘',
      short: '덧바르지 않고 걷어내고 다시',
      state: [
        '욕조와 세면대 주변 실리콘이 검게 변색된 상태',
        '실리콘 틈으로 물이 스며드는 자리',
        '겉만 닦아서는 곰팡이가 남는 부위',
        '실리콘과 타일 사이가 벌어진 자리'
      ],
      after: [
        '기존 실리콘 제거와 곰팡이 처리',
        '마스킹 라인을 맞춘 새 실리콘 시공',
        '양생 후 물 샘과 들뜸 확인',
        '마스킹 자국 정리와 표면 확인'
      ],
      note: {
        haeyo: '실리콘은 위에 덧바르면 두 달이면 다시 검게 올라와요. 안쪽에 남은 곰팡이를 걷어내고 틈을 충분히 말린 뒤에 새로 발라야 오래 가요. 욕실은 환기만 잘해도 실리콘 수명이 눈에 띄게 늘어납니다. 곰팡이가 다시 올라오는 속도는 물기 제거 습관에 따라 크게 달라져요.',
        hapsio: '실리콘은 덧바르면 두 달 내 다시 변색됩니다. 내부 곰팡이를 제거하고 틈을 충분히 건조한 뒤 새로 시공해야 오래 유지됩니다. 욕실 환기만으로도 실리콘 수명이 늘어납니다. 곰팡이 재발 속도는 물기를 닦아 두는 습관에 따라 달라집니다.',
        ilji: '덧바르기 금지. 내부 곰팡이 제거 → 건조 → 재시공. 환기로 수명 연장.'
      },
      timeText: function () { return '2~3시간 (양생 24시간 별도)'; },
      seo: ['{region} 욕실 실리콘', '{region} 실리콘 재시공', '{region} 욕실 곰팡이', '욕실 실리콘 비용'],
      open: [
        {
          haeyo: '{place} 실리콘 재시공하고 왔어요. 욕조 쪽이 검게 올라와 있었는데 겉만 닦아서는 안쪽 곰팡이가 그대로 남아 있어요.',
          hapsio: '{place} 실리콘 재시공을 진행했습니다. 욕조 주변 실리콘이 변색되어 있었고 표면 세척만으로는 내부 곰팡이를 제거할 수 없습니다.',
          ilji: '{place} 실리콘 재시공. 욕조 주변 변색 확인.'
        },
        {
          haeyo: '{place} 욕실 실리콘 시공 현장이에요. 세면대 뒤쪽에서 물이 새고 있다고 하셔서 실리콘 상태부터 봤어요.',
          hapsio: '{place} 욕실 실리콘 시공 현장입니다. 세면대 후면 누수 문의가 있어 실리콘 접착 상태를 먼저 확인했습니다.',
          ilji: '현장: {place}. 세면대 후면 물 샘. 실리콘 상태 확인.'
        }
      ],
      processes: [
        {
          name: '기존 실리콘 제거',
          lines: {
            haeyo: '기존 실리콘은 커터로 다 걷어냈어요. 위에 덧바르면 안쪽 곰팡이가 그대로 남아서 두 달이면 다시 검게 올라와요.',
            hapsio: '기존 실리콘은 커터로 전부 제거했습니다. 덧바르는 방식은 내부 곰팡이가 남아 두 달 내 재발합니다.',
            ilji: '기존 실리콘 커터 제거.'
          }
        },
        {
          name: '세척·건조',
          lines: {
            haeyo: '틈에 낀 물때와 곰팡이는 약품으로 처리하고 드라이기로 완전히 말렸어요. 물기가 남으면 실리콘이 붙지 않아요.',
            hapsio: '틈새의 물때와 곰팡이는 약품으로 처리한 뒤 열풍으로 건조했습니다. 수분이 남으면 실리콘이 접착되지 않습니다.',
            ilji: '물때·곰팡이 약품 처리 → 열풍 건조.'
          }
        },
        {
          name: '실리콘 시공',
          lines: {
            haeyo: '실리콘은 마스킹 테이프로 라인을 잡고 한 번에 밀었어요. 선을 맞춰야 마감이 깔끔하고 곰팡이도 덜 껴요.',
            hapsio: '실리콘은 마스킹 테이프로 라인을 잡은 뒤 한 번에 시공했습니다. 라인이 맞아야 마감이 깔끔하고 곰팡이 발생도 줄어듭니다.',
            ilji: '마스킹 라인 → 실리콘 시공.'
          }
        },
        {
          name: '마감·양생',
          lines: {
            haeyo: '마감 후 테이프를 바로 떼고 표면을 정리했어요. 굳는 데 하루는 잡으셔야 하고 그전에 물을 쓰면 들떠요.',
            hapsio: '시공 후 마스킹 테이프를 제거하고 표면을 정리했습니다. 경화까지 하루를 확보하셔야 하며 그 전 물 사용은 피하셔야 합니다.',
            ilji: '테이프 제거 → 표면 정리. 양생 24시간.'
          }
        }
      ],
      issues: [
        { k: ['곰팡이', '검게', '변색'], t: '변색된 실리콘' },
        { k: ['물', '샘', '누수'], t: '틈새 물 샘' },
        { k: ['들뜸', '들떠'], t: '들뜬 실리콘' }
      ],
      tips: [
        { haeyo: '실리콘은 굳기 전 24시간 물을 피해야 해요. 그 하루를 지켜야 오래 가요.', hapsio: '실리콘 경화 전 24시간은 물 사용을 피하셔야 합니다. 이 기간이 수명을 좌우합니다.', ilji: '경화 24시간 물 사용 금지.' },
        { haeyo: '곰팡이는 겉을 닦아도 안쪽에 남아요. 손으로 눌러서 들뜬 곳이 있으면 다시 시공할 때예요.', hapsio: '곰팡이는 표면 세척만으로 제거되지 않습니다. 눌러서 들뜬 부위가 있으면 재시공이 필요합니다.', ilji: '눌러서 들뜸 확인. 있으면 재시공.' },
        { haeyo: '욕실 환기를 하루 10분만 해도 실리콘 수명이 확 늘어나요.', hapsio: '욕실 환기를 하루 10분 이상 하시면 실리콘 수명이 늘어납니다.', ilji: '욕실 환기 1일 10분.' }
      ],
      tags: ['욕실실리콘', '실리콘시공', '욕실곰팡이', '실리콘재시공', '욕실리모델링']
    },

    {
      id: 'screen',
      label: '방충망·단열필름·중문',
      keyword: '방충망교체',
      scope: '방충망 교체·단열필름·중문 설치',
      detailHint: '거실 방충망 찢어짐, 베란다 중문 설치',
      quickTags: ['방충망 찢어짐', '벌레 들어옴', '단열필름', '중문 설치', '베란다 결로'],
      fallbackIssue: '찢어진 방충망',
      short: '틈새 하나까지 막는 시공',
      state: [
        '방충망이 찢어졌거나 틀이 휘어 틈이 벌어진 상태',
        '베란다 결로와 창틀 틈새가 함께 있는 경우',
        '중문만으로는 결로가 해결되지 않는 구조',
        '창틀과 방충망 사이로 바람이 들어오는 경우'
      ],
      after: [
        '방충망교체와 틈새 마감',
        '단열필름 부착과 기포 제거',
        '중문 수평 조정과 개폐 확인',
        '창 개폐와 틈새 재확인'
      ],
      note: {
        haeyo: '방충망은 망만 새것으로 바꿔도 틀이 휘어 있으면 틈이 남아요. 벌레는 그 틈으로 들어오기 때문에 망과 틀을 같이 봐야 해요. 베란다 결로는 중문만으로는 부족하고 단열필름을 함께 해야 효과가 있습니다.',
        hapsio: '방충망은 망을 교체해도 틀이 변형되어 있으면 틈이 남습니다. 벌레는 그 틈으로 유입되므로 망과 틀을 함께 확인해야 합니다. 베란다 결로는 중문 단독으로 해결되지 않아 단열필름을 병행해야 합니다.',
        ilji: '망 교체만으로 불충분. 틀 변형 확인. 결로는 중문+단열필름 병행.'
      },
      timeText: function () { return '3~5시간'; },
      seo: ['{region} 방충망 교체', '{region} 단열필름', '{region} 중문 설치', '방충망 교체 비용'],
      open: [
        {
          haeyo: '{place} 방충망 교체하고 왔어요. 망만 갈면 될 줄 알았는데 틀이 휘어 있어서 틈이 벌어져 있었어요. 벌레는 그 틈으로 들어와요.',
          hapsio: '{place} 방충망 교체를 진행했습니다. 망 상태보다 틀 변형이 문제였고 그 틈으로 벌레가 유입되고 있었습니다.',
          ilji: '{place} 방충망 교체. 틀 변형으로 틈 발생 확인.'
        },
        {
          haeyo: '{place} 중문 설치 현장이에요. 베란다 결로 때문에 알아보셨다는데 중문만 달면 결로는 그대로 남아요. 단열필름을 같이 해야 효과가 있어요.',
          hapsio: '{place} 중문 설치 현장입니다. 베란다 결로 문의가 있었고 중문 단독 시공으로는 결로가 해결되지 않아 단열필름을 함께 진행했습니다.',
          ilji: '현장: {place}. 베란다 결로. 중문+단열필름 병행.'
        }
      ],
      processes: [
        {
          name: '실측',
          lines: {
            haeyo: '방충망은 창틀마다 규격이 달라서 실측부터 했어요. 1mm만 틀어져도 틈이 생겨서 벌레가 들어와요.',
            hapsio: '방충망은 창틀별 규격이 달라 실측부터 진행했습니다. 1mm 차이로도 틈이 생겨 방충 효과가 떨어져요.',
            ilji: '창틀별 실측. 규격 확인.'
          }
        },
        {
          name: '방충망 시공',
          lines: {
            haeyo: '방충망은 망만 갈지 틀까지 바꿀지 먼저 정했어요. 틀이 휘었으면 망만 갈아도 틈이 남아요.',
            hapsio: '방충망은 망 교체와 틀 교체를 구분해 진행했습니다. 틀이 변형된 경우 망만 교체하면 틈이 남습니다.',
            ilji: '망/틀 교체 구분 시공.'
          }
        },
        {
          name: '단열필름 시공',
          lines: {
            haeyo: '단열필름은 유리와 필름 사이에 물을 충분히 뿌려 붙였어요. 기포가 남으면 여름에 그 자리만 뜨거워져요.',
            hapsio: '단열필름은 유리면에 물을 충분히 분사한 뒤 부착했습니다. 기포가 남으면 해당 부위 단열 성능이 떨어져요.',
            ilji: '유리 물분사 → 단열필름 부착 → 기포 제거.'
          }
        },
        {
          name: '중문 설치',
          lines: {
            haeyo: '중문은 수평부터 잡고 설치했어요. 수평이 틀어지면 문이 한쪽으로 쏠려서 몇 달 뒤에 소리가 나요.',
            hapsio: '중문은 수평을 먼저 확인한 뒤 설치했습니다. 수평이 틀어지면 도어가 한쪽으로 쏠려 소음이 발생합니다.',
            ilji: '수평 확인 → 중문 설치 → 개폐 조정.'
          }
        },
        {
          name: '마감·점검',
          lines: {
            haeyo: '마지막에 창을 다 닫아 보고 중문 여닫힘과 틈새까지 확인했어요. 바람이 들어오는 곳이 있으면 그 자리에서 다시 조정했어요.',
            hapsio: '마무리로 창문 개폐와 중문 여닫힘, 틈새를 확인했습니다. 바람이 유입되는 부위는 현장에서 재조정했습니다.',
            ilji: '창 개폐·중문·틈새 점검. 필요 시 재조정.'
          }
        }
      ],
      issues: [
        { k: ['찢', '구멍'], t: '찢어진 방충망' },
        { k: ['벌레', '모기'], t: '벌레 유입' },
        { k: ['결로', '단열'], t: '베란다 결로' },
        { k: ['틈', '바람'], t: '창틀 틈새' }
      ],
      tips: [
        { haeyo: '방충망은 망보다 틀과 창틀 사이 틈을 보셔야 해요. 망이 새것이어도 틈이 있으면 벌레는 들어와요.', hapsio: '방충망은 망 상태보다 틀과 창틀 사이 틈을 확인하셔야 합니다. 틈이 있으면 방충 효과가 없습니다.', ilji: '틀-창틀 사이 틈 확인. 망 상태 다음.' },
        { haeyo: '단열필름은 기포가 남으면 그 자리만 열이 들어와요. 붙인 날 바로 확인하세요.', hapsio: '단열필름에 기포가 남으면 해당 부위 단열 성능이 떨어져요. 시공 당일 확인을 권해드립니다.', ilji: '시공 당일 기포 확인.' },
        { haeyo: '중문은 수평이 틀어지면 몇 달 뒤에 소리가 나요. 설치 후 열고 닫기를 열 번 해보세요.', hapsio: '중문은 수평이 틀어지면 수개월 후 소음이 발생합니다. 설치 후 개폐를 반복해 확인하시기 바랍니다.', ilji: '설치 후 개폐 10회 확인.' }
      ],
      tags: ['방충망교체', '단열필름', '중문설치', '베란다중문', '방충망시공']
    }
  ];

  /* ─────────────────────────── 유틸 ─────────────────────────── */

  const STYLE_LABEL = { haeyo: '친근한 해요체', hapsio: '정중한 하십시오체', ilji: '간결한 현장일지체' };

  // AI 양산형 문구 — 생성 결과에서 발견되면 제거한다.
  const BANNED = [
    '에 대해 알아보겠습니다', '알아보겠습니다', '살펴보겠습니다', '정리해보겠습니다',
    '다음과 같습니다', '도움이 되셨길', '도움이 되셨으면', '결론적으로', '이번 포스팅에서는',
    '참고하시기 바랍니다', '라고 할 수 있습니다', '지금부터', '많은 도움이',
    // AI 관용구·hype 어휘 (korean-humanizer D-1·D-2·D-3·D-4·I-4)
    '요약하면', '정리하면', '시사하는 바', '주목할 만한', '주목할 만', '본질적으로', '핵심적으로',
    '궁극적으로', '다채로운', '진정한', '중추적인', '필수적인', '혁신적인', '독보적인', '파격적인',
    '압도적인', '획기적인', '자리매김', '발돋움', '방증', '향연', '명심하셔야', '명심해야'
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(arr, rnd) {
    if (!arr || !arr.length) return '';
    return arr[Math.floor(rnd() * arr.length) % arr.length];
  }

  /** "송파구 헬리오시티 34평" → { region, building, pyeong, raw } */
  function parsePlace(raw) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    let pyeong = '';
    const m = text.match(/(\d+(?:\.\d+)?)\s*(?:평|py|PY)/);
    if (m) { pyeong = m[1]; text = text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(); }

    const parts = text.split(' ').filter(Boolean);
    let region = '', building = '';
    const idx = parts.findIndex(function (p) { return /(구|시|군|동|읍|면|리)$/.test(p); });
    if (idx === 0 && parts.length === 1) { region = parts[0]; }
    else if (idx >= 0) {
      region = parts[idx];
      building = parts.slice(idx + 1).join(' ');
      if (!building) building = parts.filter(function (_, i) { return i !== idx; }).join(' ');
    } else if (parts.length) {
      region = parts[0];
      building = parts.slice(1).join(' ');
    }
    return { region: region, building: building, pyeong: pyeong, raw: text };
  }

  function placeLabel(p) {
    const bits = [p.region, p.building].filter(Boolean);
    return bits.join(' ') || '현장';
  }

  function fullPlace(p) {
    const bits = [p.region, p.building].filter(Boolean);
    if (p.pyeong) bits.push(p.pyeong + '평');
    return bits.join(' ');
  }

  function getIndustry(id) {
    return INDUSTRIES.filter(function (x) { return x.id === id; })[0] || null;
  }

  function matchIssue(industry, detail) {
    const d = String(detail || '');
    if (!d) return null;
    for (let i = 0; i < industry.issues.length; i++) {
      const it = industry.issues[i];
      for (let j = 0; j < it.k.length; j++) if (d.indexOf(it.k[j]) >= 0) return it.t;
    }
    return null;
  }

  // S1(결정적 AI 흔적) 정리 — 부호와 이모지는 문장 다듬기와 무관하게 기계적으로 지운다.
  // 줄표(—·–)는 문장 구조를 지키는 ':' 로 바꾸고, 이모지는 남기지 않는다.
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

  /* ─────────────────────────── 생성기 ─────────────────────────── */

  function buildTitles(ctx) {
    const p = ctx.place;
    const region = p.region || '우리 동네';
    const kw = ctx.industry.keyword;
    const area = p.building ? (p.building + (p.pyeong ? ' ' + p.pyeong + '평' : '')) : (p.pyeong ? p.pyeong + '평' : '');
    const time = ctx.timeShort;
    const issue = ctx.issueShort;

    const t1 = area
      ? region + ' ' + kw + ' 후기 | ' + area + (time ? ' ' + time : '')
      : region + ' ' + kw + ' 후기 | ' + (time ? time + ' 완성' : '현장 정리');

    const dupIssue = issue && (issue.indexOf(kw) >= 0 || kw.indexOf(issue) >= 0);
    // 1·2안은 지역 + 업종/세부증상 순서를 제목 맨 앞에 둔다(네이버 검색어 앞배치).
    // 단지명은 키워드 뒤에 붙여 롱테일 검색어를 살린다.
    const spot = p.building ? p.building + ' ' : '';
    const t2 = !issue
      ? region + ' ' + kw + ' | ' + spot + '작업 순서 그대로'
      : dupIssue
        ? region + ' ' + kw + ' | ' + spot + issue + ', 사진으로 비교'
        : region + ' ' + kw + ' | ' + spot + issue + ' 해결, 사진으로 비교';

    const t3 = ctx.pricePrivate
      ? region + ' ' + kw + ' 비용·소요시간, 솔직하게 정리'
      : (ctx.price
        ? region + ' ' + kw + ' 견적 ' + ctx.priceShort + ', ' + (p.pyeong ? p.pyeong + '평 기준' : '현장 기준')
        : region + ' ' + kw + ' 비용, ' + (p.pyeong ? p.pyeong + '평 ' : '') + '현장 기준으로');

    return [t1, t2, t3].map(function (t) { return t.replace(/\s+/g, ' ').slice(0, 48).trim(); });
  }

  function buildSummary(ctx) {
    const rows = [
      { k: '지역', v: ctx.placeLabel || '현장' },
      { k: '평수', v: ctx.place.pyeong ? ctx.place.pyeong + '평' : '미기재' }
    ];
    if (ctx.extra && ctx.industry.extra) rows.push({ k: ctx.industry.extra.label, v: ctx.extra });
    rows.push({ k: '작업 범위', v: ctx.industry.scope });
    rows.push({ k: '소요 시간', v: ctx.time });
    rows.push({ k: '견적', v: ctx.pricePrivate ? '현장 확인 후 안내' : (ctx.price || '현장 확인 후 안내') });
    return rows;
  }

  function summaryText(rows) {
    return ['■ 현장 요약'].concat(rows.map(function (r) { return '· ' + r.k + ' : ' + r.v; })).join('\n');
  }

  function markerLine(processName, photoLabel) {
    return '[사진 : ' + processName + ' · ' + photoLabel + ']';
  }

  function buildBody(ctx, tips) {
    const st = ctx.style;
    const I = ctx.industry;
    const lines = [];

    const open = pick(I.open, ctx.rnd)[st];
    lines.push(open.replace('{place}', ctx.placeLabel));

    if (ctx.photos.before) lines.push(markerLine(ctx.placeLabel + ' 현장 전경', '시공 전'));

    if (ctx.extra && ctx.industry.extra) {
      lines.push({
        haeyo: '이번 현장은 ' + ctx.extra + ' 기준으로 진행했어요. 기종마다 드레인 위치가 달라서 실내기 형식을 먼저 확인하고 순서를 잡았어요.',
        hapsio: '이번 현장은 ' + ctx.extra + ' 기준으로 진행했습니다. 기종별로 드레인 위치가 달라 실내기 형식을 먼저 확인한 뒤 순서를 정했습니다.',
        ilji: ctx.extra + '. 기종별 드레인 위치 확인 후 순서 결정.'
      }[st]);
    }

    if (ctx.detail) {
      const variants = [
        {
          haeyo: '현장에서 제일 신경 쓴 건 말씀하신 \'' + ctx.detail + '\' 부분이었어요. 미리 알려주신 덕분에 약품과 장비를 다르게 챙겨 갔어요.',
          hapsio: '현장에서 가장 신경 쓴 부분은 \'' + ctx.detail + '\'입니다. 미리 알려주신 덕분에 약품과 장비를 별도로 준비했습니다.',
          ilji: '중점 사항 : ' + ctx.detail + '. 장비·약품 별도 준비.'
        },
        {
          haeyo: '말씀하신 \'' + ctx.detail + '\' 부분은 처음부터 따로 봤어요. 작업 전후 사진도 남겨 두었으니 나중에 비교해서 보셔도 돼요.',
          hapsio: '\'' + ctx.detail + '\' 부위는 별도로 점검했습니다. 작업 전후 사진을 함께 남겨 두어 상태를 비교하실 수 있습니다.',
          ilji: '중점 : ' + ctx.detail + '. 전후 사진 별도 촬영.'
        }
      ];
      lines.push(pick(variants, ctx.rnd)[st]);
    } else {
      lines.push({
        haeyo: '이번 현장에서 제일 손이 많이 간 곳은 ' + ctx.issueShort + '이었어요. 눈에 잘 안 띄는 자리일수록 시간이 더 걸리더라고요.',
        hapsio: '이번 현장에서 가장 손이 많이 간 곳은 ' + ctx.issueShort + '입니다. 눈에 띄지 않는 부위일수록 시간이 더 소요됩니다.',
        ilji: '중점 : ' + ctx.issueShort + '.'
      }[st]);
    }

    // 현장 요약표는 본문 앞쪽에 둔다
    lines.push(summaryText(ctx.summary));

    // 작업 전 상태 — 사진과 함께 보는 현장 상태. 지역·업종 키워드를 본문 앞쪽에 한 번 더 둔다.
    if (I.state && I.state.length) {
      const lead = {
        haeyo: ctx.placeLabel + ' ' + I.keyword + ' 현장에 도착해서 먼저 본 상태는 이랬어요.',
        hapsio: ctx.placeLabel + ' ' + I.keyword + ' 현장에 도착해 상태를 먼저 확인했습니다.',
        ilji: I.keyword + ' 현장 상태 확인.'
      }[st];
      lines.push('■ 작업 전 상태');
      lines.push([lead].concat(I.state.map(function (s) { return '· ' + s; })).join('\n'));
    }

    const photoTypes = [];
    if (ctx.photos.during) photoTypes.push('작업 중');
    photoTypes.push('시공 후');
    const half = Math.ceil(I.processes.length / 2);

    // 작업 순서를 한 줄로 먼저 보여 준다(검색으로 들어온 사람이 먼저 보는 부분).
    const flow = I.processes.map(function (p) { return String(p.name).replace(/\s*\(.*\)$/, ''); }).join(' → ');
    lines.push('■ 작업 순서');
    lines.push({
      haeyo: '이번 현장은 ' + flow + ' 순서로 진행했어요. 순서를 바꾸면 이미 끝낸 곳에 물과 먼지가 다시 묻어서 같은 자리를 두 번 손대게 됩니다.',
      hapsio: '이번 현장은 ' + flow + ' 순서로 진행했습니다. 순서를 바꾸면 이미 마친 곳에 물과 먼지가 다시 묻어 같은 자리를 두 번 손대게 됩니다.',
      ilji: flow + ' 순서로 진행. 순서 변경 시 재작업 발생.'
    }[st]);

    I.processes.forEach(function (proc, i) {
      lines.push('■ ' + proc.name);
      lines.push(proc.lines[st]);
      if (ctx.photos.after) {
        let label;
        if (i === 0 && ctx.photos.before) label = '시공 전';
        else if (i < half && ctx.photos.during) label = '작업 중';
        else label = '시공 후';
        lines.push(markerLine(proc.name, label));
      }
    });

    // 달라진 점 — 공정 설명 뒤에 결과를 한 번에 보여 준다(본문 분량·키워드 분산).
    if (I.after && I.after.length) {
      const lead2 = {
        haeyo: '작업을 마치고 확인한 결과는 이래요.',
        hapsio: I.keyword + ' 작업을 마친 뒤 달라진 부분을 정리했습니다.',
        ilji: '작업 후 변화 정리.'
      }[st];
      lines.push('■ 달라진 점');
      lines.push([lead2].concat(I.after.map(function (s) { return '· ' + s; })).join('\n'));
    }

    // 왜 그렇게 하는지 한 단락 — 검색으로 들어온 사람이 가장 많이 읽는 부분.
    if (I.note && I.note[st]) lines.push(I.note[st]);

    const tipList = tips || I.tips;
    const tipBlock = ['■ 셀프로 확인할 포인트'].concat(tipList.map(function (tip) {
      return '· ' + tip[st];
    })).join('\n');
    lines.push(tipBlock);

    if (ctx.pricePrivate) {
      lines.push({
        haeyo: '견적은 현장 상태에 따라 차이가 커서 글로 적기 어려워요. 사진 몇 장과 평수만 알려주시면 바로 계산해 드립니다.',
        hapsio: '견적은 현장 상태에 따라 차이가 커서 서면으로 단정하기 어렵습니다. 사진과 평수를 알려주시면 정확히 안내드립니다.',
        ilji: '견적 : 현장 확인 후 안내. 사진·평수 전달 시 산출.'
      }[st]);
    } else if (ctx.price) {
      lines.push({
        haeyo: '이번 현장 견적은 ' + ctx.price + ' 정도였어요. 같은 평수라도 오염 정도에 따라 달라지니까 사진 보내주시면 정확하게 다시 안내드릴게요.',
        hapsio: '이번 현장 견적은 ' + ctx.price + ' 선에서 진행되었습니다. 동일 평수라도 오염 정도에 따라 차이가 있어 사진을 보내주시면 정확히 안내드립니다.',
        ilji: '견적 : ' + ctx.price + '. 오염 정도에 따라 변동. 사진 확인 후 확정.'
      }[st]);
    } else {
      lines.push({
        haeyo: '견적은 평수와 오염 정도에 따라 달라져요. 사진 보내주시면 정확하게 안내드릴게요.',
        hapsio: '견적은 평수와 오염 정도에 따라 달라집니다. 사진을 보내주시면 정확히 안내드립니다.',
        ilji: '견적 : 평수·오염도 기준 산출. 사진 확인 필요.'
      }[st]);
    }

    const biz = ctx.business || {};
    const name = (biz.name || '').trim();
    const contact = (biz.contact || '').trim();
    const hello = (biz.closing || '').trim();
    const region = ctx.place.region || '이 지역';

    const closingVariants = [
      {
        haeyo: (name ? name + '입니다. ' : '') + region + ' 근처는 일정만 맞으면 당일도 가능한 경우가 많아요. 사진 몇 장 보내주시면 견적 바로 잡아 드려요.' +
          (contact ? ' 문의 : ' + contact : '') + (hello ? ' ' + hello : ''),
        hapsio: (name ? name + '입니다. ' : '') + region + ' 인근은 일정에 따라 당일 방문도 가능합니다. 현장 사진과 평수를 보내주시면 견적을 안내드립니다.' +
          (contact ? ' 문의 : ' + contact : '') + (hello ? ' ' + hello : ''),
        ilji: (name ? name + '. ' : '') + region + ' 인근 당일 가능. 사진·평수 전달 시 견적 산출.' + (contact ? ' 문의 ' + contact + '.' : '') + (hello ? ' ' + hello : '')
      },
      {
        haeyo: (name ? name + '입니다. ' : '') + '사진은 시공 전·후를 같은 자리에서 찍는 게 제일 좋아요. ' + region + ' 쪽 일정도 바로 확인해 드려요.' +
          (contact ? ' 문의 : ' + contact : '') + (hello ? ' ' + hello : ''),
        hapsio: (name ? name + '입니다. ' : '') + '사진은 시공 전과 후를 같은 위치에서 촬영하시면 비교가 쉽습니다. ' + region + ' 인근 일정도 확인해 드립니다.' +
          (contact ? ' 문의 : ' + contact : '') + (hello ? ' ' + hello : ''),
        ilji: (name ? name + '. ' : '') + '전·후 동일 위치 촬영 권장. 일정 확인 후 안내.' + (contact ? ' 문의 ' + contact + '.' : '') + (hello ? ' ' + hello : '')
      }
    ];
    lines.push(pick(closingVariants, ctx.rnd)[st]);

    return lines.join('\n\n');
  }

  function buildHashtags(ctx) {
    const regionKey = (ctx.place.region || '').replace(/\s/g, '');
    const I = ctx.industry;
    const base = I.tags.slice();
    const out = [base[0]];
    if (regionKey) out.push(regionKey + base[0]);
    out.push(base[1]);
    out.push(base[2]);
    if (regionKey) out.push(regionKey + I.keyword);
    base.forEach(function (t) { if (out.length < 7 && out.indexOf(t) < 0) out.push(t); });

    const seen = {};
    const tags = [];
    out.forEach(function (t) {
      const clean = String(t).replace(/[#\s]/g, '');
      if (!clean || seen[clean]) return;
      seen[clean] = 1;
      tags.push('#' + clean);
    });
    return tags.slice(0, 5);
  }

  function buildSeoKeywords(ctx) {
    const p = ctx.place;
    const region = p.region || '지역';
    const building = p.building || '';
    const out = [];
    ctx.industry.seo.forEach(function (tpl) {
      const v = tpl.replace('{region}', region).replace('{building}', building).trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    });
    return out.slice(0, 4);
  }

  /* ─────────────────────────── 채널별 변환 ─────────────────────────── */

  const CHANNELS = [
    { id: 'blog', label: '네이버 블로그', short: '제목 3안 · 요약표 · 공정 본문', hint: '지역 키워드로 검색 유입을 노리는 상세 후기' },
    { id: 'danggeun', label: '당근', short: '동네 이웃 소식', hint: '이웃에게 말 거는 짧은 소식 + 채팅 문의' },
    { id: 'insta', label: '인스타그램', short: '후킹 첫 줄 · 3포인트', hint: '피드·릴스 캡션, 저장 유도 + 해시태그' },
    { id: 'threads', label: '스레드', short: '500자 1인칭', hint: '짧은 호흡의 담백한 구어체' }
  ];

  function getChannel(id) {
    return CHANNELS.filter(function (c) { return c.id === id; })[0] || CHANNELS[0];
  }

  function firstSentence(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    const m = t.match(/^[^.!?]*[.!?]/);
    return (m ? m[0] : t).trim();
  }

  // 공정 이름이 첫 문장에 그대로 나오면(예: "기존 줄눈은 …") 뒷문장을 쓴다
  function processNote(proc) {
    const line = String(proc.lines.haeyo || '').replace(/\s+/g, ' ').trim();
    const first = firstSentence(line);
    const head = String(proc.name || '').split(/[·\s(]/)[0];
    const rest = line.slice(first.length).trim();
    if (rest && head && first.indexOf(head) >= 0) return rest;
    return first;
  }

  function clip(text, max) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    const base = sp > max * 0.55 ? cut.slice(0, sp) : cut;
    return base.replace(/[ ,.·]$/, '') + '…';
  }

  function areaText(ctx) {
    const p = ctx.place;
    const bits = [];
    if (p.region) bits.push(p.region);
    if (p.building) bits.push(p.building);
    if (p.pyeong) bits.push(p.pyeong + '평');
    return bits.join(' ') || '현장';
  }

  function pricePhrase(ctx) {
    return ctx.pricePrivate ? '현장 확인 후 안내' : (ctx.price || '현장 확인 후 안내');
  }

  function contactTail(ctx) {
    const biz = ctx.business || {};
    const contact = String(biz.contact || '').trim();
    return contact ? ' (' + contact + ')' : '';
  }

  function issueLine(ctx, style, skipDetail) {
    const d = skipDetail ? '' : ctx.detail;
    if (d) {
      return {
        haeyo: '말씀하신 \'' + clip(d, 40) + '\' 부분부터 먼저 봤어요.',
        hapsio: '\'' + clip(d, 40) + '\' 부위부터 먼저 점검했습니다.',
        ilji: '중점 : ' + clip(d, 40) + '.'
      }[style];
    }
    return {
      haeyo: '\'' + ctx.issueShort + '\' 쪽부터 먼저 봤습니다.',
      hapsio: '\'' + ctx.issueShort + '\' 부위부터 점검했습니다.',
      ilji: '중점 : ' + ctx.issueShort + '.'
    }[style];
  }

  /* 블로그 본문 — 3,500자를 넘으면 확인 포인트를 뒤에서부터 줄여 맞춘다 */
  function blogBody(ctx) {
    let tips = ctx.industry.tips.slice();
    let body = sanitize(buildBody(ctx, tips));
    while (body.length > 3500 && tips.length > 1) {
      tips = tips.slice(0, tips.length - 1);
      body = sanitize(buildBody(ctx, tips));
    }
    return body;
  }

  /* 당근 — 동네 이웃에게 말 거는 소식 (요약 4줄 + 짧은 본문 + 채팅 유도) */
  function buildDanggeun(ctx) {
    const I = ctx.industry;
    const biz = ctx.business || {};
    const name = String(biz.name || '').trim();
    const region = ctx.place.region || '이 동네';
    const area = areaText(ctx);
    const proc = I.processes[0];

    const hello = name
      ? '안녕하세요, ' + region + '에서 ' + I.keyword + ' 하는 ' + name + '입니다.'
      : '안녕하세요, ' + region + '에서 ' + I.keyword + ' 하고 있습니다.';

    return [
      hello,
      '· 현장 : ' + area,
      '· 범위 : ' + I.scope,
      '· 소요 : ' + ctx.time,
      '· 견적 : ' + pricePhrase(ctx),
      '',
      issueLine(ctx, 'haeyo'),
      '가장 오래 붙잡은 공정은 ' + proc.name + ' 작업이었어요. ' + clip(processNote(proc), 62),
      '작업 전후 사진도 남겨 두었으니 나중에 비교해 보셔도 됩니다.',
      '',
      region + ' 근처는 일정만 맞으면 당일 방문도 가능하고 작업 후에 문제가 생기면 A/S로 다시 봐드립니다.',
      '이 동네에서 오래 일해 왔으니, 궁금한 점은 사진 한 장만 보내주셔도 됩니다.',
      '방문 전에 사진으로 상태 먼저 확인하고 견적 드립니다.',
      '사진 몇 장 보내주시면 견적이랑 일정 바로 잡아드릴게요. 편하게 당근 채팅 주세요' + contactTail(ctx) + '.'
    ].join('\n');
  }

  function danggeunTitle(ctx) {
    const I = ctx.industry;
    return (areaText(ctx) + ' ' + I.keyword + ' 다녀왔어요').replace(/\s+/g, ' ').trim().slice(0, 48);
  }

  /* 인스타그램 — 후킹 첫 줄 + 짧은 줄바꿈 + 바뀐 포인트 3가지 + 저장·DM 유도 */
  function buildInsta(ctx) {
    const I = ctx.industry;
    const region = ctx.place.region || '이 동네';
    const area = areaText(ctx);
    const hook = pick([
      ctx.issueShort + ', 사진으로 먼저 보세요.',
      ctx.issueShort + ' 이 정도면 그냥 두기 아깝습니다.',
      '이 ' + ctx.issueShort + ', 그냥 두면 더 번집니다.'
    ], ctx.rnd);

    const points = I.processes.slice(0, 3).map(function (p, i) {
      return (i + 1) + '. ' + p.name + ' : ' + clip(processNote(p), 40);
    });

    return [
      hook,
      '',
      area + ' · ' + I.keyword,
      ctx.timeShort + ' 작업 · ' + pricePhrase(ctx),
      '',
      '바뀐 포인트 3가지',
      points.join('\n'),
      '',
      region + ' 근처는 일정만 맞으면 당일 방문도 됩니다.',
      '',
      '저장해 두셨다가 필요할 때 편하게 DM이나 프로필 링크로 문의 주세요.' + contactTail(ctx)
    ].join('\n');
  }

  /* 스레드 — 500자 이내 1인칭 구어체, 짧은 호흡, 꿀팁 한 줄 + 가벼운 마무리 */
  function buildThreads(ctx) {
    const I = ctx.industry;
    const region = ctx.place.region || '이 동네';
    const area = areaText(ctx);
    const proc = I.processes[0];
    const tip = I.tips[0] && I.tips[0].haeyo ? I.tips[0].haeyo : '';

    const out = [
      '오늘 ' + area + ' ' + I.keyword + ' 하고 왔어요. ' + ctx.timeShort + ' 걸렸습니다.',
      '',
      issueLine(ctx, 'haeyo', true),
      '가장 오래 붙잡은 건 ' + proc.name + ' 작업이었어요. ' + clip(processNote(proc), 50),
      ''
    ];
    if (tip) out.push('꿀팁 하나. ' + clip(tip, 56), '');
    out.push(
      region + ' 근처면 일정 맞춰 당일도 가능합니다.',
      '사진 보내주시면 견적이랑 같이 봐드려요' + contactTail(ctx) + '.'
    );
    return out.join('\n');
  }

  function fullTextOf(r) {
    const tags = r.hashtagText || '';
    if (r.channel && r.channel !== 'blog') {
      return [r.titles && r.titles[0] ? r.titles[0] : '', r.body.replace(r.summaryText || '', '').trim(), tags]
        .filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    }
    const rest = r.body.replace(r.summaryText, '').replace(/\n{3,}/g, '\n\n').trim();
    return [r.titles[0], '', r.summaryText, '', rest, '', tags].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * @param {object} input
   *   industryId, place, detail, extra, price, pricePrivate, channel,
   *   business {name, contact, style, closing},
   *   photos {before, during, after}, seed
   */
  function generate(input) {
    const I = getIndustry(input.industryId) || INDUSTRIES[0];
    const style = (input.business && input.business.style) || 'haeyo';
    const seed = (input.seed == null ? Date.now() : input.seed) >>> 0;
    const rnd = mulberry32(seed);
    const parsed = parsePlace(input.place);
    const detail = String(input.detail || '').trim();
    const extra = String(input.extra || '').trim();
    const price = String(input.price || '').trim();
    const pricePrivate = !!input.pricePrivate;
    const timeText = I.timeText(parseFloat(parsed.pyeong) || 0, extra);
    const issue = matchIssue(I, detail) || I.fallbackIssue;

    const ctx = {
      industry: I,
      place: parsed,
      placeLabel: placeLabel(parsed),
      detail: detail,
      extra: extra,
      price: price,
      pricePrivate: pricePrivate,
      business: input.business || {},
      photos: input.photos || {},
      style: style,
      seed: seed,
      rnd: rnd,
      time: timeText,
      timeShort: timeText.replace(/\s*\(.*\)/, '').trim(),
      issueShort: issue,
      priceShort: pricePrivate ? '' : (price || '현장 확인')
    };

    ctx.summary = buildSummary(ctx);
    const ch = getChannel(input.channel);
    const sumText = summaryText(ctx.summary);

    let body, titles, hashtags, seo;
    if (ch.id === 'danggeun') {
      body = sanitize(buildDanggeun(ctx));
      titles = [danggeunTitle(ctx)];
      hashtags = [];
      seo = [];
    } else if (ch.id === 'insta') {
      body = sanitize(buildInsta(ctx));
      titles = [];
      hashtags = buildHashtags(ctx).slice(0, 5);
      seo = [];
    } else if (ch.id === 'threads') {
      body = sanitize(buildThreads(ctx));
      titles = [];
      hashtags = buildHashtags(ctx).slice(0, 1);
      seo = [];
    } else {
      body = blogBody(ctx);
      titles = buildTitles(ctx);
      hashtags = buildHashtags(ctx);
      seo = buildSeoKeywords(ctx);
    }

    const result = {
      channel: ch.id,
      channelLabel: ch.label,
      channelHint: ch.hint,
      industryId: I.id,
      industryLabel: I.label,
      style: style,
      styleLabel: STYLE_LABEL[style],
      titles: titles,
      summary: ctx.summary,
      summaryText: sumText,
      body: body,
      hashtags: hashtags,
      hashtagText: hashtags.join(' '),
      seoKeywords: seo,
      seed: seed
    };
    result.fullText = fullTextOf(result);
    return result;
  }

  /* ===== ENGINE CORE END ===== */

  return {
    INDUSTRIES: INDUSTRIES,
    CHANNELS: CHANNELS,
    STYLE_LABEL: STYLE_LABEL,
    generate: generate,
    getChannel: getChannel,
    getIndustry: getIndustry,
    parsePlace: parsePlace,
    placeLabel: placeLabel,
    fullPlace: fullPlace,
    sanitize: sanitize,
    fullTextOf: fullTextOf,
    BANNED: BANNED
  };
});
