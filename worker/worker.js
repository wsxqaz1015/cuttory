// 컷토리 서버 (Cloudflare Workers)
// 필요한 설정: 비밀 값 OPENAI_API_KEY, ADMIN_KEY / KV 바인딩 KV / (선택) ALLOWED_ORIGIN, TEXT_MODEL, IMAGE_MODEL, GOOGLE_CLIENT_ID(구글 로그인)
const COST = { gen: 10, video: 15, link: 3, person: 5, titles: 2, polish: 1, translate: 5, image: 20, transcribe: 10, pose: 15, sheet: 20 };
const START_CREDITS = 100;
const NEW_USERS_PER_IP_PER_DAY = 3;
const SYNC_APPS = ['office', 'portfolio', 'video', 'cardnews'];
const SYNC_MAX = 3 * 1024 * 1024;
const IMAGE_STYLES = {
  photo: 'photorealistic editorial photograph, natural light, shallow depth of field',
  film: '35mm film photograph, soft grain, warm faded colors',
  illust: 'clean flat vector illustration, soft pastel palette',
  '3d': 'cute 3D render, soft studio lighting, clay-like materials',
  water: 'delicate watercolor painting on textured paper',
  anime: 'Japanese anime style illustration, vibrant colors',
  pop: 'bold pop art style, halftone dots, high contrast',
  minimal: 'minimal graphic design, lots of empty space, simple shapes',
};

const json = (data, status, cors) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8', ...cors } });
const fail = (code, message, status, cors) => json({ code, message }, status || 400, cors);

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '*').split(',').map(s => s.trim());
    const cors = {
      'access-control-allow-origin': allowed.includes('*') ? '*' : (allowed.includes(origin) ? origin : allowed[0]),
      'access-control-allow-headers': 'authorization, content-type, x-admin-key',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'vary': 'origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname;
    try {
      if (path === '/' || path === '/api/health') return json({ ok: true, ai: !!env.OPENAI_API_KEY, kv: !!env.KV }, 200, cors);
      if (!env.KV) return fail('setup', '서버에 KV 저장소가 연결되지 않았어요.', 500, cors);
      if (path === '/api/samples') return await samples(env, cors);
      if (path === '/api/models') { const m = await models(env).catch(e => ({ error: e.message })); return json({ text: m.text, image: m.image, all: m.all, error: m.error }, 200, cors); }
      if (path === '/api/config') return json({ google: env.GOOGLE_CLIENT_ID || '' }, 200, cors);
      if (path === '/api/session') return json(await newSession(req, env), 200, cors);
      if (path === '/api/login/google') return json(await loginGoogle(req, await req.json(), env), 200, cors);
      if (path.startsWith('/api/admin/')) return await admin(path, req, env, cors);
      if (path === '/api/office/board') return json({ rows: await officeBoard(env) }, 200, cors);
      if (path === '/api/office/score') return json(await officeScore(req, await req.json(), env), 200, cors);

      const user = await auth(req, env);
      if (!user) return fail('unauthorized', '다시 접속해 주세요.', 401, cors);
      if (path === '/api/me') return json(pub(user), 200, cors);
      if (path === '/api/redeem') return json(await redeem(user, await req.json(), env), 200, cors);
      if (path === '/api/feedback') return json(await feedback(user, await req.json(), env), 200, cors);
      if (path === '/api/data') return json(await syncData(req, user, env), 200, cors);

      if (!env.OPENAI_API_KEY) return fail('setup', '서버에 OpenAI API 키가 없어요.', 500, cors);
      if (path === '/api/ai') {
        const b = await req.json();
        return json(await charged(user, COST[b.kind] ? b.kind : 'gen', env, () => ai(b, env)), 200, cors);
      }
      if (path === '/api/image') {
        const b = await req.json();
        return json(await charged(user, 'image', env, () => image(b, env)), 200, cors);
      }
      if (path === '/api/pose') {
        const b = await req.json();
        return json(await charged(user, b.mode === 'sheet' ? 'sheet' : 'pose', env, () => pose(b, env)), 200, cors);
      }
      if (path === '/api/transcribe') {
        const form = await req.formData();
        return json(await charged(user, 'transcribe', env, () => transcribe(form, env)), 200, cors);
      }
      if (path === '/api/fetch') {
        const b = await req.json();
        return json(await charged(user, 'link', env, () => readUrl(b.url)), 200, cors);
      }
      return fail('not_found', '없는 주소예요.', 404, cors);
    } catch (e) {
      return fail(e.code || 'error', e.message || '서버 오류가 났어요.', e.status || 500, cors);
    }
  },
};

