// 컷토리 계정: 구글 로그인 + 계정별 자동 저장
// 페이지에 <script src="account.js" data-app="office" defer></script> 처럼 넣으면
// 머리글 오른쪽에 로그인 버튼이 생기고, 로그인한 사람의 작업이 서버에 저장돼서 어느 기기에서든 이어져요.
// 서버에 GOOGLE_CLIENT_ID가 없으면 버튼이 나타나지 않고, 지금처럼 이 브라우저에만 저장돼요.
(function () {
  const API = String(window.CUTTORY_API || '').replace(/\/$/, '');
  const me = document.currentScript;
  const PAGE_APP = (me && me.dataset.app) || '';
  const APPS = { office: 'trend-office-v1', portfolio: 'cuttory-portfolio-v1', video: 'cuttory-video-v1', cardnews: 'cuttory_carousels' };
  const KEY_APP = Object.fromEntries(Object.entries(APPS).map(([a, k]) => [k, a]));
  const LS = window.localStorage;
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  const get = (k) => { try { return LS.getItem(k); } catch { return null; } };
  const put = (k, v) => { try { v == null ? rawRemove.call(LS, k) : rawSet.call(LS, k, v); } catch {} };
  const tKey = (a) => 'ct-sync-t:' + a, dirtyKey = (a) => 'ct-sync-dirty:' + a;
  const account = () => { try { return JSON.parse(get('cuttory_account') || 'null'); } catch { return null; } };
  const token = () => get('cuttory_token') || '';

  let state = 'idle', lastErr = '', timer = null, ui = null;
  const setState = (s, msg) => { state = s; lastErr = msg || ''; paint(); };

  // ----- 서버와 주고받기 -----
  async function call(path, opt) {
    const r = await fetch(API + path, { ...opt, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token(), ...(opt && opt.headers) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.message || '서버에 연결하지 못했어요.'), { code: j.code, status: r.status });
    return j;
  }
  function adopt(app, row) {
    const key = APPS[app], cur = get(key);
    put(key, row.data); put(tKey(app), String(row.t)); put(dirtyKey(app), null);
    return cur !== row.data;
  }
  function reloadOnce(why) {
    try { if (sessionStorage.getItem('ct-sync-reload') === why) return; sessionStorage.setItem('ct-sync-reload', why); } catch { return; }
    location.reload();
  }
  async function push(app) {
    const data = get(APPS[app]);
    if (data == null) { put(dirtyKey(app), null); return; }
    const t = +get(tKey(app)) || Date.now();
    const j = await call('/api/data?app=' + app, { method: 'POST', body: JSON.stringify({ data, t }) });
    if (j.stale && typeof j.data === 'string') { if (adopt(app, j) && app === PAGE_APP) reloadOnce('stale:' + j.t); }
    else { put(tKey(app), String(j.t || t)); put(dirtyKey(app), null); }
  }
  async function flush() {
    clearTimeout(timer); timer = null;
    if (!account() || !API) return;
    const apps = Object.keys(APPS).filter(a => get(dirtyKey(a)));
    if (!apps.length) return;
    setState('saving'); lastPush = Date.now();
    try { for (const a of apps) await push(a); setState('saved'); }
    catch (e) { setState('error', e.message); if (e.status === 401 || e.code === 'login_required') logoutLocal(false); }
  }
  async function pull(first) {
    if (!account() || !API) return;
    setState('saving');
    try {
      const { apps } = await call('/api/data');
      let pageChanged = false;
      for (const a of Object.keys(APPS)) {
        const row = apps && apps[a], local = get(APPS[a]), localT = +get(tKey(a)) || 0;
        if (row && typeof row.data === 'string' && row.t > localT) {
          if (first && local != null && local !== row.data) put(APPS[a] + '.before-login', local);
          if (adopt(a, row) && a === PAGE_APP) pageChanged = true;
        } else if (local != null && (!row || get(dirtyKey(a)) || localT > row.t)) {
          if (!localT) put(tKey(a), String(Date.now()));
          put(dirtyKey(a), '1');
        }
      }
      await flush();
      setState('saved');
      if (pageChanged) reloadOnce('pull:' + Date.now().toString().slice(0, -4));
    } catch (e) {
      setState('error', e.message);
      if (e.status === 401 || e.code === 'login_required') logoutLocal(false);
    }
  }

  // 페이지가 저장할 때마다(localStorage에 쓸 때마다) 표시해 두고 잠시 뒤 서버로 보내요.
  // 무료 저장소는 하루 쓰기 횟수가 정해져 있어서, 내용이 바뀐 경우에만 모아서 1분에 한 번 넘지 않게 보내요.
  let lastPush = 0;
  function mark(k) {
    const a = KEY_APP[k]; if (!a || !account()) return;
    put(tKey(a), String(Date.now())); put(dirtyKey(a), '1');
    if (!timer) timer = setTimeout(flush, Math.max(4000, lastPush + 60000 - Date.now()));
    if (state !== 'saving') setState('pending');
  }
  Storage.prototype.setItem = function (k, v) {
    const watch = this === LS && KEY_APP[k];
    const before = watch ? get(k) : null;
    rawSet.call(this, k, v);
    if (watch && before !== String(v)) mark(String(k));
  };
  Storage.prototype.removeItem = function (k) {
    const watch = this === LS && KEY_APP[k] && get(k) != null;
    rawRemove.call(this, k);
    if (watch) mark(String(k));
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); else pull(false); });
  window.addEventListener('pagehide', () => { flush(); });

  // ----- 로그인 -----
  let cfg = null;
  async function config() {
    if (cfg) return cfg;
    try { cfg = JSON.parse(sessionStorage.getItem('ct-config') || 'null'); } catch {}
    if (cfg) return cfg;
    try { cfg = await (await fetch(API + '/api/config')).json(); sessionStorage.setItem('ct-config', JSON.stringify(cfg)); } catch { cfg = {}; }
    return cfg;
  }
  let gisP = null;
  const loadGis = () => gisP ||= new Promise((res, rej) => {
    if (window.google && google.accounts && google.accounts.id) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gisP = null; rej(new Error('구글 로그인 창을 불러오지 못했어요.')); };
    document.head.appendChild(s);
  });
  async function onCredential(resp) {
    setState('saving');
    try {
      const j = await call('/api/login/google', { method: 'POST', body: JSON.stringify({ credential: resp.credential }) });
      put('cuttory_token', j.token);
      put('cuttory_account', JSON.stringify(j.account || {}));
      for (const a of Object.keys(APPS)) { put(tKey(a), null); put(dirtyKey(a), null); }
      await pull(true);
      try { sessionStorage.removeItem('ct-sync-reload'); } catch {}
      location.reload();
    } catch (e) { setState('error', e.message); }
  }
  async function renderGoogle(box) {
    box.textContent = '불러오는 중…';
    try {
      const c = await config();
      if (!c.google) { box.textContent = '아직 로그인 설정이 끝나지 않았어요.'; return; }
      await loadGis();
      google.accounts.id.initialize({ client_id: c.google, callback: onCredential, ux_mode: 'popup', auto_select: false });
      box.textContent = '';
      google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'ko', width: 240 });
    } catch (e) { box.textContent = e.message; }
  }
  function logoutLocal(wipe) {
    put('cuttory_account', null); put('cuttory_token', null);
    for (const a of Object.keys(APPS)) { put(tKey(a), null); put(dirtyKey(a), null); if (wipe) put(APPS[a], null); }
    paint();
  }
  async function logout() {
    const wipe = confirm('로그아웃할게요.\n\n이 기기에 남은 작업도 지울까요? 계정에는 그대로 저장돼 있어서 다시 로그인하면 돌아와요.\n\n[확인] 이 기기에서 지우기  [취소] 남겨 두기');
    await flush().catch(() => {});
    logoutLocal(wipe);
    location.reload();
  }

  // ----- 화면 -----
  const CSS = `
.ct-acct{position:relative;display:inline-flex}.ct-acct[hidden]{display:none}
.ct-acct-btn{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:7px 14px;font:800 13.5px/1 "Pretendard",system-ui,sans-serif;background:var(--ct-pill,#15161a);color:var(--ct-pill-ink,#fff);cursor:pointer;white-space:nowrap}
.ct-acct-btn.in{background:var(--ct-card,#f4f5f7);color:var(--ct-ink,#15161a);padding:4px 10px 4px 4px}
.ct-acct-av{width:24px;height:24px;border-radius:50%;background:var(--ct-hl,#f2c94c) center/cover;display:grid;place-items:center;font-size:12px;font-weight:900;color:#15161a}
.ct-acct-dot{width:7px;height:7px;border-radius:50%;background:#2fb36b}
.ct-acct-dot.pending,.ct-acct-dot.saving{background:#f2c94c}.ct-acct-dot.error{background:#e5484d}
.ct-acct-pop{position:absolute;right:0;top:calc(100% + 8px);z-index:60;width:min(300px,calc(100vw - 32px));background:var(--ct-bg,#fff);color:var(--ct-ink,#15161a);border:1px solid var(--ct-line,#e7e8ec);border-radius:18px;box-shadow:0 16px 40px rgba(0,0,0,.14);padding:16px;font:500 14px/1.5 "Pretendard",system-ui,sans-serif;text-align:left}
.ct-acct-pop[hidden]{display:none}
.ct-acct-pop h3{margin:0 0 4px;font-size:16px;font-weight:900}
.ct-acct-pop p{margin:0 0 12px;color:var(--ct-sub,#6b6f78);font-size:13px;word-break:keep-all}
.ct-acct-pop .g{min-height:44px;display:flex;justify-content:center;align-items:center;color:var(--ct-sub,#6b6f78);font-size:13px}
.ct-acct-pop .row{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.ct-acct-pop .row b{display:block;font-size:15px}.ct-acct-pop .row span{font-size:12.5px;color:var(--ct-sub,#6b6f78);word-break:break-all}
.ct-acct-pop .st{font-size:13px;margin:0 0 12px;color:var(--ct-sub,#6b6f78)}
.ct-acct-pop .out{width:100%;border:0;border-radius:999px;padding:10px;background:var(--ct-card,#f4f5f7);color:var(--ct-ink,#15161a);font-weight:800;cursor:pointer}
@media (max-width:760px){.ct-acct-btn{padding:6px 12px;font-size:13px}}`;
  const ST = { idle: '계정에 저장돼요', pending: '곧 저장해요…', saving: '저장하는 중…', saved: '계정에 저장했어요', error: '저장하지 못했어요' };
  function paint() {
    if (!ui) return;
    const acc = account();
    ui.btn.className = 'ct-acct-btn' + (acc ? ' in' : '');
    if (acc) {
      const name = acc.name || (acc.email || '').split('@')[0] || '나';
      ui.btn.innerHTML = '';
      const av = document.createElement('span'); av.className = 'ct-acct-av';
      if (acc.picture) av.style.backgroundImage = `url("${acc.picture.replace(/"/g, '')}")`; else av.textContent = name.slice(0, 1);
      const nm = document.createElement('span'); nm.textContent = name.length > 6 ? name.slice(0, 6) + '…' : name;
      const dot = document.createElement('span'); dot.className = 'ct-acct-dot ' + state; dot.title = ST[state];
      ui.btn.append(av, nm, dot);
      ui.btn.setAttribute('aria-label', `${name} 계정 · ${ST[state]}`);
    } else { ui.btn.textContent = '로그인'; ui.btn.setAttribute('aria-label', '구글로 로그인'); }
    if (!ui.pop.hidden) fillPop();
  }
  function fillPop() {
    const acc = account(), pop = ui.pop;
    pop.innerHTML = '';
    if (acc) {
      const row = document.createElement('div'); row.className = 'row';
      const av = ui.btn.querySelector('.ct-acct-av').cloneNode(true); av.style.width = av.style.height = '40px';
      const who = document.createElement('div'); const b = document.createElement('b'); b.textContent = acc.name || '내 계정';
      const em = document.createElement('span'); em.textContent = acc.email || ''; who.append(b, em); row.append(av, who);
      const st = document.createElement('p'); st.className = 'st'; st.textContent = (state === 'error' ? ST.error + ': ' + lastErr : ST[state]) + ' · 오피스 기록, 카드뉴스, 포트폴리오, AI 영상 기획, 크레딧이 어느 기기에서든 이어져요.';
      const out = document.createElement('button'); out.className = 'out'; out.textContent = '로그아웃'; out.onclick = logout;
      pop.append(row, st, out);
    } else {
      const h = document.createElement('h3'); h.textContent = '구글로 로그인';
      const p = document.createElement('p'); p.textContent = '로그인하면 지금까지 한 작업과 크레딧이 내 계정에 저장돼요. 휴대폰이나 다른 컴퓨터에서도 그대로 이어서 할 수 있어요.';
      const g = document.createElement('div'); g.className = 'g';
      pop.append(h, p, g); renderGoogle(g);
    }
  }
  function mount() {
    const head = document.querySelector('header.ct-top, .ct-top, .l-top');
    if (!head) return;
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const wrap = document.createElement('div'); wrap.className = 'ct-acct';
    const btn = document.createElement('button'); btn.type = 'button';
    const pop = document.createElement('div'); pop.className = 'ct-acct-pop'; pop.hidden = true; pop.setAttribute('role', 'dialog');
    wrap.append(btn, pop);
    btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; if (!pop.hidden) fillPop(); };
    pop.onclick = (e) => e.stopPropagation();
    document.addEventListener('click', () => { pop.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pop.hidden = true; });
    let right = head.querySelector('.ct-right');
    if (head.classList.contains('l-top')) head.insertBefore(wrap, head.querySelector('.l-btn'));
    else { if (!right) { right = document.createElement('div'); right.className = 'ct-right'; head.appendChild(right); } right.appendChild(wrap); }
    ui = { wrap, btn, pop };
    wrap.hidden = true;
    paint();
    // 서버에 구글 설정이 있을 때만 버튼을 보여요. 이미 로그인한 사람은 항상 보여요.
    if (account()) wrap.hidden = false;
    else config().then(c => { wrap.hidden = !c.google; });
  }

  if (!API) return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  if (account()) pull(false);
  window.CuttoryAccount = { account, flush, pull, logout };
})();
