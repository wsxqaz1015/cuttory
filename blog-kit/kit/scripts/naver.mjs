// 네이버 블로그 편집기에 원고(post.json)를 입력해 임시저장하거나 예약해요.
// 사용법:
//   node scripts/naver.mjs check                       설정과 Chrome 확인
//   node scripts/naver.mjs login                       전용 Chrome을 열어 네이버 로그인
//   node scripts/naver.mjs draft posts/my-shop         임시저장까지만
//   node scripts/naver.mjs schedule posts/my-shop --at "2026-11-03 19:30"
//   node scripts/naver.mjs list                        글 관리 화면 열기
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));
const PROFILE = join(ROOT, 'profiles', 'naver');
const LOGS = join(ROOT, 'logs');

// 네이버 편집기(스마트에디터 ONE) 버튼 위치. 화면이 바뀌면 여기만 고치면 돼요. 앞에서부터 차례로 찾아요.
const SEL = {
  draftPopupCancel: ['.se-popup-button-cancel', 'button:has-text("취소")'],
  helpClose: ['.se-help-panel-close-button', 'button[aria-label="도움말 닫기"]'],
  title: ['.se-documentTitle .se-text-paragraph', '.se-title-text', '.se-section-documentTitle'],
  bodyParagraph: ['.se-component.se-text .se-text-paragraph', '.se-section-text .se-text-paragraph'],
  imageButton: ['button.se-image-toolbar-button', 'button[data-name="image"]'],
  imageComponent: ['.se-component.se-image'],
  mapButton: ['button.se-map-toolbar-button', 'button[data-name="map"]'],
  mapSearchInput: ['.se-place-search-input input', 'input[placeholder*="장소"]', '.react-autosuggest__input'],
  mapFirstResult: ['.se-place-map-search-result-item', 'li[class*="search_result"]'],
  mapAddButton: ['.se-place-add-button', 'button:has-text("추가")'],
  mapConfirm: ['.se-popup-button-confirm', 'button:has-text("확인")'],
  saveButton: ['button[class*="save_btn"]', 'button:has-text("저장")'],
  publishButton: ['button[class*="publish_btn"]', 'button:has-text("발행")'],
  tagInput: ['#tag-input', 'input[placeholder*="태그"]'],
  reserveRadio: ['label[for="radio_time2"]', 'label:has-text("예약")'],
  dateInput: ['input[class*="input_date"]', '.date_area input'],
  hourSelect: ['select[class*="hour_option"]', 'select[title*="시"]'],
  minuteSelect: ['select[class*="minute_option"]', 'select[title*="분"]'],
  confirmPublish: ['button[class*="confirm_btn"]', '.layer_btn_area button:has-text("발행")'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pause = () => sleep(CONFIG.stepPauseMs ?? 900);
const say = msg => console.log(msg);

async function launch() {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); }
  catch { fail('부품이 설치되지 않았어요. 키트 폴더에서 npm install 을 먼저 실행해 주세요.'); }
  mkdirSync(PROFILE, { recursive: true });
  const opts = { headless: false, viewport: null, locale: 'ko-KR', args: ['--start-maximized'] };
  if (CONFIG.chromePath) opts.executablePath = CONFIG.chromePath; else opts.channel = 'chrome';
  try { return await chromium.launchPersistentContext(PROFILE, opts); }
  catch (e) { fail(`Chrome을 열지 못했어요. Google Chrome이 설치돼 있는지 확인하거나 config.json의 chromePath에 Chrome 경로를 넣어 주세요.\n${e.message}`); }
}

function fail(msg, code = 1) { console.error('\n❌ ' + msg); process.exit(code); }

async function snap(page, name) {
  mkdirSync(LOGS, { recursive: true });
  const file = join(LOGS, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); return file; } catch { return null; }
}

async function isLoggedIn(ctx) {
  const cookies = await ctx.cookies('https://www.naver.com');
  return cookies.some(c => c.name === 'NID_AUT') && cookies.some(c => c.name === 'NID_SES');
}

// 후보 선택자 중 먼저 보이는 것 하나
async function find(scope, key, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const s of SEL[key]) {
      const loc = scope.locator(s).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await sleep(250);
  }
  return null;
}

async function must(scope, key, page, timeout) {
  const loc = await find(scope, key, timeout);
  if (!loc) {
    const shot = await snap(page, `missing-${key}`);
    fail(`편집기에서 '${key}' 버튼을 찾지 못했어요. 네이버 화면이 바뀌었을 수 있어요.\n화면 캡처: ${shot}\nscripts/naver.mjs 맨 위 SEL.${key} 를 고치면 다시 할 수 있어요.`);
  }
  return loc;
}

