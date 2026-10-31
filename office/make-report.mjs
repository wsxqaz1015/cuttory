// 트렌드 오피스 리포트 만들기
// 마케팅 뉴스(RSS·구글 뉴스)를 모아 컷토리 서버의 AI로 리포트를 쓰고, office/reports/에 저장한 뒤 office/reports-data.js를 다시 만들어요.
//
//   node office/make-report.mjs                      오늘 날짜(한국 시간)에 맞춰 필요한 리포트를 모두 (매일 데일리, 월요일 위클리, 1일 먼슬리, 분기 첫날 분기)
//   node office/make-report.mjs daily 2026-10-30     그 날짜의 데일리만
//   node office/make-report.mjs weekly 2026-W43      그 주의 위클리만
//   node office/make-report.mjs monthly 2026-10      그 달의 먼슬리만
//   node office/make-report.mjs quarterly 2026-Q3    그 분기 리포트만
//   node office/make-report.mjs drafts 2026-10-30    그 날 데일리로 제작팀 콘텐츠 시안(카드뉴스·블로그·릴스)만
//   node office/make-report.mjs build                reports-data.js만 다시 만들기
//
// 모든 결과물은 팀장 검토를 거쳐요: 팀원이 시안을 쓰면 팀장이 점수와 수정 지시를 주고, 통과할 때까지 최대 5번까지 고쳐요.
// 통과한(또는 5번째) 시안이 대표 결재함으로 올라가요. 검토 기록은 각 json의 review에 남아요.
//   --force 를 붙이면 이미 있는 리포트도 다시 써요.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const API = (process.env.CUTTORY_API || 'https://cuttory-api.wsxqaz1015.workers.dev').replace(/\/$/, '');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);  // drafts에서 한 종류만 다시 (card|blog|reels)
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


