// 글 폴더의 사진을 정리해 ready/ 에 저장해요: HEIC → JPG(Mac), 얼굴 모자이크, 01.jpg 순서로 이름 붙이기
// 사용법: node scripts/prepare-photos.mjs posts/my-shop
import { readdirSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] && resolve(process.argv[2]);
if (!dir || !existsSync(dir)) { console.error('글 폴더를 찾을 수 없어요. 예) node scripts/prepare-photos.mjs posts/my-shop'); process.exit(1); }

const PHOTO = ['.jpg', '.jpeg', '.png', '.webp'];
const HEIC = ['.heic', '.heif'];
const VIDEO = ['.mp4', '.mov', '.m4v'];
const files = readdirSync(dir).filter(f => !f.startsWith('.')).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));
const ready = join(dir, 'ready');
rmSync(ready, { recursive: true, force: true });
mkdirSync(ready);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let n = 0; const report = []; const videos = []; const skipped = [];

for (const f of files) {
  const ext = extname(f).toLowerCase();
  let src = join(dir, f); let tmp = null;
  if (VIDEO.includes(ext)) {
    n++; const out = `${String(n).padStart(2, '0')}${ext}`;
    copyFileSync(src, join(ready, out)); videos.push(`${f} → ready/${out}`); continue;
  }
  if (HEIC.includes(ext)) {
    if (process.platform !== 'darwin') { skipped.push(`${f} (HEIC는 JPG로 바꿔서 다시 넣어 주세요)`); continue; }
    tmp = join(ready, `_${f}.jpg`);
    try { run('sips', ['-s', 'format', 'jpeg', src, '--out', tmp]); src = tmp; }
    catch { skipped.push(`${f} (HEIC 변환 실패)`); continue; }
  } else if (!PHOTO.includes(ext)) continue;

  n++; const out = join(ready, `${String(n).padStart(2, '0')}.jpg`);
  try {
    const lines = run('uv', ['run', '--quiet', join('scripts', 'blur_faces.py'), src, out]).split('\n');
    report.push(`${f} → ready/${String(n).padStart(2, '0')}.jpg (얼굴 ${lines.at(-1)}개 가림)`);
  } catch (e) {
    console.error(`얼굴 모자이크에 실패했어요: ${f}\n${e.stderr || e.message}`);
    console.error('uv가 설치돼 있는지 확인해 주세요. 모자이크 없이 올리지 않도록 여기서 멈춰요.');
    process.exit(1);
  }
  if (tmp) rmSync(tmp, { force: true });
}

console.log(`사진 정리 끝: ${report.length}장, 영상 ${videos.length}개`);
report.forEach(r => console.log('  ' + r));
if (videos.length) { console.log('영상은 얼굴을 자동으로 가리지 않았어요. 직접 확인해 주세요:'); videos.forEach(v => console.log('  ' + v)); }
if (skipped.length) { console.log('넣지 못한 파일:'); skipped.forEach(s => console.log('  ' + s)); }
console.log('ready/ 사진을 직접 열어서 가려지지 않은 얼굴이 없는지 꼭 확인하세요.');
