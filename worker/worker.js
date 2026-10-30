// 컷토리 서버 (Cloudflare Workers)
// 필요한 설정: 비밀 값 OPENAI_API_KEY, ADMIN_KEY / KV 바인딩 KV / (선택) ALLOWED_ORIGIN, TEXT_MODEL, IMAGE_MODEL
const COST = { gen: 10, video: 15, link: 3, person: 5, titles: 2, polish: 1, translate: 5, image: 20, transcribe: 10 };
const START_CREDITS = 100;
const NEW_USERS_PER_IP_PER_DAY = 3;
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
      if (path === '/api/session') return json(await newSession(req, env), 200, cors);
      if (path.startsWith('/api/admin/')) return await admin(path, req, env, cors);

      const user = await auth(req, env);
      if (!user) return fail('unauthorized', '다시 접속해 주세요.', 401, cors);
      if (path === '/api/me') return json(pub(user), 200, cors);
      if (path === '/api/redeem') return json(await redeem(user, await req.json(), env), 200, cors);
      if (path === '/api/feedback') return json(await feedback(user, await req.json(), env), 200, cors);

      if (!env.OPENAI_API_KEY) return fail('setup', '서버에 OpenAI API 키가 없어요.', 500, cors);
      if (path === '/api/ai') {
        const b = await req.json();
        return json(await charged(user, COST[b.kind] ? b.kind : 'gen', env, () => ai(b, env)), 200, cors);
      }
      if (path === '/api/image') {
        const b = await req.json();
        return json(await charged(user, 'image', env, () => image(b, env)), 200, cors);
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
const pub = (u) => ({ id: u.id, credits: u.credits, hist: u.hist.slice(0, 40), redeemed: u.redeemed });
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

// ===== OpenAI =====
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
    model: env.TEXT_MODEL || 'gpt-4o-mini',
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
  const size = b.format === 'reels' ? '1024x1536' : '1024x1536';
  const j = await openai(env, '/images/generations', { model: env.IMAGE_MODEL || 'gpt-image-1', prompt, size, quality: b.quality === 'high' ? 'high' : 'medium', n: 1 });
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