// ───── 팀장 검토 (대표 대신 1차 결재) ─────
const MAX_DRAFTS = 5, PASS_SCORE = 85;
const LEAD = '당신은 마케팅 콘텐츠 에이전시의 깐깐한 팀장입니다. 대표를 대신해 팀원의 시안을 먼저 검토하고, 대표에게 올릴 만한지 판단합니다. 첫 시안은 대부분 고칠 점이 있습니다. 밋밋한 문장, 누구나 쓸 법한 표현, 근거와 다른 내용은 냉정하게 감점하고, 지적은 "어느 부분을 어떻게"까지 구체적으로 씁니다. 잘한 점도 짧게 인정합니다.';
async function leadReview(what, rubric, draft, ref, v) {
  const r = await ask(`${LEAD}
지금 검토할 것: ${what} (시안 ${v}번${v > 1 ? ', 지난 지적을 반영해 고친 버전' : ''})
채점 기준 (100점):
${rubric}
${PASS_SCORE}점 이상이면 통과입니다. 고칠 점은 "어디를 어떻게"가 드러나게 최대 5개, 통과라도 다듬을 점이 있으면 1~2개 적으세요.
JSON으로만 답하세요: {"score":0~100 정수,"pass":true|false,"good":"잘한 점 1문장","feedback":["수정 지시"],"memo":"대표님께 올리는 한 줄 보고 (통과 이유 또는 남은 걱정)"}

시안:
${JSON.stringify(draft).slice(0, 24000)}
${ref ? `\n근거 자료:\n${ref.slice(0, 24000)}` : ''}`);
  const score = Math.max(0, Math.min(100, Math.round(+r.score || 0)));
  return { v, score, pass: score >= PASS_SCORE, good: String(r.good || ''), feedback: [].concat(r.feedback || []).map(String).slice(0, 5), memo: String(r.memo || '') };
}
// 시안 → 팀장 검토 → (통과 못 하면) 수정 … 최대 MAX_DRAFTS번
async function reviewLoop({ name, what, rubric, ref, first, revise, valid, keep }) {
  let draft = first;
  const rounds = [], versions = [];
  for (let v = 1; v <= MAX_DRAFTS; v++) {
    const r = await leadReview(what, rubric, draft, ref, v);
    rounds.push(r); if (keep) versions.push({ v, draft });
    console.log(`  ${name} 시안 ${v}: ${r.score}점 ${r.pass ? '통과' : '수정'}`);
    if (r.pass || v === MAX_DRAFTS) break;
    try { const next = await revise(draft, r.feedback); if (valid(next)) draft = next; else console.warn('  수정본 모양이 이상해서 이전 시안을 다시 봐요'); }
    catch (e) { console.warn('  수정 실패', e.message); }
  }
  const last = rounds[rounds.length - 1];
  return { draft, versions, review: { rounds, passed: last.pass, final_v: last.v, max: MAX_DRAFTS, memo: last.memo } };
}
const REPORT_RUBRIC = `- 근거 (30): 모든 카드 내용이 근거 자료에 있는가. 자료에 없는 숫자·결과·날짜가 있으면 크게 감점
- 구체성 (25): 사례 이름, 숫자, 장소가 들어갔는가. '효과적이다' 같은 뻔한 말이 없는가
- 쓸모 (20): why가 먹힌 구조를 짚고, action이 30분 안에 해볼 구체적 과제인가
- 구성 (15): 헤드라인이 전체를 꿰는가, 카드끼리 겹치지 않는가, 마케팅과 무관한 기사가 섞이지 않았는가
- 문체 (10): 담백한 리포트 문체(~했다), 이모지 없음, 퀴즈 정답이 본문에 있는가`;
function validReport(o) { return o && Array.isArray(o.sections) && o.sections.length && o.sections.every(s => Array.isArray(s.items) && s.items.length && s.items.every(it => it.title && it.body)); }

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
  const first = await write(kind, id, plan, items, extra);
  const cited = n => { const it = items[n - 1]; return it ? `[${n}] (${it.date} · ${it.source}) ${it.title}${it.desc ? ` — ${it.desc}` : ''}` : ''; };
  const refOf = o => [...new Set((o.sections || []).flatMap(s => (s.items || []).flatMap(it => [].concat(it.src || []).map(Number))))].sort((a, b) => a - b).map(cited).filter(Boolean).join('\n');
  const { draft, review } = await reviewLoop({
    name: `${kind} ${id}`, what: `${label(kind, id)} ${KIND_KO[kind]} 리포트`, rubric: REPORT_RUBRIC, ref: refOf(first), first, valid: validReport,
    revise: (cur, fb) => ask(`${ROLE}
당신이 쓴 ${label(kind, id)} ${KIND_KO[kind]} 리포트 초안을 팀장이 돌려보냈습니다. 지적을 모두 반영해 같은 JSON 모양으로 리포트 전체를 다시 쓰세요.
- 섹션 제목과 카드 수는 그대로 두고, 각 카드의 "src" 번호를 유지하세요. 근거가 약한 카드는 같은 섹션의 다른 자료로 바꿔도 되지만 src도 함께 바꾸세요.
- quiz도 고친 본문에 맞춰 다시 쓰세요.
팀장 지적:
${fb.map((f, i) => `${i + 1}. ${f}`).join('\n')}
${RULES}

초안:
${JSON.stringify(cur)}

자료:
${articleList(items)}`),
  });
  const doc = finish(kind, id, plan, draft, srcOf);
  doc.review = review;
  fs.mkdirSync(path.dirname(file(kind, id)), { recursive: true });
  fs.writeFileSync(file(kind, id), JSON.stringify(doc, null, 1) + '\n');
  console.log(`${kind} ${id}: "${doc.headline}" 카드 ${doc.sections.reduce((n, s) => n + s.items.length, 0)}개, 퀴즈 ${doc.quiz.length}개`);
}


