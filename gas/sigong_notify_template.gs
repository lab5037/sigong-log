/**
 * 현장로그 — 무료 체험 신청 텔레그램 알림 (Google Apps Script 템플릿)
 *
 * 이 파일에는 토큰·chat_id·전화번호를 넣지 않습니다. 값은 스크립트 속성에 저장하세요.
 *
 * ── 설치 순서 ─────────────────────────────────────────────
 * 1) https://script.google.com → 새 프로젝트 → 이 파일 내용을 Code.gs 에 붙여넣기
 * 2) 텔레그램에서 @BotFather 로 봇 생성 → 봇 토큰 받기
 * 3) 만든 봇과 대화를 한 번 시작한 뒤, 아래 getChatId 함수를 실행해 chat_id 확인
 *    (또는 브라우저에서 https://api.telegram.org/bot<토큰>/getUpdates 열어 확인)
 * 4) 프로젝트 설정 → 스크립트 속성에 아래 3개 추가
 *      TELEGRAM_TOKEN  = 봇 토큰
 *      TELEGRAM_CHAT_ID = 숫자 chat_id
 *      SHEET_ID        = (선택) 신청 내역을 쌓을 구글 시트 ID
 * 5) 배포 → 새 배포 → 유형: 웹 앱
 *      실행 계정: 나 / 액세스 권한: 모든 사용자
 *    → 배포 URL 복사 (https://script.google.com/macros/s/..../exec)
 * 6) 현장로그 사이트의 app.js 상단 CONFIG.webhookUrl 값을 그 URL로 바꾸거나,
 *    브라우저 콘솔에서 아래처럼 저장 (내 브라우저에만 저장됨, 저장소에는 안 올라감)
 *      localStorage.setItem('fieldlog.webhook.v1', JSON.stringify('https://script.google.com/...'))
 * 7) 사이트에서 신청서를 한 번 제출해 텔레그램 알림이 오는지 확인
 * ─────────────────────────────────────────────────────────
 */

var PROP = PropertiesService.getScriptProperties();

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '{}';
    var data = JSON.parse(raw);

    var name = trim_(data.name);
    var contact = trim_(data.contact);
    if (!name || !contact) {
      return json_({ ok: false, error: 'name/contact required' });
    }

    var lines = [
      '🛠 <b>현장로그 무료 체험 신청</b>',
      '',
      '상호명 : <b>' + esc_(name) + '</b>',
      '업종 : ' + esc_(trim_(data.industry) || '-'),
      '활동 지역 : ' + esc_(trim_(data.region) || '-'),
      '연락처 : ' + esc_(contact),
      '희망 요금제 : ' + esc_(trim_(data.plan) || '미정'),
      '신청 시각 : ' + esc_(trim_(data.at) || nowKst_())
    ];
    if (data.page) lines.push('유입 페이지 : ' + esc_(trim_(data.page)));

    var token = PROP.getProperty('TELEGRAM_TOKEN');
    var chatId = PROP.getProperty('TELEGRAM_CHAT_ID');

    if (token && chatId) {
      sendTelegram_(token, chatId, lines.join('\n'));
    }

    appendSheet_(data);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, service: 'sigong-log-notify' });
}

/** 봇과 대화를 시작한 뒤 한 번 실행하면 chat_id 후보를 로그에 보여줍니다. */
function getChatId() {
  var token = PROP.getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('스크ريبت 속성에 TELEGRAM_TOKEN 을 먼저 넣어주세요.');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates', { muteHttpExceptions: true });
  Logger.log(res.getContentText());
  return res.getContentText();
}

/* ── 내부 함수 ───────────────────────────────────────────── */

function sendTelegram_(token, chatId, text) {
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 300) Logger.log('telegram fail ' + code + ' ' + res.getContentText());
  return code;
}

function appendSheet_(data) {
  var sheetId = PROP.getProperty('SHEET_ID');
  if (!sheetId) return;
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    var sh = ss.getSheets()[0];
    if (sh.getLastRow() === 0) {
      sh.appendRow(['신청시각', '상호명', '업종', '지역', '연락처', '요금제']);
    }
    sh.appendRow([
      nowKst_(),
      trim_(data.name),
      trim_(data.industry),
      trim_(data.region),
      trim_(data.contact),
      trim_(data.plan)
    ]);
  } catch (err) {
    Logger.log('sheet fail ' + err);
  }
}

function nowKst_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
}

function trim_(v) { return String(v == null ? '' : v).trim().slice(0, 200); }

function esc_(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
