// 블로그 폴더의 사진·영상으로 네이버 클립(세로 9:16) 초안 영상을 만들어요.
//   node office/blog/make-clip.mjs <사진·영상 폴더> <clip.json> <결과.mp4>
// clip.json 모양:
//   { "title": ["작은 라벨", "큰 제목"], "cuts": [ { "file": "IMG_01.jpg", "sec": 2.5, "text": "자막 한 줄", "time": "14:20" } ], "ending": "끝 질문 한마디" }
// - 첫 컷 위에 제목 두 줄(3초), 컷마다 화면 중앙 아래 자막 한 줄, 시간 자막(time)이 있으면 위쪽에 작게.
// - 사진은 천천히 확대(켄 번스), 영상은 앞에서부터 sec초만 써요. 소리는 넣지 않아요 (음악은 클립 앱에서 골라요).
// - 업로드는 하지 않아요. 결과 영상은 대표님이 확인하고 직접 올려요.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [dir, spec, out] = process.argv.slice(2);
if (!dir || !spec || !out) { console.error('사용법: node office/blog/make-clip.mjs <사진·영상 폴더> <clip.json> <결과.mp4>'); process.exit(1); }
const clip = JSON.parse(fs.readFileSync(spec, 'utf8'));
const FONT = ['/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', '/usr/share/fonts/truetype/nanum/NanumGothicBold.ttf', '/System/Library/Fonts/AppleSDGothicNeo.ttc'].find(f => fs.existsSync(f));
if (!FONT) { console.error('한글 글꼴을 찾지 못했어요'); process.exit(1); }
const W = 1080, H = 1920, FPS = 30;
const tmp = fs.mkdtempSync(path.join(path.dirname(path.resolve(out)), '.clip-'));
// drawtext 에 넣을 글자는 파일로 넘겨요 (따옴표·콜론 이스케이프 문제를 피해요)
let n = 0;
// 영상 글꼴에 이모지가 없어서 네모로 깨지니 빼요 (이모지는 캡션·클립 앱 스티커로)
const noEmoji = s => String(s).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
const txt = s => { const f = path.join(tmp, `t${n++}.txt`); fs.writeFileSync(f, noEmoji(s)); return f.replace(/:/g, '\\:'); };
const draw = (file, size, y, box = true) => `drawtext=fontfile=${FONT.replace(/:/g, '\\:')}:textfile=${file}:fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}` + (box ? ':box=1:boxcolor=black@0.45:boxborderw=24' : ':borderw=6:bordercolor=black@0.7');
const isVideo = f => /\.(mp4|mov|m4v|webm)$/i.test(f);

const parts = [];
clip.cuts.forEach((c, i) => {
  const src = path.join(dir, c.file), sec = Number(c.sec) || 2.5, frames = Math.round(sec * FPS);
  if (!fs.existsSync(src)) { console.error(`없는 파일: ${c.file}`); process.exit(1); }
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const base = isVideo(src) ? `${fit},fps=${FPS}` : `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`;
  const f = [base, 'format=yuv420p'];
  if (i === 0 && clip.title) {
    const [small, big] = Array.isArray(clip.title) ? clip.title : ['', clip.title];
    if (small) f.push(draw(txt(small), 54, 'h*0.30', false) + ':enable=lt(t\\,3)');
    f.push(draw(txt(big), 84, 'h*0.36', false) + ':enable=lt(t\\,3)');
  }
  if (c.time) f.push(draw(txt(c.time), 46, 'h*0.12', false));
  if (c.text) f.push(draw(txt(c.text), 58, 'h*0.70') + (i === 0 && clip.title ? ':enable=gte(t\\,3)' : ''));
  if (i === clip.cuts.length - 1 && clip.ending) f.push(draw(txt(clip.ending), 64, 'h*0.45', false) + `:enable=gte(t\\,${Math.max(0, sec - 2)})`);
  const part = path.join(tmp, `p${i}.mp4`);
  const input = isVideo(src) ? ['-t', String(sec), '-i', src] : ['-loop', '1', '-t', String(sec), '-i', src];
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...input, '-vf', f.join(','), '-an', '-r', String(FPS), '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', part]);
  parts.push(part);
});
const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out]);
fs.rmSync(tmp, { recursive: true, force: true });
const total = clip.cuts.reduce((s, c) => s + (Number(c.sec) || 2.5), 0);
console.log(`${out} · ${clip.cuts.length}컷 · ${total.toFixed(1)}초`);