// ───── 제작팀 콘텐츠 시안 (그날 데일리로) ─────
const AUDIENCE = '독자는 마케팅에 관심 있는 2030 인스타그램·블로그 팔로워입니다. 친근한 존댓말로, 과장 없이 씁니다.';
const DRAFT_KINDS = {
  card: {
    who: '카드뉴스 디자이너', what: '인스타그램 카드뉴스 6장 문구',
    spec: '{"title":"작업 이름","slides":[{"head":"장마다 큰 제목 (18자 안쪽)","body":"작은 본문 1~2줄 (60자 안쪽)","fact":"이 장 내용의 근거가 된 기사 문장을 그대로 인용 (근거가 필요 없는 마무리 장은 빈 문자열)"} 를 정확히 6장],"caption":"인스타 캡션 3~5줄","hashtags":["해시태그 8개, # 없이"]}',
    guide: '오늘 네이버 뉴스에서 가장 화제인 이슈를 다룹니다. 1장은 스크롤을 멈추게 하는 훅, 2~5장은 무슨 일인지·왜 화제인지·나에게 어떤 의미인지, 6장은 저장·공유·댓글을 부르는 마무리.',
    rubric: `- 훅·바이럴 (30): 1장 제목만 보고도 넘기고 싶고, 저장·공유하고 싶어지는가
- 정확성 (25): 내용이 원본 기사와 맞는가. 기사에 없는 숫자를 지어내지 않았는가. 각 장의 fact가 기사 문장 그대로이고 그 장 내용을 뒷받침하는가
- 흐름 (20): 6장이 훅 → 내용 → 마무리로 자연스럽게 이어지는가
- 형식 (15): 정확히 6장, 제목 18자·본문 60자 안쪽인가
- 캡션 (10): 캡션과 해시태그가 바로 올릴 수 있는 수준인가`,
    ok: d => Array.isArray(d.slides) && d.slides.length >= 5 && d.slides.every(x => x.head),
  },
  blog: {
    who: '블로그 에디터', what: '네이버 블로그 원고',
    spec: '{"title":"검색어가 앞쪽에 들어간 제목","keywords":["검색어 3개"],"intro":"도입 3문장","sections":[{"h":"소제목","p":"본문 4~6문장"} 를 3개],"outro":"마무리 2문장 (댓글·이웃추가 유도는 한 번만)","tags":["태그 8개"]}',
    guide: '검색으로 들어온 사람이 끝까지 읽게, 소제목만 훑어도 내용이 잡히게 씁니다.',
    rubric: `- 검색 (25): 제목 앞쪽과 본문에 검색어가 자연스럽게 들어갔는가
- 정확성 (25): 사례 내용이 원본 카드와 맞는가
- 읽기 쉬움 (25): 소제목만 봐도 흐름이 잡히고 문단이 짧은가
- 쓸모 (15): 읽은 사람이 써먹을 포인트가 있는가
- 마무리 (10): 억지스럽지 않은 마무리와 태그`,
    ok: d => d.title && Array.isArray(d.sections) && d.sections.length >= 2,
  },
  reels: {
    who: '릴스 PD', what: '1분 안쪽 릴스 대본',
    spec: '{"title":"작업 이름","label":"썸네일 상단 시리즈 라벨 (예: 3n살 백수일기 #NN)","thumb":"썸네일 문구 (15자 안팎 질문형)","hook":"첫 화면 큰 타이틀 (작은 라벨 / 큰 글씨)","scenes":[{"sec":"0-3","shot":"화면 (사진·화면 녹화·셀프 촬영 중 혼자 찍을 수 있는 것)","text":"화면 자막 한 줄"} 를 8~14컷, 마지막 컷 끝 초가 60 이하],"ending":"오프닝과 맞물리는 엔딩 질문","caption":"(저장) 첫 줄 훅 + 감상 2~4줄 + 📌 꿀팁 + 공유 유도 한 줄","hashtags":["해시태그 8~10개, # 없이"],"fill":["직접 채워야 할 실제 경험·숫자 목록"]}',
    guide: `@lucky_marketer(리지) 계정 릴스입니다. 퇴사 후 콘텐츠를 만들며 독서 굿즈 펀딩을 준비하는 콘텐츠 마케터, '3n살 백수일기' 시리즈.
- 길이는 1분 안쪽(30~60초), 음악 + 자막(보이스 없음). 컷은 2~5초씩 빠르게, 자막은 짧은 혼잣말 한 줄.
- 말투: 해요체 + "~함/~음" 담백한 마무리, 말끝 흐리기("..//", "..🫠"), 질문형("~일까요..?"), 나를 놀리는 자조와 괄호 드립 "(나야 나)", "(바보)".
- 흐름: 오프닝 타이틀 → 상황 → 📌 꿀팁·알게 된 것 1~3개 → 솔직한 자조 에피소드 → 핵심 장면 → 오프닝과 맞물리는 엔딩 질문 + 다음 편 예고·팔로우 이유.
- 직장인 설정 금지, 실제 경험 미화 금지. 모르는 경험·숫자는 [직접 채우기] 또는 [N]으로 비워 두세요.
- 과장 광고 문구, 긴 설명형 자막, 누구나 쓸 법한 밋밋한 감성 문장은 피합니다.`,
    rubric: `- 훅 (30): 썸네일과 첫 3초에 모르는 사람이 멈추고 끝까지 볼 이유가 생기는가
- 리지다움 (25): 해요체·자조·괄호 드립 말투, 직장인 설정·경험 미화가 없는가, 모르는 건 [직접 채우기]로 비웠는가
- 길이·리듬 (20): 60초 안쪽, 컷 2~5초, 자막이 짧은 한 줄인가
- 찍을 수 있음 (15): 사진·화면 녹화·셀프 촬영으로 혼자 만들 수 있는가
- 캡션 (10): (저장) 첫 줄, 공유 유도, 해시태그 8~10개`,
    ok: d => d.hook && Array.isArray(d.scenes) && d.scenes.length >= 5,
  },
};

