// 트렌드 오피스 리포트 만들기
// 마케팅 뉴스(RSS·구글 뉴스)를 모아 컷토리 서버의 AI로 리포트를 쓰고, office/reports/에 저장한 뒤 office/reports-data.js를 다시 만들어요.
//
//   node office/make-report.mjs                      오늘 날짜(한국 시간)에 맞춰 필요한 리포트를 모두 (매일 데일리, 월요일 위클리, 1일 먼슬리, 분기 첫날 분기)
//   node office/make-report.mjs daily 2026-10-30     그 날짜의 데일리만
//   node office/make-report.mjs weekly 2026-W43      그 주의 위클리만
//   node office/make-report.mjs monthly 2026-10      그 달의 먼슬리만
//   node office/make-report.mjs quarterly 2026-Q3    그 분기 리포트만
//   node office/make-report.mjs build                reports-data.js만 다시 만들기
//   --force 를 붙이면 이미 있는 리포트도 다시 써요.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.CUTTORY_API || 'https://cuttory-api.wsxqaz1015.workers.dev').replace(/\/$/, '');
const FORCE = process.argv.includes('--force');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const KEEP = { daily: 45, weekly: 16, monthly: 12, quarterly: 8 };  // reports-data.js에 담는 개수 (나머지는 json으로만 남아요)

// ───── 날짜 (한국 시간) ─────
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const ymd = d => d.toISOString().slice(0, 10);
const day = s => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
function isoWeek(s) {
  const d = day(s), wd = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - wd + 3);
  const y = d.getUTCFullYear(), first = new Date(Date.UTC(y, 0, 4));
  const w = 1 + Math.round(((d - first) / 864e5 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}
function weekRange(id) {
  const [y, w] = id.split('-W').map(Number), jan4 = new Date(Date.UTC(y, 0, 4));
  const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1) * 7);
  return [ymd(mon), addDays(ymd(mon), 6)];
}
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
function label(kind, id) {
  if (kind === 'daily') return `${id.slice(0, 4)}년 ${+id.slice(5, 7)}월 ${+id.slice(8)}일 (${DOW[day(id).getUTCDay()]})`;
  if (kind === 'weekly') { const [a, b] = weekRange(id); return `${id.slice(0, 4)}년 ${+id.split('W')[1]}주차 (${md(a)} ~ ${md(b)})`; }
  if (kind === 'monthly') return `${id.slice(0, 4)}년 ${+id.slice(5)}월`;
  return `${id.slice(0, 4)}년 ${id.slice(-1)}분기`;
}
function range(kind, id) {
  if (kind === 'daily') return [addDays(id, -1), id];
  if (kind === 'weekly') return weekRange(id);
  if (kind === 'monthly') { const y = +id.slice(0, 4), m = +id.slice(5); return [`${id}-01`, ymd(new Date(Date.UTC(y, m, 0)))]; }
  const y = +id.slice(0, 4), q = +id.slice(-1);
  return [`${y}-${String(q * 3 - 2).padStart(2, '0')}-01`, ymd(new Date(Date.UTC(y, q * 3, 0)))];
}