// ===== 사용자·크레딧 =====
const err = (code, message, status) => Object.assign(new Error(message), { code, status: status || 400 });
const pub = (u) => ({ id: u.id, credits: u.credits, hist: u.hist.slice(0, 40), redeemed: u.redeemed, account: u.google ? { email: u.google.email, name: u.google.name, picture: u.google.picture } : null });
const save = (env, u) => env.KV.put('user:' + u.token, JSON.stringify(u));
async function newSession(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || 'x', day = new Date().toISOString().slice(0, 10), key = `ipday:${day}:${ip}`;
  const n = +(await env.KV.get(key)) || 0;
  if (n >= NEW_USERS_PER_IP_PER_DAY) throw err('rate_limited', '오늘은 이 네트워크에서 새 계정을 더 만들 수 없어요.', 429);
  await env.KV.put(key, String(n + 1), { expirationTtl: 60 * 60 * 26 });
  const u = { id: 'u_' + crypto.randomUUID().slice(0, 12), token: crypto.randomUUID() + crypto.randomUUID(), credits: START_CREDITS, hist: [{ t: Date.now(), k: 'start', n: START_CREDITS }], redeemed: [], createdAt: Date.now() };
  await save(env, u);
  return { token: u.token, ...pub(u) };
}
async function auth(req, env) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!t || t.length < 40) return null;
  const raw = await env.KV.get('user:' + t);
  return raw ? JSON.parse(raw) : null;
}
async function charged(user, kind, env, fn) {
  const n = COST[kind];
  if (user.credits < n) throw err('no_credits', `크레딧이 모자라요. ${n} 크레딧이 필요하고 ${user.credits} 크레딧 남았어요.`, 402);
  const out = await fn();
  user.credits -= n; user.hist.unshift({ t: Date.now(), k: kind, n: -n }); user.hist = user.hist.slice(0, 60);
  await save(env, user);
  return { ...out, credits: user.credits };
}
// ===== 구글 로그인 · 계정별 저장 =====
// 구글이 준 ID 토큰을 구글 서버에 물어서 확인하고, 구글 계정(sub)마다 컷토리 사용자 한 명을 연결해요.
async function verifyGoogle(cred, env) {
  if (!env.GOOGLE_CLIENT_ID) throw err('setup', '서버에 GOOGLE_CLIENT_ID가 아직 없어요.', 500);
  if (!cred || typeof cred !== 'string' || cred.length > 4096) throw err('bad_request', '로그인 정보가 비어 있어요.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
  const t = await r.json().catch(() => ({}));
  const ids = env.GOOGLE_CLIENT_ID.split(',').map(s => s.trim());
  if (!r.ok || !ids.includes(t.aud) || !['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) || +t.exp * 1000 < Date.now() || !t.sub)
    throw err('bad_login', '구글 로그인을 확인하지 못했어요. 다시 시도해 주세요.', 401);
  return { sub: String(t.sub), email: String(t.email || ''), name: String(t.name || t.given_name || ''), picture: String(t.picture || '') };
}
async function loginGoogle(req, b, env) {
  const g = await verifyGoogle(b.credential, env);
  const linked = await env.KV.get('acct:g:' + g.sub);
  let u = linked ? JSON.parse(await env.KV.get('user:' + linked) || 'null') : null;
  if (!u) {
    // 처음 로그인: 이 기기에서 쓰던 크레딧이 있으면 그 사용자를 계정에 붙이고, 없으면 새로 만들어요.
    const cur = await auth(req, env);
    if (cur && !cur.google) u = cur;
    else {
      u = { id: 'u_' + crypto.randomUUID().slice(0, 12), token: crypto.randomUUID() + crypto.randomUUID(), credits: START_CREDITS, hist: [{ t: Date.now(), k: 'start', n: START_CREDITS }], redeemed: [], createdAt: Date.now() };
    }
    await env.KV.put('acct:g:' + g.sub, u.token);
  }
  u.google = { ...g, at: Date.now() };
  await save(env, u);
  return { token: u.token, ...pub(u) };
}
async function syncData(req, user, env) {
  if (!user.google) throw err('login_required', '구글로 로그인하면 저장돼요.', 403);
  const app = new URL(req.url).searchParams.get('app');
  if (req.method === 'GET' && !app) {
    const out = {};
    await Promise.all(SYNC_APPS.map(async a => { out[a] = JSON.parse(await env.KV.get(`data:${user.id}:${a}`) || 'null'); }));
    return { apps: out };
  }
  if (!SYNC_APPS.includes(app)) throw err('bad_request', '저장할 수 없는 항목이에요.');
  const key = `data:${user.id}:${app}`;
  if (req.method === 'GET') return { app, ...(JSON.parse(await env.KV.get(key) || 'null') || { data: null, t: 0 }) };
  const b = await req.json();
  if (typeof b.data !== 'string') throw err('bad_request', '저장할 내용이 없어요.');
  if (b.data.length > SYNC_MAX) throw err('too_big', '저장할 내용이 너무 커요. 사진을 조금 줄여 주세요.', 413);
  const t = Math.min(+b.t || Date.now(), Date.now());
  const prev = JSON.parse(await env.KV.get(key) || 'null');
  if (prev && prev.t > t) return { app, stale: true, ...prev };
  await env.KV.put(key, JSON.stringify({ data: b.data, t }));
  return { app, t };
}
async function redeem(user, b, env) {
  const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!code) throw err('bad_request', '코드를 입력해 주세요.');
  if (user.redeemed.includes(code)) throw err('used', '이미 쓴 코드예요.');
  const c = JSON.parse(await env.KV.get('code:' + code) || 'null');
  if (!c || c.active === false) throw err('not_found', '없는 코드예요. 철자를 확인해 주세요.', 404);
  user.redeemed.push(code); user.credits += c.credits; user.hist.unshift({ t: Date.now(), k: 'code', n: c.credits });
  await save(env, user);
  return { added: c.credits, ...pub(user) };
}
async function feedback(user, b, env) {
  const text = String(b.text || '').trim().slice(0, 2000);
  if (!text) throw err('bad_request', '내용을 적어 주세요.');
  const id = Date.now() + '-' + crypto.randomUUID().slice(0, 6);
  await env.KV.put('fb:' + id, JSON.stringify({ t: Date.now(), kind: b.kind === 'bug' ? 'bug' : 'idea', text, uid: user.id, ua: String(b.ua || '').slice(0, 160) }));
  return { ok: true };
}
async function admin(path, req, env, cors) {
  if (!env.ADMIN_KEY || req.headers.get('x-admin-key') !== env.ADMIN_KEY) return fail('forbidden', '관리자 키가 맞지 않아요.', 403, cors);
  if (path === '/api/admin/codes') {
    const b = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    if (b.code) {
      const code = String(b.code).toUpperCase().replace(/[^A-Z0-9가-힣_-]/g, ''), n = Math.round(+b.credits);
      if (!code || !(n > 0)) return fail('bad_request', '코드와 크레딧 수를 넣어 주세요.', 400, cors);
      await env.KV.put('code:' + code, JSON.stringify({ credits: n, active: true, createdAt: Date.now() }));
    }
    const list = await env.KV.list({ prefix: 'code:' });
    const codes = await Promise.all(list.keys.map(async k => ({ code: k.name.slice(5), ...JSON.parse(await env.KV.get(k.name)) })));
    return json({ codes }, 200, cors);
  }
  if (path === '/api/admin/image') {
    if (!env.OPENAI_API_KEY) return fail('setup', '서버에 OpenAI API 키가 없어요.', 500, cors);
    return json(await image(await req.json(), env), 200, cors);
  }
  if (path === '/api/admin/sample') {
    const b = await req.json();
    if (!/^[a-z0-9-]{1,20}$/.test(b.name || '') || !/^data:image\/jpeg;base64,/.test(b.data || '') || b.data.length > 2_000_000) return fail('bad_request', '샘플 사진 형식이 맞지 않아요.', 400, cors);
    await env.KV.put('sample:' + b.name, b.data);
    return json({ ok: true }, 200, cors);
  }
  if (path === '/api/admin/feedback') {
    const list = await env.KV.list({ prefix: 'fb:' });
    const items = await Promise.all(list.keys.slice(-200).map(async k => JSON.parse(await env.KV.get(k.name))));
    return json({ items: items.sort((a, b) => b.t - a.t) }, 200, cors);
  }
  return fail('not_found', '없는 주소예요.', 404, cors);
}

async function samples(env, cors) {
  const list = await env.KV.list({ prefix: 'sample:' });
  const out = {};
  await Promise.all(list.keys.map(async k => { out[k.name.slice(7)] = await env.KV.get(k.name); }));
  return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', ...cors } });
}

// ===== 트렌드 오피스 리더보드 =====
// 닉네임·경험치만 저장해요. key는 처음 올린 브라우저만 알고 있어서, 다른 사람이 같은 id로 덮어쓸 수 없어요.
async function officeBoard(env) {
  const all = JSON.parse(await env.KV.get('office:board') || '{}');
  return Object.entries(all).map(([id, r]) => ({ id, nick: r.nick, xp: r.xp, lv: r.lv, streak: r.streak, look: r.look }))
    .sort((a, b) => b.xp - a.xp).slice(0, 100);
}
async function officeScore(req, b, env) {
  const id = String(b.id || ''), key = String(b.key || '');
  if (!/^o_[0-9a-f]{12}$/.test(id) || !/^[0-9a-f]{32}$/.test(key)) throw err('bad_request', '잘못된 요청이에요.');
  const nick = String(b.nick || '').trim().slice(0, 12);
  if (!nick) throw err('bad_request', '닉네임이 없어요.');
  const all = JSON.parse(await env.KV.get('office:board') || '{}'), prev = all[id];
  if (prev && prev.key !== key) throw err('forbidden', '다른 기록이에요.', 403);
  const ip = req.headers.get('cf-connecting-ip') || 'x';
  if (!prev) {  // 새 기록은 네트워크당 하루 5개까지
    const k = `office:new:${new Date().toISOString().slice(0, 10)}:${ip}`, n = +(await env.KV.get(k)) || 0;
    if (n >= 5) throw err('rate_limited', '오늘은 더 등록할 수 없어요.', 429);
    await env.KV.put(k, String(n + 1), { expirationTtl: 60 * 60 * 26 });
  }
  const num = (v, max) => Math.max(0, Math.min(max, Math.floor(+v || 0)));
  all[id] = { key, nick, xp: num(b.xp, 100000), lv: Math.max(1, num(b.lv, 10)), streak: num(b.streak, 3650), look: num(b.look, 3), at: Date.now() };
  // 오래 안 들어온 기록은 정리 (최대 2,000명)
  const ids = Object.keys(all);
  if (ids.length > 2000) ids.sort((a, c) => all[a].at - all[c].at).slice(0, ids.length - 2000).forEach(x => delete all[x]);
  await env.KV.put('office:board', JSON.stringify(all));
  return { ok: true };
}

// ===== OpenAI =====
// 계정에서 쓸 수 있는 모델을 찾아서 고르기 (설정에 TEXT_MODEL, IMAGE_MODEL이 있으면 그걸 써요)
let MODELS = null;
async function models(env) {
  if (MODELS && Date.now() - MODELS.at < 6 * 3600e3) return MODELS;
  const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + env.OPENAI_API_KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw err('ai_error', 'OpenAI 모델 목록을 읽지 못했어요: ' + ((j.error && j.error.message) || r.status), 502);
  const ids = (j.data || []).map(m => m.id);
  const ver = (id) => (id.match(/\d+(\.\d+)?/g) || ['0']).map(Number);
  const newest = (list) => list.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); } return a.length - b.length; })[0];
  const image = newest(ids.filter(id => /^gpt-image-\d/.test(id) && !/mini/.test(id))) || newest(ids.filter(id => /^gpt-image/.test(id))) || (ids.includes('dall-e-3') ? 'dall-e-3' : null);
  const text = ['gpt-4o-mini', 'gpt-4.1-mini'].find(id => ids.includes(id)) || newest(ids.filter(id => /^gpt-[\d.]+-mini$/.test(id))) || newest(ids.filter(id => /^gpt-[\d.]+o?$/.test(id)));
  return MODELS = { at: Date.now(), text, image, all: ids.filter(id => /^(gpt|dall-e)/.test(id)).slice(0, 80) };
}
async function openai(env, path, body, isForm) {
  const r = await fetch('https://api.openai.com/v1' + path, {
    method: 'POST',
    headers: isForm ? { authorization: 'Bearer ' + env.OPENAI_API_KEY } : { authorization: 'Bearer ' + env.OPENAI_API_KEY, 'content-type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (j.error && j.error.message) || 'OpenAI 오류', c = (j.error && j.error.code) || '';
    if (c === 'insufficient_quota') throw err('no_quota', 'OpenAI 계정에 잔액이 없어요. platform.openai.com 결제 페이지에서 충전해 주세요.', 502);
    if (r.status === 429) throw err('rate_limited', 'OpenAI 사용 한도에 걸렸어요. 잠시 뒤 다시 해 주세요.', 502);
    throw err('ai_error', 'AI가 답하지 못했어요: ' + m.slice(0, 160), 502);
  }
  return j;
}
async function ai(b, env) {
  const prompt = String(b.prompt || '').slice(0, 60000);
  const imgs = (Array.isArray(b.images) ? b.images : []).slice(0, 6).filter(u => /^data:image\//.test(u));
  const content = [{ type: 'text', text: prompt }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u, detail: 'low' } }))];
  const j = await openai(env, '/chat/completions', {
    model: env.TEXT_MODEL || (await models(env)).text || 'gpt-4o-mini',
    messages: [{ role: 'system', content: b.json ? 'Reply with one valid JSON object only.' : 'You are a helpful Korean copywriter.' }, { role: 'user', content }],
    ...(b.json ? { response_format: { type: 'json_object' } } : {}),
  });
  const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  if (!b.json) return { text };
  try { return { json: JSON.parse(text) }; } catch { throw err('ai_error', 'AI 답을 읽지 못했어요. 다시 해 주세요.', 502); }
}
async function image(b, env) {
  const style = IMAGE_STYLES[b.style] || IMAGE_STYLES.photo;
  const prompt = `${String(b.prompt || '').slice(0, 1500)}\nStyle: ${style}. No text, letters, logos or watermarks in the image.`;
  const model = env.IMAGE_MODEL || (await models(env)).image;
  if (!model) throw err('ai_error', '이 OpenAI 계정에서 쓸 수 있는 그림 모델이 없어요. OpenAI 조직 인증(Verify Organization)을 해 주세요.', 502);
  const body = model.startsWith('dall-e')
    ? { model, prompt: prompt.slice(0, 3900), size: '1024x1792', response_format: 'b64_json', n: 1 }
    : { model, prompt, size: '1024x1536', quality: b.quality === 'high' ? 'high' : 'medium', n: 1 };
  const j = await openai(env, '/images/generations', body);
  const d = j.data && j.data[0];
  if (!d || !d.b64_json) throw err('ai_error', '그림을 받지 못했어요.', 502);
  return { image: 'data:image/png;base64,' + d.b64_json };
}
// 캐릭터 포즈: 올린 캐릭터 그림을 그대로 살려 다른 포즈로 다시 그리기 (mode 'sheet'는 앞·옆·뒤 턴어라운드)
function dataUrlFile(u, name) {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(String(u || ''));
  if (!m) throw err('bad_request', '그림 파일을 읽지 못했어요. PNG·JPG·WEBP로 올려 주세요.');
  const bin = atob(m[3]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > 12 * 1024 * 1024) throw err('bad_request', '그림이 너무 커요. 12MB 이하로 올려 주세요.');
  return new File([bytes], name + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]), { type: m[1] });
}
async function pose(b, env) {
  const imgs = (Array.isArray(b.images) ? b.images : []).slice(0, 2);
  if (!imgs.length) throw err('bad_request', '먼저 캐릭터 그림을 올려 주세요.');
  const model = env.IMAGE_MODEL || (await models(env)).image;
  if (!model || model.startsWith('dall-e')) throw err('ai_error', '포즈 만들기는 gpt-image 모델이 필요해요. OpenAI 조직 인증(Verify Organization)을 해 주세요.', 502);
  const sheet = b.mode === 'sheet', clear = b.bg !== 'white', doodle = b.style === 'emoticon';
  const look = doodle
    ? ' Draw it as a cute Korean messenger emoticon sticker: loose hand-drawn felt-pen doodle, slightly wobbly uneven black outlines, simple flat colors with soft blush, a big exaggerated expression, chubby simple body. Add small hand-drawn comic marks around the character only where they fit the mood (motion lines, sparkles, sweat drops, hearts, tears). Keep the character recognizable: same species/shape, colors, markings and accessories, only simplified into this doodle sticker style.'
    : '';
  const bgText = clear ? 'fully transparent background' : 'plain pure white background';
  const keep = doodle ? 'Keep the same character identity as the first image.' : 'Keep it exactly the same character as the first image: same face, proportions, colors, outfit, accessories, line weight and drawing style. Do not redesign or restyle the character.';
  const prompt = sheet
    ? `Make a character turnaround sheet of the character in the image. Show four full-body views in one row at the same scale: front, three-quarter, side, back, in a relaxed neutral standing pose. ${keep} Plain pure white background, no labels, no text.`
    : `Redraw the character from the first image in a new pose for a webtoon / Instagram comic panel.\nPose: ${String(b.pose || '').slice(0, 800)}\n${keep}${imgs.length > 1 ? ' The second image is a turnaround sheet of the same character; use it for views from the side or back.' : ''} Show only this one character, whole body unless the pose says close-up, centered with a little margin. Small props mentioned in the pose are fine.${look} ${bgText}. No text, speech bubbles, frames or watermarks.`;
  const send = async (withBg) => {
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', prompt); fd.append('n', '1');
    fd.append('size', sheet ? '1536x1024' : '1024x1024'); fd.append('quality', b.quality === 'high' ? 'high' : 'medium');
    if (withBg) { fd.append('background', 'transparent'); fd.append('output_format', 'png'); }
    imgs.forEach((u, i) => fd.append('image[]', dataUrlFile(u, 'ref' + i)));
    return openai(env, '/images/edits', fd, true);
  };
  let j;
  try { j = await send(clear && !sheet); }
  catch (e) { if (clear && !sheet && /background|output_format/i.test(e.message)) j = await send(false); else throw e; }
  const d = j.data && j.data[0];
  if (!d || !d.b64_json) throw err('ai_error', '그림을 받지 못했어요.', 502);
  return { image: 'data:image/png;base64,' + d.b64_json };
}
async function transcribe(form, env) {
  const f = form.get('file');
  if (!f || typeof f === 'string') throw err('bad_request', '파일이 없어요.');
  if (f.size > 25 * 1024 * 1024) throw err('too_big', '25MB가 넘는 파일은 받아 적을 수 없어요. 영상을 짧게 자르거나 소리만 저장해서 올려 주세요.', 413);
  const fd = new FormData(); fd.append('file', f, f.name || 'audio.mp4'); fd.append('model', env.STT_MODEL || 'whisper-1'); fd.append('language', 'ko');
  const j = await openai(env, '/audio/transcriptions', fd, true);
  return { text: j.text || '' };
}