// ───── 네이버 뉴스 오늘의 이슈 (카드뉴스 소재) ─────
// 뉴스홈 헤드라인 + 언론사별 많이 본 뉴스 + 댓글 많은 뉴스를 모아, 여러 곳에 걸린 기사일수록 '핫하다'고 봐요.
async function getBuf(url, ms = 15000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
const artId = u => (String(u).match(/article\/(\d+)\/(\d+)/) || []).slice(1).join('/');
async function collectNaver() {
  const pool = new Map();
  const add = (url, title, signal, w) => {
    const id = artId(url); title = decode(title); if (!id || !title) return;
    const it = pool.get(id) || { id, url: `https://n.news.naver.com/article/${id}`, title, signals: [], heat: 0 };
    if (!it.signals.includes(signal)) it.signals.push(signal); it.heat += w; pool.set(id, it);
  };
  try {
    const home = (await getBuf('https://news.naver.com/')).toString('utf8');
    let i = 0;
    for (const m of home.matchAll(/<a href="([^"]+)" class="cnf_news[^"]*"[\s\S]{0,1200}?<strong class="cnf_news_title">([^<]+)<\/strong>/g)) add(m[1], m[2], '뉴스홈 헤드라인', 3 - Math.min(2, i++ / 10));
  } catch (e) { console.warn('네이버 뉴스홈 실패', e.message); }
  for (const [path, name, w] of [['popularDay', '언론사별 많이 본', 3], ['popularMemo', '언론사별 댓글 많은', 4]]) {
    try {
      const h = new TextDecoder('euc-kr').decode(await getBuf(`https://news.naver.com/main/ranking/${path}.naver`));
      for (const m of h.matchAll(/<a href="([^"]+)" class="list_title[^"]*"[^>]*data-nlog-params="[^"]*?rank&#034;:(\d+)[^>]*>([^<]+)<\/a>/g)) add(m[1], m[3], `${name} ${m[2]}위`, w * (6 - Math.min(5, +m[2])) / 5);
    } catch (e) { console.warn('네이버 랭킹 실패', path, e.message); }
  }
  return [...pool.values()].sort((a, b) => b.heat - a.heat).slice(0, 60);
}
async function naverArticle(url) {
  const h = (await getBuf(url, 12000)).toString('utf8');
  const body = (h.match(/<article id="dic_area"[^>]*>([\s\S]*?)<\/article>/) || [])[1] || '';
  const press = decode((h.match(/<meta property="og:article:author" content="([^"]*)"/) || [])[1] || '');
  return { text: decode(body.replace(/<br\s*\/?>/g, ' ')).slice(0, 2500), press };
}


// ───── 모아의 오늘의 핫이슈 (네이버 + 구글 뉴스 + 마케팅 매체) ─────
// 여러 곳에 동시에 걸린 기사일수록 '핫하다'고 보고, 그중 카드뉴스로 쓸만한 5개를 골라 다온에게 넘겨요.
const bigrams = s => { const t = String(s).replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/[^0-9A-Za-z가-힣]/g, ''); const out = new Set(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
const similar = (a, b) => { if (!a.size || !b.size) return 0; let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.min(a.size, b.size); };
async function collectHot(id) {
  const naver = await collectNaver();
  const pool = naver.map(it => ({ ...it, press: '', from: ['네이버'], bg: bigrams(it.title) }));
  const stats = { '네이버 뉴스홈 헤드라인': 0, '네이버 많이 본 뉴스': 0, '네이버 댓글 많은 뉴스': 0, '구글 뉴스 주요 기사': 0 };
  for (const it of naver) for (const s of it.signals) stats[s.startsWith('뉴스홈') ? '네이버 뉴스홈 헤드라인' : s.startsWith('언론사별 많이 본') ? '네이버 많이 본 뉴스' : '네이버 댓글 많은 뉴스']++;
  const merge = (title, url, press, signal, w, src, desc) => {
    const bg = bigrams(title), hit = pool.find(p => similar(p.bg, bg) >= 0.5);
    if (hit) { if (!hit.signals.includes(signal)) hit.signals.push(signal); if (!hit.from.includes(src)) hit.from.push(src); hit.heat += w; if (!hit.press && press) hit.press = press; return; }
    pool.push({ id: url, url, title, press, signals: [signal], heat: w, from: [src], bg, desc });
  };
  try {
    const g = parseRss(await getText('https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko'), '구글 뉴스');
    g.slice(0, 40).forEach((it, i) => {
      const m = it.title.match(/^(.*) - ([^-]+)$/), title = m ? m[1].trim() : it.title, press = it.source !== '구글 뉴스' ? it.source : m ? m[2].trim() : '';
      stats['구글 뉴스 주요 기사']++;
      merge(title, it.url, press, `구글 뉴스 주요 ${i + 1}위`, 3 * (1 - Math.min(0.6, i / 50)), '구글', '');
    });
  } catch (e) { console.warn('구글 뉴스 실패', e.message); }
  for (const [name, url] of FEEDS) {
    try {
      const items = parseRss(await getText(url), name).filter(it => it.date >= addDays(id, -1) && it.date <= id).slice(0, 15);
      stats[`마케팅 매체 · ${name}`] = items.length;
      for (const it of items) merge(it.title, it.url, name, `${name} 새 기사`, 1, '마케팅 매체', it.desc);
    } catch (e) { stats[`마케팅 매체 · ${name}`] = 0; console.warn('피드 실패', name, e.message); }
  }
  // 두 곳 이상에 걸린 기사는 한 번 더 가산점
  for (const p of pool) if (p.from.length > 1) p.heat += 2 * (p.from.length - 1);
  const list = pool.filter(p => !/부음|부고|인사\]|\[인사|주가|증시|코스피|환율|\[속보\]/.test(p.title)).sort((a, b) => b.heat - a.heat).slice(0, 70);
  return { list, stats, total: pool.length, cross: pool.filter(p => p.from.length > 1).length };
}
async function readHot(it) {
  if (artId(it.url)) return naverArticle(it.url);
  if (/news\.google\.com/.test(it.url)) return { text: it.desc || '', press: it.press };  // 구글 뉴스 링크는 원문으로 바로 못 읽어요
  return { text: articleText(await getText(it.url, 10000)) || it.desc || '', press: it.press };
}
const hfile = id => path.join(DIR, 'hot', id + '.json');
async function makeHot(id) {
  if (!FORCE && fs.existsSync(hfile(id))) { console.log(`hot ${id}: 이미 있어요`); return JSON.parse(fs.readFileSync(hfile(id), 'utf8')); }
  const { list, stats, total, cross } = await collectHot(id);
  console.log(`hot ${id}: 기사 ${total}개 모음 (두 곳 이상 ${cross}개)`, JSON.stringify(stats));
  if (list.length < 5) throw new Error('뉴스를 충분히 모으지 못했어요');
  const r = await ask(`당신은 마케팅 에이전시에서 매일 아침 트렌드를 보고하는 데일리 담당 "모아"입니다. 오늘 뽑은 이슈는 카드뉴스 디자이너 "다온"이 인스타그램 카드뉴스로 만듭니다. ${AUDIENCE}
아래는 ${id} 네이버 뉴스(뉴스홈·많이 본·댓글 많은), 구글 뉴스 주요 기사, 마케팅 매체 새 기사를 합친 목록입니다. [ ] 안은 걸린 곳과 순위예요. 여러 곳에 걸릴수록 오늘 화제입니다.
오늘 가장 핫하면서 카드뉴스로 만들었을 때 저장·공유가 많이 될 이슈 5개를 카드뉴스로 좋은 순서대로 고르세요.
- 좋은 것: 많은 사람이 공감하거나 놀랄 생활·경제·소비·트렌드·IT·사회 화제, "나도 알아야 하는" 정보, 브랜드·마케팅 화제
- 피할 것: 정당 간 공방·정치인 발언 다툼처럼 편이 갈리는 정치 기사, 사망·참사·범죄 피해처럼 비극을 소재로 소비하게 되는 기사, 단순 주가·환율, 같은 사건을 다룬 기사 중복
JSON으로만 답하세요: {"top":[{"n":번호,"card_fit":카드뉴스 적합도 0~100,"category":"생활|경제|소비|IT|사회|문화|마케팅 중 하나","why":"왜 오늘 핫한지와 바이럴 포인트 1문장 (어디에 걸렸는지 근거 포함)","angle":"카드뉴스로 풀 각도 1문장"} 를 5개],"note":"모아가 다온에게 1위 이슈를 넘기며 하는 한마디 (친근하게 1문장)"}

${list.map((it, i) => `[${i + 1}] ${it.title}${it.press ? ` (${it.press})` : ''} [${it.signals.join(', ')}]`).join('\n')}`);
  const top = [].concat(r.top || []).map(x => ({ ...x, it: list[+x.n - 1] })).filter(x => x.it).filter((x, i, a) => a.findIndex(y => y.it === x.it) === i).slice(0, 5);
  if (!top.length) throw new Error('모아가 이슈를 고르지 못했어요');
  const items = top.map((x, i) => ({ rank: i + 1, title: x.it.title, url: x.it.url, press: x.it.press || '', signals: x.it.signals, from: x.it.from, heat: Math.round(x.it.heat * 10) / 10, category: String(x.category || ''), card_fit: Math.max(0, Math.min(100, Math.round(+x.card_fit || 0))), why: String(x.why || ''), angle: String(x.angle || '') }));
  let pick = -1, text = '';
  for (const [i, x] of top.entries()) {
    try { const a = await readHot(x.it); if (a.text.length < 200) continue; pick = i; text = a.text; if (a.press) items[i].press = a.press; break; }
    catch (e) { console.warn('기사 읽기 실패', x.it.url, e.message); }
  }
  const out = {
    date: id, by: 'daily', at: new Date().toISOString().slice(0, 19),
    stats: { total, cross, sources: Object.entries(stats).map(([name, n]) => ({ name, n })) },
    items, pick, note: String(r.note || ''), text: text.slice(0, 2500),
  };
  fs.mkdirSync(path.dirname(hfile(id)), { recursive: true });
  fs.writeFileSync(hfile(id), JSON.stringify(out, null, 1) + '\n');
  console.log(`hot ${id}: ${items.map(x => `${x.rank}. ${x.title}`).join(' / ')} → 다온에게 ${pick + 1}위`);
  return out;
}


// ───── 콘텐츠 비서 주제 (릴스 소재) ─────
// office/content-secretary/<날짜>.json: 콘텐츠 전략 비서가 고른 그날 주제 10개 (승인한 주제 approvedIdx, TOP 1~3)
// 아직 릴스로 안 만든 주제 중 승인한 것 → TOP 순위 → 점수 순으로, 릴스 포맷을 먼저 골라요.
function secretaryTopic(id) {
  const dir = path.join(DIR, 'content-secretary');
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f.slice(0, -5) <= id).sort().reverse(); } catch {}
  const used = new Set();
  try { for (const f of fs.readdirSync(path.join(DIR, 'drafts'))) { if (f === id + '.json') continue; const r = JSON.parse(fs.readFileSync(path.join(DIR, 'drafts', f), 'utf8')).items?.reels; if (r?.from?.title) used.add(r.from.title); } } catch {}
  for (const f of files.slice(0, 7)) {
    const day = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const rank = (t, i) => (i === day.approvedIdx ? 0 : 10) + (t.format === '릴스' ? 0 : 5) + (t.top ? t.top : 4) - (t.score || 0) / 100;
    const pick = (day.topics || []).map((t, i) => ({ t, i })).filter(x => x.t.title && !used.has(x.t.title)).sort((a, b) => rank(a.t, a.i) - rank(b.t, b.i))[0];
    if (pick) return { ...pick.t, day: day.date, approved: pick.i === day.approvedIdx };
  }
  return null;
}