// ───── 뉴스 모으기 ─────
const FEEDS = [
  ['브랜드브리프', 'https://www.brandbrief.co.kr/rss/allArticle.xml'],
  ['매드타임스', 'https://www.madtimes.org/rss/allArticle.xml'],
  ['더피알', 'https://www.the-pr.co.kr/rss/allArticle.xml'],
  ['모비인사이드', 'https://www.mobiinside.co.kr/feed/'],
];
const QUERIES = ['마케팅 캠페인', '광고 캠페인 공개', '팝업스토어 오픈', '밈 마케팅', '브랜드 콜라보', '인스타그램 릴스 트렌드', '숏폼 마케팅', 'SNS 화제 브랜드'];
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; CuttoryTrendOffice/1.0)' };
const decode = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? m[1] : ''; };
function pubDay(s) {
  const t = Date.parse(s.replace(/^(\d{4}-\d\d-\d\d) /, '$1T') + (/^\d{4}-\d\d-\d\d \d/.test(s) ? '+09:00' : ''));
  return isNaN(t) ? '' : ymd(new Date(t + 9 * 3600e3));
}
async function getText(url, ms = 15000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
function parseRss(xml, source) {
  return (xml.match(/<item[\s>][\s\S]*?<\/item>/g) || []).map(x => ({
    title: decode(tag(x, 'title')), url: decode(tag(x, 'link')).trim(),
    date: pubDay(decode(tag(x, 'pubDate'))), desc: decode(tag(x, 'description')).slice(0, 320),
    source: decode(tag(x, 'source')) || source,
  }));
}
async function collect(from, to) {
  const all = [], fresh = Date.now() - day(from) < 5 * 864e5;
  if (fresh) for (const [name, url] of FEEDS) {
    try { all.push(...parseRss(await getText(url), name)); } catch (e) { console.warn('피드 실패', name, e.message); }
  }
  for (const q of QUERIES) {
    const u = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} after:${addDays(from, -1)} before:${addDays(to, 1)}`)}&hl=ko&gl=KR&ceid=KR:ko`;
    try {
      all.push(...parseRss(await getText(u), '구글 뉴스').map(it => {
        const m = it.title.match(/^(.*) - ([^-]+)$/);  // "제목 - 언론사"
        return m ? { ...it, title: m[1].trim(), source: it.source || m[2].trim(), desc: '' } : it;
      }));
    } catch (e) { console.warn('검색 실패', q, e.message); }
  }
  const seen = new Set();
  const picked = all.filter(it => it.title && /^https?:/.test(it.url) && it.date >= from && it.date <= to)
    .filter(it => { const k = it.title.replace(/\W/g, '').slice(0, 24); if (seen.has(k)) return false; seen.add(k); return true; })
    .filter(it => !/부음|부고|인사\]|\[인사|주가|증시|코스피|환율/.test(it.title))
    .sort((a, b) => (a.source === '구글 뉴스' || a.desc === '') - (b.source === '구글 뉴스' || b.desc === '') || b.date.localeCompare(a.date))
    .slice(0, 60);
  // 언론사 피드에서 온 기사는 본문 앞부분까지 읽어서 AI에게 더 많은 재료를 준다
  const direct = picked.filter(it => !/news\.google\.com/.test(it.url));
  for (let i = 0; i < direct.length; i += 6) await Promise.all(direct.slice(i, i + 6).map(async it => {
    try { it.desc = articleText(await getText(it.url, 10000)) || it.desc; } catch {}
  }));
  return picked;
}
function articleText(html) {
  const og = decode((html.match(/property="og:description"\s+content="([^"]*)"/) || [])[1]);
  const body = (html.replace(/<(script|style|nav|header|footer)[\s\S]*?<\/\1>/g, '').match(/<p[^>]*>[\s\S]*?<\/p>/g) || [])
    .map(decode).filter(t => t.length > 40 && !/저작권|무단|기자 =|구독|Copyright/i.test(t)).join(' ');
  return (body.length > og.length ? body : og).slice(0, 900);
}

// ───── AI ─────
// OPENAI_API_KEY가 있으면 OpenAI를 바로 부르고(OFFICE_MODEL로 모델 지정), 없으면 컷토리 서버의 /api/ai를 써요.
async function askOpenAI(prompt) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.OFFICE_MODEL || 'gpt-5.4-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: 'Reply with one valid JSON object only.' }, { role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(300000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI: ' + ((j.error && j.error.message) || r.status));
  return JSON.parse(j.choices[0].message.content);
}
let token = process.env.CUTTORY_TOKEN || '';
async function ask(prompt) {
  if (process.env.OPENAI_API_KEY) return askOpenAI(prompt);
  for (let i = 0; i < 3; i++) {
    if (!token) {
      const r = await fetch(API + '/api/session', { method: 'POST' }), j = await r.json();
      if (!r.ok) throw new Error('세션: ' + (j.message || r.status));
      token = j.token;
    }
    const r = await fetch(API + '/api/ai', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, json: true, kind: 'gen' }), signal: AbortSignal.timeout(180000),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.json) return j.json;
    console.warn('AI 실패', r.status, j.message);
    if (r.status === 401 || j.code === 'no_credits') token = '';
    else if (r.status >= 500 && i < 2) await new Promise(s => setTimeout(s, 4000));
    else throw new Error('AI: ' + (j.message || r.status));
  }
  throw new Error('AI가 세 번 다 답하지 못했어요');
}