function blogId() {
  const id = String(CONFIG.blogId || '').trim().replace(/^https?:\/\/(m\.)?blog\.naver\.com\//, '').replace(/\/.*$/, '');
  if (!id) fail('config.json의 blogId가 비어 있어요. 블로그 주소의 아이디를 넣어 주세요.');
  return id;
}

async function openEditor(ctx) {
  const page = ctx.pages()[0] || await ctx.newPage();
  const test = process.env.KIT_EDITOR_URL; // 키트 점검용 가짜 편집기 주소
  await page.goto(test || `https://blog.naver.com/${blogId()}?Redirect=Write&`, { waitUntil: 'domcontentloaded' });
  await sleep(2500);
  if (!test && (!(await isLoggedIn(ctx)) || /nid\.naver\.com/.test(page.url()))) {
    say('🔐 네이버 로그인이 필요해요. 열린 Chrome에서 직접 로그인한 뒤, Claude Code에 "로그인했어, 다시 해줘"라고 보내 주세요.');
    say('   (Chrome 창은 그대로 둘게요. 로그인을 마치면 창을 닫아도 돼요.)');
    await waitForLogin(ctx, page);
    process.exit(2);
  }
  // 편집기는 mainFrame 안에 있을 때도, 바로 페이지에 있을 때도 있어요.
  let editor = page;
  const frameEl = await page.$('iframe#mainFrame');
  if (frameEl) editor = await frameEl.contentFrame();
  await editor.waitForSelector('.se-content, .se-documentTitle', { timeout: 30000 }).catch(() => null);
  const cancel = await find(editor, 'draftPopupCancel', 3000);
  if (cancel) { await cancel.click(); await pause(); }
  const help = await find(editor, 'helpClose', 1500);
  if (help) { await help.click(); await pause(); }
  return { page, editor };
}

async function waitForLogin(ctx, page) {
  if (!/nid\.naver\.com/.test(page.url())) await page.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fblog.naver.com', { waitUntil: 'domcontentloaded' });
  const end = Date.now() + 10 * 60 * 1000;
  while (Date.now() < end) {
    if (await isLoggedIn(ctx)) { say('✅ 로그인을 확인했어요.'); await ctx.close(); return true; }
    await sleep(2000);
  }
  say('로그인을 10분 동안 기다렸지만 확인되지 않았어요.');
  await ctx.close();
  return false;
}

async function typeText(page, text) {
  const delay = CONFIG.typingDelayMs ?? 35;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.type(lines[i], { delay });
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}

// 본문 맨 끝으로 커서 옮기기
async function cursorToEnd(editor, page) {
  const paras = editor.locator(SEL.bodyParagraph.join(', '));
  const n = await paras.count();
  if (n) { await paras.nth(n - 1).click(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); }
}

async function insertImage(editor, page, file) {
  const before = await editor.locator(SEL.imageComponent.join(', ')).count();
  const btn = await must(editor, 'imageButton', page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 15000 }), btn.click()]);
  await chooser.setFiles(file);
  const end = Date.now() + 60000;
  while (Date.now() < end && await editor.locator(SEL.imageComponent.join(', ')).count() <= before) await sleep(500);
  if (await editor.locator(SEL.imageComponent.join(', ')).count() <= before) {
    const shot = await snap(page, 'image-upload');
    fail(`사진이 올라가지 않았어요: ${file}\n화면 캡처: ${shot}`);
  }
  await sleep(1500);
  await cursorToEnd(editor, page);
  await page.keyboard.press('Enter');
}

async function insertPlace(editor, page, query) {
  try {
    const btn = await find(editor, 'mapButton', 4000); if (!btn) throw new Error('지도 버튼 없음');
    await btn.click(); await pause();
    const input = await find(editor, 'mapSearchInput', 6000); if (!input) throw new Error('검색 칸 없음');
    await input.fill(query); await page.keyboard.press('Enter'); await sleep(2500);
    const first = await find(editor, 'mapFirstResult', 8000); if (!first) throw new Error('검색 결과 없음');
    await first.hover(); await pause();
    const add = await find(editor, 'mapAddButton', 4000); if (add) { await add.click(); await pause(); }
    const ok = await find(editor, 'mapConfirm', 4000); if (ok) await ok.click();
    await sleep(2000);
    await cursorToEnd(editor, page);
    await page.keyboard.press('Enter');
    say(`  🗺  지도 넣음: ${query}`);
    return true;
  } catch (e) {
    await page.keyboard.press('Escape').catch(() => {});
    say(`  ⚠️ 지도를 넣지 못했어요(${e.message}). 지도 없이 계속할게요.`);
    return false;
  }
}