const dfile = id => path.join(DIR, 'drafts', id + '.json');
async function makeDrafts(id) {
  if (!FORCE && !ONLY && fs.existsSync(dfile(id))) { console.log(`drafts ${id}: 이미 있어요`); return; }
  const prev = ONLY ? JSON.parse(fs.readFileSync(dfile(id), 'utf8')) : null;
  const daily = load('daily', id);
  const cards = daily ? daily.sections.flatMap(s => s.items.map(it => ({ ...it, section: s.title }))) : [];
  const out = prev || { date: id, source: { kind: 'daily', id, label: daily ? daily.period_label : '', headline: daily ? daily.headline : '' }, items: {} };
  let i = 0;
  for (const [k, K] of Object.entries(DRAFT_KINDS)) {
    if (ONLY && k !== ONLY) continue;
    let card, ref;
    if (k === 'card') { // 카드뉴스는 모아가 네이버·구글·마케팅 매체에서 뽑아 넘긴 오늘의 핫이슈로
      try {
        const hot = await makeHot(id), h = hot.items[hot.pick];
        if (!h || !hot.text) throw new Error('모아가 넘긴 이슈의 기사를 읽지 못했어요');
        card = { title: h.title, section: `모아의 오늘의 핫이슈 ${h.rank}위`, signals: h.signals, sources: [{ name: `${h.press || '뉴스'} · ${h.title}`.slice(0, 90), url: h.url }],
          handoff: { by: 'daily', note: hot.note, rank: h.rank, of: hot.items.length, total: hot.stats.total, why: h.why, angle: h.angle } };
        ref = `[오늘의 이슈] ${h.title}\n화제 신호: ${h.signals.join(', ')}\n${h.why ? `바이럴 포인트: ${h.why}\n` : ''}${h.angle ? `풀 각도: ${h.angle}\n` : ''}[기사 본문${h.press ? ` · ${h.press}` : ''}] ${hot.text}\n출처: ${h.url}`;
        console.log(`  모아가 넘긴 이슈: ${h.title} (${h.signals.join(', ')})`);
      } catch (e) { console.warn('  오늘의 핫이슈를 못 받아서 데일리 카드로 대신해요:', e.message); }
    }
    if (k === 'reels') { // 릴스는 콘텐츠 비서가 고른 가장 바이럴 될 주제로
      const t = secretaryTopic(id);
      if (t) {
        card = { title: t.title, section: `콘텐츠 비서 · ${t.day}${t.approved ? ' 승인 주제' : t.top ? ` TOP ${t.top}` : ''}`, signals: [`비서 점수 ${t.score ?? '-'}점`, t.format, t.type, t.sourceViews ? `원본 조회수 ${Number(t.sourceViews).toLocaleString('ko-KR')}` : ''].filter(Boolean), sources: [],
          handoff: { by: 'content', why: t.whyViral || '', angle: t.takeaway || '', note: t.approved ? '대표님이 승인한 주제예요' : t.top ? `오늘의 주제 TOP ${t.top}` : '' } };
        const g = t.growth || {};
        ref = `[콘텐츠 비서 주제] ${t.title}\n포맷: ${t.format || '-'} · 종류: ${t.type || '-'} · 축: ${t.axis || '-'}\n왜 터질까: ${t.whyViral || '-'}\n왜 지금: ${t.whyNow || '-'}\n노리는 것: ${t.goal || '-'}\n가져갈 것: ${t.takeaway || '-'}\n근거: ${t.evidence || '-'}${t.sourceTitle ? `\n참고한 원본: ${t.sourceTitle}${t.sourceViews ? ` (조회수 ${t.sourceViews})` : ''}` : ''}${g.thumbHook ? `\n[터지게 만드는 것] 썸네일 훅: ${g.thumbHook} / 연재 라벨: ${g.label || '-'} / 팔로우 CTA: ${g.cta || '-'} / 해시태그: ${g.tags || '-'} / 댓글 키워드: ${g.commentKeyword || '-'} / 끝 질문: ${g.closingQ || '-'}` : ''}\n제목의 훅 문장 구조는 살리고, [N]·[직접 채우기]는 그대로 비워 두세요.`;
        console.log(`  콘텐츠 비서 주제: ${t.title}`);
      } else console.warn('  콘텐츠 비서 주제가 없어서 데일리 카드로 대신해요');
    }
    if (!card) {
      if (!cards.length) { console.warn(`  ${k}: 데일리가 없어서 건너뛰어요`); continue; }
      card = { ...cards[i++ % cards.length] };
      card.handoff = { by: 'daily', note: `데일리 리포트 「${card.section}」 카드`, why: card.why || '' };
      ref = `[원본 카드] ${card.title}\n${card.brand ? `브랜드: ${card.brand}\n` : ''}${card.body}\n왜: ${card.why}\n${(card.sources || []).map(x => `출처: ${x.name} ${x.url}`).join('\n')}`;
    }
    try {
      const first = await ask(`당신은 마케팅 콘텐츠 에이전시의 ${K.who}입니다. ${AUDIENCE}
아래 자료 하나로 ${K.what}을 쓰세요. ${K.guide}
자료에 없는 숫자·결과를 지어내지 마세요. 이모지는 꼭 필요한 곳에만 쓰세요.
JSON으로만 답하세요: ${K.spec}

${ref}`);
      const res = await reviewLoop({
        name: `${k} ${id}`, what: `${K.what} (원본: ${card.title})`, rubric: K.rubric, ref, first, valid: K.ok, keep: true,
        revise: (cur, fb) => ask(`당신은 마케팅 콘텐츠 에이전시의 ${K.who}입니다. ${AUDIENCE}
팀장이 시안을 돌려보냈습니다. 지적을 모두 반영해 같은 JSON 모양으로 전체를 다시 쓰세요. ${K.guide}
팀장 지적:
${fb.map((f, n) => `${n + 1}. ${f}`).join('\n')}
JSON 모양: ${K.spec}

지금 시안:
${JSON.stringify(cur)}

${ref}`),
      });
      out.items[k] = { by: k, what: K.what, from: { title: card.title, section: card.section, signals: card.signals, sources: (card.sources || []).slice(0, 2), handoff: card.handoff }, versions: res.versions, ...res.review, draft: res.draft };
    } catch (e) { console.error(`  ${k} 시안 실패:`, e.message); }
  }
  if (!Object.keys(out.items).length) throw new Error('시안을 하나도 못 만들었어요');
  fs.mkdirSync(path.dirname(dfile(id)), { recursive: true });
  fs.writeFileSync(dfile(id), JSON.stringify(out, null, 1) + '\n');
  console.log(`drafts ${id}: ${Object.entries(out.items).map(([k, x]) => `${k} 시안 ${x.final_v}번 ${x.passed ? '통과' : '보류'}`).join(', ')}`);
}

