/* Personal blog tone, original photo + memo page. No source text is persisted locally. */
(function () {
  'use strict';
  const bsAPI = String(window.CUTTORY_API || '').replace(/\/$/, '');
  const bsState = { profile: null, config: null, setup: '', error: '', notice: '', busy: '', sources: null, reviewed: false, identity: '', epoch: 0, consent: false, editing: false };
  const bsRequests = new Set();
  let bsMount, bsDialog, bsBody, bsStatus, bsForm, bsSourceUI, bsReviewUI, bsReturnFocus, bsExpiryTimer, bsReload, bsStarted = false, bsMountMissing = false;
  let bsResolveReady;
  const bsReadyPromise = new Promise(resolve => { bsResolveReady = resolve; });

  function bsGet(key) { try { return localStorage.getItem(key) || ''; } catch (_) { return ''; } }
  function bsAuth() {
    let account = null;
    try { account = window.CuttoryAccount && window.CuttoryAccount.account ? window.CuttoryAccount.account() : JSON.parse(bsGet('cuttory_account') || 'null'); } catch (_) {}
    const token = bsGet('cuttory_token');
    const identity = account && token ? JSON.stringify([account.id || account.sub || '', account.email || '', account.google || '', token]) : '';
    return { account, token, identity };
  }
  function bsNode(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function bsButton(text, action, primary) {
    const button = bsNode('button', 'bs-button' + (primary ? ' bs-primary' : ''), text);
    button.type = 'button';
    button.addEventListener('click', action);
    return button;
  }
  function bsText(value, max) { return typeof value === 'string' ? value.slice(0, max || 1000) : ''; }
  function bsSafeURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['blog.naver.com', 'm.blog.naver.com'].includes(url.hostname)) return null;
      return url;
    } catch (_) { return null; }
  }
  function bsBlog(value) {
    const url = bsSafeURL(value);
    if (!url) return null;
    let id = '';
    const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/);
    if (match && !/\.naver$/i.test(match[1])) id = match[1];
    else if (/^\/(PostList|PostView)\.naver$/i.test(url.pathname)) id = url.searchParams.get('blogId') || '';
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id)) return null;
    return { id: id.toLowerCase(), url: 'https://blog.naver.com/' + id };
  }
  function bsPost(value, blogId) {
    const url = bsSafeURL(value);
    if (!url) return null;
    const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/(\d+)\/?$/);
    let id, post;
    if (match) { id = match[1]; post = match[2]; }
    else if (/^\/PostView\.naver$/i.test(url.pathname)) { id = url.searchParams.get('blogId'); post = url.searchParams.get('logNo'); }
    if (!id || !/^\d+$/.test(post || '') || id.toLowerCase() !== String(blogId).toLowerCase()) return null;
    return 'https://blog.naver.com/' + id + '/' + post;
  }
  function bsProfile(value) {
    if (!value || typeof value !== 'object') return null;
    const blog = bsBlog(value.blogUrl);
    if (!blog || !bsText(value.nickname, 30).trim()) throw new Error('서버의 블로그 프로필을 확인하지 못했어요. 다시 불러와 주세요.');
    const rawStyle = value.style && typeof value.style === 'object' ? value.style : null;
    const style = rawStyle ? { summary: bsText(rawStyle.summary, 2000), rules: Array.isArray(rawStyle.rules) ? rawStyle.rules.slice(0, 12).map(v => bsText(v, 500)).filter(Boolean) : [] } : null;
    if (style) ['formality', 'endings', 'paragraphs', 'lineBreaks', 'emojiFrequency', 'opening', 'closing'].forEach(key => {
      if (typeof rawStyle[key] === 'string') style[key] = bsText(rawStyle[key], 1000);
      else if (Array.isArray(rawStyle[key])) style[key] = rawStyle[key].slice(0, 12).map(value => bsText(value, 500)).filter(Boolean);
    });
    const sources = Array.isArray(value.sources) ? value.sources.slice(0, 5).map(source => ({ url: bsPost(source.url, blog.id), title: bsText(source.title, 200), chars: Number(source.chars) || 0, method: bsText(source.method, 30) })).filter(source => source.url) : [];
    return { nickname: bsText(value.nickname, 30), blogUrl: blog.url, blogId: blog.id, status: value.status === 'ready' && style && style.summary ? 'ready' : 'untrained', style, learnedAt: value.learnedAt || null, sourceCount: Number(value.sourceCount) || sources.length, sources };
  }
  function bsIsReady() { return !bsState.setup && !!bsState.identity && bsState.profile && bsState.profile.status === 'ready'; }
  function bsEmit() {
    const auth = bsAuth();
    const current = auth.identity === bsState.identity;
    const accountKey = auth.account ? String(auth.account.id || auth.account.email || '') : '';
    window.dispatchEvent(new CustomEvent('cuttory:blog-style-ready', { detail: {
      accountKey,
      profile: current ? bsCopyProfile() : null,
      ready: current && !!bsIsReady()
    } }));
  }
  function bsCopyProfile() { return bsState.profile ? JSON.parse(JSON.stringify(bsState.profile)) : null; }
  function bsGuard(epoch, identity) {
    if (bsAuth().identity !== bsState.identity) { bsRefresh(); throw new DOMException('계정이 바뀌었어요.', 'AbortError'); }
    if (epoch !== bsState.epoch || identity !== bsState.identity) throw new DOMException('이전 요청이에요.', 'AbortError');
  }
  async function bsCall(endpoint, body, anonymous) {
    const epoch = bsState.epoch, auth = bsAuth();
    bsGuard(epoch, auth.identity);
    if (!anonymous && !auth.identity) throw new Error('구글 로그인 후 사용할 수 있어요.');
    const controller = new AbortController();
    bsRequests.add(controller);
    const timeout = setTimeout(() => controller.abort('timeout'), endpoint.endsWith('/analyze') ? 100000 : 45000);
    try {
      const headers = { 'content-type': 'application/json' };
      if (!anonymous) headers.authorization = 'Bearer ' + auth.token;
      const response = await fetch(bsAPI + endpoint, { method: body === undefined ? 'GET' : 'POST', headers, signal: controller.signal, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json().catch(() => ({}));
      bsGuard(epoch, auth.identity);
      if (!response.ok) throw Object.assign(new Error(bsText(data.message, 500) || '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.'), { code: data.code, status: response.status });
      return data;
    } catch (error) {
      if (controller.signal.reason === 'timeout') throw new Error(endpoint.endsWith('/analyze') ? '응답을 기다리는 시간이 길어졌어요. 바로 다시 결제하지 말고 설정을 다시 열어 분석 결과를 먼저 확인해 주세요.' : '연결 시간이 길어졌어요. 잠시 뒤 다시 시도해 주세요.');
      throw error;
    } finally { clearTimeout(timeout); bsRequests.delete(controller); }
  }
  function bsClearSources() {
    clearTimeout(bsExpiryTimer);
    bsState.sources = null; bsState.reviewed = false;
  }
  function bsDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(date) : '날짜 정보 없음';
  }
  function bsCost() { return bsState.config && Number(bsState.config.blogStyle.cost); }
  function bsMethod(value) { return value === 'pasted' ? '직접 붙여넣은 본문' : value === 'rss' ? '공개 RSS 본문' : ['fetch', 'html', 'mobile', 'article'].includes(value) ? '서버에서 읽은 본문' : '수집 방식: ' + (value || '정보 없음'); }
  function bsPanel() {
    if (!bsMount) return;
    bsMount.replaceChildren();
    const line = bsNode('div', 'bs-compact');
    const copy = bsNode('div', 'bs-compact-copy');
    let label = '내 글 3~5개로 말투를 설정해요';
    if (bsState.busy === 'load') label = '내 블로그 말투 확인 중…';
    else if (bsState.setup) label = bsState.setup;
    else if (!bsState.identity) label = '구글 로그인 후 내 블로그 말투를 저장해요';
    else if (bsIsReady()) label = bsState.profile.nickname + '님의 말투 · ' + bsState.profile.sourceCount + '개 글 분석 완료';
    else if (bsState.profile) label = '블로그 등록 완료 · 아직 말투 분석 전이에요';
    const text = bsNode('span', 'bs-compact-label', label);
    copy.append(text);
    if (bsIsReady()) copy.append(bsNode('small', '', bsDate(bsState.profile.learnedAt)));
    const settings = bsButton('설정', bsOpen);
    settings.setAttribute('aria-haspopup', 'dialog');
    line.append(copy, settings); bsMount.append(line);
    const personal = document.getElementById('personal-tone');
    if (personal) { personal.setAttribute('aria-describedby', 'blog-style-panel'); personal.dataset.ready = String(!!bsIsReady()); }
  }
  function bsMessage() {
    if (!bsStatus) return;
    bsStatus.textContent = bsState.error || bsState.notice || (bsState.busy ? ({ load: '프로필을 확인하고 있어요…', save: '블로그를 등록하고 있어요…', sources: '공개 글 본문을 모으고 있어요. 크레딧은 사용하지 않아요.', analyze: '말투 특징을 분석하고 있어요. 잠시만 기다려 주세요.' }[bsState.busy] || '') : '');
    bsStatus.classList.toggle('bs-error', !!bsState.error);
    bsStatus.setAttribute('role', bsState.error ? 'alert' : 'status');
  }
  function bsEnable() {
    if (!bsBody) return;
    if (bsReload) bsReload.disabled = !!bsState.busy;
    bsBody.querySelectorAll('[data-bs-lock]').forEach(node => { node.disabled = !!bsState.busy; });
    if (bsForm) bsForm.save.disabled = !!bsState.busy || !bsForm.consent.checked;
    if (bsSourceUI) bsSourceUI.collect.disabled = !!bsState.busy || !bsState.consent || !bsMatchesProfile();
    if (bsReviewUI) {
      const set = bsState.sources;
      const valid = set && set.expiresAt > Date.now() && set.sources.length >= 3 && set.sources.length <= 5;
      bsReviewUI.analyze.disabled = !!bsState.busy || !valid || !bsState.reviewed || !bsState.consent || !bsMatchesProfile();
      bsReviewUI.review.disabled = !!bsState.busy;
    }
    bsMessage(); bsPanel();
  }
  function bsMatchesProfile() {
    if (!bsForm || !bsState.profile) return false;
    const blog = bsBlog(bsForm.blog.value.trim());
    return !!blog && blog.id === bsState.profile.blogId && bsForm.nickname.value.trim() === bsState.profile.nickname;
  }
  function bsFail(error) {
    if (error.name === 'AbortError') return;
    if (error.status === 401 || ['login_required', 'google_required', 'google_login_required'].includes(error.code)) {
      bsState.profile = null; bsClearSources(); bsState.consent = false;
      bsState.error = '구글 로그인을 다시 확인해 주세요. 담백한 기록과 정보 위주는 계속 쓸 수 있어요.';
      bsEmit(); bsRender(); return;
    }
    if (error.status === 404 || error.status === 405 || ['feature_unavailable', 'not_supported'].includes(error.code)) {
      bsState.setup = '서버 설정 필요: 블로그 말투 기능이 아직 배포되지 않았어요.'; bsEmit(); bsRender();
    }
    if (/expir/i.test(error.code || '')) { bsClearSources(); if (bsReviewUI) bsPaintReview(); }
    bsState.error = error.message || '처리하지 못했어요. 다시 시도해 주세요.';
  }
  async function bsRun(kind, action) {
    if (bsState.busy) return;
    const epoch = bsState.epoch;
    bsState.busy = kind; bsState.error = ''; bsState.notice = ''; bsEnable();
    try { await action(); } catch (error) { if (epoch === bsState.epoch) bsFail(error); }
    finally { if (epoch === bsState.epoch) { bsState.busy = ''; bsEnable(); } }
  }
  function bsLinkList(sources, excerpts) {
    const list = bsNode('ol', 'bs-sources');
    sources.forEach(source => {
      const item = bsNode('li', 'bs-source');
      const link = bsNode('a', '', source.title || source.url);
      link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      item.append(link, bsNode('small', 'bs-source-url', source.url), bsNode('small', 'bs-source-meta', bsMethod(source.method) + ' · 본문 ' + source.chars.toLocaleString('ko-KR') + '자'));
      if (excerpts && source.excerpt) item.append(bsNode('p', 'bs-excerpt', source.excerpt));
      list.append(item);
    });
    return list;
  }
  function bsField(label, type, value, placeholder) {
    const wrap = bsNode('label', 'bs-field');
    const input = bsNode(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.value = value || ''; input.placeholder = placeholder || '';
    input.dataset.bsLock = '1';
    wrap.append(bsNode('span', '', label), input);
    return { wrap, input };
  }
  function bsCheck(text, action) {
    const wrap = bsNode('label', 'bs-check');
    const input = bsNode('input'); input.type = 'checkbox'; input.dataset.bsLock = '1';
    input.addEventListener('change', action); wrap.append(input, bsNode('span', '', text));
    return { wrap, input };
  }
  function bsRender() {
    if (!bsBody) return;
    bsForm = bsSourceUI = bsReviewUI = null;
    bsBody.replaceChildren();
    if (bsState.setup) {
      bsBody.append(bsNode('p', 'bs-notice', bsState.setup), bsNode('p', 'bs-muted', '개인 말투는 현재 사용할 수 없어요. 담백한 기록·정보 위주와 사진 + 메모 글쓰기는 그대로 이용할 수 있어요.'), bsButton('설정 다시 확인', () => bsRefresh()));
    } else if (bsState.busy === 'load') {
      bsBody.append(bsNode('p', 'bs-muted', '로그인과 내 블로그 설정을 확인하고 있어요.'));
    } else if (!bsState.identity) {
      bsBody.append(bsNode('p', '', '구글 로그인 후 닉네임과 내 네이버 블로그를 등록해요. 내 계정에만 말투를 저장해요.'));
      const login = bsButton('구글로 로그인', () => {
        if (window.CuttoryAccount && typeof window.CuttoryAccount.openLogin === 'function') { bsDialog.close(); window.CuttoryAccount.openLogin(); }
        else { bsState.error = '로그인 연결 설정이 필요해요. 상단 로그인 버튼을 이용해 주세요.'; bsMessage(); }
      }, true);
      bsBody.append(login);
    } else if (bsIsReady() && !bsState.editing) {
      const profile = bsState.profile;
      bsBody.append(bsNode('p', 'bs-kicker', profile.nickname + '님의 내 블로그 말투'), bsNode('p', 'bs-learned-summary', profile.style.summary));
      if (profile.style.rules.length) {
        const rules = bsNode('ul', 'bs-rules'); profile.style.rules.forEach(rule => rules.append(bsNode('li', '', rule))); bsBody.append(rules);
      }
      bsBody.append(bsNode('p', 'bs-muted', profile.sourceCount + '개 글 · 분석일 ' + bsDate(profile.learnedAt)), bsLinkList(profile.sources, false));
      bsBody.append(bsButton('말투 다시 분석 / 블로그 수정', () => { bsState.editing = true; bsState.consent = false; bsState.error = ''; bsState.notice = ''; bsClearSources(); bsRender(); }));
      bsBody.append(bsNode('p', 'bs-footnote', '다시 분석할 때도 글 확인 후 크레딧 사용을 직접 선택해요. 실패하면 기존 말투를 유지해요.'));
    } else {
      bsBuildSetup();
    }
    bsMessage(); bsPanel(); bsEnable();
  }
  function bsBuildSetup() {
    const profile = bsState.profile;
    if (profile && profile.status === 'ready') bsBody.append(bsNode('p', 'bs-notice', '새 분석이 완료되기 전까지 기존 말투는 유지돼요. 블로그 주소를 바꾸어 저장하면 기존 말투는 해제돼요.'));
    const section = bsNode('section', 'bs-section');
    section.append(bsNode('h4', '', '1. 내 블로그 등록 · 무료'));
    const nickname = bsField('닉네임', 'text', profile && profile.nickname, '글에 쓸 닉네임'); nickname.input.maxLength = 30; nickname.input.autocomplete = 'nickname';
    const blog = bsField('네이버 블로그 주소', 'url', profile && profile.blogUrl, 'https://blog.naver.com/내아이디'); blog.input.autocomplete = 'url'; blog.input.spellcheck = false;
    const consent = bsCheck('내가 작성한 블로그 글이며, 말투 특징 추출을 위해 선택한 글 본문을 AI로 처리하는 데 동의해요.', () => {
      bsState.consent = consent.input.checked; bsState.reviewed = false;
      if (bsReviewUI) bsReviewUI.review.checked = false;
      bsEnable();
    });
    consent.input.checked = bsState.consent;
    const save = bsButton('블로그 등록 저장 · 무료', () => bsRun('save', async () => {
      const name = nickname.input.value.trim(), ownBlog = bsBlog(blog.input.value.trim());
      if (!name || name.length > 30) throw new Error('닉네임을 1~30자로 입력해 주세요.');
      if (!ownBlog) throw new Error('내 네이버 블로그 홈 주소를 입력해 주세요. 예: https://blog.naver.com/내아이디');
      if (!consent.input.checked) throw new Error('내 글과 AI 처리 동의를 확인해 주세요.');
      const response = await bsCall('/api/blog/profile', { nickname: name, blogUrl: ownBlog.url, consent: true });
      const next = bsProfile(response.profile);
      if (!next) throw new Error('등록 결과를 확인하지 못했어요. 다시 확인해 주세요.');
      bsState.profile = next; bsClearSources(); bsState.notice = '블로그를 등록했어요. 이제 분석할 글을 모아 확인해 주세요.'; bsEmit(); bsRender();
    }));
    save.dataset.bsLock = '1';
    bsForm = { nickname: nickname.input, blog: blog.input, consent: consent.input, save };
    const changed = () => { bsClearSources(); bsState.notice = '변경한 내용을 먼저 저장해 주세요.'; bsPaintReview(); bsEnable(); };
    nickname.input.addEventListener('input', changed); blog.input.addEventListener('input', changed);
    section.append(nickname.wrap, blog.wrap, consent.wrap, save);
    bsBody.append(section);
    bsBuildSources();
  }
  function bsBuildSources() {
    const section = bsNode('section', 'bs-section');
    section.append(bsNode('h4', '', '2. 글 3~5개 모으기 · 무료'), bsNode('p', 'bs-muted', '등록한 같은 블로그의 공개 글만 사용해요. 글마다 본문 300자 이상이 필요해요.'));
    const advanced = bsNode('details', 'bs-advanced');
    advanced.append(bsNode('summary', '', '직접 글 링크 / 읽기 차단 시 본문 붙여넣기 (선택)'));
    const mode = bsNode('select'); mode.setAttribute('aria-label', '글 수집 방식'); mode.dataset.bsLock = '1';
    [['auto', '공개 글 자동 찾기'], ['urls', '글 링크 직접 지정'], ['paste', '본문 직접 붙여넣기']].forEach(([value, label]) => { const option = bsNode('option', '', label); option.value = value; mode.append(option); });
    const urls = bsField('글 링크 3~5개 (한 줄에 하나)', 'textarea', '', 'https://blog.naver.com/내아이디/글번호'); urls.input.maxLength = 4000;
    const pasted = bsNode('div', 'bs-pasted');
    pasted.append(bsNode('p', 'bs-muted', '네이버 읽기가 차단되면 본문만 붙여넣어 주세요. 자동으로 읽은 글이 아니라 ‘직접 붙여넣은 본문’으로 표시해요. 최대 6,000자씩, 3~5개예요.'));
    const rows = [], list = bsNode('div', 'bs-sample-list');
    const add = bsButton('본문 한 개 더 추가', () => { if (rows.length < 5) addRow(); }); add.dataset.bsLock = '1';
    function addRow() {
      const row = bsNode('div', 'bs-sample');
      const url = bsField('원문 글 링크', 'url', '', '등록한 블로그의 글 링크'); url.input.maxLength = 1000;
      const text = bsField('내가 쓴 글 본문 (300~6,000자)', 'textarea', '', '제목·메뉴·댓글을 제외한 본문만 붙여넣기'); text.input.maxLength = 6000;
      const record = { row, url: url.input, text: text.input };
      const remove = bsButton('이 본문 빼기', () => { rows.splice(rows.indexOf(record), 1); row.remove(); invalidate(); add.hidden = false; }); remove.dataset.bsLock = '1';
      [url.input, text.input].forEach(input => input.addEventListener('input', invalidate));
      row.append(url.wrap, text.wrap, remove); rows.push(record); list.append(row); add.hidden = rows.length >= 5;
    }
    function invalidate() { bsClearSources(); bsPaintReview(); bsEnable(); }
    addRow(); addRow(); addRow(); pasted.append(list, add);
    const switchMode = () => { urls.wrap.hidden = mode.value !== 'urls'; pasted.hidden = mode.value !== 'paste'; invalidate(); };
    mode.addEventListener('change', switchMode); urls.input.addEventListener('input', invalidate);
    urls.wrap.hidden = pasted.hidden = true;
    advanced.append(mode, urls.wrap, pasted);
    const collect = bsButton('내 블로그 글 모으기 · 무료', () => bsRun('sources', async () => {
      if (!bsMatchesProfile() || !bsState.consent) throw new Error('블로그를 먼저 저장하고 AI 처리 동의를 확인해 주세요.');
      const id = bsState.profile.blogId;
      const body = {};
      if (mode.value === 'urls') {
        const links = urls.input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        if (links.length < 3 || links.length > 5) throw new Error('글 링크를 3~5개 입력해 주세요.');
        body.postUrls = links.map(link => { const parsed = bsPost(link, id); if (!parsed) throw new Error('모든 링크는 등록한 네이버 블로그의 글이어야 해요.'); return parsed; });
        if (new Set(body.postUrls).size !== links.length) throw new Error('중복되지 않은 글 링크를 입력해 주세요.');
      } else if (mode.value === 'paste') {
        const filled = rows.filter(row => row.url.value.trim() || row.text.value.trim());
        if (filled.length < 3 || filled.length > 5) throw new Error('서로 다른 글의 링크와 본문을 3~5개 입력해 주세요.');
        body.samples = filled.map(row => {
          const url = bsPost(row.url.value.trim(), id), text = row.text.value.trim();
          if (!url) throw new Error('붙여넣은 글의 원문 링크는 등록한 블로그여야 해요.');
          if (text.replace(/\s/g, '').length < 300 || text.length > 6000) throw new Error('글마다 공백을 제외한 본문 300자 이상, 최대 6,000자로 입력해 주세요.');
          return { url, text };
        });
        if (new Set(body.samples.map(sample => sample.url)).size !== filled.length) throw new Error('같은 글을 중복해서 사용할 수 없어요.');
      }
      bsClearSources(); bsPaintReview();
      const response = await bsCall('/api/blog/sources', body);
      if (Number(response.analysisCost) !== bsCost()) throw new Error('분석 크레딧 설정이 변경됐어요. 설정 다시 확인 후 글을 다시 모아 주세요.');
      const sources = Array.isArray(response.sources) ? response.sources.map(source => ({ url: bsPost(source.url, id), title: bsText(source.title, 200), chars: Number(source.chars), method: bsText(source.method, 30), excerpt: bsText(source.excerpt, 1000) })) : [];
      const expiresAt = typeof response.expiresAt === 'number' ? (response.expiresAt < 100000000000 ? response.expiresAt * 1000 : response.expiresAt) : Date.parse(response.expiresAt);
      if (!response.sourceSetId || sources.length < 3 || sources.length > 5 || sources.some(source => !source.url || !Number.isFinite(source.chars) || source.chars < 300) || new Set(sources.map(source => source.url)).size !== sources.length || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('분석 가능한 같은 블로그 글 3~5개를 확인하지 못했어요. 직접 링크나 본문 입력을 이용해 주세요.');
      bsState.sources = { sourceSetId: response.sourceSetId, sources, expiresAt, cost: bsCost() }; bsState.reviewed = false;
      bsExpiryTimer = setTimeout(() => { bsState.reviewed = false; bsState.notice = '글 확인 시간이 만료됐어요. 무료로 글을 다시 모아 주세요.'; bsPaintReview(); bsEnable(); }, Math.min(expiresAt - Date.now() + 50, 2147483647));
      bsState.notice = '아래 원문 링크와 본문 발췌를 확인한 다음 분석을 선택해 주세요.';
      bsPaintReview();
    }));
    collect.dataset.bsLock = '1';
    const reviewArea = bsNode('div', 'bs-review-area');
    bsSourceUI = { collect, reviewArea };
    section.append(advanced, collect, reviewArea); bsBody.append(section); bsPaintReview();
  }
  function bsPaintReview() {
    if (!bsSourceUI) return;
    const area = bsSourceUI.reviewArea; area.replaceChildren(); bsReviewUI = null;
    const set = bsState.sources;
    if (!set) return;
    area.append(bsNode('h4', '', '3. 분석할 글 확인 · ' + set.sources.length + '개'), bsLinkList(set.sources, true), bsNode('p', 'bs-muted', '확인 유효시간: ' + bsDate(set.expiresAt)));
    const review = bsCheck('위 글과 본문 발췌를 확인했어요. 이 글들로 내 말투를 분석할게요.', () => { bsState.reviewed = review.input.checked; bsEnable(); });
    review.input.checked = bsState.reviewed;
    const quote = bsNode('p', 'bs-quote', '말투 분석 1회 · ' + set.cost + '크레딧 (글 모으기·등록은 무료)');
    const analyze = bsButton(set.cost + '크레딧으로 말투 분석', () => bsRun('analyze', async () => {
      if (!bsState.reviewed || !bsState.consent || !bsMatchesProfile() || set !== bsState.sources || set.expiresAt <= Date.now()) throw new Error('분석할 글과 동의를 다시 확인해 주세요. 만료됐다면 글을 다시 모아 주세요.');
      // This is the only paid endpoint. Never invoke from login, source collection, ready, or generation guards.
      const response = await bsCall('/api/blog/analyze', { sourceSetId: set.sourceSetId, consent: true, confirmedCost: set.cost });
      const next = bsProfile(response.profile);
      if (!next || next.status !== 'ready' || next.blogId !== bsState.profile.blogId) throw new Error('분석 완료 결과를 확인하지 못했어요. 기존 말투는 바꾸지 않았어요. 설정을 다시 열어 확인해 주세요.');
      bsState.profile = next; bsState.editing = false; bsClearSources(); bsState.notice = '말투 특징을 저장했어요. 새 글에는 이번 사진과 메모의 사실만 반영해요.';
      bsEmit();
      if (Number.isFinite(Number(response.credits))) window.dispatchEvent(new CustomEvent('cuttory:credits-changed', { detail: { credits: Number(response.credits) } }));
      bsRender();
    }), true);
    analyze.dataset.bsLock = '1';
    area.append(review.wrap, quote, analyze);
    bsReviewUI = { review: review.input, analyze };
    bsEnable();
  }
  async function bsRefresh() {
    bsState.epoch++;
    bsRequests.forEach(controller => controller.abort()); bsRequests.clear();
    const epoch = bsState.epoch;
    bsState.identity = bsAuth().identity;
    bsState.profile = null; bsState.config = null; bsState.setup = ''; bsState.error = ''; bsState.notice = ''; bsState.busy = 'load'; bsState.consent = false; bsState.editing = false; bsClearSources();
    bsEmit(); bsRender();
    try {
      if (!bsAPI) { bsState.setup = '서버 설정 필요: API 주소가 연결되지 않았어요.'; return; }
      let config;
      try { config = await bsCall('/api/config', undefined, true); }
      catch (error) {
        if (error.name === 'AbortError') return;
        bsState.setup = error.status === 401 || error.status === 404 ? '서버 설정 필요: 블로그 말투 기능이 아직 배포되지 않았어요.' : '서버 설정을 확인할 수 없어요. 연결 후 다시 확인해 주세요.';
        return;
      }
      bsState.config = config;
      if (!config.features || config.features.blogStyle !== true || !config.blogStyle || !Number.isSafeInteger(Number(config.blogStyle.cost)) || Number(config.blogStyle.cost) <= 0) { bsState.setup = '서버 설정 필요: 블로그 말투 기능이 아직 준비되지 않았어요.'; return; }
      if (!config.google || typeof config.google !== 'string' || !config.google.trim()) { bsState.setup = '서버 설정 필요: Google 로그인 client ID가 등록되지 않았어요.'; return; }
      if (bsState.identity) {
        const response = await bsCall('/api/blog/profile');
        bsState.profile = bsProfile(response.profile);
        if (response.analysisCost !== undefined && Number(response.analysisCost) !== bsCost()) { bsState.setup = '서버 설정 필요: 분석 크레딧 설정이 일치하지 않아요.'; return; }
      }
    } catch (error) { if (epoch === bsState.epoch) bsFail(error); }
    finally {
      if (epoch === bsState.epoch) {
        bsState.busy = ''; bsEmit(); bsRender();
        if (bsState.identity && !bsState.profile && !bsState.setup && !bsState.error) bsOpen();
      }
    }
  }
  function bsSyncIdentity() {
    if (bsStarted && bsAuth().identity !== bsState.identity) { bsRefresh(); return false; }
    return true;
  }
  function bsOpen() {
    if (bsMountMissing) return;
    if (!bsStarted) { bsReadyPromise.then(bsOpen); return; }
    if (!bsSyncIdentity()) { /* Refresh paints a safe loading state. */ }
    if (!bsDialog.open) {
      bsReturnFocus = document.activeElement;
      bsRender();
      bsDialog.showModal();
      const target = bsBody.querySelector('input:not(:disabled), button:not(:disabled)');
      if (target) target.focus();
    } else bsMessage();
  }
  async function bsEnsurePersonal() {
    await bsReadyPromise;
    if (!bsSyncIdentity() || !bsIsReady()) { bsOpen(); return false; }
    return true;
  }
  function bsMountUI() {
    bsMount = document.getElementById('blog-style-panel');
    if (!bsMount) { bsMountMissing = true; bsResolveReady(); return; }
    bsStarted = true; bsMount.classList.add('bs-panel');
    bsDialog = bsNode('dialog', 'bs-dialog'); bsDialog.setAttribute('aria-labelledby', 'bs-dialog-title'); bsDialog.setAttribute('aria-describedby', 'bs-dialog-about');
    const header = bsNode('div', 'bs-dialog-head');
    const title = bsNode('h3', '', '내 블로그 말투'); title.id = 'bs-dialog-title';
    const close = bsButton('닫기', () => bsDialog.close()); close.setAttribute('aria-label', '내 블로그 말투 설정 닫기');
    header.append(title, close);
    const about = bsNode('p', 'bs-muted', '모델을 재학습시키는 기능이 아니라 내 글의 문장·말투 특징을 추출해요. 참고 글의 사실은 새 글에 복사하지 않아요.'); about.id = 'bs-dialog-about';
    bsBody = bsNode('div', 'bs-dialog-body'); bsStatus = bsNode('p', 'bs-status'); bsStatus.setAttribute('aria-live', 'polite'); bsStatus.setAttribute('aria-atomic', 'true');
    const retry = bsButton('설정 다시 불러오기', () => { if (!bsState.busy) bsRefresh(); }); retry.classList.add('bs-reload'); bsReload = retry;
    bsDialog.append(header, about, bsBody, bsStatus, retry); document.body.append(bsDialog);
    bsDialog.addEventListener('close', () => {
      // Drop pasted raw text on close unless an explicitly started request is still running.
      if (!bsState.busy) { bsBody.replaceChildren(); bsForm = bsSourceUI = bsReviewUI = null; bsState.consent = false; bsState.reviewed = false; }
      if (bsReturnFocus && bsReturnFocus.isConnected) bsReturnFocus.focus();
    });
    const personal = document.getElementById('personal-tone');
    if (personal) personal.addEventListener('click', () => { bsSyncIdentity(); if (!bsIsReady()) bsOpen(); });
    window.addEventListener('storage', event => { if (!event.key || ['cuttory_account', 'cuttory_token'].includes(event.key)) bsSyncIdentity(); });
    ['cuttory:account-change', 'cuttory:account-changed', 'cuttory:accountchange', 'cuttory:auth-change', 'accountchange'].forEach(name => window.addEventListener(name, () => { if (bsSyncIdentity()) bsRefresh(); }));
    window.addEventListener('focus', bsSyncIdentity);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) bsSyncIdentity(); });
    // Also observe same-tab token replacement by older account.js versions without auth events.
    setInterval(() => { if (!document.hidden) bsSyncIdentity(); }, 2000);
    bsRefresh().finally(bsResolveReady);
  }
  window.CuttoryBlogStyle = {
    ready: bsReadyPromise,
    ensurePersonal: bsEnsurePersonal,
    requestOptions: () => ({ blogPersonalStyle: true }),
    openSettings: bsOpen,
    getProfile: () => { bsSyncIdentity(); return bsCopyProfile(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bsMountUI, { once: true }); else bsMountUI();
})();
