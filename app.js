/* 현장로그 — 화면 로직
 * · 원고 엔진(engine.js) + 캔버스(canvas.js) 연결
 * · 선택 기능: Gemini 사진 인식(문장 다듬기), 신청 알림 웹훅(GAS → 텔레그램)
 *   아래 두 값은 공개 저장소에 그대로 올라가므로 실제 토큰·번호를 넣지 않는다.
 */
(function () {
  'use strict';

  const E = window.FieldLogEngine;
  const C = window.FieldLogCanvas;

  /* ── 설정 (공개 저장소용 플레이스홀더) ───────────────────────────── */
  const CONFIG = {
    // 구글 앱스 스크립트 웹앱 URL (gas/sigong_notify_template.gs 참고)
    webhookUrl: window.FIELDLOG_WEBHOOK || 'YOUR_GAS_WEBHOOK_URL',
    geminiModel: 'gemini-2.5-flash'
  };

  const STORE = {
    biz: 'fieldlog.biz.v1',
    draft: 'fieldlog.draft.v1',
    gemini: 'fieldlog.gemini.v1',
    layout: 'fieldlog.layout.v1',
    webhook: 'fieldlog.webhook.v1',
    lead: 'fieldlog.lead.v1'
  };

  const state = {
    view: 'land',
    industryId: '',
    tone: 'haeyo',
    photos: { before: null, during: null, after: null },
    layout: 'h',
    result: null,
    seed: 1,
    aiBusy: false,
    aiTouched: false,
    editingBody: false,
    sampleBizData: null,
    plan: ''
  };

  const $ = function (s, root) { return (root || document).querySelector(s); };
  const $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  /* ── 저장소 ─────────────────────────────────────────────────────── */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* ── 토스트 ─────────────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.hidden = true; }, 220);
    }, 2200);
  }

  /* ── 복사 ───────────────────────────────────────────────────────── */
  function copyText(text, okMsg) {
    const done = function () { toast(okMsg || '복사했어요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done); });
    } else {
      legacyCopy(text, done);
    }
  }
  function legacyCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { toast('복사가 안 되었어요. 길게 눌러 복사해 주세요.'); }
    document.body.removeChild(ta);
  }

  /* ── 화면 전환 ──────────────────────────────────────────────────── */
  function showView(name) {
    state.view = name;
    ['land', 'write', 'result'].forEach(function (v) {
      const el = $('#view' + v.charAt(0).toUpperCase() + v.slice(1));
      if (el) el.hidden = v !== name;
    });
    $('#bottomBar').hidden = name !== 'write';
    $$('[data-land-only]').forEach(function (a) { a.style.display = name === 'land' ? '' : 'none'; });
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* ── 랜딩: 업종 카드 ────────────────────────────────────────────── */
  function renderLanding() {
    const grid = $('#landIndustryGrid');
    grid.innerHTML = E.INDUSTRIES.map(function (ind) {
      const flow = ind.processes.slice(0, 4).map(function (p) { return p.name; }).join(' → ');
      return '<article class="industry-card">' +
        '<span class="ic-emoji">' + ind.emoji + '</span>' +
        '<h3>' + ind.label + '</h3>' +
        '<p>' + ind.short + '</p>' +
        '<p class="ic-flow">' + flow + '</p>' +
        '</article>';
    }).join('');
  }

  /* ── 랜딩: 신청 폼 ──────────────────────────────────────────────── */
  function renderApplyForm() {
    const sel = $('#coIndustry');
    sel.innerHTML = ['<option value="">업종을 선택해 주세요</option>'].concat(
      E.INDUSTRIES.map(function (i) { return '<option value="' + i.label + '">' + i.label + '</option>'; })
    ).join('');
  }

  function planLabel(plan) {
    return ['라이트', '프로', '초기 1:1 세팅'].indexOf(plan) >= 0 ? plan : '미정';
  }

  function leadText(lead) {
    return [
      '[현장로그 무료 체험 신청]',
      '상호명 : ' + lead.name,
      '업종 : ' + lead.industry,
      '활동 지역 : ' + (lead.region || '미기재'),
      '연락처 : ' + lead.contact,
      '희망 요금제 : ' + planLabel(lead.plan),
      '신청 시각 : ' + lead.at
    ].join('\n');
  }

  function getWebhookUrl() {
    const saved = read(STORE.webhook, '');
    const url = saved || CONFIG.webhookUrl;
    if (!url || url === 'YOUR_GAS_WEBHOOK_URL' || !/^https?:\/\//.test(url)) return '';
    return url;
  }

  function sendLead(url, lead) {
    // GAS 웹앱은 CORS 응답 헤더가 없어 결과를 읽을 수 없다. 요청만 보내고 화면은 복사 안내를 함께 제공한다.
    return fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        type: '현장로그 체험신청',
        name: lead.name,
        industry: lead.industry,
        region: lead.region,
        contact: lead.contact,
        plan: planLabel(lead.plan),
        at: lead.at,
        page: location.href
      })
    });
  }

  function paintPlanNote() {
    const el = $('#planNote');
    if (!el) return;
    if (!state.plan) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '희망 요금제 : <strong>' + escapeHtml(state.plan) + '</strong> <button type="button" class="plan-clear">변경</button>';
  }

  function paintWebhookState() {
    const el = $('#webhookState');
    const input = $('#webhookInput');
    if (input) input.value = read(STORE.webhook, '');
    if (!el) return;
    const url = getWebhookUrl();
    el.textContent = url
      ? '연결됨 · ' + url.replace(/^https:\/\/([^/]+).*$/, '$1') + ' 로 신청 알림이 갑니다'
      : '미설정 — 지금은 신청 내용을 복사해 보내는 방식으로 동작합니다';
  }

  function fmtNow() {
    const d = new Date();
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function handleApply(ev) {
    ev.preventDefault();
    const lead = {
      name: $('#coName').value.trim(),
      industry: $('#coIndustry').value,
      region: $('#coRegion').value.trim(),
      contact: $('#coContact').value.trim(),
      plan: state.plan,
      at: fmtNow()
    };
    const err = $('#applyError');
    const problems = [];
    if (!lead.name) problems.push('상호명');
    if (!lead.industry) problems.push('업종');
    if (!lead.contact) problems.push('연락처');
    if (!/^[0-9+\-\s()]{8,20}$/.test(lead.contact)) problems.push('연락처 형식');
    if (!$('#coAgree').checked) problems.push('연락 동의');
    if (problems.length) {
      err.hidden = false;
      err.textContent = problems.join(', ') + ' 항목을 확인해 주세요.';
      return;
    }
    err.hidden = true;

    write(STORE.lead, lead);
    $('#applyPreview').textContent = leadText(lead);
    $('#applyFormWrap').hidden = true;
    $('#applyDone').hidden = false;

    const url = getWebhookUrl();
    if (url) {
      sendLead(url, lead).then(function () {
        toast('접수 알림을 전송했어요');
      }).catch(function () {
        toast('알림 전송이 막혔어요. 아래 내용을 복사해 보내주세요.');
      });
    } else {
      toast('신청 내용을 준비했어요');
    }
    $('#applyDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── 업체 정보 ──────────────────────────────────────────────────── */
  function loadBiz() {
    const biz = read(STORE.biz, null);
    if (!biz) return;
    $('#bizName').value = biz.name || '';
    $('#bizContact').value = biz.contact || '';
    $('#bizClosing').value = biz.closing || '';
    state.tone = biz.style || 'haeyo';
    paintTone();
    updateBizSummary();
    // 이미 저장된 업체 정보가 있으면 접어 두고 바로 현장 입력으로 넘어간다.
    if (biz.name) {
      $('#bizBody').hidden = true;
      $('#bizToggle').setAttribute('aria-expanded', 'false');
    }
  }

  function currentBiz() {
    if (state.sampleBizData) return state.sampleBizData;
    return {
      name: $('#bizName').value.trim(),
      contact: $('#bizContact').value.trim(),
      style: state.tone,
      closing: $('#bizClosing').value.trim()
    };
  }

  let saveTimer = null;
  function saveBizSoon() {
    if (state.sampleBizData) {
      const s0 = $('#saveState');
      s0.textContent = '예시 정보는 저장되지 않아요 — 내 업체 정보를 넣어 주세요';
      setTimeout(function () { s0.textContent = ''; }, 2600);
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      const biz = currentBiz();
      write(STORE.biz, biz);
      updateBizSummary();
      const s = $('#saveState');
      s.textContent = '저장했어요 ✓';
      setTimeout(function () { if (s.textContent === '저장했어요 ✓') s.textContent = ''; }, 1600);
    }, 350);
  }

  function updateBizSummary() {
    const biz = currentBiz();
    const el = $('#bizSummary');
    if (biz.name) el.textContent = biz.name + ' · ' + (E.STYLE_LABEL[biz.style] || '');
    else el.textContent = '한 번만 저장하면 다음부터 자동으로 들어갑니다';
  }

  function paintTone() {
    $$('#toneChips .chip').forEach(function (c) {
      c.classList.toggle('is-on', c.getAttribute('data-tone') === state.tone);
    });
  }

  /* ── 작성 폼 ────────────────────────────────────────────────────── */
  function renderIndustryChips() {
    const box = $('#industryChips');
    box.innerHTML = E.INDUSTRIES.map(function (i) {
      return '<button class="chip" type="button" data-id="' + i.id + '">' + i.emoji + ' ' + i.label + '</button>';
    }).join('');
  }

  function paintIndustry() {
    $$('#industryChips .chip').forEach(function (c) {
      c.classList.toggle('is-on', c.getAttribute('data-id') === state.industryId);
    });
    const ind = E.getIndustry(state.industryId);
    const extraRow = $('#extraField');
    if (ind && ind.extra) {
      extraRow.hidden = false;
      $('#extraLabel').textContent = ind.extra.label;
      $('#extraInput').placeholder = ind.extra.placeholder || '';
    } else {
      extraRow.hidden = true;
      $('#extraInput').value = '';
    }
    renderQuickTags(ind);
  }

  function renderQuickTags(ind) {
    const box = $('#quickTags');
    if (!ind) { box.innerHTML = ''; return; }
    box.innerHTML = ind.quickTags.map(function (t) {
      return '<button class="chip" type="button" data-tag="' + t + '">+ ' + t + '</button>';
    }).join('');
  }

  function saveDraftSoon() {
    write(STORE.draft, {
      industryId: state.industryId,
      place: $('#placeInput').value,
      extra: $('#extraInput').value,
      detail: $('#detailInput').value,
      price: $('#priceInput').value,
      pricePrivate: $('#pricePrivate').checked
    });
  }

  function loadDraft() {
    const d = read(STORE.draft, null);
    if (!d) return;
    state.industryId = d.industryId || '';
    $('#placeInput').value = d.place || '';
    $('#extraInput').value = d.extra || '';
    $('#detailInput').value = d.detail || '';
    $('#priceInput').value = d.price || '';
    $('#pricePrivate').checked = !!d.pricePrivate;
    paintIndustry();
    syncPriceDisabled();
  }

  function syncPriceDisabled() {
    const off = $('#pricePrivate').checked;
    $('#priceInput').disabled = off;
    if (off) $('#priceInput').style.opacity = '.5';
    else $('#priceInput').style.opacity = '';
  }

  /* ── 사진 ───────────────────────────────────────────────────────── */
  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('사진을 읽지 못했습니다.')); };
      fr.readAsDataURL(file);
    });
  }

  // 업로드 사진을 저장·합성용으로 축소 (긴 변 1400px, JPEG)
  function shrink(dataURL, max, quality) {
    max = max || 1400;
    quality = quality || 0.9;
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { resolve(dataURL); };
      img.src = dataURL;
    });
  }

  function setPhoto(slot, dataURL) {
    state.photos[slot] = dataURL || null;
    const tile = $('.photo-tile[data-slot="' + slot + '"]');
    const img = tile.querySelector('img');
    const empty = tile.querySelector('.photo-empty');
    const del = tile.querySelector('.photo-del');
    if (dataURL) {
      img.src = dataURL;
      img.hidden = false;
      empty.style.display = 'none';
      del.hidden = false;
      tile.classList.add('has-photo');
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      empty.style.display = '';
      del.hidden = true;
      tile.classList.remove('has-photo');
    }
  }

  function clearPhotos() {
    ['before', 'during', 'after'].forEach(function (s) { setPhoto(s, null); });
  }

  function hasPhoto() {
    return !!(state.photos.before || state.photos.after || state.photos.during);
  }

  function handleFile(slot, file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('사진 파일만 올릴 수 있어요'); return; }
    readFileAsDataURL(file).then(function (raw) {
      return shrink(raw, 1400, 0.9);
    }).then(function (small) {
      setPhoto(slot, small);
      toast('사진을 넣었어요');
    }).catch(function () { toast('사진을 읽지 못했어요'); });
  }

  /* ── Gemini ─────────────────────────────────────────────────────── */
  function getGeminiKey() {
    return ($('#geminiKey').value || read(STORE.gemini, '') || '').trim();
  }

  function aiReady() {
    return getGeminiKey().length > 20 && hasPhoto();
  }

  // Gemini Vision 입력용: 긴 변 1024px JPEG base64
  function prepareForAI(dataURL) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () {
        const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        const url = cv.toDataURL('image/jpeg', 0.82);
        resolve(url.split(',')[1] || '');
      };
      img.onerror = function () { resolve(''); };
      img.src = dataURL;
    });
  }

  function aiPrompt(draft) {
    const tone = E.STYLE_LABEL[state.tone] || '친근한 해요체';
    return [
      '너는 한국 시공·청소 업체 사장님의 네이버 블로그 후기를 다듬는 편집자다.',
      '아래 초안은 규칙 기반으로 만든 원고다. 첨부한 현장 사진(시공 전·작업 중·시공 후)을 실제로 보고, 사진에서 확인되는 상태만 반영해 문장을 다듬어라.',
      '',
      '지킬 것:',
      '1. 지역, 평수, 업종, 공정 이름, 견적, 업체명, 연락처 같은 사실은 초안 그대로 둔다. 없는 내용을 지어내지 않는다.',
      '2. 사진에서 실제로 보이는 오염, 시공 상태, 마감 상태만 묘사한다. 사진에 없으면 언급하지 않는다.',
      "3. '[📸 사진 위치 : ...]' 줄은 글자 그대로 유지하고, 그 바로 아래 줄에 '→ ' 로 시작하는 사진 설명 한 줄을 추가한다. (사진에서 보이는 것만)",
      "4. '■' 로 시작하는 소제목 구조와 '■ 현장 요약' 항목은 유지한다.",
      '5. 말투는 ' + tone + '로 통일한다.',
      '6. 금지 표현: ~에 대해 알아보겠습니다, 살펴보겠습니다, 다음과 같습니다, 결론적으로, 도움이 되셨길, 지금부터, 최고, 완벽, 100%',
      '7. 광고 문구나 이모지를 새로 넣지 않는다. "저희가 최선을 다해" 같은 뻔한 문장도 넣지 않는다.',
      '8. 출력은 다듬은 본문 전체만. 설명, 인사말, 코드블록 표시 없이.',
      '',
      '─ 초안 ─',
      draft
    ].join('\n');
  }

  async function callGemini(promptText, images) {
    const key = getGeminiKey();
    if (!key) throw new Error('no-key');
    const parts = [{ text: promptText }];
    const labels = { before: '시공 전 사진', during: '작업 중 사진', after: '시공 후 사진' };
    for (const slot of ['before', 'during', 'after']) {
      if (!state.photos[slot]) continue;
      const b64 = await prepareForAI(state.photos[slot]);
      if (!b64) continue;
      parts.push({ text: labels[slot] });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64 } });
    }
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + CONFIG.geminiModel + ':generateContent?key=' + encodeURIComponent(key),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: parts }],
          generationConfig: { temperature: 0.75, topP: 0.95, maxOutputTokens: 4096 }
        })
      }
    );
    if (!res.ok) {
      const t = await res.text();
      throw new Error('gemini ' + res.status + ' ' + t.slice(0, 120));
    }
    const data = await res.json();
    const cand = data && data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts && cand.content.parts.map(function (p) { return p.text || ''; }).join('\n');
    if (!text) throw new Error('empty');
    return text.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
  }

  async function runAI(manual) {
    if (state.aiBusy || !state.result) return;
    if (!getGeminiKey()) {
      toast('고급 설정에 Gemini 키를 넣으면 사진까지 읽고 다듬어 드려요');
      $('#bizBody').hidden = false;
      $('#bizToggle').setAttribute('aria-expanded', 'true');
      $('.adv').open = true;
      $('#geminiKey').focus();
      return;
    }
    if (!hasPhoto()) {
      toast('사진을 먼저 올려주세요');
      return;
    }
    state.aiBusy = true;
    const btn = $('#aiBtn');
    const prevLabel = btn.textContent;
    btn.textContent = '사진 읽는 중…';
    btn.classList.add('loading-dots');
    btn.disabled = true;
    $('#aiHint').textContent = '사진 속 상태를 읽고 문장을 다듬고 있어요 (10~20초)';
    if (manual) toast('사진을 읽고 있어요');
    try {
      const polished = await callGemini(aiPrompt(state.result.body), state.photos);
      const clean = E.sanitize(polished);
      if (clean.length < 250 || clean.indexOf('■') < 0) throw new Error('결과가 짧습니다');
      setBody(clean);
      state.aiTouched = true;
      $('#bodyMeta').textContent = '사진 분석 반영 · ' + countChars(clean) + '자';
      $('#aiHint').textContent = '사진에서 본 상태가 본문에 반영됐어요. 마음에 안 들면 [다른 표현으로]를 눌러 다시 만드세요.';
      toast('사진을 반영해 다듬었어요');
    } catch (err) {
      $('#aiHint').textContent = 'AI 다듬기를 쓰지 못했어요. 기본 원고 그대로 사용하시면 됩니다.';
      toast('AI 다듬기 실패 — 기본 원고로 진행합니다');
      console.warn('[현장로그] gemini fail', err);
    } finally {
      state.aiBusy = false;
      btn.textContent = prevLabel;
      btn.classList.remove('loading-dots');
      btn.disabled = false;
    }
  }

  /* ── 생성 ───────────────────────────────────────────────────────── */
  function countChars(t) { return (t || '').replace(/\s/g, '').length; }

  function collectInput() {
    return {
      industryId: state.industryId,
      place: $('#placeInput').value.trim(),
      extra: $('#extraInput').value.trim(),
      detail: $('#detailInput').value.trim(),
      price: $('#priceInput').value.trim(),
      pricePrivate: $('#pricePrivate').checked,
      business: currentBiz(),
      photos: {
        before: !!state.photos.before,
        during: !!state.photos.during,
        after: !!state.photos.after
      },
      seed: state.seed
    };
  }

  function validate() {
    if (!state.industryId) { toast('업종을 먼저 골라주세요'); return false; }
    if (!$('#placeInput').value.trim()) { toast('동네·건물을 적어주세요 (예: 송파구 헬리오시티 34평)'); $('#placeInput').focus(); return false; }
    return true;
  }

  function doGenerate() {
    if (!validate()) return;
    const input = collectInput();
    state.result = E.generate(input);
    renderResult();
    showView('result');
    drawCompare();
    if (aiReady()) runAI(false);
  }

  function composeFullText(r) {
    const body = r.body.replace(r.summaryText, '').replace(/\n{3,}/g, '\n\n').trim();
    return [r.titles[0], '', r.summaryText, '', body, '', r.hashtagText].join('\n').replace(/\n{3,}/g, '\n\n');
  }

  function renderResult() {
    const r = state.result;
    if (!r) return;
    const ind = E.getIndustry(r.industryId);
    $('#resultMeta').textContent = (ind ? ind.label : '') + ' · ' + r.summary[0].v + ' · ' + r.styleLabel;

    const list = $('#titleList');
    list.innerHTML = r.titles.map(function (t, i) {
      return '<li><span class="t-index">' + (i + 1) + '</span><span class="t-text">' + escapeHtml(t) + '</span>' +
        '<button class="t-copy" type="button" data-title="' + escapeAttr(t) + '">복사</button></li>';
    }).join('');

    $('#bodyText').innerHTML = renderBodyHtml(r.body);
    $('#bodyMeta').textContent = '공백 제외 ' + countChars(r.body) + '자';
    $('#bodyEdit').value = r.body;
    $('#bodyEdit').hidden = true;
    $('#bodyText').hidden = false;
    $('#editBodyBtn').textContent = '수정하기';

    $('#tagList').innerHTML = r.hashtags.map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('');
    $('#seoList').innerHTML = r.seoKeywords.map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('');
    $('#aiHint').textContent = getGeminiKey()
      ? '사진을 다시 읽혀 문장을 다듬을 수 있어요.'
      : 'Gemini 키를 넣으면 사진 속 상태까지 읽어 문장을 다듬습니다.';
    state.editingBody = false;
  }

  function renderBodyHtml(body) {
    return body.split('\n').map(function (line) {
      if (/^\[📸/.test(line)) return '<span class="ph">' + escapeHtml(line) + '</span>';
      return escapeHtml(line);
    }).join('\n');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }
  function escapeAttr(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function setBody(text) {
    if (!state.result) return;
    state.result.body = text;
    state.result.fullText = composeFullText(state.result);
    if (state.editingBody) $('#bodyEdit').value = text;
    else $('#bodyText').innerHTML = renderBodyHtml(text);
    $('#bodyMeta').textContent = '공백 제외 ' + countChars(text) + '자';
  }

  /* ── 비교 카드 ──────────────────────────────────────────────────── */
  let compareCanvas = null;
  async function drawCompare() {
    const r = state.result;
    if (!r) return;
    const ind = E.getIndustry(r.industryId);
    try {
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
      compareCanvas = await C.compose({
        before: state.photos.before,
        during: state.photos.during,
        after: state.photos.after,
        layout: state.layout,
        place: r.summary[0].v,
        industryLabel: ind ? ind.label : '',
        businessName: (currentBiz().name || '')
      });
      $('#compareImg').src = compareCanvas.toDataURL('image/jpeg', 0.94);
    } catch (e) {
      console.warn('[현장로그] compose fail', e);
    }
  }

  function saveCompare() {
    if (!compareCanvas) { toast('비교 카드를 먼저 만들어 주세요'); return; }
    const region = (state.result.summary[0].v || '현장').replace(/\s+/g, '');
    const name = '현장로그_' + region + '_비교사진.png';
    C.canvasToBlob(compareCanvas, 'image/png').then(function (blob) {
      if (!blob) { toast('이미지를 저장하지 못했어요'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('저장했어요 — 사진 앱에서 확인하세요');
    });
  }

  /* ── 예시 체험 ──────────────────────────────────────────────────── */
  function runSample() {
    state.industryId = 'movein';
    state.seed = Date.now() % 100000;
    $('#placeInput').value = '송파구 헬리오시티 34평';
    $('#detailInput').value = '주방 기름때 심함, 욕실 곰팡이, 4시간 소요';
    $('#priceInput').value = '35~40만 원';
    $('#pricePrivate').checked = false;
    $('#extraInput').value = '';
    paintIndustry();
    syncPriceDisabled();

    if (!currentBiz().name) {
      state.sampleBizData = {
        name: '반짝입주청소',
        contact: '010-0000-0000 (예시)',
        closing: '다음에도 깔끔하게 모시겠습니다.',
        style: state.tone
      };
      state.tone = state.sampleBizData.style;
      paintTone();
      $('#sampleBizNote').hidden = false;
      updateBizSummary();
    }

    const samples = C.makeSamplePhotos();
    setPhoto('before', samples.before);
    setPhoto('during', samples.during);
    setPhoto('after', samples.after);

    showView('write');
    setTimeout(function () { doGenerate(); }, 60);
    toast('예시 현장으로 채웠어요');
  }

  /* ── 이벤트 연결 ────────────────────────────────────────────────── */
  function bind() {
    // 랜딩 CTA
    $('#heroTryBtn').addEventListener('click', function () { showView('write'); });
    $('#openAppBtn').addEventListener('click', function () {
      showView(state.view === 'land' ? 'write' : 'land');
      $('#openAppBtn').textContent = state.view === 'write' ? '소개로' : '체험하기';
    });
    $('#brandBtn').addEventListener('click', function () { showView('land'); });
    $$('a[data-plan]').forEach(function (a) {
      a.addEventListener('click', function () {
        state.plan = a.getAttribute('data-plan');
        paintPlanNote();
        const sel = $('#coIndustry');
        if (sel) sel.focus({ preventScroll: true });
      });
    });
    $('#planNote').addEventListener('click', function (ev) {
      if (ev.target.closest('.plan-clear')) { state.plan = ''; paintPlanNote(); }
    });

    // 신청 폼
    $('#applyForm').addEventListener('submit', handleApply);
    $('#saveWebhookBtn').addEventListener('click', function () {
      const url = $('#webhookInput').value.trim();
      if (url && !/^https:\/\//.test(url)) { toast('https:// 로 시작하는 URL을 넣어주세요'); return; }
      write(STORE.webhook, url);
      paintWebhookState();
      toast(url ? '알림 웹훅을 저장했어요' : '웹훅을 비웠어요');
    });
    $('#testWebhookBtn').addEventListener('click', function () {
      const url = getWebhookUrl();
      if (!url) { toast('먼저 웹훅 URL을 저장해 주세요'); return; }
      sendLead(url, {
        name: '테스트', industry: '입주·이사청소', region: '테스트', contact: '010-0000-0000',
        plan: '테스트', at: fmtNow()
      }).then(function () { toast('테스트 알림을 보냈어요 (텔레그램 확인)'); })
        .catch(function () { toast('전송이 막혔어요. URL을 다시 확인해 주세요'); });
    });
    $('#copyApplyBtn').addEventListener('click', function () {
      copyText($('#applyPreview').textContent, '신청 내용을 복사했어요');
    });
    $('#editApplyBtn').addEventListener('click', function () {
      $('#applyDone').hidden = true;
      $('#applyFormWrap').hidden = false;
    });

    // 업체 정보
    ['#bizName', '#bizContact', '#bizClosing'].forEach(function (s) {
      $(s).addEventListener('input', function () {
        if (state.sampleBizData) { state.sampleBizData = null; $('#sampleBizNote').hidden = true; }
        saveBizSoon();
      });
    });
    $('#useMyBizBtn').addEventListener('click', function () {
      state.sampleBizData = null;
      $('#sampleBizNote').hidden = true;
      $('#bizBody').hidden = false;
      $('#bizToggle').setAttribute('aria-expanded', 'true');
      updateBizSummary();
      $('#bizName').focus();
      toast('상호명부터 넣어주세요');
    });
    $('#bizToggle').addEventListener('click', function () {
      const body = $('#bizBody');
      const open = body.hidden;
      body.hidden = !open;
      $('#bizToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    $$('#toneChips .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        state.tone = c.getAttribute('data-tone');
        paintTone();
        saveBizSoon();
      });
    });
    $('#geminiKey').addEventListener('change', function () {
      write(STORE.gemini, $('#geminiKey').value.trim());
      toast($('#geminiKey').value.trim() ? '키를 저장했어요 (이 브라우저에만)' : '키를 지웠어요');
    });

    // 업종
    $('#industryChips').addEventListener('click', function (ev) {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      state.industryId = chip.getAttribute('data-id');
      paintIndustry();
      saveDraftSoon();
    });

    // 빠른 태그
    $('#quickTags').addEventListener('click', function (ev) {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const ta = $('#detailInput');
      const tag = chip.getAttribute('data-tag');
      ta.value = ta.value ? (ta.value.replace(/[\s,]+$/, '') + ', ' + tag) : tag;
      ta.focus();
      saveDraftSoon();
    });

    ['#placeInput', '#extraInput', '#detailInput', '#priceInput', '#pricePrivate'].forEach(function (s) {
      $(s).addEventListener('input', saveDraftSoon);
      $(s).addEventListener('change', saveDraftSoon);
    });
    $('#pricePrivate').addEventListener('change', syncPriceDisabled);

    // 사진
    $$('.photo-tile').forEach(function (tile) {
      const slot = tile.getAttribute('data-slot');
      const input = tile.querySelector('input[type=file]');
      input.addEventListener('change', function () {
        handleFile(slot, input.files && input.files[0]);
        input.value = '';
      });
      tile.querySelector('.photo-del').addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        setPhoto(slot, null);
      });
    });

    // 생성
    $('#generateBtn').addEventListener('click', doGenerate);
    $('#sampleBtn').addEventListener('click', runSample);

    // 결과
    $('#backToWrite').addEventListener('click', function () { showView('write'); });
    $('#saveCompareBtn').addEventListener('click', saveCompare);
    $('#layoutBtn').addEventListener('click', function () {
      state.layout = state.layout === 'h' ? 'v' : 'h';
      write(STORE.layout, state.layout);
      drawCompare();
      toast(state.layout === 'h' ? '좌우 배치' : '상하 배치');
    });
    $('#titleList').addEventListener('click', function (ev) {
      const b = ev.target.closest('.t-copy');
      if (!b) return;
      copyText(b.getAttribute('data-title'), '제목을 복사했어요');
    });
    $('#copyTitleBtn').addEventListener('click', function () {
      copyText(state.result.titles[0], '1번 제목을 복사했어요');
    });
    $('#copyBodyBtn').addEventListener('click', function () {
      const t = state.editingBody ? $('#bodyEdit').value : state.result.body;
      copyText(t, '본문을 복사했어요');
    });
    $('#copyTagBtn').addEventListener('click', function () {
      copyText(state.result.hashtagText, '해시태그를 복사했어요');
    });
    $('#copySeoBtn').addEventListener('click', function () {
      copyText(state.result.seoKeywords.join(', '), '키워드를 복사했어요');
    });
    $('#copyAllBtn').addEventListener('click', function () {
      copyText(state.result.fullText, '전체를 복사했어요');
    });
    $('#editBodyBtn').addEventListener('click', function () {
      state.editingBody = !state.editingBody;
      if (state.editingBody) {
        $('#bodyEdit').value = state.result.body;
        $('#bodyEdit').hidden = false;
        $('#bodyText').hidden = true;
        $('#editBodyBtn').textContent = '수정 완료';
        $('#bodyEdit').focus();
      } else {
        setBody($('#bodyEdit').value);
        $('#bodyEdit').hidden = true;
        $('#bodyText').hidden = false;
        $('#editBodyBtn').textContent = '수정하기';
        toast('수정한 내용을 반영했어요');
      }
    });
    $('#aiBtn').addEventListener('click', function () { runAI(true); });
    $('#regenBtn').addEventListener('click', function () {
      state.seed = (state.seed + 1 + Math.floor(Math.random() * 97)) >>> 0;
      doGenerate();
      toast('표현을 바꿔 다시 만들었어요');
    });
    $('#newJobBtn').addEventListener('click', function () {
      clearPhotos();
      $('#placeInput').value = '';
      $('#detailInput').value = '';
      $('#priceInput').value = '';
      $('#extraInput').value = '';
      state.result = null;
      state.aiTouched = false;
      showView('write');
      $('#placeInput').focus();
    });
  }

  /* ── 시작 ───────────────────────────────────────────────────────── */
  function init() {
    renderLanding();
    renderApplyForm();
    renderIndustryChips();
    bind();
    loadBiz();
    loadDraft();
    const key = read(STORE.gemini, '');
    if (key) $('#geminiKey').value = key;
    state.layout = read(STORE.layout, 'h');
    if (!state.industryId) state.industryId = '';

    paintWebhookState();
    if (getWebhookUrl()) console.info('[현장로그] 신청 알림 웹훅이 설정돼 있습니다.');

    // 테스트/자동화용 핸들 (공개되어도 개인정보 없음)
    window.__fieldlog = {
      state: state,
      generate: function (overrides) {
        const input = Object.assign(collectInput(), overrides || {});
        return E.generate(input);
      },
      runSample: runSample,
      doGenerate: doGenerate,
      showView: showView,
      setPhoto: setPhoto,
      getWebhookUrl: getWebhookUrl,
      composeCompare: function () { return drawCompare(); }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