const ITEM_SPEC = `{"tag":"캠페인|광고|팝업|콜라보|밈|숏폼|SNS|플랫폼|업계|AI 중 하나","title":"카드 제목. 브랜드·사례 이름이 들어간 구체적인 한 줄 (40자 안쪽)","brand":"브랜드 · 대행사 (모르면 브랜드만)","body":"무슨 일인지 3문장. 누가, 무엇을, 어떻게 했는지와 기사에 있는 숫자·날짜·장소","why":"이 사례가 먹히는 구조를 짚는 2문장. '효과적이다', '중요하다' 같은 뻔한 말 대신 어떤 장치가 왜 통했는지","action":"준비생·주니어가 오늘 30분 안에 해볼 구체적인 과제 1문장. 무엇을 보고 어떤 결과물(한 줄 카피, 표, 기획안 3줄 등)을 만들지","keywords":["키워드 2~4개"],"src":[근거 자료 번호]}`;
const RULES = `규칙:
- 반드시 아래 '자료'에 있는 내용만 쓰세요. 자료에 없는 숫자·날짜·수상·결과를 지어내지 마세요. 확실하지 않으면 빼세요.
- 모든 카드의 "src"에는 근거가 된 자료 번호를 1개 이상 넣으세요.
- 한국어 존댓말이 아닌 담백한 리포트 문체(~했다, ~다)로 쓰세요. 이모지는 쓰지 마세요.
- 각 섹션의 카드 수를 정확히 지키세요. 자료가 모자라면 그 섹션 주제에 가장 가까운 자료로 채우세요.
- 'AI 활용 캠페인을 기획해보자'처럼 막연한 문장은 쓰지 마세요. 사례 이름과 숫자로 구체적으로 쓰세요.
- 카드끼리 같은 사례를 반복하지 마세요. 마케팅·광고·브랜드와 관계없는 기사(정치, 사건사고, 실적, 인사)는 고르지 마세요.
- quiz는 리포트 본문을 읽으면 풀 수 있는 4지선다. answer는 정답 보기의 번호(0부터), explain은 어느 카드에 나온 내용인지와 이유 1~2문장.`;

function articleList(items) {
  return items.map((it, i) => `[${i + 1}] (${it.date} · ${it.source}) ${it.title}${it.desc ? ` — ${it.desc}` : ''}`).join('\n');
}

const PLAN = {
  daily: weekend => weekend
    ? { sections: [['주말에 보는 밈·콘텐츠', '이번 주 SNS에서 화제가 된 콘텐츠와 브랜드의 올라타기', 4], ['가볍게 보는 브랜드 소식', '팝업·콜라보처럼 주말에 직접 가볼 만한 것', 3]], quiz: 3 }
    : { sections: [['오늘의 마케팅 아이디어', '바로 레퍼런스로 쓸 만한 캠페인·광고 사례', 4], ['지금 뜨는 밈·콘텐츠', 'SNS에서 도는 포맷과 브랜드의 활용법', 3], ['브랜드·업계 뉴스', '플랫폼·유통·대행사 쪽 움직임', 3]], quiz: 3 },
  weekly: () => ({ sections: [['이번 주 TOP 트렌드', '한 주 동안 가장 많이 언급된 흐름을 순위로', 5], ['이번 주의 밈', '브랜드가 올라탄 밈과 쓸 때 주의할 점', 3], ['주목할 캠페인', '포트폴리오 레퍼런스로 저장할 만한 사례', 3]], quiz: 4 }),
  monthly: () => ({ sections: [['이달의 키워드', '한 달을 정리하는 흐름 다섯 가지', 5], ['이달의 캠페인 베스트', '다시 봐도 좋은 사례', 4], ['다음 달 체크포인트', '이어서 지켜볼 일정과 흐름', 3]], quiz: 5 }),
  quarterly: () => ({ sections: [['분기 결산 트렌드', '석 달 동안 굵직했던 변화', 5], ['분기의 캠페인', '업계가 주목한 사례', 4], ['다음 분기 전망', '준비해 둘 것', 3]], quiz: 5 }),
};

