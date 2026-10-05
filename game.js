/* ============================================================
 *  BubbleBlast（泡泡堂 Q版复刻）· 纯 Canvas + 原生 JS
 *  玩法：方向键+Enter / WASD+空格 移动放泡泡，炸开砖块吃道具
 * ============================================================ */
'use strict';

window.__errs = [];
window.addEventListener('error', e => window.__errs.push(e.message));

/* ---------- 常量 ---------- */
const TILE = 48;
const HUD_H = 56;
// 场地尺寸不是固定的：跟随窗口长宽比动态生成（宽屏=宽地图，竖屏=窄高地图）
let COLS = 15, ROWS = 13;
let W = COLS * TILE, H = ROWS * TILE + HUD_H;

function setFieldSize() {
  const odd = n => (n % 2 === 0 ? n + 1 : n);   // 保持奇数，石柱布局对称
  const max = (v, a) => Math.max(a, v);
  const min = (v, a) => Math.min(a, v);
  const cw = document.documentElement.clientWidth || innerWidth;
  const ch = document.documentElement.clientHeight || innerHeight;
  const aspect = max(0.45, min(3.2, cw / max(1, ch)));
  ROWS = odd(max(9, min(19, Math.round(13 / Math.sqrt(aspect)))));
  COLS = odd(max(9, min(27, Math.round(ROWS * aspect))));
  W = COLS * TILE;
  H = ROWS * TILE + HUD_H;
}

const EMPTY = 0, STONE = 1, SOFT = 2, ICE = 3, BUSH = 4, SAND = 5, PORTAL = 6;
const ITEM_BOMB = 0, ITEM_FIRE = 1, ITEM_SPEED = 2, ITEM_KICK = 3, ITEM_SHIELD = 4, ITEM_REMOTE = 5, ITEM_PUNCH = 6, ITEM_MIRROR = 7, ITEM_BOOST = 8, ITEM_DOUBLE = 9, ITEM_PIERCE = 10, ITEM_STORM = 11, ITEM_BANANA = 12;

/* ---------- 地图主题（按关卡/回合轮换） ---------- */
const TH_HINTS = { snow: ' · 冰面会滑！', flower: ' · 草丛可藏身', desert: ' · 小心流沙', night: ' · 传送门开启' };
const THEMES = [
  { name: '草原', g1: '#7ec850', g2: '#74bf4a', stone: '#5a6579', stoneTop: '#6d7891', deco: 'flower' },
  { name: '雪原', g1: '#d4e6f5', g2: '#c6dcef', stone: '#7f93ad', stoneTop: '#94a9c4', deco: 'snow' },
  { name: '沙漠', g1: '#ecd9a0', g2: '#e3cd8c', stone: '#9a7b58', stoneTop: '#b08e66', deco: 'desert' },
  { name: '夜幕', g1: '#414d78', g2: '#3a4570', stone: '#2c3352', stoneTop: '#3d4570', deco: 'night' },
];

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

/* ---------- 资源加载 & 加载界面 ---------- */
let assetsReady = false;
const loader = document.getElementById('loader');
const barFill = document.getElementById('barFill');
const loadPercent = document.getElementById('loadPercent');

Assets.onProgress((loaded, total) => {
  const pct = Math.round(loaded / total * 100);
  barFill.style.width = pct + '%';
  if (loadPercent) loadPercent.textContent = pct + '%';
});

async function initAssets() {
  try {
    await Promise.race([
      Assets.init(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
    ]);
  } catch(e) {
    console.warn('[Assets] init failed or timeout:', e);
  }
  assetsReady = true;
  // 立即移除加载屏并显示 DOM 主菜单
  if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
  MenuUI.init();
  MenuUI.show();
}
initAssets();
// 兜底：6秒后无论如何移除加载屏
setTimeout(function() {
  var l = document.getElementById('loader');
  if (l && l.parentNode) l.parentNode.removeChild(l);
  MenuUI.init();
  MenuUI.show();
}, 6500);

/* ---------- 自适应缩放 & 全屏 ---------- */
// 画布永远占满整个浏览器窗口（CSS flex 布局），
// 游戏画面在画布内等比缩放居中，按物理像素渲染 → 任何尺寸下都是高清矢量
// viewRect 记录游戏坐标系下的可见范围（可以超出 0..W / 0..H，用于背景延伸）
let viewRect = { x0: 0, y0: 0, x1: W, y1: H };
let viewScale = 1, viewOffX = 0, viewOffY = 0;
function fitCanvas() {
  setFieldSize();
  const dpr = window.devicePixelRatio || 1;
  const cw = document.documentElement.clientWidth || innerWidth;
  const ch = document.documentElement.clientHeight || innerHeight;
  cvs.width = Math.round(cw * dpr);
  cvs.height = Math.round(ch * dpr);
  // 高分屏下必须把 CSS 尺寸锁回 CSS 像素，否则元素会被 backing 撑大溢出窗口
  cvs.style.width = cw + 'px';
  cvs.style.height = ch + 'px';
  const scale = Math.min(cvs.width / W, cvs.height / H);
  const offX = (cvs.width - W * scale) / 2;
  const offY = (cvs.height - H * scale) / 2;
  ctx.setTransform(scale, 0, 0, scale, offX, offY);
  viewScale = scale; viewOffX = offX; viewOffY = offY;
  viewRect = {
    x0: -offX / scale,
    y0: -offY / scale,
    x1: (cvs.width - offX) / scale,
    y1: (cvs.height - offY) / scale,
  };
}
function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  } catch (e) { /* 某些环境（如内嵌 iframe）不允许全屏，忽略 */ }
}
window.addEventListener('resize', fitCanvas);
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitCanvas);
document.addEventListener('fullscreenchange', () => {
  document.getElementById('tip').style.display = document.fullscreenElement ? 'none' : '';
  fitCanvas();
});
cvs.addEventListener('dblclick', toggleFullscreen);

/* ---- 菜单鼠标支持：悬停高亮 + 点击进入 ---- */
  // 菜单鼠标支持：直接使用画布物理像素坐标（菜单在物理空间绘制）
  function menuPosFromEvent(e) {
    const rect = cvs.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (cvs.width / rect.width),
      y: (e.clientY - rect.top) * (cvs.height / rect.height),
    };
  }
cvs.addEventListener('mousemove', e => {
  if (Game.state !== 'menu') { cvs.style.cursor = 'default'; return; }
  const p = menuPosFromEvent(e);
  Game.hoverIndex = Game.menuRects.findIndex(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  cvs.style.cursor = Game.hoverIndex >= 0 ? 'pointer' : 'default';
});
cvs.addEventListener('click', e => {
  if (Game.state !== 'menu') return;
  const p = menuPosFromEvent(e);
  const i = Game.menuRects.findIndex(r => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
  if (i >= 0) { Game.menuIndex = i; Game.confirmMenu(); }
});
fitCanvas();

/* ---------- 工具 ---------- */
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const idx = (tx, ty) => ty * COLS + tx;
const inMap = (tx, ty) => tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS;
const cx = tx => tx * TILE + TILE / 2;   // 格子中心像素
const cy = ty => ty * TILE + TILE / 2 + HUD_H;

/* ---------- 合成音效（WebAudio，无素材） ---------- */
const Sfx = {
  ac: null, muted: false,
  ensure() {
    if (!this.ac) { try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (this.ac && this.ac.state === 'suspended') this.ac.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.12, slide = 0) {
    if (this.muted || !this.ac) return;
    const t = this.ac.currentTime;
    const o = this.ac.createOscillator(), g = this.ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.ac.destination);
    o.start(t); o.stop(t + dur);
  },
  noise(dur, vol = 0.2) {
    if (this.muted || !this.ac) return;
    const t = this.ac.currentTime, n = this.ac.sampleRate * dur;
    const buf = this.ac.createBuffer(1, n, this.ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ac.createBufferSource(); s.buffer = buf;
    const g = this.ac.createGain(); g.gain.value = vol;
    const f = this.ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    s.connect(f); f.connect(g); g.connect(this.ac.destination);
    s.start(t);
  },
  place()   { this.tone(220, 0.08, 'square', 0.1, -80); },
  boom()    { this.noise(0.45, 0.28); this.tone(90, 0.4, 'sawtooth', 0.18, -50); },
  pickup()  { this.tone(523, 0.07, 'square', 0.1); setTimeout(() => this.tone(784, 0.1, 'square', 0.1), 70); },
  die()     { this.tone(440, 0.5, 'sawtooth', 0.15, -330); },
  kill()    { this.tone(660, 0.12, 'square', 0.1, -200); },
  ice()     { this.tone(560, 0.14, 'sine', 0.055, -320); },
  warp()    { this.tone(220, 0.18, 'sine', 0.09, 520); },
  slip()    { this.tone(900, 0.28, 'sawtooth', 0.08, -700); },
  move()    { this.tone(340, 0.05, 'square', 0.06); },
  confirm() { this.tone(523, 0.09, 'square', 0.1); setTimeout(() => this.tone(784, 0.12, 'square', 0.1), 80); },
  win()     { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.15, 'square', 0.12), i * 120)); },
  lose()    { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'sawtooth', 0.12), i * 160)); },
};

/* ---------- DOM 主菜单控制器 ---------- */
const MenuUI = {
  el: null, items: [],
  init() {
    this.el = document.getElementById('menu');
    if (!this.el) return;
    this.items = [...this.el.querySelectorAll('.m-item')];
    this.items.forEach((el, i) => {
      el.addEventListener('mouseenter', () => {
        if (Game.state !== 'menu' || Game.menuIndex === i) return;
        Game.menuIndex = i; Sfx.move(); this.sync();
      });
      el.addEventListener('click', () => {
        if (Game.state !== 'menu') return;
        Game.menuIndex = i; this.sync(); Game.confirmMenu();
      });
    });
    this.sync();
  },
  sync() {
    this.items.forEach((el, i) => el.classList.toggle('sel', i === Game.menuIndex));
  },
  show() { if (this.el) { this.el.classList.remove('hidden'); this.sync(); } },
  hide() { if (this.el) this.el.classList.add('hidden'); },
};

/* ---------- 输入 ---------- */
const keys = {};
const HANDLED = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
window.addEventListener('keydown', e => {
  Sfx.ensure();
  keys[e.key] = true;
  if (HANDLED.includes(e.key)) e.preventDefault();
  Game.onKey(e.key);
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

/* ---------- 关卡生成 ---------- */
// 6 种布局原型按关卡轮换（点对称生成保证工整），雪原关卡生成冰面滑行区
const MAP_PATTERNS = 9;
function genMap(mode) {
  const m = new Array(COLS * ROWS).fill(EMPTY);
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0))
        m[idx(x, y)] = STONE;

  // 四角出生点及其相邻格保持空
  const corners = [[1, 1], [COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 2]];
  const safe = new Set();
  for (const [x, y] of corners) {
    safe.add(idx(x, y));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (inMap(x + dx, y + dy) && m[idx(x + dx, y + dy)] !== STONE) safe.add(idx(x + dx, y + dy));
  }

  const level = (typeof Game !== 'undefined' && Game.level) || 1;
  const pattern = (level - 1) % MAP_PATTERNS;
  const put = (x, y) => {
    if (!inMap(x, y) || m[idx(x, y)] !== EMPTY || safe.has(idx(x, y))) return;
    m[idx(x, y)] = SOFT;
    m[idx(COLS - 1 - x, ROWS - 1 - y)] = SOFT;   // 点对称镜像
  };
  const cxm = (COLS - 1) / 2, cym = (ROWS - 1) / 2;
  const half = Math.floor((COLS - 1) / 2);

  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x <= half; x++) {
      if (m[idx(x, y)] !== EMPTY || safe.has(idx(x, y))) continue;
      const r = Math.random();
      if (pattern === 0) {
        // 散布
        if (r < 0.70) put(x, y);
      } else if (pattern === 1) {
        // 短墙段：水平/垂直 2~3 连
        if (r < 0.30) {
          const len = randi(2, 3), horiz = Math.random() < 0.5;
          for (let i = 0; i < len; i++) put(x + (horiz ? i : 0), y + (horiz ? 0 : i));
        }
      } else if (pattern === 2) {
        // 空心围合
        if (r < 0.16) {
          for (let i = 0; i < 3; i++) { put(x + i, y); put(x + i, y + 2); put(x, y + i); put(x + 2, y + i); }
        } else if (r < 0.48) put(x, y);
      } else if (pattern === 3) {
        // 菱形环廊：曼哈顿距离 4~5 的环 + 稀疏内芯
        const d = Math.abs(x - cxm) + Math.abs(y - cym);
        if (d === 4 || d === 5) put(x, y);
        else if (d === 2 && r < 0.4) put(x, y);
      } else if (pattern === 4) {
        // 双金字塔（沙漏）：上下两座三角
        if (y < cym - 1 && Math.abs(x - cxm) <= (cym - y) * 1.35 && r < 0.85) put(x, y);
      } else if (pattern === 5) {
        // 蛇形走廊：偶数行横墙 + 每行一个对称缺口
        if (y % 2 === 0 && y >= 2 && y <= ROWS - 3) {
          const gap = 2 + Math.floor(Math.random() * Math.max(1, half - 2));
          if (x !== gap && x !== COLS - 1 - gap) put(x, y);
        } else if (r < 0.35) put(x, y);
      } else if (pattern === 6) {
        // 回字迷宫：同心方环交替
        const ring = Math.max(Math.abs(x - cxm), Math.abs(y - cym));
        if (ring % 2 === 1 && ring <= 5 && r < 0.92) put(x, y);
      } else if (pattern === 7) {
        // 四角堡垒 + 中央十字
        const qx = Math.abs(x - cxm), qy = Math.abs(y - cym);
        if ((qx <= 1 && qy <= 3) || (qy <= 1 && qx <= 3)) put(x, y);
        else if (qx >= 4 && qx <= 5 && qy >= 4 && qy <= 5 && r < 0.9) put(x, y);
      } else {
        // 竞技场：开阔地 + 四角掩体
        const qx = Math.abs(x - cxm), qy = Math.abs(y - cym);
        if (r < 0.15) put(x, y);
        else if (qx >= 3 && qx <= 4 && qy >= 3 && qy <= 4 && r < 0.85) put(x, y);
      }
    }

  // 主题专属玩法地块：草原=草丛(潜行) 雪原=冰面(滑行) 沙漠=流沙(减速) 夜幕=传送门
  const thIdx = ((mode === 'versus' ? Game.round : level) - 1) % THEMES.length;
  const th = THEMES[thIdx];
  if (typeof Game !== 'undefined') Game.portals = null;
  const blob = (tile, seeds, steps) => {
    for (let s = 0; s < seeds; s++) {
      let sx = randi(3, COLS - 4), sy = randi(3, ROWS - 4);
      for (let step = 0; step < steps; step++) {
        if (m[idx(sx, sy)] === EMPTY && !safe.has(idx(sx, sy))) m[idx(sx, sy)] = tile;
        if (Math.random() < 0.5) sx = clamp(sx + randi(-1, 1), 2, COLS - 3);
        else sy = clamp(sy + randi(-1, 1), 2, ROWS - 3);
      }
    }
  };
  if (th && th.deco === 'snow') {
    blob(ICE, 2 + randi(0, 2), 14);
  } else if (th && th.deco === 'flower') {
    blob(BUSH, 3 + randi(0, 2), 10);
  } else if (th && th.deco === 'desert') {
    blob(SAND, 3 + randi(0, 2), 12);
  } else if (th && th.deco === 'night') {
    const spots = [];
    for (let y = 2; y < ROWS - 2; y++) for (let x = 2; x < COLS - 2; x++)
      if (m[idx(x, y)] === EMPTY && !safe.has(idx(x, y))) spots.push([x, y]);
    if (spots.length >= 2) {
      const a = spots[randi(0, spots.length - 1)];
      let b = a, tries = 40;
      while (tries-- > 0 && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 8)
        b = spots[randi(0, spots.length - 1)];
      m[idx(a[0], a[1])] = PORTAL; m[idx(b[0], b[1])] = PORTAL;
      if (typeof Game !== 'undefined') Game.portals = [[a[0], a[1], b[0], b[1]]];
    }
  }
  if (typeof Game !== 'undefined') { Game._fieldCols = COLS; Game._fieldRows = ROWS; }
  return m;
}

