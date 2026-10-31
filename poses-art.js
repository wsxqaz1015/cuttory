// 포즈 썸네일 그림 — 얼굴 없는 기본 인형을 SVG로 그려요. (100×100 칸 기준 좌표)
// 몸 모양: h 머리 [x, y, 고개 방향(-1 왼쪽 ~ 1 오른쪽), 기울기], n 몸통 [목 x, y, 엉덩이 x, y]
// a/b 화면 왼쪽·오른쪽 팔 [팔꿈치 x, y, 손 x, y], l/r 왼쪽·오른쪽 다리 [무릎 x, y, 발 x, y]
// back 뒷모습, pb 몸 뒤 소품, p 몸 앞 소품, fx 효과
(() => {
const K = 'stroke="#222" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const W = `fill="#fff" ${K}`, N = `fill="none" ${K}`, G = 'stroke="#b3b3b3" stroke-width="1.8" fill="none" stroke-linecap="round"';
// 소품
const P = {
  floor: (y = 90, x0 = 14, x1 = 86) => `<path d="M${x0} ${y}H${x1}" ${N}/>`,
  desk: (y = 74) => `<path d="M12 ${y}H88" ${N}/>`,
  cup: (x, y) => `<path d="M${x - 4} ${y - 5}h8l-1 10h-6z" ${W}/><path d="M${x + 4} ${y - 2}q4 1 0 5" ${N}/>`,
  mug: (x, y) => `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2" ${W}/><path d="M${x + 5} ${y - 2}q4 2 0 5" ${N}/>`,
  steam: (x, y) => `<path d="M${x - 2} ${y}q-2 -3 0 -6q2 -3 0 -6M${x + 3} ${y}q-2 -3 0 -6" ${G}/>`,
  phone: (x, y, r = 0) => `<rect x="${x - 3.5}" y="${y - 6}" width="7" height="12" rx="1.6" transform="rotate(${r} ${x} ${y})" ${W}/>`,
  laptop: (x, y) => `<path d="M${x - 14} ${y}h28l-3 -14h-22z" ${W}/><path d="M${x - 18} ${y}h36" ${N}/>`,
  book: (x, y) => `<path d="M${x} ${y - 7}q-8 -3 -14 0v13q6 -3 14 0q8 -3 14 0v-13q-6 -3 -14 0z M${x} ${y - 7}v13" ${W}/>`,
  headphones: (x, y) => `<path d="M${x - 21} ${y + 2}q0 -26 21 -26q21 0 21 26" fill="none" stroke="#222" stroke-width="4"/><rect x="${x - 25}" y="${y - 4}" width="7" height="12" rx="3" ${W}/><rect x="${x + 18}" y="${y - 4}" width="7" height="12" rx="3" ${W}/>`,
  dumbbell: (x, y) => `<path d="M${x - 5} ${y}h10" ${N}/><rect x="${x - 8}" y="${y - 4}" width="4" height="8" rx="1" ${W}/><rect x="${x + 4}" y="${y - 4}" width="4" height="8" rx="1" ${W}/>`,
  pan: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="3" ${W}/><path d="M${x + 9} ${y}l9 -3" ${N}/>`,
  spatula: (x, y) => `<path d="M${x} ${y}l-6 -10" ${N}/><rect x="${x - 10}" y="${y - 17}" width="6" height="6" rx="1" transform="rotate(-30 ${x - 7} ${y - 14})" ${W}/>`,
  pot: (x, y) => `<path d="M${x - 12} ${y - 7}h24v6q0 7 -7 7h-10q-7 0 -7 -7z" ${W}/><path d="M${x - 15} ${y - 7}h30" ${N}/>`,
  chopsticks: (x, y) => `<path d="M${x} ${y}l-10 -12M${x + 2} ${y}l-7 -13" ${N}/><path d="M${x - 7} ${y - 6}q-1 6 1 12M${x - 4} ${y - 6}q1 6 -1 12" ${G}/>`,
  bag: (x, y) => `<rect x="${x - 7}" y="${y - 6}" width="14" height="12" rx="3" ${W}/><path d="M${x - 4} ${y - 6}q4 -6 8 0" ${N}/>`,
  leek: (x, y) => `<path d="M${x - 2} ${y - 6}l-3 -10M${x + 1} ${y - 6}l2 -11" stroke="#222" stroke-width="2.2" stroke-linecap="round"/>`,
  handles: () => `<path d="M30 4v6M70 4v6" ${N}/><path d="M26 10h8l-1 6h-6zM66 10h8l-1 6h-6z" ${W}/>`,
  backpack: (x, y) => `<rect x="${x - 8}" y="${y - 7}" width="16" height="14" rx="4" ${W}/><path d="M${x - 5} ${y - 1}h10" ${N}/>`,
  pen: (x, y) => `<path d="M${x} ${y}l6 -9" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>`,
  note: (x, y) => `<path d="M${x - 12} ${y}l3 -8h20l-3 8z" ${W}/>`,
  shirt: (x, y) => `<path d="M${x - 8} ${y - 6}l-5 4l3 4l3 -2v8h14v-8l3 2l3 -4l-5 -4q-4 3 -8 0q-4 3 -8 0z" ${W}/>`,
  pile: (x, y) => `<path d="M${x - 14} ${y}q0 -8 8 -8q2 -5 8 -3q8 -2 8 6q4 1 4 5z" ${W}/>`,
  dog: (x, y) => `<path d="M${x - 8} ${y}q0 -10 8 -10q8 0 8 10z" ${W}/><circle cx="${x + 6}" cy="${y - 12}" r="5" ${W}/><path d="M${x + 9} ${y - 16}l3 -3l1 5" ${W}/>`,
  umbrella: (x, y) => `<path d="M${x - 18} ${y}q18 -18 36 0q-4 -3 -9 0q-4 -3 -9 0q-5 -3 -9 0q-5 -3 -9 0z" ${W}/><path d="M${x} ${y - 9}v-3M${x} ${y}v18" ${N}/>`,
  rain: () => `<path d="M14 20l-2 6M86 30l-2 6M20 50l-2 6M84 60l-2 6M12 74l-2 6" ${G}/>`,
  pillow: (x, y) => `<rect x="${x - 14}" y="${y - 5}" width="28" height="10" rx="5" ${W}/>`,
  blanket: (x, y, w = 50) => `<path d="M${x} ${y}h${w}q4 0 4 4v10h-${w + 8}v-10q0 -4 4 -4z" ${W}/>`,
  sofa: () => `<path d="M14 66q0 -18 10 -18h52q10 0 10 18v14h-72z" ${W}/><path d="M22 66h56" ${N}/>`,
  mat: () => `<path d="M14 88l8 -10h56l8 10z" ${W}/>`,
  gift: (x, y) => `<rect x="${x - 9}" y="${y - 7}" width="18" height="14" rx="1.5" ${W}/><path d="M${x} ${y - 7}v14M${x - 9} ${y - 2}h18" ${N}/><path d="M${x} ${y - 7}q-6 -6 -7 -1q1 2 7 1q6 -6 7 -1q-1 2 -7 1" ${W}/>`,
  fork: (x, y) => `<path d="M${x} ${y}v-10M${x - 2} ${y - 10}v-4M${x + 2} ${y - 10}v-4" ${N}/>`,
  sign: (x, y) => `<rect x="${x - 18}" y="${y - 11}" width="36" height="20" rx="2" ${W}/>`,
  clipboard: (x, y) => `<rect x="${x - 8}" y="${y - 10}" width="16" height="20" rx="2" ${W}/><path d="M${x - 4} ${y - 4}l2 2l3 -3M${x - 4} ${y + 3}l2 2l3 -3" ${N}/>`,
  magnifier: (x, y) => `<circle cx="${x}" cy="${y}" r="8" ${W}/><path d="M${x + 6} ${y + 6}l7 7" stroke="#222" stroke-width="3.2" stroke-linecap="round"/>`,
  chair: () => `<path d="M30 76h40M34 76v14M66 76v14" ${N}/>`,
};
// 효과
const F = {
  sweat: (x, y) => `<path d="M${x} ${y - 5}q4 5 0 8q-4 -3 0 -8z" ${W}/>`,
  tears: (x, y) => `<path d="M${x - 10} ${y}q-3 6 -1 10M${x + 10} ${y}q3 6 1 10" fill="none" stroke="#222" stroke-width="2" stroke-linecap="round"/><path d="M${x - 14} ${y + 14}q2 3 0 5q-2 -2 0 -5zM${x + 14} ${y + 14}q2 3 0 5q-2 -2 0 -5z" ${W}/>`,
  sparkle: (x, y, s = 1) => `<path d="M${x} ${y - 5 * s}q1 4 5 ${5 * s}q-4 1 -5 ${5 * s}q-1 -4 -5 -${5 * s}q4 -1 5 -${5 * s}z" ${W}/>`,
  steam: (x, y) => `<path d="M${x - 8} ${y}q-3 -4 0 -7M${x} ${y - 2}q-3 -4 0 -7M${x + 8} ${y}q-3 -4 0 -7" ${N}/>`,
  q: (x, y) => `<path d="M${x - 3} ${y - 4}q0 -5 4 -5q4 0 4 4q0 3 -4 4v3" ${N}/><circle cx="${x + 1}" cy="${y + 6}" r="1.3" fill="#222"/>`,
  bulb: (x, y) => `<circle cx="${x}" cy="${y}" r="6" ${W}/><path d="M${x - 3} ${y + 7}h6M${x - 10} ${y - 6}l-3 -2M${x + 10} ${y - 6}l3 -2M${x} ${y - 10}v-3" ${N}/>`,
  heart: (x, y, s = 1) => `<path d="M${x} ${y + 5 * s}q-8 -5 -8 -10q0 -4 4 -4q3 0 4 3q1 -3 4 -3q4 0 4 4q0 5 -8 10z" ${W}/>`,
  notes: (x, y) => `<path d="M${x} ${y}v-8l6 -2v8" ${N}/><circle cx="${x - 1.5}" cy="${y}" r="2" fill="#222"/><circle cx="${x + 4.5}" cy="${y - 2}" r="2" fill="#222"/>`,
  moon: (x, y) => `<path d="M${x} ${y - 6}q-8 6 0 12q-10 2 -10 -6q0 -8 10 -6z" ${W}/>`,
  speed: (x, y) => `<path d="M${x} ${y}h-10M${x + 2} ${y + 6}h-14M${x} ${y + 12}h-9" ${G}/>`,
  shock: (x, y) => `<path d="M${x - 24} ${y - 8}l-6 -4M${x - 26} ${y + 2}h-7M${x + 24} ${y - 8}l6 -4M${x + 26} ${y + 2}h7" ${N}/>`,
  dots: (x, y) => `<circle cx="${x}" cy="${y}" r="1.4" fill="#222"/><circle cx="${x + 5}" cy="${y}" r="1.4" fill="#222"/><circle cx="${x + 10}" cy="${y}" r="1.4" fill="#222"/>`,
  cloud: (x, y) => `<path d="M${x - 10} ${y + 3}q-5 0 -5 -4q0 -5 6 -4q1 -5 7 -5q6 0 7 5q5 -1 5 4q0 4 -5 4z" ${W}/><path d="M${x - 6} ${y + 6}l-1 4M${x} ${y + 6}l-1 4M${x + 6} ${y + 6}l-1 4" ${G}/>`,
  shiver: (x, y) => `<path d="M${x - 26} ${y}q-3 3 0 6q3 3 0 6M${x + 26} ${y}q3 3 0 6q-3 3 0 6" ${N}/>`,
  squiggle: (x, y) => `<path d="M${x - 24} ${y}q-4 -4 0 -7q4 -3 0 -7M${x + 24} ${y}q4 -4 0 -7q-4 -3 0 -7" ${N}/>`,
  gloom: (x) => `<path d="M${x - 12} 6v12M${x - 4} 4v16M${x + 4} 4v16M${x + 12} 6v12" ${G}/>`,
  clap: (x, y) => `<path d="M${x - 9} ${y - 7}l-3 -3M${x + 9} ${y - 7}l3 -3M${x} ${y - 10}v-4" ${N}/>`,
  burst: (x, y, r = 30) => `<path d="${[...Array(10)].map((_, i) => { const a = i / 10 * Math.PI * 2 + .3, c = Math.cos(a), d = Math.sin(a); return `M${(x + c * r).toFixed(1)} ${(y + d * r).toFixed(1)}L${(x + c * (r + 8)).toFixed(1)} ${(y + d * (r + 8)).toFixed(1)}`; }).join('')}" ${N}/>`,
  stars: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="16" ry="4" ${G}/>` + `<path d="M${x - 12} ${y - 4}l1.5 3l3 .5l-2.2 2l.6 3l-2.9 -1.5l-2.9 1.5l.6 -3l-2.2 -2l3 -.5z" ${W}/>`,
  flower: (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">${[0, 72, 144, 216, 288].map(a => `<circle cx="${(Math.cos(a * Math.PI / 180) * 4).toFixed(1)}" cy="${(Math.sin(a * Math.PI / 180) * 4).toFixed(1)}" r="3.4" ${W}/>`).join('')}<circle r="2" fill="#222"/></g>`,
  z: (x, y) => `<path d="M${x} ${y}h5l-5 5h5" ${N}/>`,
  puff: (x, y) => `<path d="M${x} ${y}q3 -3 6 0q3 -3 6 0" ${G}/>`,
};
const pt = (a) => a.map(v => +v.toFixed(1));
window.cuttoryPoseSVG = (f) => {
  f = f || {};
  const [hx, hy, turn = 0, tilt = 0] = f.h || [50, 30], hr = f.hr || 21;
  const [nx, ny, px, py] = f.n || [50, 50, 50, 70];
  const sL = [nx - 7, ny + 5], sR = [nx + 7, ny + 5], iL = [px - 4, py + 1], iR = [px + 4, py + 1];
  const arms = [[sL, ...(f.a ? [f.a.slice(0, 2), f.a.slice(2)] : [[nx - 11, ny + 13], [nx - 12, ny + 21]])], [sR, ...(f.b ? [f.b.slice(0, 2), f.b.slice(2)] : [[nx + 11, ny + 13], [nx + 12, ny + 21]])]];
  const legs = [[iL, ...(f.l ? [f.l.slice(0, 2), f.l.slice(2)] : [[px - 5, py + 9], [px - 6, py + 18]])], [iR, ...(f.r ? [f.r.slice(0, 2), f.r.slice(2)] : [[px + 5, py + 9], [px + 6, py + 18]])]];
  const limb = (pts) => 'M' + pts.map(p => pt(p).join(' ')).join('L');
  const torso = `M${nx} ${ny + 2}L${px} ${py - 2}`;
  const parts = (w) => [
    `<path d="${torso}" stroke-width="${w + 10}"/>`,
    ...arms.map(a => `<path d="${limb(a)}" stroke-width="${w}"/>`),
    ...legs.map(l => `<path d="${limb(l)}" stroke-width="${w + 1}"/>`),
  ].join('');
  const hands = (r) => [...(f.noHands ? [] : arms.map(a => a[2])), ...legs.map(l => l[2])].map(p => `<circle cx="${pt(p)[0]}" cy="${pt(p)[1]}" r="${r}"/>`).join('');
  const body = `<g stroke-linecap="round" stroke-linejoin="round" fill="none"><g stroke="#222">${parts(7.5)}</g><g fill="#222">${hands(5)}</g><g stroke="#fff">${parts(3.5)}</g><g fill="#fff">${hands(2.8)}</g></g>`;
  const off = turn * hr * 0.75;
  const guides = f.back ? '' : `<g transform="rotate(${tilt} ${hx} ${hy})" ${G}><path d="M${hx} ${hy - hr + 1}Q${hx + off * 1.4} ${hy} ${hx} ${hy + hr - 1}"/><path d="M${hx - hr + 1} ${hy + 2}Q${hx + off * 0.6} ${hy + 6} ${hx + hr - 1} ${hy + 2}"/></g>`;
  const head = `<circle cx="${hx}" cy="${hy}" r="${hr}" fill="#fff" stroke="#222" stroke-width="2.4"/>${guides}`;
  const order = f.headBehind ? head + body : body + head;
  const art = `${f.pb || ''}${order}${f.p || ''}${f.fx || ''}`;
  const cap = f.t ? `<text x="50" y="15" text-anchor="middle" font-family="'Nanum Pen Script', 'Gaegu', cursive" font-size="${f.t.length > 4 ? 15 : 18}" fill="#222">${f.t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>` : '';
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${f.t ? `<g transform="translate(11 19) scale(.78)">${art}</g>` : art}${cap}</svg>`;
};

// 포즈별 모양
const A = {
  // 이모티콘
  e01: { t: '네~', h: [48, 32, 0, -8], b: [70, 42, 74, 26], fx: `<path d="M80 20q4 2 4 6M82 32q4 0 6 3" ${N}/>` },
  e02: { t: '사랑해', h: [50, 32, 0, 8], a: [42, 64, 48, 60], b: [58, 64, 52, 60], fx: F.heart(50, 6, .7) + F.heart(80, 30, .45) },
  e03: { t: '감사합니다', h: [50, 46], n: [50, 60, 50, 72], a: [42, 72, 48, 76], b: [58, 72, 52, 76], fx: F.sparkle(80, 30, .6) },
  e04: { t: '좋아!', h: [50, 30], n: [50, 50, 50, 66], a: [34, 38, 30, 20], b: [66, 38, 70, 20], l: [44, 74, 40, 80], r: [56, 74, 60, 80], fx: F.burst(50, 40, 34) },
  e05: { t: '파이팅!', h: [50, 32], a: [38, 64, 44, 58], b: [62, 64, 56, 58], fx: F.burst(50, 44, 34) },
  e06: { t: '최고!', h: [48, 30, .4, -4], a: [36, 62, 42, 68], b: [64, 58, 72, 52], p: `<path d="M72 52v-7" stroke="#222" stroke-width="3" stroke-linecap="round"/>`, fx: F.sparkle(84, 40, .6) },
  e07: { t: 'ㅋㅋㅋ', h: [50, 32, 0, -14], a: [40, 64, 46, 66], b: [60, 64, 54, 66], fx: F.shiver(50, 40) },
  e08: { t: 'ㅠㅠ', h: [50, 40], n: [50, 60, 50, 74], a: [36, 70, 40, 78], b: [64, 70, 60, 78], l: [36, 82, 44, 88], r: [64, 82, 56, 88], fx: F.tears(50, 42) },
  e09: { t: '부글부글', h: [50, 34], a: [36, 64, 34, 72], b: [64, 64, 66, 72], fx: F.steam(50, 12) + F.squiggle(50, 50) },
  e10: { t: '헉!', h: [50, 32, 0, -6], a: [34, 52, 30, 40], b: [66, 52, 70, 40], fx: F.shock(50, 32) },
  e11: { t: '졸려...', h: [50, 34, 0, 18], a: [42, 66, 40, 74], b: [58, 66, 60, 74], fx: F.z(76, 16) + F.z(84, 8) },
  e12: { headBehind: true, t: '부끄', h: [50, 32, 0, -8], a: [36, 52, 36, 38], b: [64, 52, 64, 38], fx: F.heart(82, 20, .4) },
  e13: { headBehind: true, t: '메롱', h: [50, 32, .2], b: [64, 52, 60, 36], a: [36, 62, 40, 70] },
  e14: { t: '출근 중', h: [50, 34], pb: P.handles(), a: [38, 52, 30, 16], p: P.backpack(56, 64) },
  e15: { t: '열일 중', pb: P.chair(), h: [50, 34], n: [50, 54, 50, 70], a: [38, 66, 42, 74], b: [62, 66, 58, 74], l: [40, 80, 42, 90], r: [60, 80, 58, 90], p: P.laptop(50, 76), fx: F.speed(30, 60) },
  e16: { t: '@_@', h: [50, 34, 0, 12], a: [34, 64, 30, 70], b: [66, 64, 70, 70], l: [44, 80, 38, 88], r: [56, 80, 62, 88], fx: F.stars(50, 12) },
  e17: { t: '축하해!', h: [50, 32], a: [30, 54, 20, 46], b: [70, 54, 80, 46], fx: F.flower(16, 30, .9) + F.flower(84, 30) + F.flower(26, 80, .7) + F.flower(78, 82, .8) },
  e18: { t: '룰루~', h: [50, 32, 0, -12], b: [66, 50, 70, 38], a: [38, 64, 40, 72], fx: F.notes(20, 30) + F.notes(82, 22) },
  e19: { t: 'OK!', h: [50, 38], n: [50, 58, 50, 74], a: [28, 32, 46, 14], b: [72, 32, 54, 14] },
  e20: { t: '잘자~', h: [40, 62, 0, -30], n: [52, 70, 66, 74], a: [44, 80, 40, 84], b: [52, 80, 50, 84], l: [74, 80, 80, 84], r: [72, 76, 82, 78], pb: `<ellipse cx="54" cy="82" rx="40" ry="12" ${W}/>`, fx: F.moon(80, 30) },
  e21: { t: '배고파', h: [50, 32, 0, 6], a: [40, 64, 46, 62], b: [64, 60, 62, 48], p: `<path d="M62 48v-10" stroke="#222" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="62" cy="36" rx="3" ry="4" ${W}/>`, fx: F.sweat(44, 46) },
  e22: { t: '??', h: [50, 32, 0, 24], a: [40, 64, 42, 72], b: [60, 64, 58, 72], fx: F.q(80, 24) },
  e23: { t: '토닥토닥', h: [44, 32, .7], b: [66, 54, 78, 48], fx: F.heart(84, 34, .4) + `<path d="M74 40l2 -4M80 40l2 -3" ${N}/>` },
  e24: { headBehind: true, t: '넵!', h: [50, 32], b: [66, 46, 60, 22], a: [36, 64, 40, 72], fx: F.sparkle(80, 50, .6) },
  // 기본
  b01: {},
  b02: { h: [50, 30, .7] },
  b03: { h: [50, 30, 1], a: [50, 63, 51, 71], b: [56, 63, 57, 71], l: [48, 79, 49, 88], r: [52, 79, 53, 88] },
  b04: { h: [50, 30, 0], back: true },
  // 일상
  d01: { headBehind: true, a: [36, 62, 45, 52], b: [64, 62, 55, 52], h: [50, 28, 0, 0], p: P.mug(50, 50) + P.steam(50, 42), },
  d02: { pb: P.chair(), h: [50, 34], n: [50, 54, 50, 70], a: [38, 66, 42, 74], b: [62, 66, 58, 74], l: [40, 80, 42, 90], r: [60, 80, 58, 90], p: P.laptop(50, 76) },
  d03: { h: [50, 28, .5, 8], b: [62, 60, 58, 50], p: P.phone(58, 49, -10) },
  d04: { h: [50, 30, -.6], b: [64, 50, 62, 38], a: [36, 64, 44, 70], p: P.phone(64, 36, 15) },
  d05: { h: [50, 30, .9], a: [44, 63, 40, 70], b: [58, 63, 62, 69], l: [52, 80, 58, 88], r: [47, 80, 40, 88], p: P.floor(90, 30, 70) },
  d06: { h: [56, 30, 1, 10], n: [54, 49, 49, 68], a: [42, 62, 34, 56], b: [64, 60, 68, 66], l: [56, 76, 54, 86], r: [42, 76, 34, 80], fx: F.speed(28, 34) },
  d07: { pb: P.sofa(), h: [50, 36, 0, -12], n: [50, 56, 50, 70], a: [32, 64, 24, 68], b: [68, 64, 76, 68], l: [42, 76, 36, 88], r: [58, 76, 64, 88] },
  d08: { h: [36, 46, .4], n: [44, 62, 66, 66], a: [32, 72, 34, 62], b: [42, 72, 40, 62], l: [76, 62, 78, 52], r: [80, 66, 86, 56], p: P.phone(38, 56, 0) + P.blanket(56, 64, 30) + P.floor(84, 14, 90) },
  d09: { h: [30, 66, 0, -80], n: [48, 66, 68, 68], a: [52, 74, 46, 76], b: [56, 72, 50, 72], l: [74, 74, 82, 78], r: [74, 70, 84, 72], pb: P.pillow(28, 80), p: P.blanket(44, 64, 42) + F.moon(30, 38), back: false },
  d10: { h: [50, 32], n: [50, 52, 50, 70], a: [36, 62, 42, 46], b: [64, 62, 60, 72], l: [36, 80, 46, 86], r: [64, 80, 54, 86], p: P.chopsticks(44, 46) + P.pot(50, 84) + P.steam(50, 68) },
  d11: { h: [48, 30, .6], a: [38, 62, 46, 70], b: [64, 60, 70, 66], p: P.pan(76, 66) + P.spatula(46, 70) },
  d12: { h: [50, 30, 0, 4], n: [50, 50, 50, 68], a: [38, 62, 40, 66], b: [62, 62, 60, 66], l: [36, 78, 46, 84], r: [64, 78, 54, 84], p: P.book(50, 68) + P.floor(88, 20, 80) },
  d13: { h: [50, 32, 0, -8], n: [50, 52, 50, 70], l: [36, 80, 46, 84], r: [64, 80, 54, 84], pb: P.mat(), p: P.headphones(50, 32) + F.notes(76, 22) + F.notes(20, 30) },
  d14: { h: [50, 30, .6], a: [36, 62, 40, 50], b: [64, 62, 60, 50], p: P.dumbbell(40, 50) + P.dumbbell(60, 50) + F.sweat(72, 22) },
  d15: { h: [50, 34, 0, 0], n: [50, 54, 50, 72], a: [40, 40, 47, 16], b: [60, 40, 53, 16], fx: F.sparkle(80, 30, .8) },
  d16: { h: [48, 30, .8], a: [44, 63, 42, 71], b: [60, 60, 66, 66], l: [52, 80, 57, 88], r: [47, 80, 41, 88], p: P.bag(68, 72) + P.leek(68, 66) },
  d17: { h: [50, 30], pb: P.handles(), a: [38, 50, 34, 14], p: P.backpack(50, 62) },
  d18: { pb: P.chair(), h: [50, 34, 0, 8], n: [50, 54, 50, 70], a: [38, 66, 42, 72], b: [60, 66, 56, 72], l: [40, 80, 42, 90], r: [60, 80, 58, 90], p: P.desk(74) + P.note(52, 74) + P.pen(56, 72) },
  d19: { headBehind: true, h: [50, 32, -.3, -6], b: [66, 40, 70, 22], a: [36, 60, 38, 46], p: P.phone(70, 18, 10) + `<path d="M36 44l-2 -6M39 44l1 -6" ${N}/>` },
  d20: { h: [50, 32, 0, 6], n: [50, 52, 50, 70], a: [36, 62, 38, 58], b: [64, 62, 62, 58], l: [36, 80, 46, 84], r: [64, 80, 54, 84], p: P.shirt(50, 60) + P.pile(24, 88) },
  d21: { h: [40, 40, .7, 10], n: [42, 58, 42, 72], a: [48, 66, 56, 66], b: [50, 64, 60, 64], l: [50, 78, 48, 88], r: [36, 80, 40, 88], p: P.dog(68, 88) + F.heart(56, 46, .6) },
  d22: { h: [50, 34], b: [62, 60, 56, 60], a: [36, 62, 40, 70], pb: P.rain(), p: P.umbrella(56, 14) },
  // 긍정
  p01: { h: [48, 32, 0, -6], b: [70, 40, 74, 24], fx: `<path d="M80 18q4 2 4 6M82 30q4 0 6 3" ${N}/>` },
  p02: { h: [48, 30, 0, -4], a: [36, 62, 42, 68], b: [64, 58, 72, 52], p: `<path d="M72 52v-7" stroke="#222" stroke-width="3" stroke-linecap="round"/>` },
  p03: { h: [48, 30, 0, -10], b: [68, 46, 66, 34], p: `<path d="M65 32l-2 -7M68 32l2 -7" stroke="#222" stroke-width="2.4" stroke-linecap="round"/>` },
  p04: { h: [50, 34], n: [50, 54, 50, 70], a: [34, 40, 30, 22], b: [66, 40, 70, 22], l: [44, 80, 40, 86], r: [56, 80, 60, 86], fx: F.sparkle(18, 46) + F.sparkle(84, 46, .8) },
  p05: { h: [50, 30, .3], a: [40, 64, 46, 60], b: [64, 62, 58, 68], fx: F.sparkle(76, 20, .7) },
  p06: { h: [50, 36], n: [50, 56, 50, 72], a: [32, 34, 46, 12], b: [68, 34, 54, 12], fx: F.heart(50, 6, .4) },
  p07: { h: [48, 30, 0, -6], b: [64, 62, 70, 54], p: `<path d="M68 52l2 -4l2 4" ${N}/>`, fx: F.heart(72, 40, .5) },
  p08: { h: [50, 30], a: [40, 64, 48, 58], b: [60, 64, 52, 58], fx: F.clap(50, 56) },
  p09: { h: [48, 30, -.3, -10], a: [34, 46, 30, 32], b: [66, 58, 76, 56], l: [44, 80, 46, 88], r: [60, 74, 64, 82], fx: F.notes(78, 30) },
  p10: { h: [50, 30], a: [40, 66, 46, 62], b: [60, 66, 54, 62], p: P.gift(50, 62), fx: F.sparkle(78, 22, .7) + F.sparkle(22, 26, .6) },
  p11: { headBehind: true, h: [50, 30, 0, 8], a: [36, 50, 34, 38], b: [64, 62, 68, 58], p: P.fork(68, 58), fx: F.sparkle(24, 30, .6) + F.heart(78, 22, .5) },
  p12: { h: [50, 28, .6, -6], a: [44, 64, 58, 60], b: [56, 64, 42, 60] },
  p13: { h: [50, 46, 0, 0], n: [50, 60, 50, 72], a: [42, 72, 48, 76], b: [58, 72, 52, 76], back: false },
  p14: { h: [50, 30], a: [30, 54, 20, 52], b: [70, 54, 80, 52], fx: F.heart(84, 28, .5) },
  // 부정
  n01: { headBehind: true, h: [50, 30, 0, 0], a: [40, 60, 40, 40], b: [60, 60, 60, 40], fx: F.tears(50, 34) },
  n02: { h: [50, 32, 0, 10], a: [44, 64, 50, 66], b: [56, 64, 50, 66], fx: F.sweat(60, 32) },
  n03: { h: [50, 30], a: [36, 62, 32, 72], b: [64, 62, 68, 72], l: [42, 80, 38, 88], r: [58, 80, 62, 88], fx: F.steam(50, 8) },
  n04: { h: [50, 30, -.9, -6], a: [44, 64, 58, 60], b: [56, 64, 42, 60], fx: `<path d="M74 30q4 -4 8 0q-4 4 -8 0z" ${W}/>` },
  n05: { headBehind: true, h: [50, 32], n: [50, 52, 50, 70], a: [36, 52, 36, 36], b: [64, 52, 64, 36], fx: F.shock(50, 30) },
  n06: { h: [50, 36, 0, 12], n: [50, 56, 52, 72], a: [42, 70, 40, 80], b: [60, 70, 62, 80], fx: F.cloud(50, 6) },
  n07: { h: [30, 72, 0, -70], n: [48, 74, 70, 76], a: [42, 84, 34, 86], b: [56, 84, 52, 88], l: [80, 80, 88, 84], r: [80, 74, 88, 76], p: P.floor(90, 10, 92) + `<path d="M44 86q8 6 18 2" ${G}/>` },
  n08: { h: [50, 40], n: [50, 60, 50, 76], a: [30, 46, 34, 30], b: [70, 46, 66, 30], fx: F.squiggle(50, 40) },
  n09: { h: [50, 30, -.5], a: [42, 64, 48, 62], b: [58, 64, 52, 62], fx: F.sweat(70, 20) + F.sweat(76, 32) },
  n10: { h: [72, 58, 0, 80], n: [56, 54, 36, 56], a: [56, 68, 54, 78], b: [62, 68, 60, 78], l: [34, 74, 34, 88], r: [38, 74, 40, 88], p: P.floor(90, 20, 84), fx: F.sweat(78, 30), back: true },
  n11: { headBehind: true, h: [50, 30], a: [38, 56, 38, 28], fx: F.dots(70, 22) },
  n12: { h: [50, 32], a: [42, 66, 56, 60], b: [58, 66, 44, 60], fx: F.shiver(50, 54) + F.puff(64, 46) },
  n13: { h: [50, 30], b: [66, 50, 68, 38], a: [36, 64, 38, 72], fx: F.sweat(30, 22) + F.sweat(28, 36) + `<path d="M70 32q4 -4 6 0q-2 4 -6 0" ${N}/>` },
  n14: { h: [28, 58, 0, 70], n: [44, 56, 62, 66], a: [36, 70, 30, 80], b: [42, 70, 38, 80], l: [64, 78, 76, 80], r: [70, 76, 82, 78], p: P.floor(84, 12, 90), fx: F.gloom(30), back: true },
  // 정보성
  i01: { h: [48, 30, 0, -4], b: [66, 50, 66, 34], a: [36, 62, 40, 70], p: `<path d="M66 32v-8" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>` },
  i02: { h: [46, 30, .3], b: [72, 58, 86, 56], p: `<path d="M86 56h6" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>` },
  i03: { h: [54, 30, -.3], a: [28, 58, 14, 56], p: `<path d="M14 56h-6" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>` },
  i04: { h: [50, 34, 0, -8], n: [50, 54, 50, 72], b: [66, 34, 70, 14], p: `<path d="M70 12v-6" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>` },
  i05: { h: [50, 46], n: [50, 64, 50, 78], a: [32, 48, 34, 26], b: [68, 48, 66, 26], l: [46, 84, 45, 92], r: [54, 84, 55, 92], p: P.sign(50, 18) },
  i06: { h: [50, 38], n: [50, 58, 50, 74], a: [28, 32, 46, 14], b: [72, 32, 54, 14] },
  i07: { h: [50, 30], a: [40, 64, 62, 54], b: [60, 64, 38, 54] },
  i08: { h: [50, 30, .6, -8], a: [44, 64, 56, 62], b: [64, 56, 58, 46], fx: F.q(78, 20) },
  i09: { h: [50, 34], n: [50, 54, 50, 72], b: [66, 46, 66, 30], p: `<path d="M66 28v-6" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>`, fx: F.bulb(50, 8) },
  i10: { h: [50, 30, 0, 6], a: [38, 62, 42, 62], b: [62, 62, 56, 60], p: P.clipboard(46, 62) + P.pen(56, 60) },
  i11: { h: [42, 34, .7, 12], n: [46, 52, 50, 70], b: [64, 50, 66, 40], p: P.magnifier(66, 34) },
  i12: { headBehind: true, h: [50, 30, 0, -6], b: [62, 58, 52, 46], p: `<path d="M52 46v-8" stroke="#222" stroke-width="2.6" stroke-linecap="round"/>` },
};
window.CUTTORY_POSE_ART = A;
})();