const KIND_KO = { daily: '데일리', weekly: '위클리', monthly: '먼슬리', quarterly: '분기' };
const ROLE = '당신은 한국 마케팅 트렌드 리포트를 쓰는 에디터입니다. 독자는 마케팅 취업 준비생과 주니어 마케터입니다.';
const EXAMPLE = `{"tag":"팝업","title":"(문체 예시) 라면 브랜드 A, 편의점 앞 '야식 정류장' 팝업","brand":"브랜드 A · 대행사 B","body":"브랜드 A가 11월 한 달 동안 서울 편의점 20곳 앞에 버스 정류장 모양 팝업을 세웠다. 밤 10시 이후 정류장 QR을 찍으면 신제품 컵라면 1+1 쿠폰이 나온다. 첫 주에만 쿠폰 3만 장이 내려받아졌다.","why":"제품을 먹는 시간과 장소(퇴근길 밤, 편의점)에 맞춰 접점을 만들었다. 정류장이라는 익숙한 사물이 사진을 찍게 만드는 장치가 됐다.","action":"내가 좋아하는 브랜드 하나를 골라 '이 제품을 가장 많이 쓰는 시간과 장소'를 한 줄로 쓰고, 그 장소에 놓을 팝업 이름 3개를 지어 보자."}`;

// 1) 섹션마다 쓸 자료 고르기 → 2) 섹션별로 카드 쓰기 → 3) 헤드라인·요약·퀴즈 쓰기
async function write(kind, id, plan, items, extra) {
  const all = articleList(items);
  const pick = await ask(`${ROLE}
${label(kind, id)} ${KIND_KO[kind]} 리포트에 실을 자료를 고르세요. ${extra || ''}
섹션: ${plan.sections.map(([t, d, n], i) => `${i + 1}. "${t}" (${d}) ${n}개`).join(' / ')}
마케팅·광고·브랜드·콘텐츠와 관계없는 자료(정치, 사건사고, 단순 실적, 인사, 주가)는 고르지 마세요. 같은 사례를 다룬 자료는 하나만 고르세요. 섹션끼리 겹치지 않게 고르세요.
JSON으로만 답하세요: {"sections":[[섹션1 자료 번호들],[섹션2 자료 번호들],...]}

자료:
${all}`);
  const used = new Set(), sections = [];
  for (const [si, [title, desc, n]] of plan.sections.entries()) {
    const nums = [].concat((pick.sections || [])[si] || []).map(Number).filter(x => items[x - 1] && !used.has(x)).slice(0, n);
    nums.forEach(x => used.add(x));
    if (!nums.length) continue;
    const out = await ask(`${ROLE}
${label(kind, id)} ${KIND_KO[kind]} 리포트의 "${title}" 섹션(${desc})에 들어갈 카드 ${nums.length}개를 쓰세요. 자료 하나당 카드 하나, 아래 자료 순서대로 쓰세요.
JSON으로만 답하세요: {"items":[카드 ${nums.length}개]}
카드 모양: ${ITEM_SPEC}
문체 예시 (내용은 지어낸 것이니 따라 쓰지 말고 구체성과 문체만 참고): ${EXAMPLE}
${RULES}

자료:
${nums.map(x => `[${x}] (${items[x - 1].date} · ${items[x - 1].source}) ${items[x - 1].title}${items[x - 1].desc ? ` — ${items[x - 1].desc}` : ''}`).join('\n')}`);
    sections.push({ title, description: desc, items: (out.items || []).map((it, i) => ({ ...it, src: [].concat(it.src || []).length ? it.src : [nums[i]] })) });
  }
  const cardText = sections.map(s => `## ${s.title}\n` + s.items.map((it, i) => `${i + 1}. ${it.title} — ${it.body} ${it.why || ''}`).join('\n')).join('\n\n');
  const meta = await ask(`${ROLE}
아래는 ${label(kind, id)} ${KIND_KO[kind]} 리포트의 본문 카드입니다. 이 카드들만 보고 리포트 머리말과 퀴즈를 JSON으로만 쓰세요.
{"headline":"리포트 전체를 꿰는 한 줄. 사례 이름이나 현상이 드러나게 (30자 안쪽, '마케팅 트렌드' 같은 뻔한 말 금지)","summary":["요약 문단 3개. 각 문단은 2문장이고 카드에 나온 사례 이름을 넣으세요"],"keywords":["키워드 6~10개 (브랜드·캠페인·현상 이름)"],"follow_up":["이어서 지켜볼 것 3개, 구체적으로"],"quiz":[{"q":"질문","options":["보기 4개"],"answer":0,"explain":"어느 섹션 몇 번 카드에 나온 내용인지와 이유"} 를 ${plan.quiz}개]}
${RULES}

카드:
${cardText}`);
  return { ...meta, sections };
}

