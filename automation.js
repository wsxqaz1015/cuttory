/* Cuttory inline editorial helper. No network, publishing, link issuing, or AI calls.
 * Integration: init(host) once after DOM ready. Optional mount: #cuttory-automation-mount;
 * otherwise inserts before .inputs first child. Listen to cuttory:account-change and
 * cuttory:automation-context (host.getContext is always authoritative).
 * onPost(post, {request, accountKey}?) RETURNS A CLONE, never mutates the argument.
 * Capture a deep copy of getRequest() and accountKey before legacy generation.
 * Pass both on the first call; subsequent calls preserve embedded request metadata.
 * _automationRequest (null for experience), _automationAccountKey,
 * _automationTopicId and _automationGenerationId bind the resulting draft.
 * Repeated calls with the returned post do not reset publication status. Assign its return value
 * after shape and title generation, before render. It adds [광고] to title/titles,
 * the exact disclosure at intro top, and the original affiliate URL once at outro.
 * It snapshots the selected topic as draft, never as published. Re-run before export
 * if edited. Call preflight() immediately before every editor/export handoff.
 * Host must guard its own asynchronous generation against account switches too.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CuttoryAutomation = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const OFFICIAL = 'https://brandconnect.naver.com/about/creator';
  const DISCLOSURES = Object.freeze({
    shopping: '이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.',
    travel: '이 포스팅은 네이버 여행 커넥트 활동의 일환으로, 예약 발생 시 수수료를 제공받습니다.'
  });
  const STATES = Object.freeze({topic:'글감',draft:'초안',ready:'검토 완료','awaiting-publication':'직접 발행 대기','published-confirmed':'발행 확인'});
  const KINDS = {experience:'일반 경험',shopping:'쇼핑 커넥트',travel:'여행 커넥트'};
  const PREFIX = 'cuttory.blog.editorial.v1:';
  const text = v => typeof v === 'string' ? v : '';
  const clone = v => JSON.parse(JSON.stringify(v));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  function getDisclosure(kind) { return DISCLOSURES[kind] || ''; }
  function safeHttps(value) {
    if (typeof value !== 'string' || !value || value !== value.trim() || /[\s\u0000-\u0020\u007f\\<>"`]/u.test(value) || !/^https:\/\//i.test(value)) throw new Error('공백이나 인증 정보가 없는 안전한 https 링크를 입력해 주세요.');
    let u; try { u = new URL(value); } catch (_) { throw new Error('올바른 https 링크를 입력해 주세요.'); }
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || !h.includes('.') || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/.test(h) || /^[\d.]+$/.test(h) || h.includes(':') || /%0[ad]/i.test(value)) throw new Error('인증 정보나 내부 주소가 없는 공개 https 링크를 입력해 주세요.');
    return value; // Intentional: never return URL.href or rebuild affiliate query strings.
  }
  function validDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text(v))) return false;
    const d = new Date(v+'T12:00:00Z'); return Number.isFinite(+d) && d.toISOString().slice(0,10) === v;
  }
  function keywords(v) { return [...new Set((Array.isArray(v)?v:text(v).split(/[,\n#]/)).map(x=>text(x).trim()).filter(Boolean))].slice(0,20); }
  function blank() { return {kind:'experience',subject:'',affiliateUrl:'',sourceUrl:'',facts:'',verifiedAt:'',angle:'',keywords:[],rightsConfirmed:false,linkConfirmed:false,plannedAt:'',status:'topic',finalUrl:'',publicationConfirmed:false}; }
  function requestFrom(v) {
    if (v.kind === 'experience') return null;
    if (!DISCLOSURES[v.kind]) throw new Error('글 유형을 선택해 주세요.');
    for (const [k,label] of [['subject','주제'],['facts','확인한 사실'],['angle','글의 관점']]) if (!text(v[k]).trim()) throw new Error(label+'을 적어 주세요.');
    const affiliateUrl = safeHttps(v.affiliateUrl), sourceUrl = safeHttps(v.sourceUrl);
    if (affiliateUrl === sourceUrl) throw new Error('제휴 링크와 별개인 사실 확인 출처 링크를 입력해 주세요.');
    if (!validDate(v.verifiedAt) || v.verifiedAt > today()) throw new Error('오늘까지의 실제 정보 확인 날짜를 입력해 주세요.');
    if (!keywords(v.keywords).length) throw new Error('핵심 키워드를 한 개 이상 적어 주세요.');
    if (v.linkConfirmed !== true) throw new Error('본인 계정에서 직접 발급한 제휴 링크인지 확인해 주세요.');
    if (v.rightsConfirmed !== true) throw new Error('출처와 사진·영상 사용 권한을 확인해 주세요.');
    return {version:1,kind:v.kind,subject:text(v.subject).trim(),affiliateUrl,sourceUrl,facts:text(v.facts).trim(),verifiedAt:v.verifiedAt,angle:text(v.angle).trim(),keywords:keywords(v.keywords),rightsConfirmed:true,linkConfirmed:true,disclosure:getDisclosure(v.kind)};
  }
  function blogId(value) {
    try { const u=new URL(safeHttps(value)); if(u.hostname!=='blog.naver.com' || u.search || u.hash) return ''; const m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/?$/); return m?m[1].toLowerCase():''; } catch (_) { return ''; }
  }
  function finalPublicationUrl(value, blogUrl) {
    safeHttps(value); const id=blogId(blogUrl); if(!id) throw new Error('계정 프로필에 https://blog.naver.com/블로그아이디 주소를 먼저 연결해 주세요.');
    const u=new URL(value), m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)\/([1-9]\d*)\/?$/);
    if(u.hostname!=='blog.naver.com' || u.search || u.hash || !m || m[1].toLowerCase()!==id) throw new Error('연결된 같은 블로그의 실제 글 주소 https://blog.naver.com/블로그아이디/글번호를 입력해 주세요.');
    return value;
  }
  function storageKey(accountKey) { if(!text(accountKey).trim()) throw new Error('계정 연결이 필요해요.'); return PREFIX+encodeURIComponent(accountKey); }
  function snapshot(post) {
    if (!post || typeof post!=='object') return null;
    return {title:text(post.title),titles:Array.isArray(post.titles)?post.titles.map(text):[],intro:text(post.intro),outro:text(post.outro),sections:(Array.isArray(post.sections)?post.sections:[]).map(s=>({heading:text(s.heading),blocks:(Array.isArray(s.blocks)?s.blocks:[]).filter(b=>typeof b.text==='string').map(b=>({text:b.text}))})),tags:Array.isArray(post.tags)?post.tags.map(text):[]};
  }
  function postText(post) {
    const p=snapshot(post); if(!p) return ''; return [p.intro,...p.sections.flatMap(s=>[s.heading,...s.blocks.map(b=>b.text)]),text(post.tip),...(Array.isArray(post.faq)?post.faq.flatMap(f=>[text(f.q),text(f.a)]):[]),text(post.recommend),p.outro].filter(Boolean).join('\n\n');
  }
  function compliantPost(post, req) {
    const p=clone(post); if (!req) return p;
    // A changed program or issued URL must replace, not retain, our old footer.
    p.outro=text(p.outro).replace(/(?:\n\n|^)(?:상품 정보와 구매 링크|여행 정보와 예약 링크)\nhttps:\/\/\S+\s*$/,'').trim();
    const removeNotice = s => { for(const d of Object.values(DISCLOSURES)) s=s.split(d).join(''); return s; };
    const clean = s => removeNotice(text(s)).split(req.affiliateUrl).join('').replace(/내돈내산/g,'').replace(/\[광고\]/g,'').trim();
    const walk = value => { if(typeof value==='string') return clean(value); if(Array.isArray(value)) return value.map(walk); if(value && typeof value==='object') { for(const k of Object.keys(value)) value[k]=walk(value[k]); } return value; };
    walk(p);
    p.title='[광고] '+(text(p.title)||req.subject);
    p.titles=(Array.isArray(p.titles)?p.titles:[]).map(t=>'[광고] '+text(t));
    p.intro=req.disclosure+(text(p.intro)?'\n\n'+p.intro:'');
    // Remove only the module's previous footer labels, then append exactly once.
    p.outro=text(p.outro).replace(/(?:상품 정보와 구매 링크|여행 정보와 예약 링크)\s*$/,'').trim();
    p.outro+=(p.outro?'\n\n':'')+(req.kind==='shopping'?'상품 정보와 구매 링크':'여행 정보와 예약 링크')+'\n'+req.affiliateUrl;
    return p;
  }
  function suggestions(form, topics) {
    const seeds=[text(form.subject),...keywords(form.keywords),...topics.flatMap(t=>[text(t.subject),...keywords(t.keywords)])].map(s=>s.trim()).filter(Boolean);
    return [...new Set(seeds)].slice(0,6).map((seed,i)=>({subject:seed,angle:['선택 전에 확인할 점','확인한 정보와 아직 모르는 점','내 상황에 맞는 선택 기준'][i%3]}));
  }
  function cleanTopic(v) {
    if(!v || typeof v!=='object' || typeof v.id!=='string' || !v.id) return null;
    const r=blank(); for(const k of ['subject','affiliateUrl','sourceUrl','facts','verifiedAt','angle','plannedAt','finalUrl']) r[k]=text(v[k]);
    r.id=v.id;r.kind=Object.hasOwn(KINDS,v.kind)?v.kind:'experience'; r.keywords=keywords(v.keywords);r.rightsConfirmed=v.rightsConfirmed===true;r.linkConfirmed=v.linkConfirmed===true;
    r.status=Object.hasOwn(STATES,v.status)?v.status:'topic';r.publicationConfirmed=v.publicationConfirmed===true;r.post=snapshot(v.post);r.createdAt=text(v.createdAt);r.updatedAt=text(v.updatedAt);
    return r;
  }
  function readAccount(store,key) {
    const raw=store.getItem(storageKey(key)); if(raw===null) return [];
    let data; try { data=JSON.parse(raw); } catch (_) { throw new Error('저장된 글감 파일을 읽지 못했어요. 기존 데이터를 덮어쓰지 않아요.'); }
    if(data.version!==1 || data.accountKey!==key || !Array.isArray(data.topics)) throw new Error('글감의 계정 정보가 맞지 않아요. 기존 데이터를 덮어쓰지 않아요.');
    return data.topics.map(cleanTopic).filter(Boolean);
  }
  function backup(key,topics) { return {version:1,accountKey:key,exportedAt:new Date().toISOString(),topics:topics.map(cleanTopic).filter(Boolean)}; }
  function publicationCheck(form,ctx,checks) {
    const errors=[]; let req=null;
    try { req=requestFrom(form); } catch(e) {errors.push(e.message);}
    if(!ctx.accountKey) errors.push('먼저 계정을 연결해 주세요.');
    if(!ctx.post) errors.push('먼저 원고를 만들어 주세요.');
    if(ctx.busy) errors.push('진행 중인 작업이 끝난 뒤 확인해 주세요.');
    const body=text(ctx.bodyText)||postText(ctx.post);
    if(req && ctx.post) {
      if(!text(ctx.post.title).startsWith('[광고]')) errors.push('제목 첫머리에 [광고]를 넣어 주세요.');
      if(!body.trimStart().startsWith(req.disclosure)) errors.push('본문 맨 위에 해당 프로그램의 고지 문구를 넣어 주세요.');
      if(!body.includes(req.affiliateUrl)) errors.push('본문에서 발급받은 제휴 링크 원문을 확인해 주세요.');
      if(/내돈내산/.test(text(ctx.post.title)+body)) errors.push('제휴 원고의 내돈내산 표현을 지워 주세요.');
    }
    if(!checks.facts) errors.push('실제 경험과 정보·가격·날짜를 직접 검토해 주세요.');
    if(!checks.rights) errors.push('출처와 모든 사진·영상의 사용 권한을 확인해 주세요.');
    if(req && !checks.disclosure) errors.push('광고 표시와 링크 원문을 최종 확인해 주세요.');
    return {ok:!errors.length,errors,checks:{...checks},request:req};
  }
  let host=null, panel=null, els={}, form=blank(), topics=[], selected=null, account='', epoch=0, pending=null, storageBlocked=false, dirty=false;
  let checks={facts:false,rights:false,disclosure:false}, view='list', filterDate='', filterStatus='', month=today().slice(0,7);
  const context=()=>host&&host.getContext ? host.getContext()||{} : {};
  function message(s) { if(els.message) els.message.textContent=s; if(host&&host.notify) host.notify(s); }
  function resetChecks() { checks={facts:false,rights:false,disclosure:false}; for(const k of Object.keys(checks)) if(els['check_'+k]) els['check_'+k].checked=false; }
  function sync() {
    const c=context(), key=text(c.accountKey);
    if(key!==account) {
      account=key; epoch++; form=blank();topics=[];selected=null;dirty=false;storageBlocked=false;resetChecks();filterDate='';filterStatus='';
      if(account) try { topics=readAccount(root.localStorage,account); } catch(e) {storageBlocked=true;message(e.message);}
      if(panel) { fillForm(); render(); }
    }
    return c;
  }
  function persist() {
    if(!account || storageBlocked) throw new Error(storageBlocked?'기존 저장 데이터를 보호하고 있어요. 백업이나 저장소 상태를 먼저 확인해 주세요.':'계정 연결이 필요해요.');
    if(text(context().accountKey)!==account) {sync();throw new Error('계정이 바뀌었어요. 다시 선택해 주세요.');}
    try { root.localStorage.setItem(storageKey(account),JSON.stringify(backup(account,topics))); }
    catch(e) {throw new Error('브라우저에 저장하지 못했어요. 저장 공간과 권한을 확인하고 JSON 백업을 내려받아 주세요.');}
  }
  function guarded(fn) { return function(){try {sync(); const result=fn.apply(this,arguments); if(result && typeof result.then==='function')return Promise.resolve(result).catch(e=>{message(e.message||'작업을 완료하지 못했어요.');return false;});return result;} catch(e){message(e.message||'작업을 완료하지 못했어요.');return false;}}; }
  function newId() {return root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);}
  function locked() {return !!pending || !!context().busy;}
  function costQuote(c) {return typeof c.estimatedCost==='number' && Number.isFinite(c.estimatedCost) && c.estimatedCost>=12?c.estimatedCost:12;}
  function pinRequest(req) {return req===null?null:clone(requestFrom(clone(req)));}
  function requestForPost(post,fallback) {
    if(post && Object.hasOwn(post,'_automationRequest')) {
      if(post._automationAccountKey!==account)throw new Error('다른 계정의 원고는 사용할 수 없어요.');
      return pinRequest(post._automationRequest);
    }
    return pinRequest(fallback);
  }
  function readForm() {
    if(pending && pending.key===account && pending.epoch===epoch)return form;
    for(const k of ['kind','subject','affiliateUrl','sourceUrl','facts','verifiedAt','angle','plannedAt','status','finalUrl']) if(els[k]) form[k]=els[k].value;
    form.keywords=keywords(els.keywords.value);form.linkConfirmed=els.linkConfirmed.checked;form.rightsConfirmed=els.rightsConfirmed.checked;form.publicationConfirmed=els.publicationConfirmed.checked;
    return form;
  }
  function fillForm() {
    for(const k of ['kind','subject','affiliateUrl','sourceUrl','facts','verifiedAt','angle','plannedAt','status','finalUrl']) if(els[k]) els[k].value=form[k];
    if(els.keywords) els.keywords.value=keywords(form.keywords).join(', ');
    for(const k of ['linkConfirmed','rightsConfirmed','publicationConfirmed']) if(els[k]) els[k].checked=form[k];
  }
  function saveTopic(silent) {
    sync();if(locked())throw new Error('진행 중인 작업이 끝난 뒤 글감을 저장해 주세요.');readForm(); if(!form.subject.trim()) throw new Error('저장할 주제를 적어 주세요.');
    if(form.affiliateUrl) safeHttps(form.affiliateUrl);if(form.sourceUrl) safeHttps(form.sourceUrl);
    if(form.status==='published-confirmed') {
      finalPublicationUrl(form.finalUrl,context().blogUrl);
      if(!form.publicationConfirmed) throw new Error('해당 주소에서 직접 발행된 글을 확인했다는 항목에 체크해 주세요.');
    }
    const now=new Date().toISOString(), prior=topics.find(t=>t.id===selected);
    const item=cleanTopic({...form,id:selected||('topic-'+(root.crypto&&root.crypto.randomUUID?root.crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2))),post:prior?prior.post:null,createdAt:prior?prior.createdAt:now,updatedAt:now});
    const prev=topics;topics=prior?topics.map(t=>t.id===selected?item:t):[...topics,item];
    try {persist();}catch(e){topics=prev;throw e;}selected=item.id;dirty=false;render();if(!silent) message('이 계정의 글감을 저장했어요. 날짜는 편집 계획이며 예약 발행이 아니에요.');return item;
  }
  function selectTopic(id) {
    if(locked()) throw new Error('원고 생성이 끝난 뒤 글감을 바꿔 주세요.');
    if(dirty && !root.confirm('아직 저장하지 않은 글감 입력이 있어요. 저장하지 않고 바꿀까요?')) return;
    const item=topics.find(t=>t.id===id);if(!item) return;
    const c=sync(), nextMemo=item.facts || item.subject;
    if(text(c.memo).trim() && c.memo!==nextMemo && !root.confirm('기존 메모가 있어요. 선택한 글감의 확인 내용으로 바꿀까요? 취소하면 기존 메모를 유지해요.')) return;
    const key=account, rev=epoch;
    if(host.setDraftInputs({memo:nextMemo,info:'',place:item.subject,area:''})===false) throw new Error('기존 메모를 유지했어요.');
    if(text(context().accountKey)!==key || epoch!==rev){sync();return;}
    selected=id;form={...blank(),...clone(item)};dirty=false;resetChecks();fillForm();render();message('글감을 불러왔어요. 저장된 초안은 카드에서 확인할 수 있고 현재 원고는 바꾸지 않아요.');
  }
  function getRequest() {sync();if(pending){if(pending.key!==account || pending.epoch!==epoch)throw new Error('계정이 바뀌어 이전 원고 요청을 중단했어요.');return clone(pending.request);}if(panel) readForm();return requestFrom(form);}
  function getPublicationContext() {
    sync();if(panel)readForm();const p=context().post;const hasPin=p && Object.hasOwn(p,'_automationRequest');const req=hasPin?requestForPost(p,null):requestFrom(form);const kind=req?req.kind:(hasPin?'experience':form.kind);const pinnedTopic=hasPin?topics.find(t=>t.id===p._automationTopicId):null;const topicState=pinnedTopic||(hasPin?blank():form);return {...(req||{}),accountKey:account,kind,request:req,affiliateUrl:req?req.affiliateUrl:'',rightsConfirmed:req?req.rightsConfirmed:topicState.rightsConfirmed,linkConfirmed:req?req.linkConfirmed:false,disclosure:getDisclosure(kind),topicId:hasPin?p._automationTopicId:selected,selectedTopicId:selected,topicStatus:topicState.status,plannedAt:topicState.plannedAt,editorialPlanOnly:true,finalUrl:topicState.finalUrl,canAutoPublish:false,canSchedule:false,reason:'네이버 자동 발행 권한과 API가 연결되지 않았어요. 편집기에서 직접 발행해 주세요.'};
  }
  function preflight() {const c=sync();if(panel)readForm();let result;try{const req=c.post && Object.hasOwn(c.post,'_automationRequest')?requestForPost(c.post,null):requestFrom(form);result=publicationCheck(req||{kind:'experience'},c,checks);}catch(e){result={ok:false,errors:[e.message],checks:{...checks},request:null};}if(els.preflight){els.preflight.replaceChildren(); for(const line of result.errors.length?result.errors:['확인을 마쳤어요. 편집기에서 직접 검토하고 발행해 주세요.']) els.preflight.appendChild(el('li',{},line));}return result;}
  function onPost(post, options) {
    sync();if(pending && (pending.key!==account || pending.epoch!==epoch))throw new Error('계정이 바뀌어 이전 계정의 원고를 반영하지 않았어요.');
    const hasOverride=options && Object.hasOwn(options,'request');
    if(options && options.accountKey!==account)throw new Error('계정이 바뀌어 이전 계정의 원고를 반영하지 않았어요.');
    if(post && Object.hasOwn(post,'_automationAccountKey') && post._automationAccountKey!==account)throw new Error('다른 계정의 원고는 사용할 수 없어요.');
    const req=hasOverride?pinRequest(options.request):pending?clone(pending.request):post && Object.hasOwn(post,'_automationRequest')?requestForPost(post,null):pinRequest(getRequest());
    const repeated=!!(post && post._automationGenerationId);
    const generationId=repeated?post._automationGenerationId:pending?pending.generationId:newId();
    const topicId=repeated?post._automationTopicId:pending?pending.topicId:selected;
    const result=compliantPost(post,req);
    result._automationRequest=clone(req);result._automationAccountKey=account;result._automationGenerationId=generationId;result._automationTopicId=topicId||null;
    if(pending)pending.postReceived=true;if(!repeated)resetChecks();
    if(topicId && topics.some(t=>t.id===topicId)) {
      const prev=topics;topics=topics.map(t=>t.id===topicId?{...t,post:snapshot(result),...(!repeated?{status:'draft',publicationConfirmed:false,finalUrl:''}:{}),updatedAt:new Date().toISOString()}:t);
      try {persist();if(!repeated && selected===topicId){form.status='draft';form.finalUrl='';form.publicationConfirmed=false;}fillForm();render();}catch(e){topics=prev;message(e.message);}
    }
    return result;
  }
  async function generate() {
    const c=sync();if(pending || c.busy) throw new Error('진행 중인 작업이 끝난 뒤 다시 눌러 주세요.');
    const capturedRequest=pinRequest(getRequest());if(!text(c.memo).trim() && !form.subject.trim() && !form.facts.trim()) throw new Error('경험 메모나 글감을 먼저 적어 주세요.');
    const quotedCost=costQuote(c);
    if(typeof c.credits==='number' && c.credits<quotedCost) throw new Error('원고를 만들려면 '+quotedCost+'크레딧이 필요해요.');
    if(!root.confirm('원고 만들기에 '+quotedCost+'크레딧을 사용해요. 진행할까요?')) return;
    const key=account, rev=epoch;if(!key)throw new Error('먼저 계정을 연결해 주세요.');
    if(capturedRequest===null) {
      const desiredMemo=[form.subject.trim(),form.facts.trim()].filter(Boolean).join('\n\n');
      if(desiredMemo && desiredMemo!==text(c.memo)) {
        if(text(c.memo).trim() && !root.confirm('기존 메모가 있어요. 이 글감의 주제와 확인 내용으로 바꿀까요? 취소하면 생성하지 않고 기존 메모를 유지해요.'))return;
        if(host.setDraftInputs({memo:desiredMemo,info:'',place:form.subject,area:''})===false)throw new Error('기존 메모를 유지했어요. 원고를 생성하지 않았어요.');
      }
    }
    if(text(context().accountKey)!==key || epoch!==rev){sync();throw new Error('계정이 바뀌었어요. 다시 확인해 주세요.');}
    if(selected || form.subject.trim()) saveTopic(true);
    const token={key,epoch:rev,request:clone(capturedRequest),topicId:selected,generationId:newId(),quotedCost};pending=token;render();
    try {
      const current=context();
      if(text(current.accountKey)!==key || epoch!==rev)throw new Error('계정이 바뀌어 원고 생성을 중단했어요.');
      if(costQuote(current)!==quotedCost)throw new Error('예상 비용이 변경되어 생성을 멈췄어요. 변경된 크레딧을 확인하고 다시 눌러 주세요.');
      if(typeof current.credits==='number' && current.credits<quotedCost)throw new Error('원고를 만들려면 '+quotedCost+'크레딧이 필요해요.');
      await host.generate(); if(account===key && epoch===rev) message(token.postReceived?'원고를 만들었어요. 사실과 광고 고지를 직접 검토해 주세요.':'요청 처리를 마쳤어요. 현재 원고와 생성 결과를 확인해 주세요.'); }
    catch(e) { if(account===key && epoch===rev) message(e.message||'원고를 만들지 못했어요.'); }
    finally { if(pending===token)pending=null;sync();render(); }
  }
  function exportBackup() {sync();if(!account)throw new Error('먼저 계정을 연결해 주세요.');host.saveBlob(new Blob([JSON.stringify(backup(account,topics),null,2)],{type:'application/json'}),'cuttory-topics-'+today()+'.json');message('현재 계정의 저장된 글감만 백업했어요.');}
  function exportCaption() {
    const r=preflight();if(!r.ok) throw new Error(r.errors.join('\n'));
    const c=context(), req=r.request;
    const caption=[req?req.disclosure:'',text(c.post.title),postText(c.post)].filter(Boolean).join('\n\n');
    // postText already contains disclosure. Keep it only at the top of exported caption.
    const body=req?caption.slice(req.disclosure.length).split(req.disclosure).join('').trim():caption;
    host.saveBlob(new Blob([req?req.disclosure+'\n\n'+body:body],{type:'text/plain;charset=utf-8'}),'cuttory-'+(req?req.kind:'experience')+'-caption-'+today()+'.txt');
    message('현재 원고의 고지 포함 캡션을 내보냈어요. 실제 영상에도 광고 표시를 직접 넣어 주세요.');
  }
  function newTopic() {
    if(locked()) throw new Error('원고 생성이 끝난 뒤 새 글감을 열어 주세요.');
    if(dirty&&!root.confirm('저장하지 않은 입력을 지우고 새 글감을 열까요?'))return;
    form=blank();selected=null;dirty=false;resetChecks();fillForm();render();message('새 글감을 열었어요. 기존 메모와 원고는 유지해요.');
  }
  function el(tag,attrs,content) {
    const n=root.document.createElement(tag);for(const [k,v]of Object.entries(attrs||{})) {if(k==='class')n.className=v;else if(k==='on')n.addEventListener('click',guarded(v));else n.setAttribute(k,v);}
    if(content!==undefined)n.textContent=content;return n;
  }
  function button(label,fn,primary) {return el('button',{type:'button',class:primary?'ca-button ca-primary':'ca-button',on:fn},label);}
  function field(parent,key,label,type='text',hint) {
    const wrap=el('label',{class:'ca-field'},label), id='ca-'+key;wrap.setAttribute('for',id);
    const input=el(type==='textarea'?'textarea':'input',{id,...(type==='textarea'?{rows:'3'}:{type}),...(key==='affiliateUrl'||key==='sourceUrl'?{autocomplete:'off',spellcheck:'false'}:{})});
    els[key]=input;wrap.appendChild(input);if(hint)wrap.appendChild(el('small',{},hint));parent.appendChild(wrap);return input;
  }
  function check(parent,key,label) {const wrap=el('label',{class:'ca-check'}),input=el('input',{type:'checkbox',id:'ca-'+key});els[key]=input;wrap.append(input,el('span',{},label));parent.appendChild(wrap);return input;}
  function select(parent,key,label,options) {const wrap=el('label',{class:'ca-field'},label),s=el('select',{id:'ca-'+key});els[key]=s;for(const [v,l]of Object.entries(options))s.appendChild(el('option',{value:v},l));wrap.appendChild(s);parent.appendChild(wrap);return s;}
  function renderBoard() {
    const list=els.board;list.replaceChildren();
    let shown=topics.filter(t=>(!filterStatus||t.status===filterStatus)&&(!filterDate||t.plannedAt.slice(0,10)===filterDate));
    const appendCard=(container,t)=>{
      const card=el('article',{class:'ca-topic'+(selected===t.id?' ca-selected':'')});
      card.append(button(t.subject,()=>selectTopic(t.id)),el('p',{class:'ca-muted'},KINDS[t.kind]+' · '+STATES[t.status]+(t.plannedAt?' · 계획 '+t.plannedAt.replace('T',' '):' · 날짜 미정')));
      if(t.finalUrl) try {finalPublicationUrl(t.finalUrl,context().blogUrl);card.appendChild(el('a',{href:t.finalUrl,target:'_blank',rel:'noopener noreferrer'},'직접 확인한 발행 글 보기'));}catch(_){}
      if(t.post) {const details=el('details'),summary=el('summary',{},'저장된 초안 보기');details.append(summary,el('p',{class:'ca-snapshot'},t.post.title+'\n\n'+postText(t.post)));card.appendChild(details);}
      const del=button('삭제',()=>{if(locked())throw new Error('원고 생성 중에는 삭제할 수 없어요.');if(!root.confirm('이 계정에서 이 글감을 삭제할까요?'))return;const prev=topics;topics=topics.filter(x=>x.id!==t.id);try{persist();}catch(e){topics=prev;throw e;}if(selected===t.id){selected=null;form=blank();dirty=false;fillForm();}render();});del.setAttribute('aria-label',t.subject+' 글감 삭제');card.appendChild(del);container.appendChild(card);
    };
    if(view==='list') {shown.sort((a,b)=>(a.plannedAt||'9999').localeCompare(b.plannedAt||'9999')).forEach(t=>appendCard(list,t));if(!shown.length)list.appendChild(el('p',{class:'ca-muted'},'조건에 맞는 글감이 없어요. 주제를 적고 저장해 보세요.'));return;}
    const [y,m]=month.split('-').map(Number),start=new Date(y,m-1,1),days=new Date(y,m,0).getDate(),grid=el('div',{class:'ca-calendar'});
    for(const day of ['일','월','화','수','목','금','토'])grid.appendChild(el('div',{class:'ca-weekday'},day));
    for(let i=0;i<start.getDay();i++)grid.appendChild(el('div',{'aria-hidden':'true'}));
    for(let d=1;d<=days;d++){const date=month+'-'+String(d).padStart(2,'0'),day=el('div',{class:'ca-day'});const b=button(String(d),()=>{filterDate=filterDate===date?'':date;els.filterDate.value=filterDate;renderBoard();});b.setAttribute('aria-label',date+' 편집 계획 보기');b.setAttribute('aria-pressed',String(filterDate===date));day.appendChild(b);for(const t of shown.filter(t=>t.plannedAt.slice(0,10)===date)){const b=button(t.subject,()=>selectTopic(t.id));b.classList.add('ca-calendar-topic');b.title=STATES[t.status];day.appendChild(b);}grid.appendChild(day);}list.appendChild(grid);
    const undated=shown.filter(t=>!t.plannedAt);if(undated.length){list.appendChild(el('p',{class:'ca-muted'},'날짜 미정'));undated.forEach(t=>appendCard(list,t));}
  }
  function render() {
    if(!panel)return;const c=context(), affiliate=form.kind!=='experience';
    els.account.textContent=account?(text(c.accountName)||'연결된 계정')+'의 글감이에요. 이 브라우저에만 저장해요.':'계정을 연결하면 글감을 저장할 수 있어요.';
    els.affiliate.hidden=!affiliate;els.disclosure.textContent=getDisclosure(form.kind);els.linkConfirmed.disabled=!affiliate;
    els.publication.hidden=form.status!=='published-confirmed';
    const lock=!account||!!pending||!!c.busy;
    els.fields.disabled=lock;els.generate.disabled=lock;els.save.disabled=lock||storageBlocked;els.new.disabled=lock;
    els.generate.textContent=pending?'원고를 만들고 있어요':'원고 만들기 · '+costQuote(c)+'크레딧';
    els.open.disabled=lock;els.video.disabled=lock||!c.post;els.caption.disabled=lock||!c.post;els.backup.disabled=!account;
    renderBoard();
  }
  function init(nextHost) {
    if(!nextHost || ['getContext','setDraftInputs','generate','prepareVideo','openEditor','notify','saveBlob'].some(k=>typeof nextHost[k]!=='function'))throw new Error('CuttoryBlogHost 연결을 확인해 주세요.');
    host=nextHost;if(panel){sync();render();return api;}
    if(!root.document)return api;
    panel=el('details',{class:'ca-panel',id:'cuttory-automation'});panel.appendChild(el('summary',{},'글감·수익화'));
    const content=el('div',{class:'ca-content'});panel.appendChild(content);
    els.account=el('p',{class:'ca-muted'});content.appendChild(els.account);
    els.fields=el('fieldset',{class:'ca-fields'});els.fields.appendChild(el('legend',{class:'ca-sr'},'글감 입력'));content.appendChild(els.fields);
    select(els.fields,'kind','어떤 글을 쓸까요?',KINDS);
    field(els.fields,'subject','주제');field(els.fields,'facts','직접 겪었거나 출처에서 확인한 사실','textarea','방문·구매·사용 경험이 없다면 없다고 적어 주세요. 확인하지 않은 가격이나 성과는 쓰지 않아요.');
    field(els.fields,'angle','독자에게 도움이 될 관점');field(els.fields,'keywords','핵심 키워드','text','쉼표로 나눠 적어요.');
    els.affiliate=el('div',{class:'ca-affiliate'});els.fields.appendChild(els.affiliate);
    field(els.affiliate,'affiliateUrl','본인 계정에서 발급한 제휴 링크','url','https 원문을 그대로 붙여넣어요. 여기서 링크를 새로 발급하거나 바꾸지 않아요.');
    field(els.affiliate,'sourceUrl','사실 확인 출처 링크','url','제휴 링크와 별개인 공식 상품·숙소 등 정보 출처를 적어요.');field(els.affiliate,'verifiedAt','정보를 확인한 날짜','date');els.verifiedAt.max=today();
    check(els.affiliate,'linkConfirmed','본인 계정에서 직접 발급한 링크이며 해당 프로그램에 참여 중인지 확인했어요.');
    const official=el('p',{class:'ca-muted'});official.append(el('a',{href:OFFICIAL,target:'_blank',rel:'noopener noreferrer'},'네이버 공식 안내에서 링크 발급·통계 확인하기'));els.affiliate.appendChild(official);
    els.affiliate.appendChild(el('p',{class:'ca-muted'},'여기서는 링크 귀속·수수료율·판매·예약·수익을 검증할 수 없어요. 실제 조건과 성과는 공식 화면에서 확인해 주세요.'));
    els.disclosure=el('p',{class:'ca-notice'});els.affiliate.appendChild(els.disclosure);
    check(els.fields,'rightsConfirmed','출처를 확인했고 사진·영상·인용문을 사용할 권한이 있어요.');
    const plan=el('div',{class:'ca-pair'});els.fields.appendChild(plan);field(plan,'plannedAt','편집 계획 날짜·시간','datetime-local');select(plan,'status','작업 상태',STATES);
    els.fields.appendChild(el('p',{class:'ca-muted'},'이 날짜는 편집 계획이에요. 알림이나 예약 발행은 실행하지 않아요.'));
    els.publication=el('div',{class:'ca-publication'});els.fields.appendChild(els.publication);field(els.publication,'finalUrl','직접 발행한 실제 네이버 글 주소','url','연결된 같은 블로그의 /블로그아이디/글번호 주소만 저장해요. 여기서는 페이지 공개 여부를 자동 검증하지 못해요.');check(els.publication,'publicationConfirmed','실제 글 주소를 열어 발행된 글을 직접 확인했어요.');
    const actions=el('div',{class:'ca-actions'});els.new=button('새 글감',newTopic);els.save=button('글감 저장',()=>saveTopic(false));els.generate=button('원고 만들기 · '+costQuote(context())+'크레딧',()=>generate().catch(e=>message(e.message)),true);actions.append(els.new,els.save,els.generate);content.appendChild(actions);
    const suggest=el('details',{class:'ca-section'});suggest.appendChild(el('summary',{},'입력한 내용으로 글감 더 보기'));suggest.appendChild(el('p',{class:'ca-muted'},'입력·저장한 주제와 키워드를 조합해요. 실시간 검색량·트렌드나 인기 순위가 아니에요. 외부 AI를 호출하지 않아요.'));
    const suggestionList=el('div',{class:'ca-actions'});suggest.append(button('글감 조합 보기',()=>{readForm();suggestionList.replaceChildren();const all=suggestions(form,topics);if(!all.length)suggestionList.appendChild(el('p',{class:'ca-muted'},'먼저 실제 주제나 키워드를 적어 주세요.'));for(const s of all)suggestionList.appendChild(button(s.subject+' · '+s.angle,()=>{if(locked())throw new Error('진행 중인 작업이 끝난 뒤 글감을 바꿔 주세요.');if(form.angle&&!root.confirm('현재 관점을 이 조합으로 바꿀까요?'))return;form.subject=s.subject;form.angle=s.angle;dirty=true;resetChecks();fillForm();render();}));}),suggestionList);content.appendChild(suggest);
    const board=el('details',{class:'ca-section',open:''});board.appendChild(el('summary',{},'저장한 글감·초안'));const filters=el('div',{class:'ca-pair'});board.appendChild(filters);
    select(filters,'filterStatus','상태로 보기',{'':'전체',...STATES});field(filters,'filterDate','계획 날짜로 보기','date');
    const tools=el('div',{class:'ca-actions'});tools.append(button('목록',()=>{view='list';renderBoard();}),button('달력',()=>{view='calendar';renderBoard();}),button('날짜 조건 지우기',()=>{filterDate='';els.filterDate.value='';renderBoard();}));board.appendChild(tools);
    field(board,'month','달력의 달','month');els.month.value=month;els.board=el('div',{class:'ca-board'});board.appendChild(els.board);els.backup=button('이 계정 글감 JSON 백업',exportBackup);board.appendChild(els.backup);content.appendChild(board);
    const review=el('details',{class:'ca-section'});review.appendChild(el('summary',{},'발행 전 확인·내보내기'));
    for(const [k,label]of Object.entries({facts:'실제 경험과 확인한 사실만 적었고 가격·일정·조건을 다시 확인했어요.',rights:'출처와 사진·영상의 사용 권한을 최종 확인했어요.',disclosure:'제휴 글이라면 [광고] 제목·본문 첫 고지·제휴 링크 원문을 확인했어요.'}))check(review,'check_'+k,label).addEventListener('change',()=>{sync();checks[k]=els['check_'+k].checked;});
    const handoff=el('div',{class:'ca-actions'});els.open=button('네이버 편집기 열기',()=>{const r=preflight();if(!r.ok)throw new Error(r.errors.join('\n'));const key=account;host.openEditor();if(text(context().accountKey)!==key){sync();return;}if(selected && form.status!=='published-confirmed'){form.status='awaiting-publication';fillForm();saveTopic(true);}message('편집기를 열었어요. 직접 발행한 뒤 실제 글 주소를 기록해 주세요. 아직 발행 확인 상태는 아니에요.');});
    els.video=button('이 글로 영상 준비',()=>{const r=preflight();if(!r.ok)throw new Error(r.errors.join('\n'));host.prepareVideo();});els.caption=button('고지 포함 캡션 내보내기',exportCaption);handoff.append(button('발행 전 점검',()=>preflight()),els.open,els.video,els.caption);review.appendChild(handoff);
    els.preflight=el('ul',{class:'ca-preflight','aria-live':'polite'});review.appendChild(els.preflight);
    const unavailable=el('div',{class:'ca-actions'});for(const title of ['자동 발행 · 연결 필요','예약 발행 · 연결 필요']){const b=button(title,()=>{});b.disabled=true;b.setAttribute('aria-describedby','ca-unavailable');unavailable.appendChild(b);}review.append(unavailable,el('p',{id:'ca-unavailable',class:'ca-muted'},'네이버 자동 발행 권한과 API가 연결되지 않았어요. 자동 로그인·자동 게시·진짜 예약 발행은 지원하지 않아요. 편집기에서 직접 발행해 주세요.'));content.appendChild(review);
    els.message=el('p',{class:'ca-message',role:'status','aria-live':'polite'});content.appendChild(els.message);
    els.fields.addEventListener('input',()=>{const key=account;sync();if(key!==account)return;if(locked()){fillForm();return;}readForm();dirty=true;resetChecks();if(els.message)els.message.textContent='변경한 글감은 저장 버튼을 눌러 보관해 주세요.';});
    els.fields.addEventListener('change',()=>{const key=account;sync();if(key!==account)return;if(locked()){fillForm();return;}readForm();dirty=true;resetChecks();render();});
    els.filterStatus.addEventListener('change',()=>{sync();filterStatus=els.filterStatus.value;renderBoard();});els.filterDate.addEventListener('change',()=>{sync();filterDate=els.filterDate.value;renderBoard();});els.month.addEventListener('change',()=>{sync();if(/^\d{4}-\d{2}$/.test(els.month.value)){month=els.month.value;renderBoard();}});
    const mount=root.document.getElementById('cuttory-automation-mount')||root.document.querySelector('.inputs')||root.document.querySelector('main');if(!mount)throw new Error('기존 블로그에 글감 섹션을 넣을 위치가 없어요.');mount.prepend(panel);
    root.addEventListener('cuttory:account-change',()=>{sync();render();});root.addEventListener('cuttory:automation-context',()=>{sync();resetChecks();render();});
    sync();fillForm();render();return api;
  }
  const api={init,getRequest,onPost,getPublicationContext,preflight,getDisclosure,getStateForTest:()=>({accountKey:account,selected,topics:clone(topics),form:clone(form),pending:!!pending,epoch}),helpers:{costQuote,safeHttps,validDate,requestFrom,blogId,finalPublicationUrl,storageKey,snapshot,postText,compliantPost,suggestions,cleanTopic,readAccount,backup,publicationCheck}};
  return api;
});