// ===== 링크 읽기 =====
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const meta = (html, name) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i')); return m ? decode(m[1]) : ''; };
async function readUrl(url) {
  let u; try { u = new URL(url); } catch { throw err('bad_request', '주소가 올바르지 않아요.'); }
  if (!/^https?:$/.test(u.protocol)) throw err('bad_request', 'http 주소만 읽을 수 있어요.');
  const r = await fetch(u.toString(), { headers: { 'user-agent': 'Mozilla/5.0 (compatible; CuttoryBot/1.0)', 'accept-language': 'ko,en;q=0.8' }, redirect: 'follow' });
  if (!r.ok) throw err('fetch_failed', `사이트가 읽기를 막았어요 (${r.status}). 글을 직접 붙여 넣어 주세요.`, 502);
  const html = (await r.text()).slice(0, 3_000_000);
  if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return youtube(html);
  const title = meta(html, 'og:title') || decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  let body = (html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<body[\s\S]*<\/body>/i) || [html])[0];
  body = body.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const text = decode(body).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 1).join('\n');
  return { text: (title ? title + '\n\n' : '') + text.slice(0, 20000) };
}
async function youtube(html) {
  const title = meta(html, 'og:title'), desc = (html.match(/"shortDescription":"((?:\\.|[^"\\])*)"/) || [])[1];
  let out = title + '\n\n' + (desc ? JSON.parse('"' + desc + '"') : meta(html, 'og:description'));
  const m = html.match(/"captionTracks":(\[.*?\])/);
  if (m) {
    try {
      const tracks = JSON.parse(m[1]);
      const t = tracks.find(x => /^ko/.test(x.languageCode)) || tracks[0];
      const xml = await (await fetch(t.baseUrl)).text();
      const cap = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(x => decode(decode(x[1])).replace(/\s+/g, ' ')).join(' ');
      if (cap) out += '\n\n[자막]\n' + cap.slice(0, 18000);
    } catch {}
  }
  return { text: out.trim(), captions: !!m };
}