// 모델이 정답을 한 자리에 몰아 두는 버릇이 있어서 보기를 섞는다
function shuffleQuiz(qs, seed) {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32;
  return (qs || []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 3 && q.options[q.answer] != null).map(q => {
    const order = q.options.map((_, i) => i).sort(() => rnd() - .5);
    return { q: q.q, options: order.map(i => String(q.options[i])), answer: order.indexOf(q.answer), explain: q.explain || '' };
  });
}

function finish(kind, id, plan, out, srcOf) {
  const sections = (out.sections || []).map((s, si) => ({
    title: s.title || plan.sections[si]?.[0] || '', description: s.description || plan.sections[si]?.[1] || '',
    items: (s.items || []).map(it => {
      const sources = [];
      for (const n of [].concat(it.src || [])) for (const x of srcOf(+n)) if (!sources.some(y => y.url === x.url)) sources.push(x);
      return { tag: it.tag || '', title: it.title || '', brand: it.brand || '', body: it.body || '', why: it.why || '', action: it.action || '', keywords: (it.keywords || []).slice(0, 5), sources: sources.slice(0, 3) };
    }).filter(it => it.title && it.body && it.sources.length).map((it, i) => ({ rank: i + 1, ...it })),
  })).filter(s => s.items.length);
  if (!sections.length) throw new Error('근거가 확인된 카드가 하나도 없어요');
  return {
    type: kind, period_id: id, period_label: label(kind, id), ...(kind === 'daily' && [0, 6].includes(day(id).getUTCDay()) ? { edition: 'weekend' } : {}),
    headline: out.headline || '', summary: (out.summary || []).slice(0, 3), keywords: (out.keywords || []).slice(0, 10),
    sections, follow_up: (out.follow_up || []).slice(0, 4), quiz: shuffleQuiz(out.quiz, kind + id),
  };
}

const file = (kind, id) => path.join(DIR, 'reports', kind, id + '.json');
const load = (kind, id) => { try { return JSON.parse(fs.readFileSync(file(kind, id), 'utf8')); } catch { return null; } };
const list = kind => { try { return fs.readdirSync(path.join(DIR, 'reports', kind)).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort(); } catch { return []; } };