/* ---------- 危险区计算（AI 用） ---------- */
function buildDanger() {
  const danger = new Array(COLS * ROWS).fill(0); // 0 安全, >0 危险
  for (const f of Game.flames) danger[idx(f.tx, f.ty)] = 1;
  for (const b of Game.bombs) {
    danger[idx(b.tx, b.ty)] = 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let i = 1; i <= b.range; i++) {
        const x = b.tx + dx * i, y = b.ty + dy * i;
        if (!inMap(x, y)) break;
        const t = Game.map[idx(x, y)];
        if (t === STONE) break;
        danger[idx(x, y)] = 1;
        if (t === SOFT) break;
      }
    }
  }
  return danger;
}

function bfsPath(sx, sy, danger, isGoal) {
  const prev = new Array(COLS * ROWS).fill(-1);
  const vis = new Array(COLS * ROWS).fill(false);
  const q = [idx(sx, sy)];
  vis[idx(sx, sy)] = true;
  let goal = -1;
  while (q.length && goal < 0) {
    const cur = q.shift();
    const x = cur % COLS, y = (cur / COLS) | 0;
    if (!(x === sx && y === sy) && isGoal(x, y, cur)) { goal = cur; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(nx, ny)) continue;
      const ni = idx(nx, ny);
      if (vis[ni]) continue;
      const t = Game.map[ni];
      if (t === STONE || t === SOFT) continue;
      if (Game.bombs.some(b => b.tx === nx && b.ty === ny)) continue;
      if (danger[ni]) continue;
      vis[ni] = true; prev[ni] = cur; q.push(ni);
    }
  }
  if (goal < 0) return null;
  const path = [];
  for (let c = goal; c !== idx(sx, sy); c = prev[c]) path.push([c % COLS, (c / COLS) | 0]);
  return path.reverse();
}

/* ---------- 实体 ---------- */
function makePlayer(tx, ty, color, name, isAI = false) {
  return {
    kind: 'player',
    x: cx(tx), y: cy(ty), tx, ty,
    half: 19, speed: 150,
    bombMax: 1, bombActive: 0, fire: 2,
    color, name, isAI,
    alive: true, dying: 0, dead: false,
    invincible: 0, anim: rand(0, 9),
    kick: false, shield: 0, remote: false,
    portalCD: 0, hidden: false, slide: null, slideTarget: null, lastDir: null,
    punch: false, mirror: false, boost: false, double: false, pierce: false, storm: false,
    punchTimer: 0, mirrorTimer: 0, boostTimer: 0, stormTimer: 0,
    face: { x: 0, y: 1 }, moving: false,
    lives: 3, score: 0,
  };
}

function makeEnemy(tx, ty, level) {
  return {
    kind: 'enemy',
    x: cx(tx), y: cy(ty), tx, ty,
    speed: 78 + level * 8,
    bombActive: 0, bombMax: 1, fire: 1,
    alive: true, dying: 0,
    target: null, decideT: 0,
    color: ['#8a5cc9', '#3fa65b', '#c96a3f', '#c93f7a', '#4f8fc9'][level % 5],
    anim: rand(0, 9), moving: false, face: { x: 0, y: 1 },
  };
}