function loadPost(dirArg) {
  const dir = resolve(dirArg || '');
  const file = join(dir, 'post.json');
  if (!existsSync(file)) fail(`${file} 이 없어요. 원고를 먼저 써 주세요.`);
  const post = JSON.parse(readFileSync(file, 'utf8'));
  if (!post.title || !Array.isArray(post.blocks)) fail('post.json에 title과 blocks가 있어야 해요.');
  for (const b of post.blocks) if (b.type === 'image') {
    b.path = isAbsolute(b.file) ? b.file : join(dir, b.file);
    if (!existsSync(b.path)) fail(`사진이 없어요: ${b.file}`);
  }
  return { dir, post };
}

async function writePost(editor, page, post) {
  const title = await must(editor, 'title', page, 30000);
  await title.click(); await pause();
  await typeText(page, post.title);
  say(`  ✏️ 제목: ${post.title}`);
  const body = await must(editor, 'bodyParagraph', page);
  await body.click(); await pause();
  let photos = 0, maps = 0;
  for (const b of post.blocks) {
    if (b.type === 'text') { await typeText(page, b.text); await page.keyboard.press('Enter'); }
    else if (b.type === 'image') { await insertImage(editor, page, b.path); photos++; say(`  🖼  사진 ${photos}장째 넣음`); }
    else if (b.type === 'place') { if (await insertPlace(editor, page, b.query)) maps++; }
    await pause();
  }
  return { photos, maps };
}

async function draft(dirArg) {
  const { dir, post } = loadPost(dirArg);
  const ctx = await launch();
  const { page, editor } = await openEditor(ctx);
  say('📝 네이버 편집기에 입력을 시작해요. 끝날 때까지 Chrome 창을 건드리지 말아 주세요.');
  const r = await writePost(editor, page, post);
  const save = await must(editor, 'saveButton', page);
  await save.click();
  const saved = await page.waitForSelector('text=/저장되었|임시저장/', { timeout: 8000 }).then(() => true).catch(() => false)
    || await editor.locator('text=/저장되었|임시저장/').first().isVisible().catch(() => false);
  const shot = await snap(page, 'draft');
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ action: 'draft', at: new Date().toISOString(), ...r, saved, screenshot: shot }, null, 2));
  say(`\n${saved ? '✅ 임시저장했어요.' : '⚠️ 저장 버튼은 눌렀지만 저장 알림을 확인하지 못했어요. 화면 캡처를 확인해 주세요.'}`);
  say(`   사진 ${r.photos}장, 지도 ${r.maps}개. 화면 캡처: ${shot}`);
  say('   네이버 임시저장에는 태그가 남지 않아요. 예약할 때 다시 넣어요.');
  say('   다 읽어 보려면 네이버 글쓰기 화면의 "저장" 옆 숫자(임시저장 글)를 누르면 돼요.');
  await sleep(3000); await ctx.close();
  if (!saved) process.exitCode = 1;
}

function parseAt(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
  if (!m) fail('예약 시각은 "2026-11-03 19:30" 형식으로 적어 주세요.');
  let [, y, mo, d, h, mi] = m.map(Number);
  const when = new Date(y, mo - 1, d, h, Math.ceil(mi / 10) * 10);
  if (when - Date.now() < 15 * 60 * 1000) fail('예약은 지금부터 15분 이후여야 해요.');
  return when;
}

async function pickDate(editor, page, when) {
  const input = await must(editor, 'dateInput', page);
  await input.click(); await pause();
  for (let i = 0; i < 24; i++) {
    const y = Number((await editor.locator('.ui-datepicker-year').first().textContent().catch(() => '')).replace(/\D/g, ''));
    const mo = Number((await editor.locator('.ui-datepicker-month').first().textContent().catch(() => '')).replace(/\D/g, ''));
    if (!y || !mo) break;
    if (y === when.getFullYear() && mo === when.getMonth() + 1) break;
    await editor.locator('.ui-datepicker-next').first().click(); await sleep(300);
  }
  const day = editor.locator('.ui-datepicker-calendar td:not(.ui-datepicker-other-month) a, .ui-datepicker-calendar td:not(.ui-datepicker-other-month) button')
    .filter({ hasText: new RegExp(`^${when.getDate()}$`) }).first();
  if (!(await day.isVisible().catch(() => false))) {
    const shot = await snap(page, 'datepicker');
    fail(`예약 날짜를 고르지 못했어요. 화면 캡처: ${shot}`);
  }
  await day.click(); await pause();
}

