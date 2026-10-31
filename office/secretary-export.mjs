// 콘텐츠 비서(아티팩트) 저장소를 내려받은 폴더를 오피스가 읽는 파일로 바꿔요.
// 매일 아침 예약 작업이 ArtifactData로 days·approvals·saved·notes·settings 를 <dump>/<컬렉션>/<id>.json 으로 받은 뒤 실행해요.
//   node office/secretary-export.mjs <dump 폴더>
// 결과: office/content-secretary/<날짜>.json (하루치 주제) · saved.json (저장한 주제 + 피드백) · account.json (인스타 최근 게시물 성과)
import fs from 'node:fs';
import path from 'node:path';

const dump = process.argv[2];
if (!dump) { console.error('사용법: node office/secretary-export.mjs <dump 폴더>'); process.exit(1); }
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'content-secretary');
const read = col => { const dir = path.join(dump, col); let fl = []; try { fl = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch {}
  return fl.map(f => { const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return { id: j.id || f.slice(0, -5), ...(j.data || j) }; }); };

const days = read('days'), approvals = Object.fromEntries(read('approvals').map(a => [a.id, a.idx]));
const notes = {}; for (const n of read('notes')) notes[n.id] = (n.list || []).filter(x => x && x.note);
for (const d of days) {
  if (!/^\d{4}-\d\d-\d\d$/.test(d.date || d.id)) continue;
  const date = d.date || d.id, file = path.join(OUT, date + '.json');
  const doc = { date, from: 'content-secretary', approvedIdx: approvals[date] ?? null, topics: d.topics || [] };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}
const saved = read('saved').filter(s => s.topic).map(s => ({ key: s.id, date: s.date, idx: s.idx, savedAt: s.at || '', refSec: Number(s.refSec) || null, topic: s.topic, notes: notes[s.id] || [] }));
fs.writeFileSync(path.join(OUT, 'saved.json'), JSON.stringify({ exportedAt: new Date().toISOString(), saved }, null, 2) + '\n');
// 인스타 성과 (비서 설정의 account.recent) → 오피스 🏆 성과 보상에서 읽어요
const set = read('settings').find(x => x.id === 'main');
if (set && set.account) { const a = set.account; fs.writeFileSync(path.join(OUT, 'account.json'), JSON.stringify({ updatedAt: a.updatedAt || '', followers: a.followers ?? null, recent: (a.recent || []).map(r => ({ url: r.url, type: r.type, caption: r.caption, date: r.date, views: r.views ?? null, likes: r.likes ?? null, comments: r.comments ?? null })) }, null, 2) + '\n'); }
console.log(`하루치 ${days.length}개, 저장한 주제 ${saved.length}개를 내보냈어요`);