/* ---------- 主对象 ---------- */
const Game = {
  state: 'menu',        // menu / play / pause / over / win
  mode: 'single',       // single / versus
  map: null,
  players: [], enemies: [],
  bombs: [], flames: [], items: [], particles: [],
  level: 1, round: 1,
  time: 0, msg: '', msgT: 0, shakeT: 0,
  respawnT: 0, roundEndT: 0,
  menuIndex: 0, hoverIndex: -1, menuRects: [],
  confirmLockT: 0, peels: [],

  reset(mode) {
    this.mode = mode;
    this.hidden = [];
    this.level = 1; this.round = 1;
    this.map = genMap(mode);
    this.theme = THEMES[0];
    this.bombs = []; this.flames = []; this.items = []; this.particles = []; this.peels = [];
    this.enemies = [];
    const p1 = makePlayer(1, 1, '#4f8fdc', 'P1');
    p1.lives = 3;
    this.players = [p1];
    if (mode === 'versus') {
      const p2 = makePlayer(COLS - 2, ROWS - 2, '#e05b5b', 'P2');
      p2.lives = 1;
      this.players.push(p2);
      this.spawnItemsForVersus();
    } else {
      this.spawnEnemies();
    }
    // 道具挑战模式：全道具池
    if (mode === 'item-challenge') {
      this.hidden = [];
      const pool = [ITEM_BOMB, ITEM_FIRE, ITEM_SPEED, ITEM_KICK, ITEM_SHIELD, ITEM_REMOTE, ITEM_PUNCH, ITEM_MIRROR, ITEM_BOOST, ITEM_DOUBLE, ITEM_PIERCE, ITEM_STORM, ITEM_BANANA];
      for (let i = 0; i < this.map.length; i++) {
        if (this.map[i] === SOFT) {
          this.hidden[i] = pool[randi(0, pool.length - 1)];
        }
      }
    }
    // 无尽模式：敌人越来越多
    if (mode === 'endless') {
      this.level = 1;
    }
    this.state = 'play';
    const modeNames = { 'item-challenge': '道具挑战', 'endless': '无尽模式' };
    this.showMsg(mode === 'versus' ? `第 ${this.round} 回合 · 开始！` : mode === 'item-challenge' ? '道具挑战 · 开始！' : mode === 'endless' ? '无尽模式 · 开始！' : `第 ${this.level} 关 · 开始！`);
  },

  nextLevel() {
    this.level++;
    this.hidden = [];
    this.map = genMap(this.mode);
    this.theme = THEMES[(this.level - 1) % THEMES.length];
    this.bombs = []; this.flames = []; this.items = []; this.particles = []; this.peels = [];
    const p = this.players[0];
    p.x = cx(1); p.y = cy(1); p.tx = 1; p.ty = 1;
    p.alive = true; p.dead = false; p.invincible = 2; p.dying = 0;
    p.bombActive = 0; p.bombMax = 1; p.fire = 2; p.speed = 150;
    p.kick = false; p.shield = 0; p.remote = false;
    p.punch = false; p.mirror = false; p.boost = false; p.double = false; p.pierce = false; p.storm = false;
    p.punchTimer = 0; p.mirrorTimer = 0; p.boostTimer = 0; p.stormTimer = 0;
    this.spawnEnemies();
    this.state = 'play';
    this.showMsg(`第 ${this.level} 关 · ${this.theme.name}` + TH_HINTS[this.theme.deco]);
  },

  nextRound() {
    this.round++;
    this.hidden = [];
    this.map = genMap(this.mode);
    this.theme = THEMES[(this.round - 1) % THEMES.length];
    this.bombs = []; this.flames = []; this.items = []; this.particles = []; this.peels = [];
    const spots = [[1, 1], [COLS - 2, ROWS - 2]];
    this.players.forEach((p, i) => {
      p.x = cx(spots[i][0]); p.y = cy(spots[i][1]);
      p.tx = spots[i][0]; p.ty = spots[i][1];
      p.alive = true; p.dead = false; p.invincible = 2; p.dying = 0;
      p.bombMax = 1; p.bombActive = 0; p.fire = 2; p.speed = 150;
      p.kick = false; p.shield = 0; p.remote = false;
      p.punch = false; p.mirror = false; p.boost = false; p.double = false; p.pierce = false; p.storm = false;
      p.punchTimer = 0; p.mirrorTimer = 0; p.boostTimer = 0; p.stormTimer = 0;
    });
    this.spawnItemsForVersus();
    this.state = 'play';
    this.showMsg(`第 ${this.round} 回合 · ${this.theme.name}` + TH_HINTS[this.theme.deco]);
  },

  spawnEnemies() {
    this.enemies = [];
    const n = Math.min(2 + (this.level - 1) + (COLS > 19 ? 1 : 0), 6); // 宽地图多放一个敌人
    const spots = [[COLS - 2, 1], [1, ROWS - 2], [COLS - 2, ROWS - 2], [COLS - 2, 2], [2, ROWS - 2], [2, 2]];
    for (let i = 0; i < n; i++) {
      const [x, y] = spots[i];
      if (this.map[idx(x, y)] === SOFT) this.map[idx(x, y)] = EMPTY;
      this.enemies.push(makeEnemy(x, y, this.level - 1 + i));
    }
  },

  spawnItemsForVersus() {
    // 对战模式：把部分软砖下埋道具
    const pool = [ITEM_BOMB, ITEM_FIRE, ITEM_SPEED, ITEM_KICK, ITEM_SHIELD, ITEM_REMOTE, ITEM_PUNCH, ITEM_MIRROR, ITEM_BOOST, ITEM_DOUBLE, ITEM_PIERCE, ITEM_STORM, ITEM_BANANA];
    let placed = 0;
    for (let i = 0; i < this.map.length && placed < 14; i++) {
      if (this.map[i] === SOFT && Math.random() < 0.3) {
        this.hidden = this.hidden || [];
        this.hidden[i] = pool[randi(0, pool.length - 1)];
        placed++;
      }
    }
  },

  showMsg(s) { this.msg = s; this.msgT = 2; },

  // 窗口尺寸变化 → 场地重新生成（保留生命/分数/道具进度）
  onResize() {
    if (!this.map) return;
    // 网格尺寸没变（普通切窗口/缩放/跨屏）→ 只重绘画面，游戏进度分毫不动
    if (COLS === this._fieldCols && ROWS === this._fieldRows) return;
    this.hidden = [];
    this.map = genMap(this.mode);
    this.bombs = []; this.flames = []; this.items = []; this.particles = [];
    if (this.mode === 'single' || this.mode === 'item-challenge' || this.mode === 'endless') {
      this.spawnEnemies();
      const p = this.players[0];
      p.x = cx(1); p.y = cy(1); p.tx = 1; p.ty = 1;
      p.alive = true; p.dying = 0; p.invincible = 2;
    } else if (this.mode === 'versus') {
      const spots = [[1, 1], [COLS - 2, ROWS - 2]];
      this.players.forEach((p, i) => {
        p.x = cx(spots[i][0]); p.y = cy(spots[i][1]);
        p.tx = spots[i][0]; p.ty = spots[i][1];
        p.alive = true; p.dying = 0; p.invincible = 2;
      });
      this.spawnItemsForVersus();
    }
    if (this.mode === 'endless') this.level = Math.max(1, this.level);
    this.showMsg('场地已随窗口调整！');
  },

  onKey(k) {
    if (k === 'v' || k === 'V') toggleFullscreen();
    if (k === 'm' || k === 'M') Sfx.muted = !Sfx.muted;
    if (this.state === 'menu') {
      const n = 4;
      if (k === 'ArrowUp' || k === 'ArrowLeft' || k === 'w' || k === 'W' || k === 'a' || k === 'A') { this.menuIndex = (this.menuIndex + n - 1) % n; Sfx.move(); MenuUI.sync(); }
      else if (k === 'ArrowDown' || k === 'ArrowRight' || k === 's' || k === 'S' || k === 'd' || k === 'D') { this.menuIndex = (this.menuIndex + 1) % n; Sfx.move(); MenuUI.sync(); }
      else if ((k === 'Enter' || k === ' ') && this.confirmLockT <= 0) this.confirmMenu();
      else if (k === '1' && this.confirmLockT <= 0) { this.menuIndex = 0; this.confirmMenu(); }
      else if (k === '2' && this.confirmLockT <= 0) { this.menuIndex = 1; this.confirmMenu(); }
      else if (k === '3' && this.confirmLockT <= 0) { this.menuIndex = 2; this.confirmMenu(); }
      else if (k === '4' && this.confirmLockT <= 0) { this.menuIndex = 3; this.confirmMenu(); }
      return;
    }
    if (this.state === 'play' || this.state === 'pause') {
      if (k === 'p' || k === 'P' || k === 'Escape') {
        this.state = this.state === 'play' ? 'pause' : 'play';
      }
    }
    if (this.state === 'over') {
      if ((k !== 'Enter' && k !== ' ') || this.confirmLockT > 0) return;
      if (this.mode === 'versus') this.nextRound();
      else this.gotoMenu();
      return;
    }
    if (this.state === 'win') {
      if ((k !== 'Enter' && k !== ' ') || this.confirmLockT > 0) return;
      if (this.mode === 'single') this.nextLevel();
      else if (this.mode === 'endless') { this.state = 'play'; this.showMsg(`第 ${this.level} 波 · 准备！`); }
      else this.gotoMenu();
      return;
    }
    if (k === 'm' || k === 'M') Sfx.muted = !Sfx.muted;
  },

  confirmMenu() {
    Sfx.confirm();
    MenuUI.hide();
    const modes = ['single', 'versus', 'item-challenge', 'endless'];
    const mode = modes[this.menuIndex];
    this.reset(mode);
  },

  // 回到主菜单（显示 DOM 菜单层）
  gotoMenu() {
    this.hidden = [];
    this.state = 'menu';
    this.confirmLockT = 0.5;
    this.enemies = [];
    MenuUI.show();
  },

  /* ---------- 泡泡 ---------- */
  placeBomb(p) {
    // 遥控引爆：泡泡放满了再按键 → 引爆自己最早的一颗
    const maxBombs = p.double ? Math.min(p.bombMax + 1, 8) : p.bombMax;
    if (p.bombActive >= maxBombs) {
      if (p.remote) {
        const mine = this.bombs.filter(b => b.owner === p && b.timer > 0);
        if (mine.length) mine[0].timer = 0.01;
      }
      return;
    }
    const tx = p.tx, ty = p.ty;
    if (this.bombs.some(b => b.tx === tx && b.ty === ty)) return;
    p.bombActive++;
    const bomb = { tx, ty, timer: 2.4, range: p.fire, owner: p, pass: new Set([p]) };
    this.bombs.push(bomb);
    Sfx.place();
    // 拳风：放置炸弹时向前方发射冲击波
    if (p.punch && p.punchTimer > 0) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let i = 1; i <= 3; i++) {
          const x = tx + dx * i, y = ty + dy * i;
          if (!inMap(x, y)) break;
          if (this.map[idx(x, y)] === STONE) break;
          if (this.map[idx(x, y)] === SOFT) {
            this.breakSoft(x, y);
            break;
          }
          // 伤害敌人
          for (const en of this.enemies) {
            if (en.alive && en.tx === x && en.ty === y) {
              en.dying = 1.5; en.alive = false;
              p.score++;
              this.particles.push({ x: cx(x), y: cy(x), vx: rand(-80, 80), vy: rand(-120, -30), life: 0.5, size: 5, color: '#ffd23d' });
            }
          }
        }
      }
      p.punchTimer = 0;
      this.shakeT = 0.15;
      this.showMsg(p.name + ' · 拳风！');
    }
  },

  // 泡泡能否滑进目标格（冰面也可滑行）
  canSlideTo(b, nx, ny) {
    if (!inMap(nx, ny)) return false;
    const t = this.map[idx(nx, ny)];
    if (t !== EMPTY && t !== ICE && t !== PORTAL) return false;
    if (this.bombs.some(o => o !== b && o.tx === nx && o.ty === ny)) return false;
    if ([...this.players, ...this.enemies].some(e => e.alive && e.tx === nx && e.ty === ny)) return false;
    return true;
  },

  explode(b) {
    b.timer = -1;
    b.owner.bombActive = Math.max(0, b.owner.bombActive - 1);
    Sfx.boom();
    this.shakeT = 0.25;
    const pierce = b.owner.pierce && b.owner.pierce > 0;
    const cells = [[b.tx, b.ty, 'c']];
    for (const [dx, dy, d] of [[1, 0, 'h'], [-1, 0, 'h'], [0, 1, 'v'], [0, -1, 'v']]) {
      for (let i = 1; i <= b.range; i++) {
        const x = b.tx + dx * i, y = b.ty + dy * i;
        if (!inMap(x, y)) break;
        const t = this.map[idx(x, y)];
        if (t === STONE) break;
        cells.push([x, y, d, i]);
        if (t === SOFT) {
          this.breakSoft(x, y);
          if (!pierce) break;
          // 穿透：火焰继续穿透软砖
        }
        const ob = this.bombs.find(o => o !== b && o.tx === x && o.ty === y && o.timer > 0);
        if (ob) { ob.timer = Math.min(ob.timer, 0.06); break; }
      }
    }
    for (const [x, y, d, i] of cells) {
      this.flames.push({ tx: x, ty: y, timer: 0.5, d: d || 'c', i: i || 0 });
      for (let j = 0; j < 4; j++)
        this.particles.push({
          x: cx(x) + rand(-14, 14), y: cy(y) + rand(-14, 14),
          vx: rand(-90, 90), vy: rand(-140, -20),
          life: rand(0.3, 0.6), size: rand(3, 7), color: ['#ffdf6b', '#ff9a3d', '#ff5b3d'][randi(0, 2)],
        });
    }
  },

  breakSoft(x, y) {
    this.map[idx(x, y)] = EMPTY;
    for (let j = 0; j < 6; j++)
      this.particles.push({
        x: cx(x) + rand(-16, 16), y: cy(y) + rand(-16, 16),
        vx: rand(-70, 70), vy: rand(-120, -30),
        life: rand(0.3, 0.55), size: rand(3, 6), color: '#b07b4f',
      });
    // 隐藏道具：对战模式埋在 hidden；闯关模式概率生成；道具挑战全图埋道具
    let type = null;
    if (this.mode === 'versus' && this.hidden && this.hidden[idx(x, y)] != null) {
      type = this.hidden[idx(x, y)]; this.hidden[idx(x, y)] = null;
    } else if (this.mode === 'item-challenge' && this.hidden && this.hidden[idx(x, y)] != null) {
      type = this.hidden[idx(x, y)]; this.hidden[idx(x, y)] = null;
    } else if (this.mode === 'single' && Math.random() < 0.38) {
      type = [ITEM_BOMB, ITEM_FIRE, ITEM_FIRE, ITEM_SPEED, ITEM_SPEED, ITEM_KICK, ITEM_KICK, ITEM_SHIELD, ITEM_REMOTE, ITEM_PUNCH, ITEM_MIRROR, ITEM_BOOST, ITEM_DOUBLE, ITEM_PIERCE, ITEM_STORM][randi(0, 14)];
    }
    if (type !== null) this.items.push({ tx: x, ty: y, type, anim: 0 });
  },

  /* ---------- 碰撞 ---------- */
  solidFor(e, tx, ty) {
    if (!inMap(tx, ty)) return true;
    const t = this.map[idx(tx, ty)];
    if (t === STONE || t === SOFT) return true;
    const b = this.bombs.find(b => b.tx === tx && b.ty === ty);
    if (b && !b.slide && !b.pass.has(e)) return true;   // 滑行中的泡泡不挡路
    return false;
  },

  moveEntity(e, dx, dy, dt) {
    // 分轴移动 + 撞墙时贴角辅助
    if (dx !== 0) {
      const nx = e.x + dx;
      const lead = dx > 0 ? nx + e.half : nx - e.half;
      const tcol = Math.floor(lead / TILE);
      const cellY1 = Math.floor((e.y - e.half + 1 - HUD_H) / TILE);
      const cellY2 = Math.floor((e.y + e.half - 1 - HUD_H) / TILE);
      let blocked = this.solidFor(e, tcol, cellY1) || this.solidFor(e, tcol, cellY2);
      // 踢泡泡：有踢鞋时顶到泡泡就把它踢飞
      if (blocked && e.kick) {
        for (const cyy of (cellY1 !== cellY2 ? [cellY1, cellY2] : [cellY1])) {
          const bomb = this.bombs.find(b => !b.slide && b.tx === tcol && b.ty === cyy);
          if (bomb && this.canSlideTo(bomb, tcol + Math.sign(dx), cyy)) {
            bomb.slide = { dx: Math.sign(dx), dy: 0 };
            bomb.slideTx = tcol + Math.sign(dx);
            bomb.slideTy = cyy;
            bomb.px = cx(bomb.tx); bomb.py = cy(bomb.ty);
            bomb.pass.clear();
            blocked = this.solidFor(e, tcol, cellY1) || this.solidFor(e, tcol, cellY2);
          }
        }
      }
      if (!blocked) {
        e.x = nx;
      } else {
        // 贴角辅助：目标列只挡住一侧时，向另一侧滑动
        const otherCell = cellY1 !== cellY2 ? (this.solidFor(e, tcol, cellY1) ? cellY2 : cellY1) : -1;
        const curCol = Math.floor((e.x - dx * 0.01) / TILE);
        if (otherCell >= 0 && !this.solidFor(e, tcol, otherCell) && !this.solidFor(e, curCol, otherCell)) {
          const targetY = cy(otherCell);
          const step = Math.sign(targetY - e.y) * Math.min(Math.abs(targetY - e.y), Math.abs(dx));
          e.y += step;
        } else {
          e.x = dx > 0 ? tcol * TILE - e.half - 0.01 : (tcol + 1) * TILE + e.half + 0.01;
        }
      }
    }
    if (dy !== 0) {
      const ny = e.y + dy;
      const lead = dy > 0 ? ny + e.half : ny - e.half;
      const trow = Math.floor((lead - HUD_H) / TILE);
      const cellX1 = Math.floor((e.x - e.half + 1) / TILE);
      const cellX2 = Math.floor((e.x + e.half - 1) / TILE);
      let blocked = this.solidFor(e, cellX1, trow) || this.solidFor(e, cellX2, trow);
      // 踢泡泡（垂直方向）
      if (blocked && e.kick) {
        for (const cxx of (cellX1 !== cellX2 ? [cellX1, cellX2] : [cellX1])) {
          const bomb = this.bombs.find(b => !b.slide && b.tx === cxx && b.ty === trow);
          if (bomb && this.canSlideTo(bomb, cxx, trow + Math.sign(dy))) {
            bomb.slide = { dx: 0, dy: Math.sign(dy) };
            bomb.slideTx = cxx;
            bomb.slideTy = trow + Math.sign(dy);
            bomb.px = cx(bomb.tx); bomb.py = cy(bomb.ty);
            bomb.pass.clear();
            blocked = this.solidFor(e, cellX1, trow) || this.solidFor(e, cellX2, trow);
          }
        }
      }
      if (!blocked) {
        e.y = ny;
      } else {
        const otherCell = cellX1 !== cellX2 ? (this.solidFor(e, cellX1, trow) ? cellX2 : cellX1) : -1;
        const curRow = Math.floor((e.y - dy * 0.01 - HUD_H) / TILE);
        if (otherCell >= 0 && !this.solidFor(e, otherCell, trow) && !this.solidFor(e, otherCell, curRow)) {
          const targetX = cx(otherCell);
          const step = Math.sign(targetX - e.x) * Math.min(Math.abs(targetX - e.x), Math.abs(dy));
          e.x += step;
        } else {
          e.y = dy > 0 ? HUD_H + trow * TILE - e.half - 0.01 : HUD_H + (trow + 1) * TILE + e.half + 0.01;
        }
      }
    }
    // 更新所在格
    e.tx = clamp(Math.floor(e.x / TILE), 0, COLS - 1);
    e.ty = clamp(Math.floor((e.y - HUD_H) / TILE), 0, ROWS - 1);
  },

  killEntity(e) {
    if (e.invincible > 0 || (e.shield > 0) || !e.alive || e.dying > 0) return;
    e.alive = false; e.dying = 0.8;
    if (e.kind === 'enemy') {
      this.players[0].score++;
      Sfx.kill();
    } else {
      Sfx.die();
    }
    for (let j = 0; j < 14; j++)
      this.particles.push({
        x: e.x, y: e.y - 10, vx: rand(-120, 120), vy: rand(-180, -40),
        life: rand(0.4, 0.8), size: rand(3, 8), color: e.color,
      });
  },

  /* ---------- AI ---------- */
  updateEnemy(en, dt) {
    en.anim += dt;
    if (!en.target) { this.enemyDecide(en); }
    if (en.target) {
      const gx = cx(en.target[0]), gy = cy(en.target[1]);
      const ddx = gx - en.x, ddy = gy - en.y;
      const dist = Math.hypot(ddx, ddy);
      if (dist < 2) {
        en.x = gx; en.y = gy;
        en.tx = en.target[0]; en.ty = en.target[1];
        en.target = null;
        this.enemyDecide(en);
      } else {
        const step = en.speed * dt * (this.map[idx(en.tx, en.ty)] === SAND ? 0.55 : 1);
        en.x += ddx / dist * step;
        en.y += ddy / dist * step;
        en.face.x = Math.sign(ddx); en.face.y = Math.sign(ddy);
        en.moving = true;
      }
    } else { en.moving = false; }

    // 主动进攻：贴着玩家或砖块就放泡泡
    en.decideT -= dt;
    if (en.decideT <= 0) {
      en.decideT = rand(0.2, 0.4);
      const danger = buildDanger();
      const nearPlayer = this.players.some(p => p.alive && !p.hidden && Math.abs(p.tx - en.tx) + Math.abs(p.ty - en.ty) <= 2);
      const nearSoft = [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => inMap(en.tx+dx,en.ty+dy) && this.map[idx(en.tx+dx,en.ty+dy)] === SOFT);
      if ((nearPlayer || nearSoft) && en.bombActive < en.bombMax && !danger[idx(en.tx, en.ty)]) {
        // 先模拟：放下泡泡后自己是否有逃生路线，没有就不放
        const sim = danger.slice();
        sim[idx(en.tx, en.ty)] = 1;
        for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          for (let i = 1; i <= en.fire; i++) {
            const x = en.tx + dx * i, y = en.ty + dy * i;
            if (!inMap(x, y)) break;
            const t = Game.map[idx(x, y)];
            if (t === STONE) break;
            sim[idx(x, y)] = 1;
            if (t === SOFT) break;
          }
        }
        if (bfsPath(en.tx, en.ty, sim, (x, y) => !sim[idx(x, y)])) {
          en.bombActive++;
          this.bombs.push({ tx: en.tx, ty: en.ty, timer: 2.0, range: en.fire, owner: en, pass: new Set([en]) });
          Sfx.place();
          en.target = null;
        }
      }
    }
  },

  enemyDecide(en) {
    const danger = buildDanger();
    const here = idx(en.tx, en.ty);
    if (danger[here]) {
      // 危险！BFS 找最近安全格
      const path = bfsPath(en.tx, en.ty, danger, (x, y) => !danger[idx(x, y)]);
      if (path && path.length) { en.target = path[0]; return; }
    }
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy]) => {
      if (!inMap(en.tx+dx, en.ty+dy)) return false;
      const t = this.map[idx(en.tx+dx, en.ty+dy)];
      if (t === STONE || t === SOFT) return false;
      if (this.bombs.some(b => b.tx === en.tx+dx && b.ty === en.ty+dy)) return false;
      if (danger[idx(en.tx+dx, en.ty+dy)]) return false;
      return true;
    });
    if (!dirs.length) { en.target = null; return; }
    // 追踪玩家：优先朝玩家方向（藏进草丛的玩家不可见）
    const p = this.players.find(q => q.alive && !q.hidden);
    if (p && Math.random() < 0.7) {
      dirs.sort((a, b) => {
        const da = Math.abs(en.tx + a[0] - p.tx) + Math.abs(en.ty + a[1] - p.ty);
        const db = Math.abs(en.tx + b[0] - p.tx) + Math.abs(en.ty + b[1] - p.ty);
        return da - db;
      });
    }
    en.target = [en.tx + dirs[0][0], en.ty + dirs[0][1]];
  },

  /* ---------- 更新 ---------- */
  update(dt) {
    this.time += dt;
    if (this.confirmLockT > 0) this.confirmLockT -= dt;
    if (this.msgT > 0) this.msgT -= dt;
    if (this.shakeT > 0) this.shakeT -= dt;

    // 香蕉皮寿命
    if (this.peels) {
      for (const q of this.peels) { q.life -= dt; if (q.arm > 0) q.arm -= dt; }
      this.peels = this.peels.filter(q => q.life > 0);
    }

    // 粒子
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 380 * dt; p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);

    if (this.state !== 'play') return;

    // 玩家输入 / AI
    for (const p of this.players) {
      if (p.invincible > 0) p.invincible -= dt;
      if (p.portalCD > 0) p.portalCD -= dt;
      if (p.slipCD > 0) p.slipCD -= dt;
      if (p.shield > 0) p.shield -= dt;
      if (p.punchTimer > 0) p.punchTimer -= dt;
      if (p.mirrorTimer > 0) p.mirrorTimer -= dt;
      if (p.boostTimer > 0) { p.boostTimer -= dt; if (p.boostTimer <= 0) { p.boost = false; p.speed = Math.min(p.speed - 60, 280); } }
      if (p.stormTimer > 0) p.stormTimer -= dt;
      if (!p.alive) continue;
      p.anim += dt;
      if (this.mode === 'versus' && p === this.players[1]) {
        const throwKey = keys[' '] || keys['f'];
        if (p.slide) {
          this.slideMove(p, dt);
          if (throwKey) this.placeBomb(p);
        } else {
          let dx = (keys['a'] ? -1 : 0) + (keys['d'] ? 1 : 0);
          let dy = (keys['w'] ? -1 : 0) + (keys['s'] ? 1 : 0);
          this.applyMove(p, dx, dy, dt);
          this.tryStartSlide(p);
          if (throwKey) this.placeBomb(p);
        }
      } else {
        const throwKey = this.mode === 'versus' ? keys['Enter'] : (keys['Enter'] || keys[' ']);
        if (p.slide) {
          this.slideMove(p, dt);
          if (throwKey) this.placeBomb(p);
        } else {
          let dx = (keys['ArrowLeft'] ? -1 : 0) + (keys['ArrowRight'] ? 1 : 0);
          let dy = (keys['ArrowUp'] ? -1 : 0) + (keys['ArrowDown'] ? 1 : 0);
          this.applyMove(p, dx, dy, dt);
          this.tryStartSlide(p);
          // 对战中 P1 只用 Enter（空格让给 P2），单人模式空格/Enter 皆可
          if (throwKey) this.placeBomb(p);
        }
      }
      this.handlePortals(p);
      // 香蕉皮：踩到 → 顺势滑倒（随机方向）
      if (!p.slide && p.slipCD <= 0) {
        const peel = (this.peels || []).find(q => q.tx === p.tx && q.ty === p.ty && q.arm <= 0);
        if (peel) {
          this.peels.splice(this.peels.indexOf(peel), 1);
          const dirs = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy]) => !this.solidFor(p, p.tx+dx, p.ty+dy));
          if (dirs.length) {
            const [dx, dy] = dirs[randi(0, dirs.length - 1)];
            p.slide = { x: dx, y: dy };
            p.slideTarget = { tx: p.tx + dx, ty: p.ty + dy };
            p.slipCD = 0.5;
            Sfx.slip();
          }
        }
      }
      p.hidden = this.map[idx(p.tx, p.ty)] === BUSH;
    }

    // 敌人
    if (this.mode === 'single') {
      for (const en of this.enemies) {
        if (en.dying > 0) { en.dying -= dt; continue; }
        if (!en.alive) continue;
        this.updateEnemy(en, dt);
      }
    }

    // 泡泡计时 / 滑行 & 玩家离开后泡泡变实心
    for (const b of this.bombs) {
      b.timer -= dt;
      if (b.slide) {
        const sp = 330 * dt;
        const gx = cx(b.slideTx), gy = cy(b.slideTy);
        const ddx = gx - b.px, ddy = gy - b.py;
        const dist = Math.hypot(ddx, ddy);
        if (dist <= sp) {
          b.px = gx; b.py = gy;
          b.tx = b.slideTx; b.ty = b.slideTy;
          // 传送门：滑入的泡泡被传送过去接着滑
          if (this.map[idx(b.tx, b.ty)] === PORTAL && this.portals) {
            const pr = this.portals.find(q => (q[0] === b.tx && q[1] === b.ty) || (q[2] === b.tx && q[3] === b.ty));
            if (pr) {
              const [nxp, nyp] = (pr[0] === b.tx && pr[1] === b.ty) ? [pr[2], pr[3]] : [pr[0], pr[1]];
              b.px = cx(nxp); b.py = cy(nyp);
              b.tx = nxp; b.ty = nyp;
              Sfx.warp();
            }
          }
          // 到达一格后判断能否继续滑
          const nx2 = b.tx + b.slide.dx, ny2 = b.ty + b.slide.dy;
          if (this.canSlideTo(b, nx2, ny2)) {
            b.slideTx = nx2; b.slideTy = ny2;
          } else {
            b.slide = null; b.px = undefined; b.py = undefined;
          }
        } else {
          b.px += ddx / dist * sp;
          b.py += ddy / dist * sp;
          b.tx = clamp(Math.floor(b.px / TILE), 0, COLS - 1);
          b.ty = clamp(Math.floor((b.py - HUD_H) / TILE), 0, ROWS - 1);
        }
      }
      for (const e of [...b.pass]) {
        const etx = Math.floor(e.x / TILE), ety = Math.floor((e.y - HUD_H) / TILE);
        if (etx !== b.tx || ety !== b.ty) b.pass.delete(e);
      }
    }
    for (const b of [...this.bombs]) {
      if (b.timer <= 0 && b.timer > -1) this.explode(b);
    }
    this.bombs = this.bombs.filter(b => b.timer > -1);

    // 火焰：点燃连锁 & 伤害
    for (const f of this.flames) {
      f.timer -= dt;
      const fi = idx(f.tx, f.ty);
      for (const b of this.bombs) {
        if (b.tx === f.tx && b.ty === f.ty && b.timer > 0.06) b.timer = 0.06;
      }
      for (const e of [...this.players, ...this.enemies]) {
        if (!e.alive || e.dying > 0) continue;
        const etx = Math.floor(e.x / TILE), ety = Math.floor((e.y - HUD_H) / TILE);
        if (etx === f.tx && ety === f.ty) this.killEntity(e);
      }
      // 烧掉新炸出的砖下面正在的道具? 道具被烧毁（经典设定：火焰会烧掉道具）
      for (const it of [...this.items]) {
        if (it.tx === f.tx && it.ty === f.ty) {
          this.items.splice(this.items.indexOf(it), 1);
          for (let j = 0; j < 4; j++)
            this.particles.push({ x: cx(it.tx), y: cy(it.ty), vx: rand(-60,60), vy: rand(-100,-30), life: 0.4, size: 4, color: '#fff' });
        }
      }
    }
    this.flames = this.flames.filter(f => f.timer > 0);

    // 道具拾取
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const it of [...this.items]) {
        if (it.tx === p.tx && it.ty === p.ty) {
          it.anim += dt;
          this.items.splice(this.items.indexOf(it), 1);
          Sfx.pickup();
          if (it.type === ITEM_BOMB) p.bombMax = Math.min(p.bombMax + 1, 8);
          if (it.type === ITEM_FIRE) p.fire = Math.min(p.fire + 1, 8);
          if (it.type === ITEM_SPEED) p.speed = Math.min(p.speed + 22, 280);
          if (it.type === ITEM_KICK) p.kick = true;
          if (it.type === ITEM_SHIELD) p.shield = 6;
          if (it.type === ITEM_REMOTE) p.remote = true;
          if (it.type === ITEM_PUNCH) { p.punch = true; p.punchTimer = 5; }
          if (it.type === ITEM_MIRROR) { p.mirror = true; p.mirrorTimer = 5; }
          if (it.type === ITEM_BOOST) { p.boost = true; p.boostTimer = 4; p.speed = Math.min(p.speed + 60, 280); }
          if (it.type === ITEM_DOUBLE) p.double = true;
          if (it.type === ITEM_PIERCE) p.pierce = true;
          if (it.type === ITEM_STORM) { p.storm = true; p.stormTimer = 3; }
          if (it.type === ITEM_BANANA) {
            this.peels.push({ tx: p.tx, ty: p.ty, life: 22, arm: 0.8 });
          }
          this.showMsg(p.name + [
            ' 泡泡+1!', ' 火力+1!', ' 速度+1!',
            ' 获得踢鞋！顶着泡泡把它踢飞！', ' 护盾！6 秒无敌！', ' 遥控器！泡泡满时按键引爆！',
            ' 拳风！冲击波清敌！', ' 镜子！反弹炸弹！', ' 加速！冲刺！',
            ' 双倍！一次两颗泡泡！', ' 穿透！火焰贯穿软砖！', ' 风暴！全屏清敌！',
            ' 香蕉皮陷阱已布置！',
          ][it.type]);
        }
      }
    }

    // 风暴·周期性清敌
    for (const p of this.players) {
      if (p.storm && p.stormTimer > 0 && !p.alive) continue;
      if (p.storm && p.stormTimer > 0 && this.time % 1.5 < dt) {
        for (const en of this.enemies) {
          if (en.alive && Math.abs(en.tx - p.tx) <= 3 && Math.abs(en.ty - p.ty) <= 3) {
            en.dying = 1.5; en.alive = false;
            p.score++;
          }
        }
        for (const pf of this.particles) { /* 风暴视觉粒子 */ }
        this.shakeT = 0.2;
        for (let j = 0; j < 20; j++)
          this.particles.push({
            x: cx(p.tx) + rand(-60, 60), y: cy(p.ty) + rand(-60, 60),
            vx: rand(-100, 100), vy: rand(-100, 100),
            life: 0.6, size: rand(3, 8), color: ['#4dd0e1', '#fff', '#a0f0d0'][randi(0, 2)],
          });
      }
    }

    // 镜子：炸弹爆炸时若在范围内，可能反弹
    // (简单实现：镜子的玩家在爆炸相邻格获得无敌帧)
    for (const p of this.players) {
      if (p.mirror && p.mirrorTimer > 0) {
        for (const f of this.flames) {
          if (Math.abs(f.tx - p.tx) <= 1 && Math.abs(f.ty - p.ty) <= 1) {
            p.invincible = Math.max(p.invincible, 0.5);
          }
        }
      }
    }

    // 玩家死亡结算
    for (const p of this.players) {
      if (p.dying > 0 && !p.alive) {
        p.dying -= dt;
        if (p.dying <= 0) {
          if (this.mode !== 'versus') {
            // 单人/道具挑战/无尽：扣命重生
            p.lives--;
            if (p.lives > 0) {
              p.alive = true; p.dead = false;
              p.x = cx(1); p.y = cy(1); p.tx = 1; p.ty = 1;
              p.invincible = 2.5;
              if (this.mode === 'endless') this.spawnEnemies();
            } else {
              p.dead = true;
              this.state = 'over';
              this.confirmLockT = 0.6;
              Sfx.lose();
            }
          } else {
            p.dead = true;
            const winner = this.players.find(q => q !== p);
            if (winner) winner.score++;
            this.state = 'over';
            this.confirmLockT = 0.6;
            this.roundEndT = 0;
            if (winner && winner.score >= 3) { this.state = 'win'; Sfx.win(); }
            else Sfx.lose();
          }
        }
      }
    }

    // 单人模式：敌人清空（含死亡动画播完）→ 过关
    if (this.mode === 'single' && this.enemies.every(e => !e.alive && e.dying <= 0) && this.state === 'play') {
      if (this.players[0].alive) {
        this.state = 'win';
        this.confirmLockT = 0.6;
        Sfx.win();
      }
    }
    // 无尽模式：敌人清空 → 下一波
    if (this.mode === 'endless' && this.enemies.every(e => !e.alive && e.dying <= 0) && this.state === 'play') {
      if (this.players[0].alive) {
        this.level++;
        this.spawnEnemies();
        this.showMsg(`第 ${this.level} 波 · 准备！`);
      }
    }
  },

  applyMove(p, dx, dy, dt) {
    if (dx === 0 && dy === 0) { p.moving = false; return; }
    if (dx !== 0 && dy !== 0) { // 斜向时只保留水平（泡泡堂是四方向）
      dy = 0;
    }
    // 流沙减速
    const spd = p.speed * (this.map[idx(p.tx, p.ty)] === SAND ? 0.55 : 1);
    p.lastDir = { x: dx, y: dy };
    if (dx !== 0) {
      p.face.x = dx; p.face.y = 0;
      // 垂直方向自动对齐格子中线（走位手感）
      const rowC = cy(p.ty);
      const off = rowC - p.y;
      p.y += clamp(off, -spd * dt * 0.8, spd * dt * 0.8) * (Math.abs(off) > 1 ? 1 : 0);
      this.moveEntity(p, dx * spd * dt, 0, dt);
    } else {
      p.face.y = dy; p.face.x = 0;
      const colC = cx(p.tx);
      const off = colC - p.x;
      p.x += clamp(off, -spd * dt * 0.8, spd * dt * 0.8) * (Math.abs(off) > 1 ? 1 : 0);
      this.moveEntity(p, 0, dy * spd * dt, dt);
    }
    p.moving = true;
  },

  // 传送门：玩家踩上 portal 格 → 传到孪生格（0.6s 冷却防来回弹）
  handlePortals(p) {
    if (p.portalCD > 0 || !this.portals) return;
    if (this.map[idx(p.tx, p.ty)] !== PORTAL) return;
    const pr = this.portals.find(q => (q[0] === p.tx && q[1] === p.ty) || (q[2] === p.tx && q[3] === p.ty));
    if (!pr) return;
    const [nx, ny] = (pr[0] === p.tx && pr[1] === p.ty) ? [pr[2], pr[3]] : [pr[0], pr[1]];
    for (let j = 0; j < 10; j++) {
      this.particles.push({
        x: cx(p.tx), y: cy(p.ty),
        vx: rand(-70, 70), vy: rand(-90, -10),
        life: 0.4, size: rand(2, 4), color: '#9b6bff',
      });
    }
    p.x = cx(nx); p.y = cy(ny); p.tx = nx; p.ty = ny;
    p.slide = null; p.slideTarget = null;
    p.portalCD = 0.6;
    Sfx.warp();
  },

  /* ---- 冰面滑行（雪原关卡）----
   * 踩上冰面会沿当前方向滑行，直到滑出冰面或被障碍挡住；
   * 滑行中无法转向，但可以放泡泡（滑狙战术） */
  tryStartSlide(p) {
    if (!p.moving || !p.lastDir) return;
    if (this.map[idx(p.tx, p.ty)] !== ICE) return;
    const nx = p.tx + p.lastDir.x, ny = p.ty + p.lastDir.y;
    if (this.solidFor(p, nx, ny)) return;
    p.slide = { x: p.lastDir.x, y: p.lastDir.y };
    p.slideTarget = { tx: nx, ty: ny };
    Sfx.ice();
  },

  slideMove(p, dt) {
    const t = p.slideTarget;
    if (!t) { p.slide = null; return; }
    const sp = p.speed * 1.15;
    const gx = cx(t.tx), gy = cy(t.ty);
    const ddx = gx - p.x, ddy = gy - p.y;
    const dist = Math.hypot(ddx, ddy);
    const step = sp * dt;
    p.face.x = p.slide.x; p.face.y = p.slide.y;
    p.moving = true;
    // 冰屑粒子
    if (Math.random() < 0.6) {
      this.particles.push({
        x: p.x + rand(-9, 9), y: p.y + 15,
        vx: rand(-24, 24), vy: rand(-36, -8),
        life: 0.35, size: rand(1.5, 3), color: 'rgba(225,246,255,.9)',
      });
    }
    if (dist <= step) {
      p.x = gx; p.y = gy;
      p.tx = t.tx; p.ty = t.ty;
      // 判定：还在冰上且前方可走 → 继续滑；否则停
      const curIce = this.map[idx(p.tx, p.ty)] === ICE;
      const nx = p.tx + p.slide.x, ny = p.ty + p.slide.y;
      if (curIce && !this.solidFor(p, nx, ny)) {
        p.slideTarget = { tx: nx, ty: ny };
      } else {
        p.slide = null; p.slideTarget = null;
      }
    } else {
      p.x += ddx / dist * step;
      p.y += ddy / dist * step;
      p.tx = clamp(Math.floor(p.x / TILE), 0, COLS - 1);
      p.ty = clamp(Math.floor((p.y - HUD_H) / TILE), 0, ROWS - 1);
    }
  },

  /* ---------- 渲染 ---------- */
  draw() {
    ctx.save();
    if (this.state !== 'menu') {
      // 背景延伸：装饰地砖 + HUD 深色条一直画到窗口边缘
      const vr = viewRect;
      const c0 = Math.floor(vr.x0 / TILE), c1 = Math.ceil(vr.x1 / TILE);
      const r0 = Math.floor((vr.y0 - HUD_H) / TILE), r1 = Math.ceil((vr.y1 - HUD_H) / TILE);
      for (let ry = r0; ry < r1; ry++)
        for (let rx = c0; rx < c1; rx++) this.drawGroundCell(rx, ry);
      if (vr.y0 < HUD_H) {
        ctx.fillStyle = '#20233a';
        ctx.fillRect(vr.x0, vr.y0, vr.x1 - vr.x0, HUD_H - vr.y0);
      }
    }
    if (this.shakeT > 0) {
      ctx.translate(rand(-1, 1) * this.shakeT * 14, rand(-1, 1) * this.shakeT * 14);
    }

    if (this.state === 'menu') { this.drawMenuBg(); ctx.restore(); return; }

    // 地块
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const t = this.map[idx(x, y)];
        if (t === STONE) this.drawStone(x, y);
        else if (t === SOFT) this.drawSoft(x, y);
        else if (t === ICE) this.drawIce(x, y);
        else if (t === SAND) this.drawSand(x, y);
        else if (t === BUSH) this.drawBushBase(x, y);
        else if (t === PORTAL) this.drawPortal(x, y);
      }

    // 道具
    for (const it of this.items) this.drawItem(it);

    // 香蕉皮陷阱
    for (const q of (this.peels || [])) this.drawPeel(q);

    // 泡泡
    for (const b of this.bombs) this.drawBomb(b);

    // 火焰
    for (const f of this.flames) this.drawFlame(f);

    // 实体
    const ents = [...this.enemies.filter(e => e.alive || e.dying > 0), ...this.players.filter(p => p.alive || p.dying > 0)];
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) this.drawChar(e);

    // 草丛顶视图：盖在角色身上 → 站进草丛=藏身
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (this.map[idx(x, y)] === BUSH) this.drawBushTop(x, y);

    // 香蕉皮寿命
    if (this.peels) {
      for (const q of this.peels) { q.life -= dt; if (q.arm > 0) q.arm -= dt; }
      this.peels = this.peels.filter(q => q.life > 0);
    }

    // 粒子
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    this.drawHUD();

    // 消息（横幅样式）
    if (this.msgT > 0) {
      const a = clamp(this.msgT, 0, 1);
      ctx.globalAlpha = a;
      const bw = Math.min(W * 0.62, 460), bh = 64;
      const bx = W / 2 - bw / 2, byy = HUD_H + ROWS * TILE / 2 - 170;
      ctx.fillStyle = 'rgba(12,16,36,0.78)';
      this.roundRect(bx, byy - bh / 2, bw, bh, 16); ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,90,0.55)'; ctx.lineWidth = 1.5;
      this.roundRect(bx, byy - bh / 2, bw, bh, 16); ctx.stroke();
      this.drawOutlinedText(this.msg, W / 2, byy, 24, '#ffe066');
      ctx.globalAlpha = 1;
    }

    // 遮罩状态
    if (this.state === 'pause') this.drawOverlay('暂停', '按 P 继续');
    if (this.state === 'over') {
      if (this.mode === 'versus') {
        const winner = this.players.find(p => !p.dead);
        const loser = this.players.find(p => p.dead);
        this.drawOverlay(`${winner.name} 得分！`, `比分 ${this.players[0].score} : ${this.players[1].score}\n按 Enter / 空格 继续`);
      } else {
        const modeName = this.mode === 'endless' ? '无尽模式' : this.mode === 'item-challenge' ? '道具挑战' : '游戏';
        this.drawOverlay(`${modeName}结束`, `消灭敌人 ${this.players[0].score} 个 · 按 Enter / 空格 返回菜单`);
      }
    }
    if (this.state === 'win') {
      if (this.mode === 'versus') {
        const w = this.players[0].score >= 3 ? this.players[0] : this.players[1];
        this.drawOverlay(`${w.name} 获得胜利！🎉`, `比分 ${this.players[0].score} : ${this.players[1].score} · 按 Enter / 空格 返回菜单`);
      } else if (this.mode === 'endless') {
        this.drawOverlay(`第 ${this.level} 波 通过！`, '按 Enter / 空格 进入下一波 · 越来越难！');
      } else {
        this.drawOverlay(`第 ${this.level} 关 通过！`, '按 Enter / 空格 进入下一关');
      }
    }
    ctx.restore();
  },

  drawOutlinedText(s, x, y, size, color, align = 'center') {
    ctx.font = `bold ${size}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeText(s, x, y);
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  },

  drawOverlay(title, sub) {
    const vr = viewRect;
    ctx.fillStyle = 'rgba(10,12,30,.55)';
    ctx.fillRect(vr.x0, vr.y0, vr.x1 - vr.x0, vr.y1 - vr.y0);
    this.drawOutlinedText(title, W / 2, H / 2 - 30, 42, '#ffe066');
    sub.split('\n').forEach((s, i) =>
      this.drawOutlinedText(s, W / 2, H / 2 + 24 + i * 34, 20, '#fff'));
  },

  // 确定性伪随机（装饰用，避免逐帧闪烁）
  cellHash(x, y) {
    let h = (x * 73856093) ^ (y * 19349663);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },

  // 单格地面：棋盘底色 + 主题装饰（草丛/小花/雪晶/石子/星尘）
  drawGroundCell(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    const th = this.theme;
    ctx.fillStyle = (x + y) % 2 ? th.g1 : th.g2;
    ctx.fillRect(px, py, TILE, TILE);
    const h = this.cellHash(x, y);
    if (th.deco === 'flower') {
      if (h < 0.10) {
        ctx.strokeStyle = 'rgba(30,90,20,0.35)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const gx = px + TILE * (0.28 + (h * 40) % 0.44), gy = py + TILE * 0.74;
        ctx.beginPath();
        ctx.moveTo(gx - 4, gy); ctx.lineTo(gx - 5, gy - 7);
        ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 9);
        ctx.moveTo(gx + 4, gy); ctx.lineTo(gx + 5, gy - 7);
        ctx.stroke();
      } else if (h > 0.93) {
        const fx2 = px + TILE * 0.68, fy2 = py + TILE * 0.32;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        for (let a = 0; a < 5; a++) {
          const ang = a * Math.PI * 2 / 5 - Math.PI / 2;
          ctx.beginPath(); ctx.arc(fx2 + Math.cos(ang) * 3.4, fy2 + Math.sin(ang) * 3.4, 2.1, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = '#ffb400';
        ctx.beginPath(); ctx.arc(fx2, fy2, 1.9, 0, Math.PI * 2); ctx.fill();
      }
    } else if (th.deco === 'snow') {
      if (h > 0.80) {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const sx2 = px + TILE * (0.22 + (h * 10) % 0.56), sy2 = py + TILE * (0.26 + (h * 7) % 0.48);
        ctx.beginPath(); ctx.arc(sx2, sy2, 1.9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(sx2 + 7, sy2 + 6, 1.2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (th.deco === 'desert') {
      if (h < 0.13) {
        ctx.fillStyle = 'rgba(140,108,64,0.5)';
        const dx2 = px + TILE * 0.66, dy2 = py + TILE * 0.68;
        ctx.beginPath(); ctx.ellipse(dx2, dy2, 4.2, 2.6, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(dx2 + 9, dy2 - 5, 3, 1.9, -0.2, 0, Math.PI * 2); ctx.fill();
      }
    } else if (th.deco === 'night') {
      if (h > 0.86) {
        ctx.fillStyle = 'rgba(190,208,255,0.4)';
        const nx2 = px + TILE * (0.22 + (h * 10) % 0.56), ny2 = py + TILE * (0.3 + (h * 5) % 0.4);
        ctx.beginPath(); ctx.arc(nx2, ny2, 1.7, 0, Math.PI * 2); ctx.fill();
      }
    }
  },

  // 冰面：玻璃质感 + 斜向光泽 + 裂纹 + 闪星（踩上会滑）
  drawIce(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    const h = this.cellHash(x, y);
    ctx.fillStyle = (x + y) % 2 ? '#cdeaf9' : '#c0e2f6';
    ctx.fillRect(px, py, TILE, TILE);
    // 斜向光泽带
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.beginPath();
    ctx.moveTo(px + 5, py + TILE - 8);
    ctx.lineTo(px + TILE - 15, py + 5);
    ctx.lineTo(px + TILE - 4, py + 5);
    ctx.lineTo(px + 17, py + TILE - 8);
    ctx.closePath(); ctx.fill();
    // 裂纹
    ctx.strokeStyle = 'rgba(110,175,215,.55)';
    ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px + 9 + h * 10, py + TILE - 11);
    ctx.lineTo(px + 20 + h * 8, py + TILE / 2);
    ctx.lineTo(px + 15 + h * 10, py + 11);
    ctx.stroke();
    // 闪星
    if (h > 0.55) {
      const sx2 = px + TILE * (0.28 + (h - 0.55) * 0.9), sy2 = py + TILE * 0.3;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx2 - 4.5, sy2); ctx.lineTo(sx2 + 4.5, sy2);
      ctx.moveTo(sx2, sy2 - 4.5); ctx.lineTo(sx2, sy2 + 4.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(96,160,205,.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
  },

  // 流沙：波纹 + 沙粒（踩上减速）
  drawSand(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    ctx.fillStyle = (x + y) % 2 ? '#dcc58f' : '#d3ba80';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = 'rgba(155,125,72,.5)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.arc(px + TILE * (0.32 + i * 0.36), py + TILE * (0.34 + i * 0.32), 7 + i * 3.5, Math.PI * 0.15, Math.PI * 1.05);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(120,95,55,.5)';
    ctx.beginPath(); ctx.arc(px + TILE * 0.72, py + TILE * 0.28, 2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + TILE * 0.28, py + TILE * 0.72, 1.7, 0, Math.PI * 2); ctx.fill();
  },

  drawBushBase(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    ctx.fillStyle = (x + y) % 2 ? '#6db644' : '#64ab3e';
    ctx.fillRect(px, py, TILE, TILE);
    ctx.fillStyle = 'rgba(28,78,18,.3)';
    ctx.beginPath(); ctx.ellipse(px + TILE / 2, py + TILE / 2, TILE * 0.42, TILE * 0.36, 0, 0, Math.PI * 2); ctx.fill();
  },

  // 草丛顶视图：盖在角色之上
  drawBushTop(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    const h = this.cellHash(x, y);
    ctx.save();
    ctx.globalAlpha = 0.95;
    for (let i = 0; i < 7; i++) {
      const bx2 = px + 5 + i * 6 + (h * 5) % 3;
      const bh2 = 17 + ((h * 97 + i * 31) % 15);
      ctx.strokeStyle = i % 2 ? '#3e8f2e' : '#52a83a';
      ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx2, py + TILE - 4);
      ctx.quadraticCurveTo(bx2 - 3, py + TILE - 4 - bh2 * 0.6, bx2 + (i % 2 ? 4 : -4), py + TILE - 4 - bh2);
      ctx.stroke();
    }
    if (h > 0.72) {
      ctx.fillStyle = '#ff8fb0';
      ctx.beginPath(); ctx.arc(px + TILE * 0.66, py + TILE * 0.34, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px + TILE * 0.66, py + TILE * 0.34, 1.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  },

  // 传送门：双色旋涡（成对，踩上传送）
  drawPortal(x, y) {
    const px = cx(x), py = cy(y);
    const isA = this.portals && this.portals.some(q => q[0] === x && q[1] === y);
    const col = isA ? '#5ad0ff' : '#ff7ad0';
    const t = this.time * 2.4;
    const g = ctx.createRadialGradient(px, py, 3, px, py, TILE * 0.62);
    g.addColorStop(0, col + '55'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(px - TILE * 0.62, py - TILE * 0.62, TILE * 1.24, TILE * 1.24);
    ctx.strokeStyle = col; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    for (const o of [0, Math.PI]) {
      ctx.beginPath();
      ctx.arc(px, py, 13, t + o, t + o + Math.PI * 1.15);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
    for (const o of [Math.PI / 2, Math.PI * 1.5]) {
      ctx.beginPath();
      ctx.arc(px, py, 8, -t + o, -t + o + Math.PI * 0.9);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, 2.6 + Math.sin(this.time * 6) * 0.8, 0, Math.PI * 2); ctx.fill();
  },

  drawStone(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    const th = this.theme;
    const h = this.cellHash(x, y);
    // 投影
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    this.roundRect(px + 2, py + 4, TILE - 4, TILE - 3, 9); ctx.fill();
    // 主体 + 顶面 + 高光
    ctx.fillStyle = th.stone;
    this.roundRect(px + 1.5, py + 1.5, TILE - 3, TILE - 5, 9); ctx.fill();
    ctx.fillStyle = th.stoneTop;
    this.roundRect(px + 3.5, py + 3.5, TILE - 7, TILE - 13, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    this.roundRect(px + 7, py + 6, TILE - 24, 6, 3); ctx.fill();
    // 裂纹（约1/4的石砖有）
    if (h > 0.74) {
      ctx.strokeStyle = 'rgba(0,0,0,0.24)';
      ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      const kx = px + TILE * (0.32 + (h * 10) % 0.36), ky = py + TILE * 0.56;
      ctx.beginPath();
      ctx.moveTo(kx - 6, ky - 4); ctx.lineTo(kx, ky); ctx.lineTo(kx - 3, ky + 6);
      ctx.moveTo(kx, ky); ctx.lineTo(kx + 7, ky + 2);
      ctx.stroke();
    }
  },

  drawSoft(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    // 投影
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    this.roundRect(px + 2, py + 4, TILE - 4, TILE - 3, 8); ctx.fill();
    // 木箱式软砖：深框 + 面板 + 木纹 + 板钉 + 高光
    ctx.fillStyle = '#8f5a2e';
    this.roundRect(px + 1.5, py + 1.5, TILE - 3, TILE - 5, 8); ctx.fill();
    ctx.fillStyle = '#b07a44';
    this.roundRect(px + 3.5, py + 3.5, TILE - 7, TILE - 11, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(90,50,20,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 6, py + TILE * 0.38); ctx.lineTo(px + TILE - 6, py + TILE * 0.38);
    ctx.moveTo(px + 6, py + TILE * 0.66); ctx.lineTo(px + TILE - 6, py + TILE * 0.66);
    ctx.stroke();
    ctx.fillStyle = 'rgba(70,40,15,0.55)';
    ctx.beginPath(); ctx.arc(px + 9, py + 9.5, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(px + TILE - 9, py + TILE - 14, 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,235,200,0.22)';
    this.roundRect(px + 6, py + 5.5, TILE - 22, 5, 2.5); ctx.fill();
  },

  drawBomb(b) {
    const t = this.time * 6;
    const pulse = 1 + Math.sin(t) * 0.06 * (1 + (2.4 - Math.max(b.timer, 0)) / 2);
    const px = b.px != null ? b.px : cx(b.tx);
    const py = b.py != null ? b.py : cy(b.ty);
    const r = 16 * pulse;
    // 滑行速度线
    if (b.slide) {
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      const bx = -b.slide.dx * 22, by = -b.slide.dy * 22;
      for (const o of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.moveTo(px + bx + (b.slide.dy ? o : 0), py + by + (b.slide.dx ? o : 0));
        ctx.lineTo(px + bx * 1.6 + (b.slide.dy ? o : 0), py + by * 1.6 + (b.slide.dx ? o : 0));
        ctx.stroke();
      }
    }
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(px, py + 15, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    // 本体
    const g = ctx.createRadialGradient(px - 5, py - 7, 3, px, py, r + 3);
    g.addColorStop(0, '#5a6b8c'); g.addColorStop(1, '#1c2333');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(px - r * 0.35, py - r * 0.4, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2); ctx.fill();
    // 引线
    ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px, py - r);
    ctx.quadraticCurveTo(px + 6, py - r - 8, px + 10, py - r - 6);
    ctx.stroke();
    // 火花
    const sp = 1 + Math.sin(this.time * 20) * 0.5;
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath(); ctx.arc(px + 10, py - r - 6, 3.5 * sp, 0, Math.PI * 2); ctx.fill();
  },

  drawFlame(f) {
    const k = f.timer / 0.5;               // 1→0
    const s = k > 0.75 ? (1 - k) / 0.25 : Math.min(1, k / 0.35);  // 出现扩张→收缩
    const px = cx(f.tx), py = cy(f.ty);
    ctx.save();
    ctx.translate(px, py);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, TILE * 0.55);
    grad.addColorStop(0, '#fff8d0');
    grad.addColorStop(0.5, '#ffd23d');
    grad.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = grad;
    const armLen = TILE / 2 * s;
    const armW = TILE * 0.42 * s;
    if (f.d === 'c') {
      ctx.beginPath(); ctx.arc(0, 0, armLen * 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(-armLen * 0.7, 0, armW * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(armLen * 0.7, 0, armW * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -armLen * 0.7, armW * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, armLen * 0.7, armW * 0.5, 0, Math.PI * 2); ctx.fill();
      // 白热内核
      ctx.fillStyle = `rgba(255,255,255,${0.75 * s})`;
      ctx.beginPath(); ctx.arc(0, 0, armLen * 0.42, 0, Math.PI * 2); ctx.fill();
    } else {
      const horiz = f.d === 'h';
      ctx.save();
      if (horiz) ctx.rotate(0); else ctx.rotate(Math.PI / 2);
      this.roundRect(-armLen, -armW / 2, armLen * 2, armW, armW / 2);
      ctx.fill();
      // 白热内核
      ctx.fillStyle = `rgba(255,255,255,${0.7 * s})`;
      this.roundRect(-armLen * 0.62, -armW * 0.18, armLen * 1.24, armW * 0.36, armW * 0.18);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  drawItem(it) {
    it.anim += 0.016;
    const bob = Math.sin(it.anim * 2.6) * 4;
    const px = cx(it.tx), pyBase = cy(it.ty);
    // 影子（随浮动缩放）
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(px, pyBase + 15, 11 - bob * 0.35, 4, 0, 0, Math.PI * 2); ctx.fill();
    const py = pyBase + bob - 2;
    // 泡泡外壳（经典泡泡堂：道具都装在泡泡里）
    ctx.save();
    ctx.translate(px, py);
    const bg3 = ctx.createRadialGradient(-5, -6, 3, 0, 0, 17);
    bg3.addColorStop(0, 'rgba(255,255,255,0.6)');
    bg3.addColorStop(0.6, 'rgba(215,232,255,0.2)');
    bg3.addColorStop(1, 'rgba(190,215,255,0.07)');
    ctx.fillStyle = bg3;
    ctx.beginPath(); ctx.arc(0, 0, 16.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(0, 0, 16.5, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, 12.5, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
    // 环绕小星
    const sa = it.anim * 2.4;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(Math.cos(sa) * 13.5, Math.sin(sa) * 13.5, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    this.drawItemIcon(it.type, px, py);
  },

  // 地面香蕉皮
  drawPeel(q) {
    const px = cx(q.tx), py = cy(q.ty) + 9;
    ctx.save();
    if (q.life < 3) ctx.globalAlpha = 0.4 + Math.sin(this.time * 10) * 0.3;
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.arc(px, py, 10, Math.PI * 0.12, Math.PI * 0.88);
    ctx.arc(px, py - 5.5, 11.5, Math.PI * 0.88, Math.PI * 0.12, true);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(180,135,10,.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(px, py - 1.5, 8.5, Math.PI * 0.22, Math.PI * 0.78); ctx.stroke();
    ctx.fillStyle = '#8a6a08';
    ctx.beginPath(); ctx.arc(px - 8, py - 3.5, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  },

  // 12 种道具的专属图标（画在泡泡中心，坐标为图标中心点）
  drawItemIcon(type, px, py) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (type === ITEM_BOMB) {
      const g = ctx.createRadialGradient(px - 2, py - 3, 1, px, py, 8);
      g.addColorStop(0, '#5a6b8c'); g.addColorStop(1, '#1c2333');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py + 1, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)';
      ctx.beginPath(); ctx.ellipse(px - 2.5, py - 1.5, 2.4, 1.4, -0.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py - 6); ctx.quadraticCurveTo(px + 4, py - 10, px + 6, py - 8); ctx.stroke();
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath(); ctx.arc(px + 6, py - 8, 2, 0, Math.PI * 2); ctx.fill();
    } else if (type === ITEM_FIRE) {
      ctx.fillStyle = '#ff7043';
      ctx.beginPath();
      ctx.moveTo(px, py - 9);
      ctx.quadraticCurveTo(px + 8, py - 1, px + 4.5, py + 6);
      ctx.quadraticCurveTo(px, py + 10, px - 4.5, py + 6);
      ctx.quadraticCurveTo(px - 8, py - 1, px, py - 9);
      ctx.fill();
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      ctx.moveTo(px, py - 3);
      ctx.quadraticCurveTo(px + 4, py + 2, px, py + 7);
      ctx.quadraticCurveTo(px - 4, py + 2, px, py - 3);
      ctx.fill();
    } else if (type === ITEM_SPEED) {
      // 闪电
      ctx.fillStyle = '#28b9f0';
      ctx.beginPath();
      ctx.moveTo(px + 2, py - 9); ctx.lineTo(px - 5, py + 1); ctx.lineTo(px - 1, py + 1);
      ctx.lineTo(px - 2, py + 9); ctx.lineTo(px + 5, py - 2); ctx.lineTo(px + 1, py - 2);
      ctx.closePath(); ctx.fill();
    } else if (type === ITEM_KICK) {
      ctx.fillStyle = '#b8863b';
      this.roundRect(px - 7, py - 7, 6, 10, 2.5); ctx.fill();
      this.roundRect(px - 7, py + 0.5, 12, 5, 2.5); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.8;
      for (const o of [-3, 0.5, 4]) {
        ctx.beginPath(); ctx.moveTo(px + 3, py + o); ctx.lineTo(px + 8.5, py + o); ctx.stroke();
      }
    } else if (type === ITEM_SHIELD) {
      ctx.fillStyle = '#8a5cc9';
      ctx.beginPath();
      ctx.moveTo(px, py - 8);
      ctx.lineTo(px + 7, py - 4.5); ctx.lineTo(px + 7, py + 2);
      ctx.quadraticCurveTo(px + 7, py + 7, px, py + 9);
      ctx.quadraticCurveTo(px - 7, py + 7, px - 7, py + 2);
      ctx.lineTo(px - 7, py - 4.5);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px - 1, py + 3); ctx.lineTo(px + 3.5, py - 3); ctx.stroke();
    } else if (type === ITEM_REMOTE) {
      ctx.fillStyle = '#3fa65b';
      this.roundRect(px - 7, py - 3, 14, 10, 3); ctx.fill();
      ctx.fillStyle = '#ff4757';
      ctx.beginPath(); ctx.arc(px, py + 2, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3fa65b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py - 3, 4.5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py - 3, 7.5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    } else if (type === ITEM_PUNCH) {
      // 拳套
      ctx.fillStyle = '#ff6b9d';
      this.roundRect(px - 8, py - 5, 12, 10, 5); ctx.fill();
      this.roundRect(px - 8, py - 2, 16, 6, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.8;
      for (const o of [-3.5, 0]) {
        ctx.beginPath(); ctx.moveTo(px - 4, py + o); ctx.lineTo(px + 2, py + o); ctx.stroke();
      }
    } else if (type === ITEM_MIRROR) {
      // 镜子
      ctx.fillStyle = '#00c877';
      ctx.beginPath(); ctx.ellipse(px, py, 5.5, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.ellipse(px - 1.8, py - 2, 1.8, 4, -0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#00895c';
      this.roundRect(px - 2, py + 8, 4, 3.5, 1.5); ctx.fill();
    } else if (type === ITEM_BOOST) {
      // 双箭头
      ctx.fillStyle = '#ff9800';
      for (const dy of [-4.5, 3.5]) {
        ctx.beginPath();
        ctx.moveTo(px, py + dy - 4); ctx.lineTo(px + 6, py + dy + 1.5); ctx.lineTo(px, py + dy - 0.5);
        ctx.lineTo(px - 6, py + dy + 1.5);
        ctx.closePath(); ctx.fill();
      }
    } else if (type === ITEM_DOUBLE) {
      // 双泡泡
      const g1 = ctx.createRadialGradient(px - 3, py - 3, 1, px - 3, py - 2, 7);
      g1.addColorStop(0, '#8fb7ff'); g1.addColorStop(1, '#2d5fc4');
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(px - 3.5, py - 2, 6.5, 0, Math.PI * 2); ctx.fill();
      const g2 = ctx.createRadialGradient(px + 4, py + 3, 1, px + 4, py + 4, 6);
      g2.addColorStop(0, '#ff9aa8'); g2.addColorStop(1, '#c03546');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(px + 4, py + 4, 5.5, 0, Math.PI * 2); ctx.fill();
    } else if (type === ITEM_PIERCE) {
      // 穿透泡泡：圆环+箭头
      ctx.strokeStyle = '#7c4dff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 6.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#7c4dff';
      ctx.beginPath();
      ctx.moveTo(px + 5, py - 2); ctx.lineTo(px + 10, py + 1.5); ctx.lineTo(px + 5, py + 5);
      ctx.closePath(); ctx.fill();
    } else if (type === ITEM_STORM) {
      // 龙卷
      ctx.strokeStyle = '#4dd0e1'; ctx.lineWidth = 2.6;
      for (let i = 0; i < 3; i++) {
        const wy = py - 6 + i * 6, w = 4 + i * 3.5;
        ctx.beginPath();
        ctx.moveTo(px - w, wy);
        ctx.quadraticCurveTo(px, wy + 3, px + w, wy - 1);
        ctx.stroke();
      }
    } else if (type === ITEM_BANANA) {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      ctx.arc(px, py + 2, 8, Math.PI * 0.1, Math.PI * 0.9);
      ctx.arc(px, py - 3, 9.5, Math.PI * 0.9, Math.PI * 0.1, true);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a6a08';
      ctx.beginPath(); ctx.arc(px - 6.5, py - 4, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(180,135,10,.8)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(px, py - 1, 6.5, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
    } else {
      // 兜底：星形
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      for (let a = 0; a < 10; a++) {
        const ang = a * Math.PI / 5 - Math.PI / 2;
        const rr = a % 2 ? 3.5 : 8;
        const sx2 = px + Math.cos(ang) * rr, sy2 = py + Math.sin(ang) * rr;
        a ? ctx.lineTo(sx2, sy2) : ctx.moveTo(sx2, sy2);
      }
      ctx.closePath(); ctx.fill();
    }
  },

  drawChar(e) {
    const dead = !e.alive;
    let px = e.x, py = e.y, alpha = 1, rot = 0;
    if (dead) {
      const k = 1 - e.dying / 0.8;
      alpha = 1 - k; rot = k * 6; py -= k * 20;
    }
    if (!dead && e.invincible > 0 && Math.floor(this.time * 10) % 2 === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(rot);
    const r = 16;
    const walkT = e.anim * 11;
    const bob = e.moving ? Math.abs(Math.sin(walkT)) * 3.5 : Math.sin(e.anim * 3) * 1.4;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.ellipse(0, r + 3, 12, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    // 身体（无脚：圆滚滚的果冻身材直接落在影子上，经典泡泡堂造型）
    const bodyY = -bob - 3;
    if (e.shield > 0) {
      ctx.strokeStyle = `rgba(255,220,90,${0.45 + Math.sin(this.time * 8) * 0.25})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, bodyY, r + 6 + Math.sin(this.time * 8) * 1.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.translate(0, bodyY);
    // 身体（果冻感挤压）
    const squash = e.moving ? 1 + Math.sin(walkT * 2) * 0.045 : 1 + Math.sin(e.anim * 3) * 0.02;
    ctx.save();
    ctx.scale(1 / squash, squash);
    const g = ctx.createRadialGradient(-4, -6, 3, 0, 0, r + 5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, e.color);
    g.addColorStop(1, this.shade(e.color, -42));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    // 配饰（区分角色）
    this.drawAccessory(e, r);
    // 手手
    ctx.fillStyle = this.shade(e.color, -14);
    const swing = e.moving ? Math.sin(walkT) * 3.5 : 0;
    ctx.beginPath(); ctx.arc(-r - 1.5 + swing * 0.4, 2.5 - swing, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r + 1.5 - swing * 0.4, 2.5 + swing, 5, 0, Math.PI * 2); ctx.fill();
    // 眼睛（看向移动方向 + 偶尔眨眼）
    const blinking = Math.sin(e.anim * 0.9 + (e.tx || 0)) > 0.985;
    const ex = e.face.x * 3.2, ey = e.face.y * 2.8;
    for (const s of [-1, 1]) {
      if (blinking) {
        ctx.strokeStyle = '#222'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s * 6.5 - 3.5, -5); ctx.lineTo(s * 6.5 + 3.5, -5); ctx.stroke();
        continue;
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(s * 6.5, -5, 5.6, 6.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(s * 6.5 + ex * 0.65, -5 + ey, 2.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s * 6.5 + ex * 0.65 - 1, -6.6 + ey, 1.05, 0, Math.PI * 2); ctx.fill();
    }
    // 腮红
    ctx.fillStyle = 'rgba(255,120,140,.55)';
    ctx.beginPath(); ctx.ellipse(-10.5, 3, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(10.5, 3, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    // 嘴
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    ctx.beginPath();
    if (e.isAI) {
      ctx.arc(0, 2.5, 3.4, Math.PI * 0.12, Math.PI * 0.88);
      // 坏笑小尖牙
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(2.5, 5.6); ctx.lineTo(4, 5.2); ctx.lineTo(3.2, 7.2);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.arc(0, 2.5, 4, Math.PI * 0.15, Math.PI * 0.85);
    }
    ctx.stroke();
    ctx.restore();
  },

  // 角色配饰：P1 帽子 / P2 围巾 / 敌人按颜色区分（尖角·叶芽·怒眉·王冠·头带）
  drawAccessory(e, r) {
    if (e.name === 'P1') {
      ctx.fillStyle = '#e05b5b';
      ctx.beginPath(); ctx.arc(0, -r * 0.42, r * 0.78, Math.PI, 0); ctx.fill();
      this.roundRect(-r * 0.95, -r * 0.52, r * 1.9, 4.5, 2.2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.62, r * 0.3, 2.2, -0.2, 0, Math.PI * 2); ctx.fill();
    } else if (e.name === 'P2') {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.72, 5, 0, 0, Math.PI * 2); ctx.fill();
      this.roundRect(r * 0.42, r * 0.5, 5.5, 10, 2.5); ctx.fill();
      ctx.strokeStyle = '#e8b400'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(r * 0.56, r * 0.56); ctx.lineTo(r * 0.56, r * 0.78); ctx.stroke();
    } else if (e.color === '#8a5cc9') {
      ctx.fillStyle = '#a87fd4';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * r * 0.55, -r * 0.62);
        ctx.lineTo(s * r * 0.42, -r * 1.22);
        ctx.lineTo(s * r * 0.18, -r * 0.72);
        ctx.closePath(); ctx.fill();
      }
    } else if (e.color === '#3fa65b') {
      ctx.strokeStyle = '#2d8a3e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -r * 0.85); ctx.lineTo(0, -r * 1.15); ctx.stroke();
      ctx.fillStyle = '#3fa65b';
      ctx.beginPath(); ctx.ellipse(4, -r * 1.18, 6, 3, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-4, -r * 1.05, 5, 2.6, 0.45, 0, Math.PI * 2); ctx.fill();
    } else if (e.color === '#c96a3f') {
      ctx.strokeStyle = '#7a3418'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-10, -11); ctx.lineTo(-3.5, -8.5);
      ctx.moveTo(10, -11); ctx.lineTo(3.5, -8.5);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,230,210,0.75)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(7, 6); ctx.lineTo(10.5, 10);
      ctx.moveTo(10, 5); ctx.lineTo(13, 8.5);
      ctx.stroke();
    } else if (e.color === '#c93f7a') {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      const cyy = -r - 3;
      ctx.moveTo(-7, cyy + 3); ctx.lineTo(-5, cyy - 3); ctx.lineTo(-2, cyy + 0.5);
      ctx.lineTo(0, cyy - 4); ctx.lineTo(2, cyy + 0.5); ctx.lineTo(5, cyy - 3); ctx.lineTo(7, cyy + 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff4757';
      ctx.beginPath(); ctx.arc(0, cyy - 1.5, 1.4, 0, Math.PI * 2); ctx.fill();
    } else if (e.color === '#4f8fc9') {
      ctx.strokeStyle = '#2c5f8a'; ctx.lineWidth = 3.4;
      ctx.beginPath(); ctx.arc(0, -2, r * 0.86, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
    }
  },

  shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp((n >> 16) + amt, 0, 255);
    const g = clamp(((n >> 8) & 255) + amt, 0, 255);
    const b = clamp((n & 255) + amt, 0, 255);
    return `rgb(${r},${g},${b})`;
  },

  roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  drawHUD() {
    const vr = viewRect;
    ctx.fillStyle = '#20233a';
    ctx.fillRect(vr.x0, 0, vr.x1 - vr.x0, HUD_H);
    ctx.fillStyle = '#2c3050';
    ctx.fillRect(vr.x0, HUD_H - 4, vr.x1 - vr.x0, 4);

    if (this.mode === 'single') {
      const p = this.players[0];
      const alive = this.enemies.filter(e => e.alive || e.dying > 0).length;
      const y = HUD_H / 2;
      this.drawOutlinedText(`❤ ${p.lives}`, 16, y, 24, '#ff6b7d', 'left');
      this.drawOutlinedText(`第 ${this.level} 关 · ${this.theme.name}`, W * 0.15, y, 22, '#ffe066', 'left');
      this.drawOutlinedText(`敌人 x${alive}`, W * 0.30, y, 22, '#9fd6ff', 'left');
      this.drawOutlinedText(`消灭 ${p.score}`, W * 0.45, y, 22, '#b5e8a0', 'left');
      const perks = `💣 ${p.bombMax}  🔥 ${p.fire}  👟 ${Math.round((p.speed - 150) / 22)}`
        + (p.kick ? '  🥾' : '') + (p.remote ? '  ⏱' : '') + (p.shield > 0 ? `  🛡${Math.ceil(p.shield)}` : '');
      this.drawOutlinedText(perks, W - 16, y, 20, '#fff', 'right');
    } else if (this.mode === 'versus') {
      const [a, b] = this.players;
      this.drawOutlinedText(`P1  ${a.score}`, W * 0.38, HUD_H / 2, 30, '#4f8fdc');
      this.drawOutlinedText(`第 ${this.round} 回合`, W / 2, HUD_H / 2, 18, '#ffe066');
      this.drawOutlinedText(`${b.score}  P2`, W * 0.62, HUD_H / 2, 30, '#e05b5b');
      const perkA = `💣${a.bombMax} 🔥${a.fire}` + (a.kick ? ' 🥾' : '') + (a.remote ? ' ⏱' : '') + (a.shield > 0 ? ` 🛡${Math.ceil(a.shield)}` : '');
      const perkB = `💣${b.bombMax} 🔥${b.fire}` + (b.kick ? ' 🥾' : '') + (b.remote ? ' ⏱' : '') + (b.shield > 0 ? ` 🛡${Math.ceil(b.shield)}` : '');
      this.drawOutlinedText(perkA, 16, HUD_H / 2, 18, '#9fc3ff', 'left');
      this.drawOutlinedText(perkB, W - 16, HUD_H / 2, 18, '#ffb0a8', 'right');
    } else {
      // 道具挑战 / 无尽模式
      const p = this.players[0];
      const y = HUD_H / 2;
      const modeLabel = this.mode === 'item-challenge' ? '道具挑战' : '无尽模式';
      this.drawOutlinedText(`${modeLabel}`, 16, y, 22, '#ffd23d', 'left');
      this.drawOutlinedText(`❤ ${p.lives}`, 16, y + 20, 18, '#ff6b7d', 'left');
      this.drawOutlinedText(`消灭 ${p.score}`, W * 0.25, y, 22, '#b5e8a0', 'left');
      const perks = `💣 ${p.bombMax}  🔥 ${p.fire}  👟 ${Math.round((p.speed - 150) / 22)}`
        + (p.kick ? '  🥾' : '') + (p.remote ? '  ⏱' : '') + (p.shield > 0 ? `  🛡${Math.ceil(p.shield)}` : '')
        + (p.punch && p.punchTimer > 0 ? `  💥${Math.ceil(p.punchTimer)}` : '')
        + (p.mirror && p.mirrorTimer > 0 ? `  🪞${Math.ceil(p.mirrorTimer)}` : '')
        + (p.boost && p.boostTimer > 0 ? `  ⚡${Math.ceil(p.boostTimer)}` : '')
        + (p.double ? '  💣💣' : '')
        + (p.pierce ? '  🔮' : '')
        + (p.storm && p.stormTimer > 0 ? `  🌪${Math.ceil(p.stormTimer)}` : '');
      this.drawOutlinedText(perks, W - 16, y, 20, '#fff', 'right');
    }
  },

  drawKeycap(xc, yc, label, w = 26) {
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    this.roundRect(xc - w / 2, yc - 11, w, 22, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1;
    this.roundRect(xc - w / 2, yc - 11, w, 22, 5); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, xc, yc + 0.5);
  },

  /* ---- 标题画面右侧的海报主视觉：漂浮的战斗小岛 ---- */
  drawPoster(t) {
    const px = W * 0.70, py = H * 0.50;
    const s = Math.min(W * 0.42 / 330, H * 0.60 / 300);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.045);
    ctx.scale(s, s);

    // 背光光晕
    const glow = ctx.createRadialGradient(0, -20, 30, 0, 0, 280);
    glow.addColorStop(0, 'rgba(255,205,100,0.20)');
    glow.addColorStop(0.5, 'rgba(130,150,255,0.10)');
    glow.addColorStop(1, 'rgba(130,150,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 280, 0, Math.PI * 2); ctx.fill();

    // 漂浮小岛：草地瓦片 + 土层底座
    const T = 46, cols = 6, rows = 4;
    const ox = -cols * T / 2, oy = -rows * T / 2 - 6;
    ctx.fillStyle = '#4e3826';
    this.roundRect(ox + 8, oy + rows * T - 10, cols * T - 16, 48, 18); ctx.fill();
    ctx.fillStyle = '#3c2b1d';
    this.roundRect(ox + 30, oy + rows * T + 24, cols * T - 60, 34, 14); ctx.fill();

    const stoneSet = new Set(['0,0', '5,0', '0,3', '5,3', '2,1', '4,2']);
    const softSet = new Set(['1,0', '3,1', '1,2', '4,0', '2,3']);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = ox + c * T, y = oy + r * T;
        if (stoneSet.has(c + ',' + r)) {
          ctx.fillStyle = '#5a6579'; this.roundRect(x + 1, y + 1, T - 2, T - 2, 8); ctx.fill();
          ctx.fillStyle = '#6d7891'; this.roundRect(x + 3, y + 3, T - 6, T - 12, 7); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.14)';
          this.roundRect(x + 7, y + 6, T - 22, 7, 3.5); ctx.fill();
        } else if (softSet.has(c + ',' + r)) {
          ctx.fillStyle = '#a9713d'; this.roundRect(x + 2, y + 2, T - 4, T - 4, 7); ctx.fill();
          ctx.fillStyle = '#c68a4e'; this.roundRect(x + 4, y + 4, T - 8, T - 14, 6); ctx.fill();
          ctx.strokeStyle = '#8a5a30'; ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(x + 6, y + T / 2 - 2); ctx.lineTo(x + T - 6, y + T / 2 - 2);
          ctx.moveTo(x + T / 2, y + 6); ctx.lineTo(x + T / 2, y + T - 7);
          ctx.stroke();
        } else {
          ctx.fillStyle = (c + r) % 2 ? '#7ec850' : '#74bf4a';
          ctx.fillRect(x, y, T, T);
        }
      }

    const icy = oy + rows * T / 2;

    // 大泡泡（引信火花 + 脉冲）
    const pulse = 1 + Math.sin(t * 7) * 0.05;
    ctx.save();
    ctx.translate(40, icy - 6);
    ctx.scale(pulse, pulse);
    const bg2 = ctx.createRadialGradient(-6, -8, 4, 0, 0, 26);
    bg2.addColorStop(0, '#5a6b8c'); bg2.addColorStop(1, '#1c2333');
    ctx.fillStyle = bg2;
    ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.beginPath(); ctx.ellipse(-9, -10, 6, 3.4, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#caa06a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.quadraticCurveTo(8, -34, 14, -31); ctx.stroke();
    const sp = 1 + Math.sin(t * 18) * 0.5;
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath(); ctx.arc(14, -31, 4.5 * sp, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // 右上角爆闪
    const eb = 0.75 + Math.sin(t * 9) * 0.25;
    ctx.save();
    ctx.translate(150, oy - 34);
    ctx.scale(eb, eb);
    const eg = ctx.createRadialGradient(0, 0, 4, 0, 0, 60);
    eg.addColorStop(0, 'rgba(255,248,208,0.95)');
    eg.addColorStop(0.4, 'rgba(255,210,61,0.75)');
    eg.addColorStop(1, 'rgba(255,107,61,0)');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,120,0.8)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let a = 0; a < 8; a++) {
      const ang = a * Math.PI / 4 + t * 0.8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * 26, Math.sin(ang) * 26);
      ctx.lineTo(Math.cos(ang) * 44, Math.sin(ang) * 44);
      ctx.stroke();
    }
    ctx.restore();

    // 角色：蓝方追击、紫方逃窜
    this.drawChar({ x: -90, y: icy + 4, alive: true, dying: 0, color: '#4f8fdc', face: { x: 1, y: 0 }, anim: t, moving: true, isAI: false, name: 'P1' });
    this.drawChar({ x: 118, y: icy - 28, alive: true, dying: 0, color: '#8a5cc9', face: { x: -1, y: 0 }, anim: t * 1.3, moving: true, isAI: true });

    // 漂浮的踢鞋道具
    ctx.save();
    ctx.translate(-150, oy - 30 + Math.sin(t * 2.2) * 6);
    ctx.fillStyle = 'rgba(184,134,59,0.92)';
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.beginPath(); ctx.arc(-5, -5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    this.roundRect(-7, -8, 5, 9, 2); ctx.fill();
    this.roundRect(-7, -2, 9, 4, 2); ctx.fill();
    ctx.restore();

    ctx.restore();
  },

  // 菜单已由 DOM 层渲染，canvas 只需铺底色（DOM 菜单背景为半透明渐变时透出）
  drawMenuBg() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const CW = cvs.width, CH = cvs.height;
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, '#0e1334'); bg.addColorStop(1, '#0a0e24');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);
  },

  drawMenu() {
    const t = this.time;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const CW = cvs.width, CH = cvs.height;
    const S = CH / 1080;   // 全局比例

    /* ===== 背景 ===== */
    const bg = ctx.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, '#0d1226'); bg.addColorStop(0.55, '#121a38'); bg.addColorStop(1, '#0a0e1e');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, CW, CH);

    // 两团氛围光（右上暖粉 / 左下冷蓝）
    var glow1 = ctx.createRadialGradient(CW * 0.78, CH * 0.3, 10, CW * 0.78, CH * 0.3, CH * 0.7);
    glow1.addColorStop(0, 'rgba(255,120,180,0.07)'); glow1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow1; ctx.fillRect(0, 0, CW, CH);
    var glow2 = ctx.createRadialGradient(CW * 0.12, CH * 0.85, 10, CW * 0.12, CH * 0.85, CH * 0.6);
    glow2.addColorStop(0, 'rgba(70,130,255,0.07)'); glow2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow2; ctx.fillRect(0, 0, CW, CH);

    // 少量上升光点
    for (var i = 0; i < 10; i++) {
      var sp = 0.12 + i * 0.03;
      var px = ((i * 191.3) % 100 / 100) * CW + Math.sin(t * sp + i * 2.1) * 20 * S;
      var py = CH - ((t * 26 * S + i * 137 * S) % (CH + 80 * S));
      var rr = (2 + (i % 3) * 2) * S;
      ctx.globalAlpha = 0.10 + (i % 3) * 0.05;
      ctx.fillStyle = ['#7ea8ff', '#ff8fc0', '#ffd76b'][i % 3];
      ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* ===== 右侧主视觉：光泽糖果泡泡群 ===== */
    var orbs = [
      { x: 0.700, y: 0.335, r: 0.120, c1: '#6fd2ff', c2: '#1d5fb0', icon: 'bomb',  ph: 0.0, amp: 14 },
      { x: 0.865, y: 0.175, r: 0.072, c1: '#ffd76b', c2: '#c07f16', icon: 'star',  ph: 1.2, amp: 10 },
      { x: 0.895, y: 0.500, r: 0.098, c1: '#ff92c2', c2: '#b0337a', icon: 'heart', ph: 2.1, amp: 12 },
      { x: 0.730, y: 0.690, r: 0.082, c1: '#8fe08f', c2: '#2d8a3e', icon: null,    ph: 3.0, amp: 9 },
      { x: 0.575, y: 0.545, r: 0.058, c1: '#c79bff', c2: '#6b34c0', icon: 'fire',  ph: 4.0, amp: 11 },
      { x: 0.880, y: 0.815, r: 0.062, c1: '#ffb35e', c2: '#c06a12', icon: null,    ph: 5.0, amp: 10 },
    ];
    orbs.forEach(function(o) {
      var ox = o.x * CW, oy = o.y * CH + Math.sin(t * 0.9 + o.ph) * o.amp * S;
      var orad = o.r * CH;
      // 背后光晕
      var halo = ctx.createRadialGradient(ox, oy, orad * 0.5, ox, oy, orad * 1.9);
      halo.addColorStop(0, 'rgba(255,255,255,0.10)');
      halo.addColorStop(0.4, o.c1 + '26');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ox, oy, orad * 1.9, 0, Math.PI * 2); ctx.fill();
      // 本体
      var body = ctx.createRadialGradient(ox - orad * 0.35, oy - orad * 0.4, orad * 0.1, ox, oy, orad);
      body.addColorStop(0, o.c1);
      body.addColorStop(0.55, o.c2);
      body.addColorStop(1, o.c2);
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(ox, oy, orad, 0, Math.PI * 2); ctx.fill();
      // 底部透光弧（糖果感）
      ctx.strokeStyle = 'rgba(255,255,255,0.30)';
      ctx.lineWidth = orad * 0.07; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ox, oy, orad * 0.86, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
      // 顶部大高光
      var spec = ctx.createRadialGradient(ox - orad * 0.38, oy - orad * 0.45, 1, ox - orad * 0.38, oy - orad * 0.45, orad * 0.55);
      spec.addColorStop(0, 'rgba(255,255,255,0.85)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.beginPath(); ctx.ellipse(ox - orad * 0.38, oy - orad * 0.45, orad * 0.42, orad * 0.30, -0.5, 0, Math.PI * 2); ctx.fill();
      // 小亮点
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(ox + orad * 0.25, oy - orad * 0.55, orad * 0.06, 0, Math.PI * 2); ctx.fill();
      // 内芯图标（随泡泡尺寸缩放）
      if (o.icon === 'bomb' || o.icon === 'fire') {
        ctx.save();
        ctx.translate(ox, oy + orad * 0.06);
        var k = orad / 30;
        ctx.scale(k, k);
        this.drawItemIcon(o.icon === 'bomb' ? ITEM_BOMB : ITEM_FIRE, 0, 0);
        ctx.restore();
      } else if (o.icon === 'star') {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        for (var k = 0; k < 10; k++) {
          var a2 = k * Math.PI / 5 - Math.PI / 2;
          var rr2 = k % 2 ? orad * 0.22 : orad * 0.48;
          var sx2 = ox + Math.cos(a2) * rr2, sy2 = oy + Math.sin(a2) * rr2;
          k ? ctx.lineTo(sx2, sy2) : ctx.moveTo(sx2, sy2);
        }
        ctx.closePath(); ctx.fill();
      } else if (o.icon === 'heart') {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        var hs = orad * 0.5;
        ctx.beginPath();
        ctx.moveTo(ox, oy + hs * 0.75);
        ctx.bezierCurveTo(ox - hs * 1.2, oy - hs * 0.2, ox - hs * 0.6, oy - hs * 0.9, ox, oy - hs * 0.25);
        ctx.bezierCurveTo(ox + hs * 0.6, oy - hs * 0.9, ox + hs * 1.2, oy - hs * 0.2, ox, oy + hs * 0.75);
        ctx.fill();
      }
    }.bind(this));

    /* ===== 左侧内容列（垂直居中） ===== */
    var mx = Math.max(40 * S, CW * 0.055);
    var titleH = 150 * S;
    var cardW = Math.min(CW * 0.30, 360 * S);
    var cardH = 66 * S, gap = 14 * S;
    var listGap = 34 * S;
    var contentH = titleH + listGap + 4 * cardH + 3 * gap;
    var startY = Math.max(40 * S, (CH - contentH) / 2);

    /* --- 标题 --- */
    var tSz = Math.round(84 * S);
    var ty2 = startY;
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // 柔和底光
    var tgl = ctx.createRadialGradient(mx + tSz * 1.4, ty2 + tSz * 0.5, 10, mx + tSz * 1.4, ty2 + tSz * 0.5, tSz * 2.6);
    tgl.addColorStop(0, 'rgba(255,180,90,0.14)'); tgl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tgl; ctx.fillRect(mx - 60 * S, ty2 - 40 * S, tSz * 4.4, tSz * 2.2);
    // 眉题
    ctx.font = 'bold ' + Math.round(15 * S) + 'px "Arial", sans-serif';
    ctx.fillStyle = 'rgba(255,214,110,0.75)';
    ctx.fillText('B U B B L E   B L A S T', mx + 4, ty2 - 30 * S);
    // 主标题：双色渐变 + 柔光
    ctx.font = '900 ' + tSz + 'px "Microsoft YaHei", sans-serif';
    var drawTitle = function(txt, x, cLight, cDark, glow) {
      var gr = ctx.createLinearGradient(0, ty2, 0, ty2 + tSz);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, cLight); gr.addColorStop(1, cDark);
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 26 * S;
      ctx.fillStyle = gr;
      ctx.fillText(txt, x, ty2 + Math.sin(t * 1.5) * 3 * S);
      ctx.restore();
      return ctx.measureText(txt).width;
    };
    var w1 = drawTitle('泡泡', mx, '#6fb6ff', '#1f6fd0', 'rgba(60,140,255,0.55)');
    drawTitle('爆破', mx + w1, '#ff8fc4', '#d63d8f', 'rgba(255,90,170,0.55)');
    ctx.restore();
    // 金色小下划线
    ctx.fillStyle = '#ffd76b';
    ctx.fillRect(mx + 2, ty2 + tSz + 10 * S, 56 * S, 4 * S);

    /* --- 模式卡片 --- */
    var items = [
      { title: '单人闯关', desc: '挑战 AI 敌人 · 关卡无限', color: '#4f9fff', icon: ITEM_BOMB },
      { title: '双人对战', desc: '同屏 1v1 · 先胜三回合', color: '#ff6b6b', icon: ITEM_FIRE },
      { title: '道具挑战', desc: '限定道具 · 极致操作', color: '#ffd23d', icon: ITEM_SHIELD },
      { title: '无尽模式', desc: '越战越勇 · 冲击极限', color: '#4dd06a', icon: ITEM_STORM },
    ];
    var listY = startY + titleH + listGap;
    this.menuRects = [];
    items.forEach(function(it, i) {
      var y = listY + i * (cardH + gap);
      var btnX = mx - 14 * S, btnW = cardW + 28 * S;
      this.menuRects.push({ x: btnX, y: y, w: btnW, h: cardH });
      var isSel = this.menuIndex === i, isHov = this.hoverIndex === i;

      // 卡片底
      ctx.fillStyle = isSel ? 'rgba(30,42,80,0.92)' : isHov ? 'rgba(20,28,56,0.85)' : 'rgba(15,21,44,0.72)';
      this.roundRect(btnX, y, btnW, cardH, 14 * S); ctx.fill();
      // 边框
      if (isSel) {
        ctx.save();
        ctx.shadowColor = it.color; ctx.shadowBlur = 20 * S;
        ctx.strokeStyle = it.color; ctx.lineWidth = 2.5 * S;
        this.roundRect(btnX, y, btnW, cardH, 14 * S); ctx.stroke();
        ctx.restore();
      } else {
        ctx.strokeStyle = isHov ? it.color + '80' : 'rgba(130,170,255,0.12)';
        ctx.lineWidth = 1.5 * S;
        this.roundRect(btnX, y, btnW, cardH, 14 * S); ctx.stroke();
      }
      // 左侧强调条
      ctx.save();
      if (isSel || isHov) { ctx.shadowColor = it.color; ctx.shadowBlur = 12 * S; }
      ctx.fillStyle = it.color;
      ctx.globalAlpha = isSel ? 1 : isHov ? 0.8 : 0.45;
      this.roundRect(btnX + 2 * S, y + 9 * S, 4.5 * S, cardH - 18 * S, 2.5 * S); ctx.fill();
      ctx.globalAlpha = 1; ctx.restore();

      // 图标徽章（复用游戏内道具图标，美术统一）
      var icX = btnX + 40 * S, icY = y + cardH / 2, icR = 21 * S;
      var ig = ctx.createRadialGradient(icX - 5 * S, icY - 5 * S, 2, icX, icY, icR);
      ig.addColorStop(0, it.color + '55'); ig.addColorStop(1, it.color + '14');
      ctx.fillStyle = ig;
      ctx.beginPath(); ctx.arc(icX, icY, icR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = it.color; ctx.globalAlpha = isSel ? 0.85 : 0.4; ctx.lineWidth = 1.5 * S;
      ctx.beginPath(); ctx.arc(icX, icY, icR, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      this.drawItemIcon(it.icon, icX, icY);

      // 文案
      var tCol = isSel ? '#ffe066' : isHov ? '#e6ecff' : '#aab6d6';
      var dCol = isSel ? 'rgba(255,240,190,0.85)' : 'rgba(130,145,190,0.8)';
      this.drawOutlinedText(it.title, btnX + 76 * S, y + cardH * 0.32, Math.round(21 * S), tCol, 'left');
      this.drawOutlinedText(it.desc, btnX + 76 * S, y + cardH * 0.71, Math.round(12.5 * S), dCol, 'left');

      // 选中箭头
      if (isSel) {
        var ax = btnX - 26 * S + Math.sin(t * 6) * 3 * S;
        ctx.fillStyle = it.color;
        ctx.beginPath();
        ctx.moveTo(ax, icY - 7 * S); ctx.lineTo(ax + 11 * S, icY); ctx.lineTo(ax, icY + 7 * S);
        ctx.closePath(); ctx.fill();
      }
    }.bind(this));

    /* ===== 底部按键提示 & 版本 ===== */
    var segs = [
      { caps: ['↑', '↓'], label: '选择' },
      { caps: ['Enter'], label: '确认' },
      { caps: ['V'], label: '全屏' },
      { caps: ['M'], label: '音效' },
    ];
    var fx = mx, ky = CH - 30 * S;
    segs.forEach(function(s) {
      var x = fx;
      s.caps.forEach(function(c) { this.drawKeycap(x + 13 * S, ky, c, 26 * S); x += 30 * S; }.bind(this));
      ctx.fillStyle = 'rgba(150,165,205,0.5)';
      ctx.font = 12 * S + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, x + 8 * S, ky + 1);
      fx = x + 8 * S + ctx.measureText(s.label).width + 22 * S;
    }.bind(this));
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText('v1.0.0', CW - 14, CH - 14);

    /* ===== 暗角 ===== */
    var vg = ctx.createRadialGradient(CW / 2, CH / 2, Math.min(CW, CH) * 0.38, CW / 2, CH / 2, Math.max(CW, CH) * 0.75);
    vg.addColorStop(0, 'rgba(5,8,20,0)'); vg.addColorStop(1, 'rgba(5,8,20,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, CW, CH);

    ctx.restore();
  },



};

/* ---------- 主循环 ---------- */
let last = performance.now();
let lastWinW = document.documentElement.clientWidth, lastWinH = document.documentElement.clientHeight;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const cwNow = document.documentElement.clientWidth, chNow = document.documentElement.clientHeight;
  if (cwNow !== lastWinW || chNow !== lastWinH) {
    lastWinW = cwNow; lastWinH = chNow;
    fitCanvas();
    Game.onResize();
  }
  Game.update(dt);
  Game.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 窗口尺寸变化 → 网格变了才重建场地（onResize 内部判断）
window.addEventListener('resize', () => Game.onResize());
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => Game.onResize());

// 切走窗口 / 切到别的标签页 → 自动暂停，回来按 P 继续
window.addEventListener('blur', () => {
  if (Game.state === 'play') Game.state = 'pause';
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && Game.state === 'play') Game.state = 'pause';
});