function build() {
  const reports = {};
  for (const kind of Object.keys(KEEP)) reports[kind] = list(kind).slice(-KEEP[kind]).map(id => ({ id, doc: load(kind, id) })).filter(r => r.doc);
  let drafts = [];
  try { drafts = fs.readdirSync(path.join(DIR, 'drafts')).filter(f => f.endsWith('.json')).sort().slice(-14).map(f => ({ id: f.slice(0, -5), doc: JSON.parse(fs.readFileSync(path.join(DIR, 'drafts', f), 'utf8')) })); } catch {}
  let hot = [];
  try { hot = fs.readdirSync(path.join(DIR, 'hot')).filter(f => f.endsWith('.json')).sort().slice(-14).map(f => { const { text, ...doc } = JSON.parse(fs.readFileSync(path.join(DIR, 'hot', f), 'utf8')); return { id: f.slice(0, -5), doc }; }); } catch {}
  const out = `// make-report.mjs가 만드는 파일이에요. 직접 고치지 말고 reports/ 안의 json을 고친 뒤 build 하세요.\nwindow.OFFICE_DATA = ${JSON.stringify({ version: new Date().toISOString().slice(0, 19), reports, drafts, hot })};\n`;
  fs.writeFileSync(path.join(DIR, 'reports-data.js'), out);
  console.log('reports-data.js', Object.entries(reports).map(([k, v]) => `${k} ${v.length}`).join(', '), `drafts ${drafts.length}`, `hot ${hot.length}`);
}

(async () => {
  const [kind, id] = args;
  const jobs = [];
  if (kind && kind !== 'build') jobs.push([kind, id || ymd(kstNow())]);
  if (!kind) jobs.push(['drafts', ymd(kstNow())], ['hot', ymd(kstNow())]);
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
  // 리포트 → 모아의 핫이슈 → 시안 순서로 (시안은 앞 사람이 넘긴 걸 받아서 써요)
  const order = k => k === 'drafts' ? 2 : k === 'hot' ? 1 : 0;
  jobs.sort((a, b) => order(a[0]) - order(b[0]));
  for (const [k, i] of jobs) { try { await (k === 'drafts' ? makeDrafts(i) : k === 'hot' ? makeHot(i) : make(k, i)); } catch (e) { failed++; console.error(`${k} ${i} 실패:`, e.message); } }
  build();
  if (failed && failed === jobs.length) process.exit(1);
})();