async function make(kind, id) {
  if (!FORCE && fs.existsSync(file(kind, id))) { console.log(`${kind} ${id}: 이미 있어요`); return; }
  const [from, to] = range(kind, id);
  const plan = PLAN[kind](kind === 'daily' && [0, 6].includes(day(id).getUTCDay()));
  let items, srcOf, extra = '';
  // 위클리 이상은 그 기간의 하위 리포트 카드를 재료로 쓰고, 모자라면 뉴스로 채운다
  const cards = [];
  for (const child of { weekly: ['daily'], monthly: ['weekly', 'daily'], quarterly: ['monthly', 'weekly'] }[kind] || []) {
    if (cards.length >= 12) break;
    for (const cid of list(child)) {
      const d = load(child, cid), end = d && range(child, cid)[1];
      if (!d || end < from || end > to) continue;
      for (const s of d.sections) for (const it of s.items) cards.push({ title: it.title, date: cid, source: d.period_label, desc: `${it.body} ${it.why}`.slice(0, 360), sources: it.sources });
    }
  }
  if (cards.length >= 12) {
    items = cards.slice(0, 70);
    srcOf = n => (cards[n - 1] || {}).sources || [];
    extra = '자료는 이 기간에 나간 하위 리포트의 카드들입니다. 여러 번 나온 흐름일수록 순위를 높게 주세요.';
  } else {
    const news = (await collect(from, to)).slice(0, 70);
    console.log(`${kind} ${id}: 기사 ${news.length}개 모음 (${from} ~ ${to})`);
    if (news.length < 8) throw new Error('기사가 너무 적어요');
    items = news;
    srcOf = n => { const it = news[n - 1]; return it ? [{ name: `${it.source} · ${it.title}`.slice(0, 90), url: it.url, date: it.date }] : []; };
  }
  const doc = finish(kind, id, plan, await write(kind, id, plan, items, extra), srcOf);
  fs.mkdirSync(path.dirname(file(kind, id)), { recursive: true });
  fs.writeFileSync(file(kind, id), JSON.stringify(doc, null, 1) + '\n');
  console.log(`${kind} ${id}: "${doc.headline}" 카드 ${doc.sections.reduce((n, s) => n + s.items.length, 0)}개, 퀴즈 ${doc.quiz.length}개`);
}

function build() {
  const reports = {};
  for (const kind of Object.keys(KEEP)) reports[kind] = list(kind).slice(-KEEP[kind]).map(id => ({ id, doc: load(kind, id) })).filter(r => r.doc);
  const out = `// make-report.mjs가 만드는 파일이에요. 직접 고치지 말고 reports/ 안의 json을 고친 뒤 build 하세요.\nwindow.OFFICE_DATA = ${JSON.stringify({ version: new Date().toISOString().slice(0, 19), reports })};\n`;
  fs.writeFileSync(path.join(DIR, 'reports-data.js'), out);
  console.log('reports-data.js', Object.entries(reports).map(([k, v]) => `${k} ${v.length}`).join(', '));
}

(async () => {
  const [kind, id] = args;
  const jobs = [];
  if (kind && kind !== 'build') jobs.push([kind, id || ymd(kstNow())]);
  if (!kind) {
    const today = ymd(kstNow()), d = day(today);
    jobs.push(['daily', today]);
    if (d.getUTCDay() === 1) jobs.push(['weekly', isoWeek(addDays(today, -7))]);
    if (d.getUTCDate() === 1) {
      const prev = addDays(today, -1);
      jobs.push(['monthly', prev.slice(0, 7)]);
      if ([1, 4, 7, 10].includes(d.getUTCMonth() + 1)) jobs.push(['quarterly', `${prev.slice(0, 4)}-Q${Math.ceil(+prev.slice(5, 7) / 3)}`]);
    }
  }
  let failed = 0;
  for (const [k, i] of jobs) { try { await make(k, i); } catch (e) { failed++; console.error(`${k} ${i} 실패:`, e.message); } }
  build();
  if (failed && failed === jobs.length) process.exit(1);
})();