async function schedule(dirArg, atArg) {
  const when = parseAt(atArg);
  const { dir, post } = loadPost(dirArg);
  const ctx = await launch();
  const { page, editor } = await openEditor(ctx);
  say(`📅 ${when.toLocaleString('ko-KR')} 예약으로 입력을 시작해요. 끝날 때까지 Chrome 창을 건드리지 말아 주세요.`);
  const r = await writePost(editor, page, post);
  await (await must(editor, 'publishButton', page)).click(); await sleep(1500);
  const tag = await find(editor, 'tagInput', 6000);
  if (tag && post.tags?.length) {
    for (const t of post.tags.slice(0, 30)) { await tag.click(); await page.keyboard.type(String(t).replace(/^#/, ''), { delay: CONFIG.typingDelayMs ?? 35 }); await page.keyboard.press('Enter'); await sleep(250); }
    say(`  🏷  태그 ${post.tags.length}개`);
  }
  await (await must(editor, 'reserveRadio', page)).click(); await pause();
  await pickDate(editor, page, when);
  const hh = String(when.getHours()).padStart(2, '0'), mm = String(when.getMinutes()).padStart(2, '0');
  await (await must(editor, 'hourSelect', page)).selectOption({ label: hh }).catch(async () => (await find(editor, 'hourSelect')).selectOption(hh));
  await (await must(editor, 'minuteSelect', page)).selectOption({ label: mm }).catch(async () => (await find(editor, 'minuteSelect')).selectOption(mm));
  await pause();
  const before = await snap(page, 'schedule-before');
  await (await must(editor, 'confirmPublish', page)).click();
  await sleep(5000);
  const left = !(await find(editor, 'title', 1500).catch(() => null)); // 편집기가 닫혔으면 발행 완료
  const shot = await snap(page, 'schedule');
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ action: 'schedule', at: new Date().toISOString(), when: when.toISOString(), ...r, editorClosed: left, screenshots: [before, shot] }, null, 2));
  say(`\n${left ? '✅ 예약 발행을 걸었어요.' : '⚠️ 발행 버튼은 눌렀지만 편집기가 닫히지 않았어요. 화면 캡처를 확인해 주세요.'} (${hh}:${mm})`);
  say(`   화면 캡처: ${shot}`);
  say('   마지막으로 node scripts/naver.mjs list 로 예약 목록에서 제목과 시간을 확인해 주세요.');
  await ctx.close();
  if (!left) process.exitCode = 1;
}

async function list() {
  const ctx = await launch();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`https://admin.blog.naver.com/${blogId()}/config/postlist`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await sleep(2000);
  if (!(await isLoggedIn(ctx))) { say('🔐 로그인이 필요해요. 열린 Chrome에서 로그인해 주세요.'); await waitForLogin(ctx, page); process.exit(2); }
  say('📋 블로그 관리 화면을 열었어요. "글 관리"에서 예약 표시가 붙은 글의 제목과 시간을 확인하세요.');
  say('   예약을 취소하려면 그 글을 골라 삭제하거나, 글을 열어 발행 설정을 바꾸면 돼요. 다 보면 창을 닫아 주세요.');
  await Promise.race([new Promise(r => ctx.on('close', r)), sleep(10 * 60 * 1000)]);
  await ctx.close().catch(() => {});
}

async function check() {
  say(`blogId: ${CONFIG.blogId || '(비어 있음)'}`);
  const ctx = await launch();
  say('✅ Chrome을 열 수 있어요.');
  say(await isLoggedIn(ctx) ? '✅ 네이버에 로그인돼 있어요.' : 'ℹ️ 아직 네이버 로그인 전이에요. node scripts/naver.mjs login 으로 한 번 로그인해 주세요.');
  await ctx.close();
}

const [cmd, arg, ...rest] = process.argv.slice(2);
const at = rest[rest.indexOf('--at') + 1];
if (cmd === 'check') await check();
else if (cmd === 'login') { const ctx = await launch(); const page = ctx.pages()[0] || await ctx.newPage(); if (await isLoggedIn(ctx)) { say('✅ 이미 로그인돼 있어요.'); await ctx.close(); } else { say('🔐 열린 Chrome에서 네이버에 로그인해 주세요. 로그인되면 저절로 닫혀요.'); await waitForLogin(ctx, page); } }
else if (cmd === 'draft') await draft(arg);
else if (cmd === 'schedule') { if (!rest.includes('--at')) fail('예약 시각을 --at "2026-11-03 19:30" 처럼 적어 주세요.'); await schedule(arg, at); }
else if (cmd === 'list') await list();
else say('사용법: node scripts/naver.mjs check | login | draft <글폴더> | schedule <글폴더> --at "YYYY-MM-DD HH:MM" | list');
