/* 현장로그 — 화면 로직
 * · 원고는 서버(Supabase Edge Function generate-post)에서만 만듭니다.
 *   브라우저에는 원고 생성기가 없고, 서버가 잔여 횟수를 차감한 뒤에만 결과를 돌려줍니다.
 * · 신청서는 Edge Function submit-lead 로 보냅니다(leads 테이블 저장 + 텔레그램 알림).
 *   공개 번들에는 웹훅 URL·봇 토큰 같은 비밀값을 두지 않습니다.
 * · 화면 표시용 업종·채널 목록은 catalog.js, 예시 체험 결과는 demo-result.js 에 있습니다.
 */
(function () {
  'use strict';

  const CAT = window.FieldLogCatalog;
  const DEMO = window.FieldLogDemo;
  const C = window.FieldLogCanvas;

  /* ── 라인 아이콘 (이모지 대신 쓰는 인라인 SVG — 1세트 1스트로크 1.5) ── */
  function svg(paths, size) {
    const n = size || 18;
    return '<svg class="icon" viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  const ICON = {
    blog: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
    danggeun: svg('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>'),
    insta: svg('<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="3.6"/><path d="M17.2 6.8h.01"/>'),
    threads: svg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>'),
    movein: svg('<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>', 20),
    aircon: svg('<path d="M4 8h9a3 3 0 1 0-3-3"/><path d="M4 12h13a3 3 0 1 1-3 3"/><path d="M4 16h6"/>', 20),
    grout: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 12h17M12 3.5v17"/>', 20),
    leak: svg('<path d="M12 3.5 6.8 10a7 7 0 1 0 10.4 0z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.4"/>', 20),
    silicon: svg('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/><path d="M18 17v3M16.5 18.5h3"/>', 20),
    screen: svg('<rect x="3.5" y="4" width="17" height="14" rx="1.5"/><path d="M12 4v14M3.5 11h17"/><path d="M7 21h10"/>', 20),
    camera: svg('<path d="M4 8.5h2.6L8 6h8l1.4 2.5H20a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.4" r="3.4"/>', 16)
  };

  /* ── 설정 (공개 저장소용 값만) ───────────────────────────────────── */
  const CONFIG = {
    geminiModel: 'gemini-2.5-flash'
  };

  /* ── Supabase (공개 프론트엔드용 값만 — sb_secret_·service_role 키는 절대 넣지 않음) ── */
  const SUPABASE = {
    url: 'https://khivycnezspevendmdtx.supabase.co',
    key: 'sb_publishable_ANBO1DW598SenNqUkDd2wg_RWOLE3hn'
  };
  const QUOTA = { trial: 3, light: 15 };

  const auth = {
    sb: null,            // supabase-js 클라이언트
    session: null,       // 로그인 세션
    profile: null,       // profiles 행 (plan / used_count / 업체 정보)
    schemaMissing: false,// schema.sql 미실행 상태
    profileError: false, // 프로필을 읽지 못한 상태(권한 등) — 횟수를 추측해 보여주지 않는다
    mode: 'login',
    busy: false,
    pending: false,      // 로그인 뒤 이어서 만들 원고가 있는지
    actionSignIn: false, // 사용자가 방금 로그인/가입 버튼을 눌러 생긴 SIGNED_IN인지
    ready: false
  };

  const STORE = {
    biz: 'fieldlog.biz.v1',
    draft: 'fieldlog.draft.v1',
    gemini: 'fieldlog.gemini.v1',
    layout: 'fieldlog.layout.v1',
    lead: 'fieldlog.lead.v1',
    channel: 'fieldlog.channel.v1',
    owner: 'fieldlog.owner.v1'   // 마지막으로 로그인한 계정 id (계정 전환 감지용)
  };

  const state = {
    view: 'land',
    industryId: '',
    channel: 'blog',
    tone: 'haeyo',
    photos: { before: null, during: null, after: null },
    layout: 'h',
    result: null,
    seed: 1,
    aiBusy: false,
    aiTouched: false,
    editingBody: false,
    sampleBizData: null,
    plan: '',
    lastDemo: false,
    demoScene: false,   // [예시로 바로 체험하기]로 채운 가상 현장인지
    posts: null,        // 서버가 한 번에 만들어 준 4채널 결과 (채널 전환은 무료)
    genBusy: false
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

  // 로그아웃·계정 전환 시 이 기기에 남은 업체정보·신청서·초안을 지운다.
  function clearLocalPII() {
    [STORE.biz, STORE.draft, STORE.lead].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    });
    state.sampleBizData = null;
    ['#bizName', '#bizContact', '#bizClosing', '#placeInput', '#detailInput', '#priceInput', '#extraInput', '#authEmail', '#authPw'].forEach(function (s) {
      const el = $(s);
      if (el) el.value = '';
    });
    updateBizSummary();
  }

  /* ── 계정 · 무료 체험 잠금 (Supabase) ───────────────────────────── */
  function initSupabase() {
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[현장로그] supabase-js를 불러오지 못했습니다.');
      paintAuth();
      return;
    }
    try {
      auth.sb = window.supabase.createClient(SUPABASE.url, SUPABASE.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    } catch (e) {
      console.warn('[현장로그] supabase 초기화 실패', e);
      auth.sb = null;
      paintAuth();
      return;
    }
    // onAuthStateChange 콜백 안에서 다른 supabase 호출을 바로 기다리면 교착될 수 있어 setTimeout으로 뺀다.
    auth.sb.auth.onAuthStateChange(function (event, session) {
      auth.session = session || null;
      if (!auth.session) auth.profile = null;
      paintAuth();
      setTimeout(function () { afterAuthChange(event, session); }, 0);
    });
    auth.sb.auth.getSession().then(function (r) {
      auth.session = (r && r.data) ? r.data.session : null;
      auth.ready = true;
      if (auth.session) loadProfile();
      paintAuth();
    }).catch(function (e) {
      console.warn('[현장로그] 세션 확인 실패', e);
      auth.ready = true;
      paintAuth();
    });
  }

  function afterAuthChange(event, session) {
    // 실제 로그아웃일 때만 이 기기의 개인정보를 지운다. (비로그인 방문·최초 로드에서는 초안을 지우지 않음)
    if (event === 'SIGNED_OUT') {
      auth.profile = null;
      write(STORE.owner, '');
      clearLocalPII();
      setAuthMode('login');
      paintAuth();
      return;
    }
    if (!session) { auth.profile = null; paintAuth(); return; }
    if (event === 'TOKEN_REFRESHED') { return; }
    const wasPending = auth.pending;
    const byUser = auth.actionSignIn;
    loadProfile().then(function (p) {
      if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') { paintSysState(); return; }
      closeAuthModal();
      setAuthMode('login');
      if (wasPending) {
        auth.pending = false;
        toast('로그인했어요 · 원고를 만들게요');
        doGenerate();
      } else if (event === 'SIGNED_IN' && byUser) {
        const info = (p && !auth.profileError) ? ' · ' + planInfo(p).text : '';
        toast('로그인했어요' + info);
      }
      auth.actionSignIn = false;
      paintSysState();
    });
  }

  function planInfo(p) {
    const plan = (p && p.plan) || 'trial';
    const used = (p && typeof p.used_count === 'number') ? p.used_count : 0;
    if (plan === 'light') {
      const limit = (p && p.monthly_limit) || QUOTA.light;
      const left = Math.max(0, limit - used);
      return { plan: plan, text: '라이트 ' + left + '/' + limit + '건 남음', short: '라이트 ' + left + '/' + limit, out: left <= 0 };
    }
    if (plan === 'pro') return { plan: plan, text: '프로 무제한', short: '프로 무제한', out: false };
    if (plan === 'agency') return { plan: plan, text: '카톡 1:1 대행형', short: '카톡 1:1', out: false };
    const left = Math.max(0, QUOTA.trial - used);
    return { plan: 'trial', text: '무료 체험 ' + left + '/' + QUOTA.trial + '건 남음', short: '무료 ' + left + '/' + QUOTA.trial, out: left <= 0 };
  }

  function isSchemaMissing(err) {
    if (!err) return false;
    const code = err.code || '';
    const msg = String(err.message || '');
    return code === 'PGRST202' || code === 'PGRST205' || /Could not find the (table|function)|schema cache/i.test(msg);
  }

  async function loadProfile() {
    if (!auth.sb || !auth.session) { auth.profile = null; auth.profileError = false; paintAuth(); return null; }
    // 계정이 바뀌었으면 이 기기에 남은 이전 계정 정보가 새 계정으로 복사되지 않게 먼저 지운다.
    const prevOwner = read(STORE.owner, '');
    if (prevOwner && prevOwner !== auth.session.user.id) clearLocalPII();
    write(STORE.owner, auth.session.user.id);
    let r;
    try {
      r = await auth.sb.from('profiles')
        .select('id,plan,monthly_limit,used_count,shop_name,shop_contact,tone,closing')
        .eq('id', auth.session.user.id)
        .maybeSingle();
    } catch (e) {
      console.warn('[현장로그] 프로필 조회 실패', e);
      return null;
    }
    if (r.error) {
      if (isSchemaMissing(r.error)) {
        auth.schemaMissing = true;
        console.warn('[현장로그] profiles 테이블 없음 — supabase/schema.sql을 SQL Editor에서 실행하세요.', r.error);
      } else {
        console.warn('[현장로그] 프로필 조회 오류', r.error);
      }
      auth.profile = null;
      auth.profileError = !isSchemaMissing(r.error);
      paintAuth();
      return null;
    }
    auth.schemaMissing = false;
    auth.profileError = false;
    auth.profile = r.data || null;
    paintAuth();
    applyProfileBiz();
    return auth.profile;
  }

  // 계정에 저장된 업체 정보를 불러오고, 서버에 아무것도 없으면 이 기기 값을 올린다.
  function applyProfileBiz() {
    const p = auth.profile;
    if (!p) return;
    const hasServer = !!(p.shop_name || p.shop_contact || p.closing);
    if (hasServer) {
      if (p.shop_name) $('#bizName').value = p.shop_name;
      if (p.shop_contact) $('#bizContact').value = p.shop_contact;
      if (p.closing) $('#bizClosing').value = p.closing;
      if (p.tone && CAT.STYLE_LABEL[p.tone]) { state.tone = p.tone; paintTone(); }
      updateBizSummary();
      write(STORE.biz, currentBiz());
      if (p.shop_name) {
        $('#bizBody').hidden = true;
        $('#bizToggle').setAttribute('aria-expanded', 'false');
      }
    } else {
      const local = read(STORE.biz, null);
      if (local && local.name) syncBizToServer();
    }
  }

  let profileTimer = null;
  function syncBizToServer() {
    if (!auth.sb || !auth.session || auth.schemaMissing) return;
    clearTimeout(profileTimer);
    profileTimer = setTimeout(function () {
      if (!auth.sb || !auth.session) return;
      const biz = currentBiz();
      auth.sb.from('profiles').update({
        shop_name: biz.name,
        shop_contact: biz.contact,
        tone: biz.style,
        closing: biz.closing
      }).eq('id', auth.session.user.id).then(function (r) {
        if (!r.error) return;
        if (isSchemaMissing(r.error)) { auth.schemaMissing = true; paintAuth(); return; }
        console.warn('[현장로그] 업체 정보 동기화 실패', r.error);
      }).catch(function (e) { console.warn('[현장로그] 업체 정보 동기화 실패', e); });
    }, 700);
  }

  function paintAuth() {
    const signed = !!auth.session;
    const info = planInfo(auth.profile);
    const chip = $('#authChip');
    if (chip) {
      chip.classList.toggle('is-on', signed && !info.out);
      chip.classList.toggle('is-out', signed && info.out);
      const t = $('#authChipText');
      if (t) t.textContent = signed ? ((auth.schemaMissing || auth.profileError) ? '로그인됨' : info.short) : '로그인';
      chip.setAttribute('aria-label', signed ? ('내 계정 · ' + (auth.session.user.email || '')) : '로그인 또는 회원가입');
    }
    const bar = $('#accountBar');
    if (bar) {
      bar.classList.toggle('is-on', signed && !info.out);
      bar.classList.toggle('is-out', signed && info.out);
      $('#abName').textContent = signed ? (auth.session.user.email || '내 계정') : '로그인이 필요해요';
      $('#abSub').textContent = signed
        ? (auth.schemaMissing
          ? '체험 횟수 잠금이 아직 서버에 없어요 — 관리자 확인이 필요합니다'
          : (auth.profileError
            ? '체험 횟수를 서버에서 불러오지 못했어요 — 관리자 확인이 필요합니다'
            : info.text + ' · 업체 정보는 계정에 저장됩니다'))
        : '무료 3건 체험을 위해 10초만 써 주세요';
      $('#abBtn').hidden = signed;
      $('#abActions').hidden = !signed;
    }
    paintSysState();
  }

  function paintSysState() {
    const el = $('#sysState');
    if (!el) return;
    if (!auth.sb) { el.textContent = '계정 모듈을 불러오지 못했습니다 — 새로고침해 주세요.'; return; }
    if (auth.schemaMissing) { el.textContent = '체험 횟수 서버 잠금: 미설치 — supabase/schema.sql을 SQL Editor에서 실행해 주세요.'; return; }
    if (auth.session && auth.profileError) { el.textContent = '로그인은 되었지만 profiles 조회 권한이 없습니다 — supabase/schema.sql을 다시 실행해 주세요.'; return; }
    el.textContent = auth.session
      ? '계정 서버 연결됨 · ' + (auth.session.user.email || '') + ' · ' + planInfo(auth.profile).text
      : '계정 서버 연결됨 · 로그인 전';
  }

  function paintAiRow() {
    const row = $('#aiRow');
    if (row) row.hidden = !getGeminiKey();
  }

  function openAuthModal(reason) {
    const el = $('#authModal');
    if (!el) return;
    setAuthMode(auth.mode || 'login');
    if (reason === 'gate') {
      $('#authTitle').textContent = '10초 회원가입하고 시작하기';
      $('#authSub').textContent = '무료 3건 체험을 위해 10초 회원가입/로그인해 주세요. 결제는 없습니다.';
    }
    el.hidden = false;
    setTimeout(function () { const e = $('#authEmail'); if (e) e.focus(); }, 40);
  }

  function closeAuthModal() {
    const el = $('#authModal');
    auth.pending = false;
    if (!el || el.hidden) return;
    el.hidden = true;
    authMsg('');
  }

  function setAuthMode(mode) {
    auth.mode = mode === 'signup' ? 'signup' : 'login';
    $$('.modal-tab').forEach(function (t) {
      const on = t.getAttribute('data-auth-tab') === auth.mode;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $('#authSubmit').textContent = auth.mode === 'signup' ? '회원가입하고 시작하기' : '로그인';
    $('#authPw').setAttribute('autocomplete', auth.mode === 'signup' ? 'new-password' : 'current-password');
    $('#authNote').textContent = auth.mode === 'signup'
      ? '가입한 이메일·비밀번호로 다음에도 로그인할 수 있습니다. 비밀번호는 저희가 볼 수 없습니다.'
      : '체험 횟수는 서버에 저장돼 기기를 바꿔도 유지됩니다. 비밀번호는 저희가 볼 수 없습니다.';
    authMsg('');
  }

  function authMsg(text, ok) {
    const el = $('#authMsg');
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle('is-ok', !!ok);
  }

  function setAuthBusy(on) {
    auth.busy = on;
    const btn = $('#authSubmit');
    if (!btn) return;
    btn.disabled = on;
    btn.textContent = on
      ? (auth.mode === 'signup' ? '가입 중…' : '로그인 중…')
      : (auth.mode === 'signup' ? '회원가입하고 시작하기' : '로그인');
  }

  function mapAuthError(err) {
    const m = String((err && err.message) || '');
    if (/Invalid login credentials/i.test(m)) return '이메일 또는 비밀번호가 맞지 않아요.';
    if (/Email not confirmed/i.test(m)) return '메일 인증이 아직 안 됐어요. 받은 메일의 확인 링크를 먼저 눌러 주세요.';
    if (/User already registered|already been registered/i.test(m)) return '이미 가입된 이메일이에요. [로그인] 탭에서 로그인해 주세요.';
    if (/Password should be at least/i.test(m)) return '비밀번호는 6자 이상으로 넣어 주세요.';
    if (/rate limit|too many|over_email_send_rate_limit/i.test(m)) return '시도가 너무 잦아요. 잠시 후 다시 시도해 주세요.';
    if (/fetch|network|Failed to fetch/i.test(m)) return '연결이 불안정해요. 잠시 후 다시 시도해 주세요.';
    return '로그인하지 못했어요: ' + (m.slice(0, 140) || '알 수 없는 오류');
  }

  async function handleAuthSubmit(ev) {
    ev.preventDefault();
    if (auth.busy) return;
    if (!auth.sb) { authMsg('로그인 서버에 연결하지 못했어요. 새로고침 후 다시 시도해 주세요.'); return; }
    const email = $('#authEmail').value.trim();
    const pw = $('#authPw').value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authMsg('이메일 주소를 확인해 주세요.'); return; }
    if (pw.length < 6) { authMsg('비밀번호는 6자 이상으로 넣어 주세요.'); return; }
    setAuthBusy(true);
    auth.actionSignIn = true;
    try {
      if (auth.mode === 'signup') {
        const r = await auth.sb.auth.signUp({
          email: email,
          password: pw,
          options: { emailRedirectTo: location.origin + location.pathname }
        });
        if (r.error) { auth.actionSignIn = false; authMsg(mapAuthError(r.error)); return; }
        if (r.data && r.data.session) { authMsg('가입 완료 — 바로 시작할 수 있어요', true); return; }
        auth.actionSignIn = false;
        authMsg('가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 [로그인] 탭에서 로그인해 주세요. (스팸함도 확인해 주세요)', true);
        setAuthMode('login');
      } else {
        const r = await auth.sb.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) { auth.actionSignIn = false; authMsg(mapAuthError(r.error)); return; }
        authMsg('로그인 중…', true);
      }
    } catch (e) {
      auth.actionSignIn = false;
      authMsg(mapAuthError(e));
    } finally {
      setAuthBusy(false);
    }
  }

  function signOut() {
    if (!auth.sb) return;
    auth.sb.auth.signOut().then(function () {
      toast('로그아웃했어요');
    }).catch(function () { toast('로그아웃하지 못했어요'); });
  }

  function openLimitModal(data) {
    const el = $('#limitModal');
    if (!el) return;
    if (data && data.reason === 'monthly_limit') {
      $('#limitEyebrow').textContent = '라이트 이용 한도';
      $('#limitTitle').textContent = '이번 달 15건을 모두 쓰셨어요';
      $('#limitSub').textContent = '다음 달 1일에 다시 15건이 채워집니다. 지금 더 쓰시려면 프로(무제한)로 올려 주세요.';
    } else {
      const used = (data && data.used) || QUOTA.trial;
      $('#limitEyebrow').textContent = '무료 체험 종료';
      $('#limitTitle').textContent = '무료 체험 ' + used + '건을 모두 쓰셨어요';
      $('#limitSub').textContent = '계속 쓰시려면 아래에서 플랜을 신청해 주세요. 신청서를 남겨주시면 바로 안내드립니다.';
    }
    el.hidden = false;
  }

  function closeLimitModal() {
    const el = $('#limitModal');
    if (el) el.hidden = true;
  }

  function goToPlan(plan) {
    closeLimitModal();
    state.plan = plan || '';
    paintPlanNote();
    showView('land');
    setTimeout(function () {
      const t = $('#apply');
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    if (plan) toast(plan + ' 신청서로 이동했어요');
  }

  function applyUsage(data) {
    const prev = auth.profile || {};
    auth.profile = {
      plan: data.plan || prev.plan || 'trial',
      used_count: (typeof data.used === 'number') ? data.used : prev.used_count,
      monthly_limit: (typeof data.limit === 'number' && data.limit > 0) ? data.limit : prev.monthly_limit,
      shop_name: prev.shop_name, shop_contact: prev.shop_contact, tone: prev.tone, closing: prev.closing
    };
    paintAuth();
    const info = planInfo(auth.profile);
    if (info.plan === 'trial' || info.plan === 'light') {
      toast(info.out ? '체험 횟수를 다 쓰셨어요' : info.text);
    }
  }

  // 원고는 서버(Edge Function)에서만 만듭니다. 서버가 횟수를 차감하고 결과를 돌려줍니다.
  // 여기서 실패하면 원고를 만들지 않습니다(fail-closed). 브라우저 우회 생성 경로는 없습니다.
  async function requestPosts(input) {
    if (!auth.sb) return { ok: false, reason: 'no_client', payload: {} };
    if (!auth.session) return { ok: false, reason: 'not_authenticated', payload: {} };
    try {
      const res = await auth.sb.functions.invoke('generate-post', { body: input });
      let payload = res.data;
      let status = 0;
      if (res.error) {
        const ctx = res.error.context;
        if (ctx) {
          status = ctx.status || 0;
          try { payload = await ctx.json(); } catch (e) { payload = null; }
        }
        return { ok: false, status: status, payload: payload || {} };
      }
      if (!payload || payload.ok !== true || !payload.posts) {
        return { ok: false, status: status, payload: {} };
      }
      return { ok: true, posts: payload.posts, quota: payload.quota || null };
    } catch (e) {
      console.warn('[현장로그] 원고 생성 요청 실패', e);
      return { ok: false, status: 0, payload: {} };
    }
  }

  function handleGenError(res) {
    const payload = res.payload || {};
    const reason = payload.reason || res.reason || '';
    if (res.status === 401 || reason === 'not_authenticated') {
      auth.pending = true;
      openAuthModal('gate');
      authMsg('로그인이 만료됐어요. 다시 로그인해 주세요.');
      return;
    }
    if (res.status === 402 && (reason === 'trial_exhausted' || reason === 'monthly_limit')) {
      openLimitModal({ reason: reason, used: payload.used, limit: payload.limit });
      return;
    }
    if (reason === 'schema_not_installed') {
      toast('원고 서버 준비가 끝나지 않았어요 — 관리자에게 알려주세요');
      return;
    }
    if (reason === 'invalid_input') {
      toast('현장 정보를 확인해 주세요 (동네·업종은 필수예요)');
      return;
    }
    if (reason === 'no_client') {
      toast('로그인 모듈을 불러오지 못했어요 — 새로고침 후 다시 시도해 주세요');
      return;
    }
    toast('원고를 만들지 못했어요. 잠시 후 다시 눌러 주세요');
  }

  function setGenBusy(on) {
    const btn = $('#generateBtn');
    if (btn) {
      btn.disabled = on;
      btn.textContent = on ? '만드는 중…' : '후기 만들기';
    }
    $$('#regenBtn, #newJobBtn').forEach(function (b) { b.disabled = on; });
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

  /* ── 채널 선택 ──────────────────────────────────────────────────── */
  function renderChannelChips() {
    const html = CAT.CHANNELS.map(function (c) {
      return '<button class="channel-chip" type="button" data-channel="' + c.id + '">' +
        '<span class="cc-icon" aria-hidden="true">' + (ICON[c.id] || ICON.blog) + '</span>' +
        '<span class="cc-text"><strong>' + c.label + '</strong><small>' + c.short + '</small></span>' +
        '</button>';
    }).join('');
    $$('.channel-chips').forEach(function (box) { box.innerHTML = html; });
    paintChannel();
  }

  function paintChannel() {
    const ch = CAT.getChannel(state.channel);
    $$('.channel-chip').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-channel') === ch.id);
    });
    const hint = $('#channelHint');
    if (hint) hint.textContent = ch.hint;
    const toneHint = $('#toneHint');
    if (toneHint) {
      toneHint.textContent = ch.id === 'blog'
        ? '블로그 본문 말투입니다.'
        : ch.label + ' 형식은 채널 말투로 자동 변환됩니다 (말투 설정은 블로그에 적용)';
    }
  }

  function setChannel(id) {
    const ch = CAT.getChannel(id);
    if (state.channel === ch.id) return;
    state.channel = ch.id;
    write(STORE.channel, ch.id);
    paintChannel();
    if (state.view === 'result' && state.result) {
      // 서버가 한 번에 4채널을 만들어 두므로 채널 전환은 횟수를 더 쓰지 않는다.
      const next = state.lastDemo ? DEMO.get(ch.id) : (state.posts ? state.posts[ch.id] : null);
      if (!next) {
        toast('채널을 바꾸려면 [다시 만들기]를 눌러 주세요');
        return;
      }
      state.result = next;
      renderResult();
      drawCompare();
      toast(ch.label + ' 형식으로 바꿨어요');
    } else {
      toast(ch.label + ' 형식으로 만들게요');
    }
  }

  /* ── 랜딩: 업종 카드 ────────────────────────────────────────────── */
  function renderLanding() {
    const grid = $('#landIndustryGrid');
    grid.innerHTML = CAT.INDUSTRIES.map(function (ind) {
      const flow = ind.processes.slice(0, 4).map(function (p) { return p.name; }).join(' → ');
      return '<article class="industry-card">' +
        '<span class="ic-icon" aria-hidden="true">' + (ICON[ind.id] || '') + '</span>' +
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
      CAT.INDUSTRIES.map(function (i) { return '<option value="' + i.label + '">' + i.label + '</option>'; })
    ).join('');
  }

  function planLabel(plan) {
    // 카톡 1:1 대행형으로 개편(2026-11-19). 개편 전 명칭은 저장된 신청서 호환용.
    return ['라이트', '프로', '카톡 1:1 대행형', '초기 1:1 세팅'].indexOf(plan) >= 0 ? plan : '미정';
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

  // 신청은 서버(Edge Function submit-lead)로 보낸다. 서버가 leads 테이블에 저장하고 텔레그램 알림을 보낸다.
  // (공개 번들에 웹훅 URL·봇 토큰이 없어 누구나 알림을 위조해 보낼 수 없다)
  async function submitLead(lead) {
    if (!auth.sb) return { ok: false, reason: 'no_client' };
    try {
      const res = await auth.sb.functions.invoke('submit-lead', {
        body: {
          name: lead.name,
          industry: lead.industry,
          region: lead.region,
          contact: lead.contact,
          plan: planLabel(lead.plan),
          page: location.href,
          agree: true,
          website: $('input[name="company_website"]') ? $('input[name="company_website"]').value : ''
        }
      });
      let payload = res.data;
      let status = 0;
      if (res.error) {
        const ctx = res.error.context;
        if (ctx) {
          status = ctx.status || 0;
          try { payload = await ctx.json(); } catch (e) { payload = null; }
        }
        return { ok: false, status: status, reason: (payload && payload.reason) || '' };
      }
      if (!payload || payload.ok !== true) return { ok: false, status: status, reason: '' };
      return { ok: true, duplicate: !!payload.duplicate, notified: !!payload.notified, accepted: payload.accepted !== false };
    } catch (e) {
      console.warn('[현장로그] 신청 전송 실패', e);
      return { ok: false, reason: '' };
    }
  }

  function paintPlanNote() {
    const el = $('#planNote');
    if (!el) return;
    if (!state.plan) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '희망 요금제 : <strong>' + escapeHtml(state.plan) + '</strong> <button type="button" class="plan-clear">변경</button>';
  }

  function setLeadState(stateName, notified) {
    const title = $('#applyDoneTitle');
    const sub = $('#applyDoneSub');
    const line = $('#leadState');
    const map = {
      sending: ['신청을 보내고 있어요', '잠시만 기다려 주세요.'],
      ok: ['신청이 접수됐습니다', '확인 후 순서대로 연락드리겠습니다. 아래 내용은 보관용입니다.'],
      duplicate: ['이미 접수된 신청이에요', '같은 연락처로 이미 접수되어 있습니다. 곧 연락드리겠습니다.'],
      limited: ['잠시 후 다시 시도해 주세요', '짧은 시간에 신청이 많았어요. 아래 내용을 복사해 보내주셔도 됩니다.'],
      failed: ['신청을 보내지 못했어요', '아래 내용을 복사해서 안내받은 카톡·문자로 보내주세요.']
    };
    const m = map[stateName] || map.failed;
    if (title) title.textContent = m[0];
    if (sub) sub.textContent = m[1];
    if (!line) return;
    if (stateName === 'ok' && notified === false) {
      line.hidden = false;
      line.textContent = '접수는 저장됐고, 알림 발송만 지연되고 있어요. 연락은 정상적으로 드립니다.';
    } else {
      line.hidden = true;
      line.textContent = '';
    }
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
    setLeadState('sending');
    $('#applyDone').scrollIntoView({ behavior: 'smooth', block: 'center' });

    submitLead(lead).then(function (r) {
      if (r.ok && r.duplicate) { setLeadState('duplicate'); toast('이미 접수된 신청이에요'); return; }
      if (r.ok) {
        setLeadState('ok', r.notified);
        toast('신청이 접수됐어요');
        return;
      }
      if (r.reason === 'rate_limited' || r.reason === 'hourly_cap') {
        setLeadState('limited');
        toast('잠시 후 다시 시도해 주세요');
        return;
      }
      setLeadState('failed');
      toast('전송이 막혔어요. 아래 내용을 복사해 보내주세요.');
    });
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
      syncBizToServer();
      updateBizSummary();
      const s = $('#saveState');
      s.textContent = '저장했어요';
      setTimeout(function () { if (s.textContent === '저장했어요') s.textContent = ''; }, 1600);
    }, 350);
  }

  function updateBizSummary() {
    const biz = currentBiz();
    const el = $('#bizSummary');
    if (biz.name) el.textContent = biz.name + ' · ' + (CAT.STYLE_LABEL[biz.style] || '');
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
    box.innerHTML = CAT.INDUSTRIES.map(function (i) {
      return '<button class="chip" type="button" data-id="' + i.id + '">' + i.label + '</button>';
    }).join('');
  }

  function paintIndustry() {
    $$('#industryChips .chip').forEach(function (c) {
      c.classList.toggle('is-on', c.getAttribute('data-id') === state.industryId);
    });
    const ind = CAT.getIndustry(state.industryId);
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
    state.lastDemo = false;
    state.demoScene = false;
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
    state.lastDemo = false;
    state.demoScene = false;
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
    const tone = CAT.STYLE_LABEL[state.tone] || '친근한 해요체';
    const ch = CAT.getChannel(state.channel);
    const rules = ch.id === 'blog'
      ? [
          "3. '[사진 : ...]' 줄은 글자 그대로 유지하고, 그 바로 아래 줄에 '→ ' 로 시작하는 사진 설명 한 줄을 추가한다. (사진에서 보이는 것만)",
          "4. '■' 로 시작하는 소제목 구조와 '■ 현장 요약' 항목은 유지한다.",
          '5. 분량은 900~1,200자를 유지한다.',
          '6. 말투는 ' + tone + '로 통일한다.'
        ]
      : [
          "3. '" + ch.label + "' 형식(첫 줄·줄바꿈·문단 순서·마지막 문의 유도 문장)을 그대로 유지한다. '[사진 : ...]'나 '■' 소제목은 새로 넣지 않는다.",
          '4. 분량은 초안과 비슷하게 유지한다' + (ch.id === 'threads' ? ' (500자 이내).' : '.'),
          '5. 말투는 초안의 구어체를 유지한다.'
        ];
    return [
      '너는 한국 시공·청소 업체 사장님의 ' + ch.label + ' 후기를 다듬는 편집자다.',
      '아래 초안은 규칙 기반으로 만든 원고다. 첨부한 현장 사진(시공 전·작업 중·시공 후)을 실제로 보고, 사진에서 확인되는 상태만 반영해 문장을 다듬어라.',
      '',
      '지킬 것:',
      '1. 지역, 평수, 업종, 공정 이름, 견적, 업체명, 연락처 같은 사실은 초안 그대로 둔다. 없는 내용을 지어내지 않는다.',
      '2. 사진에서 실제로 보이는 오염, 시공 상태, 마감 상태만 묘사한다. 사진에 없으면 언급하지 않는다.'
    ].concat(rules).concat([
      '- 금지 표현: ~에 대해 알아보겠습니다, 살펴보겠습니다, 다음과 같습니다, 결론적으로, 요약하면, 시사하는 바, 본질적으로, 도움이 되셨길, 지금부터, 최고, 완벽, 100%',
      '- 줄표(—, –)를 쓰지 않는다. 나열이 필요하면 쉼표나 마침표로 끊는다.',
      '- 연결어미(-고, -며, -서, -는데, -니까) 바로 뒤에 쉼표를 넣지 않는다.',
      '- 광고 문구나 이모지를 새로 넣지 않는다. "저희가 최선을 다해" 같은 뻔한 문장도 넣지 않는다.',
      '- 다 쓰고 나서 스스로 확인한다: ① 지역·평수·공정·견적·연락처가 초안과 같은가 ② 줄표가 없는가 ③ 이모지가 없는가 ④ 연결어미 뒤에 쉼표가 없는가 ⑤ 초안에 없던 사실이나 수치를 넣지 않았는가.',
      '- 출력은 다듬은 본문 전체만. 설명, 인사말, 코드블록 표시 없이.',
      '',
      '─ 초안 ─',
      draft
    ]).join('\n');
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
      toast('AI 다듬기는 관리자 설정에서 Gemini 키를 넣은 기기에서만 동작해요');
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
      const clean = CAT.sanitize(polished);
      const ch = CAT.getChannel(state.channel);
      if (clean.length < (ch.id === 'blog' ? 250 : 80)) throw new Error('결과가 짧습니다');
      if (ch.id === 'blog' && clean.indexOf('■') < 0) throw new Error('형식이 깨졌습니다');
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
      channel: state.channel,
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
    if (!$('#placeInput').value.trim()) { toast('동네·건물을 적어주세요 (예: OO구 OO아파트 34평)'); $('#placeInput').focus(); return false; }
    return true;
  }

  async function doGenerate(opts) {
    opts = opts || {};
    if (!validate()) return;
    if (state.genBusy) return;

    // 가상 예시 현장은 서버를 부르지 않고 고정된 예시 결과만 보여준다.
    if (opts.sample === true || state.demoScene) { showDemo(); return; }

    if (!auth.session) {
      auth.pending = true;
      openAuthModal('gate');
      return;
    }

    state.genBusy = true;
    setGenBusy(true);
    try {
      const res = await requestPosts(collectInput());
      if (!res.ok) { handleGenError(res); return; }
      state.posts = res.posts;
      state.result = res.posts[state.channel] || res.posts.blog;
      state.lastDemo = false;
      if (res.quota) applyUsage(res.quota);
      renderResult();
      showView('result');
      drawCompare();
      if (aiReady()) runAI(false);
    } finally {
      state.genBusy = false;
      setGenBusy(false);
    }
  }

  // 고정 예시 결과(가상 데이터) 미리보기 — 횟수 차감 없음, 생성기도 부르지 않음
  function showDemo() {
    state.posts = null;
    state.result = DEMO.get(state.channel);
    state.lastDemo = true;
    renderResult();
    showView('result');
    drawCompare();
  }

  function refreshFullText() {
    if (state.result) state.result.fullText = CAT.fullTextOf(state.result);
  }

  function renderResult() {
    const r = state.result;
    if (!r) return;
    const ind = CAT.getIndustry(r.industryId);
    const ch = CAT.getChannel(r.channel);
    $('#resultMeta').textContent = ch.label + ' · ' + (ind ? ind.label : '') + ' · ' + r.summary[0].v;

    const hasTitles = r.titles.length > 0;
    $('#titleCard').hidden = !hasTitles;
    if (hasTitles) {
      $('#titleCardTitle').textContent = r.titles.length > 1 ? '제목 3안' : '제목';
      $('#titleCardSub').textContent = ch.id === 'blog'
        ? '지역 키워드가 들어간 순서입니다'
        : '동네 소식 제목으로 그대로 쓰시면 됩니다';
      $('#copyTitleBtn').textContent = r.titles.length > 1 ? '1번 제목 복사' : '제목 복사';
    }

    const list = $('#titleList');
    list.innerHTML = r.titles.map(function (t, i) {
      return '<li><span class="t-index">' + (i + 1) + '</span><span class="t-text">' + escapeHtml(t) + '</span>' +
        '<button class="t-copy" type="button" data-title="' + escapeAttr(t) + '">복사</button></li>';
    }).join('');

    $('#bodyText').innerHTML = renderBodyHtml(r.body);
    $('#bodyMeta').textContent = ch.label + ' · 공백 제외 ' + countChars(r.body) + '자';
    $('#bodyEdit').value = r.body;
    $('#bodyEdit').hidden = true;
    $('#bodyText').hidden = false;
    $('#editBodyBtn').textContent = '수정하기';

    const tagCard = $('#tagCard');
    tagCard.hidden = r.hashtags.length === 0;
    if (r.hashtags.length) {
      $('#tagCardTitle').textContent = '해시태그 ' + r.hashtags.length + '개';
      $('#tagCardSub').textContent = ch.id === 'blog' ? '그대로 붙여넣으세요' : '캡션 끝에 그대로 붙여넣으세요';
    }
    $('#tagList').innerHTML = r.hashtags.map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('');

    $('#seoCard').hidden = r.seoKeywords.length === 0;
    $('#seoList').innerHTML = r.seoKeywords.map(function (t) { return '<span>' + escapeHtml(t) + '</span>'; }).join('');

    $('#aiHint').textContent = getGeminiKey()
      ? '사진을 다시 읽혀 ' + ch.label + ' 형식 그대로 문장을 다듬을 수 있어요.'
      : 'Gemini 키를 넣으면 사진 속 상태까지 읽어 ' + ch.label + ' 형식으로 다듬습니다.';
    state.editingBody = false;
    paintChannel();
  }

  function renderBodyHtml(body) {
    return body.split('\n').map(function (line) {
      if (/^\[사진[ :]/.test(line)) return '<span class="ph ph-photo">' + ICON.camera + '<span>' + escapeHtml(line) + '</span></span>';
      if (/^■/.test(line)) return '<span class="sec">' + escapeHtml(line) + '</span>';
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
    refreshFullText();
    if (state.editingBody) $('#bodyEdit').value = text;
    else $('#bodyText').innerHTML = renderBodyHtml(text);
    $('#bodyMeta').textContent = '공백 제외 ' + countChars(text) + '자';
  }

  /* ── 비교 카드 ──────────────────────────────────────────────────── */
  let compareCanvas = null;
  async function drawCompare() {
    const r = state.result;
    if (!r) return;
    const ind = CAT.getIndustry(r.industryId);
    try {
      if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
      compareCanvas = await C.compose({
        before: state.photos.before,
        during: state.photos.during,
        after: state.photos.after,
        layout: state.layout,
        place: r.summary[0].v,
        industryLabel: ind ? ind.label : '',
        businessName: (currentBiz().name || '') + (state.sampleBizData ? ' (예시)' : '')
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

  /* ── 예시 체험 (assets/demo-*.jpg 실사 사진) ────────────────────── */
  function photoAsset(name) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        try {
          const max = 1080;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const cv = document.createElement('canvas');
          cv.width = w; cv.height = h;
          const cx = cv.getContext('2d');
          cx.drawImage(img, 0, 0, w, h);
          resolve(cv.toDataURL('image/jpeg', 0.9));
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('asset ' + name)); };
      img.src = 'assets/demo-' + name + '.jpg';
    });
  }

  // assets 사진을 못 읽으면(로컬 파일·오프라인) 기존 일러스트로 대체한다.
  async function samplePhotos() {
    try {
      const list = await Promise.all(['before', 'during', 'after'].map(photoAsset));
      return { before: list[0], during: list[1], after: list[2] };
    } catch (e) {
      console.info('[현장로그] 예시 사진을 불러오지 못해 일러스트로 대체합니다.', e);
      return C.makeSamplePhotos();
    }
  }

  async function runSample(forceBlog) {
    if (forceBlog && state.channel !== 'blog') {
      state.channel = 'blog';
      write(STORE.channel, 'blog');
      paintChannel();
    }
    state.industryId = 'grout';
    state.seed = DEMO.input.seed;
    state.demoScene = true;
    $('#placeInput').value = 'OO구 OO아파트 34평';
    $('#detailInput').value = '욕실 줄눈 곰팡이, 탄성코트 희망';
    $('#priceInput').value = '35~40만 원';
    $('#pricePrivate').checked = false;
    $('#extraInput').value = '';
    paintIndustry();
    syncPriceDisabled();

    if (!currentBiz().name) {
      state.sampleBizData = {
        name: 'OO클린',
        contact: '010-0000-0000',
        closing: '다음에도 깔끔하게 모시겠습니다.',
        style: state.tone
      };
      state.tone = state.sampleBizData.style;
      paintTone();
      $('#sampleBizNote').hidden = false;
      updateBizSummary();
    }

    showView('write');
    toast('예시 현장으로 채웠어요 — 가상 예시라 횟수가 차감되지 않습니다');
    const samples = await samplePhotos();
    setPhoto('before', samples.before);
    setPhoto('during', samples.during);
    setPhoto('after', samples.after);
    setTimeout(function () { doGenerate({ sample: true }); }, 60);
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
      paintAiRow();
      toast($('#geminiKey').value.trim() ? '키를 저장했어요 (이 브라우저에만)' : '키를 지웠어요');
    });

    // 계정 · 로그인 모달 · 체험 한도
    $('#authChip').addEventListener('click', function () {
      if (!auth.session) { openAuthModal('chip'); return; }
      showView('write');
      setTimeout(function () {
        const bar = $('#accountBar');
        if (bar) bar.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
    });
    $('#abBtn').addEventListener('click', function () { openAuthModal('bar'); });
    $('#abLogoutBtn').addEventListener('click', function () { signOut(); });
    $('#abPlanBtn').addEventListener('click', function () {
      showView('land');
      setTimeout(function () {
        const t = $('#pricing');
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    });
    $$('.modal-tab').forEach(function (t) {
      t.addEventListener('click', function () { setAuthMode(t.getAttribute('data-auth-tab')); });
    });
    $('#authForm').addEventListener('submit', handleAuthSubmit);
    $$('[data-close-auth]').forEach(function (b) { b.addEventListener('click', closeAuthModal); });
    $$('[data-close-limit]').forEach(function (b) { b.addEventListener('click', closeLimitModal); });
    $('#limitLater').addEventListener('click', closeLimitModal);
    $$('[data-limit-plan]').forEach(function (b) {
      b.addEventListener('click', function () { goToPlan(b.getAttribute('data-limit-plan')); });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!$('#authModal').hidden) closeAuthModal();
      else if (!$('#limitModal').hidden) closeLimitModal();
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

    // 채널
    $$('.channel-chips').forEach(function (box) {
      box.addEventListener('click', function (ev) {
        const b = ev.target.closest('[data-channel]');
        if (!b) return;
        setChannel(b.getAttribute('data-channel'));
      });
    });

    // 생성
    $('#generateBtn').addEventListener('click', doGenerate);
    $('#sampleBtn').addEventListener('click', function () { runSample(false); });
    $('#demoTryBtn').addEventListener('click', function () { runSample(true); });
    // 랜딩 예시 원고: 내부 스크롤 대신 '원고 전체 보기'로 펼친다
    const moreBtn = $('#demoMoreBtn');
    if (moreBtn) {
      moreBtn.addEventListener('click', function () {
        const open = moreBtn.getAttribute('aria-expanded') !== 'true';
        moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        moreBtn.textContent = open ? '원고 접기' : '원고 전체 보기';
        const pre = $('#demoText');
        if (pre) pre.classList.toggle('is-open', open);
      });
    }

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
      if (state.lastDemo) { showDemo(); return; }
      state.seed = (state.seed + 1 + Math.floor(Math.random() * 97)) >>> 0;
      doGenerate({ sample: false });
    });
    $('#newJobBtn').addEventListener('click', function () {
      clearPhotos();
      $('#placeInput').value = '';
      $('#detailInput').value = '';
      $('#priceInput').value = '';
      $('#extraInput').value = '';
      state.result = null;
      state.posts = null;
      state.lastDemo = false;
      state.demoScene = false;
      state.aiTouched = false;
      showView('write');
      $('#placeInput').focus();
    });
  }

  /* ── 시작 ───────────────────────────────────────────────────────── */
  function init() {
    state.channel = CAT.getChannel(read(STORE.channel, 'blog')).id;
    renderLanding();
    renderApplyForm();
    renderIndustryChips();
    renderChannelChips();
    bind();
    loadBiz();
    loadDraft();
    const key = read(STORE.gemini, '');
    if (key) $('#geminiKey').value = key;
    state.layout = read(STORE.layout, 'h');
    if (!state.industryId) state.industryId = '';

    paintAuth();
    paintAiRow();
    initSupabase();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
