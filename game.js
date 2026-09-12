/* ============================================================
 *  BubbleBlast（泡泡堂 Q版复刻）· 纯 Canvas + 原生 JS
 *  玩法：方向键/WASD 移动，空格/F 放泡泡，炸开砖块吃道具
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
  const aspect = max(0.45, min(3.2, innerWidth / max(1, innerHeight)));
  ROWS = odd(max(9, min(19, Math.round(13 / Math.sqrt(aspect)))));
  COLS = odd(max(9, min(27, Math.round(ROWS * aspect))));
  W = COLS * TILE;
  H = ROWS * TILE + HUD_H;
}

const EMPTY = 0, STONE = 1, SOFT = 2;
const ITEM_BOMB = 0, ITEM_FIRE = 1, ITEM_SPEED = 2, ITEM_KICK = 3, ITEM_SHIELD = 4, ITEM_REMOTE = 5;

/* ---------- 地图主题（按关卡/回合轮换） ---------- */
const THEMES = [
  { name: '草原', g1: '#7ec850', g2: '#74bf4a', stone: '#5a6579', stoneTop: '#6d7891' },
  { name: '雪原', g1: '#d4e6f5', g2: '#c6dcef', stone: '#7f93ad', stoneTop: '#94a9c4' },
  { name: '沙漠', g1: '#ecd9a0', g2: '#e3cd8c', stone: '#9a7b58', stoneTop: '#b08e66' },
  { name: '夜幕', g1: '#414d78', g2: '#3a4570', stone: '#2c3352', stoneTop: '#3d4570' },
];

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');

/* ---------- 资源加载 & 加载界面 ---------- */
let assetsReady = false;
const loader = document.getElementById('loader');
const barFill = document.getElementById('barFill');

Assets.onProgress((loaded, total) => {
  barFill.style.width = Math.round(loaded / total * 100) + '%';
});

async function initAssets() {
  const count = await Assets.init();
  assetsReady = true;
  setTimeout(() => { loader.classList.add('hidden'); }, 400);
}
initAssets();

/* ---------- 自适应缩放 & 全屏 ---------- */
// 画布永远占满整个浏览器窗口（CSS flex 布局），
// 游戏画面在画布内等比缩放居中，按物理像素渲染 → 任何尺寸下都是高清矢量
// viewRect 记录游戏坐标系下的可见范围（可以超出 0..W / 0..H，用于背景延伸）
let viewRect = { x0: 0, y0: 0, x1: W, y1: H };
let viewScale = 1, viewOffX = 0, viewOffY = 0;
function fitCanvas() {
  setFieldSize();
  const dpr = window.devicePixelRatio || 1;
  cvs.width = Math.round(innerWidth * dpr);
  cvs.height = Math.round(innerHeight * dpr);
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
function menuPosFromEvent(e) {
  const rect = cvs.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (cvs.width / rect.width);
  const py = (e.clientY - rect.top) * (cvs.height / rect.height);
  return { x: (px - viewOffX) / viewScale, y: (py - viewOffY) / viewScale };
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
  move()    { this.tone(340, 0.05, 'square', 0.06); },
  confirm() { this.tone(523, 0.09, 'square', 0.1); setTimeout(() => this.tone(784, 0.12, 'square', 0.1), 80); },
  win()     { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.15, 'square', 0.12), i * 120)); },
  lose()    { [392, 330, 262, 196].forEach((f, i) => setTimeout(() => this.tone(f, 0.2, 'sawtooth', 0.12), i * 160)); },
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
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++)
      if (m[idx(x, y)] === EMPTY && !safe.has(idx(x, y)) && Math.random() < 0.72)
        m[idx(x, y)] = SOFT;
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

  reset(mode) {
    this.mode = mode;
    this.hidden = [];
    this.map = genMap(mode);
    this.theme = THEMES[0];
    this.bombs = []; this.flames = []; this.items = []; this.particles = [];
    this.enemies = [];
    this.level = 1; this.round = 1;
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
    this.state = 'play';
    this.showMsg(mode === 'versus' ? `第 ${this.round} 回合 · 开始！` : `第 ${this.level} 关 · 开始！`);
  },

  nextLevel() {
    this.level++;
    this.hidden = [];
    this.map = genMap(this.mode);
    this.theme = THEMES[(this.level - 1) % THEMES.length];
    this.bombs = []; this.flames = []; this.items = []; this.particles = [];
    const p = this.players[0];
    p.x = cx(1); p.y = cy(1); p.tx = 1; p.ty = 1;
    p.alive = true; p.dead = false; p.invincible = 2; p.dying = 0;
    this.spawnEnemies();
    this.state = 'play';
    this.showMsg(`第 ${this.level} 关 · 开始！`);
  },

  nextRound() {
    this.round++;
    this.hidden = [];
    this.map = genMap(this.mode);
    this.theme = THEMES[(this.round - 1) % THEMES.length];
    this.bombs = []; this.flames = []; this.items = []; this.particles = [];
    const spots = [[1, 1], [COLS - 2, ROWS - 2]];
    this.players.forEach((p, i) => {
      p.x = cx(spots[i][0]); p.y = cy(spots[i][1]);
      p.tx = spots[i][0]; p.ty = spots[i][1];
      p.alive = true; p.dead = false; p.invincible = 2; p.dying = 0;
      p.bombMax = 1; p.bombActive = 0; p.fire = 2; p.speed = 150;
      p.kick = false; p.shield = 0; p.remote = false;
    });
    this.spawnItemsForVersus();
    this.state = 'play';
    this.showMsg(`第 ${this.round} 回合 · 开始！`);
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
    const pool = [ITEM_BOMB, ITEM_FIRE, ITEM_SPEED, ITEM_KICK, ITEM_SHIELD, ITEM_REMOTE];
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
    if (this.state === 'menu' || !this.map) return;
    this.hidden = [];
    this.map = genMap(this.mode);
    this.bombs = []; this.flames = []; this.items = []; this.particles = [];
    if (this.mode === 'single') {
      this.spawnEnemies();
      const p = this.players[0];
      p.x = cx(1); p.y = cy(1); p.tx = 1; p.ty = 1;
      p.alive = true; p.dying = 0; p.invincible = 2;
    } else {
      const spots = [[1, 1], [COLS - 2, ROWS - 2]];
      this.players.forEach((p, i) => {
        p.x = cx(spots[i][0]); p.y = cy(spots[i][1]);
        p.tx = spots[i][0]; p.ty = spots[i][1];
        p.alive = true; p.dying = 0; p.invincible = 2;
      });
    }
    this.showMsg('场地已随窗口调整！');
  },

  onKey(k) {
    if (k === 'v' || k === 'V') toggleFullscreen();
    if (k === 'm' || k === 'M') Sfx.muted = !Sfx.muted;
    if (this.state === 'menu') {
      const n = 2;
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { this.menuIndex = (this.menuIndex + n - 1) % n; Sfx.move(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { this.menuIndex = (this.menuIndex + 1) % n; Sfx.move(); }
      else if (k === 'Enter' || k === ' ') this.confirmMenu();
      else if (k === '1') { this.menuIndex = 0; this.confirmMenu(); }
      else if (k === '2') { this.menuIndex = 1; this.confirmMenu(); }
      return;
    }
    if (this.state === 'play' || this.state === 'pause') {
      if (k === 'p' || k === 'P' || k === 'Escape') {
        this.state = this.state === 'play' ? 'pause' : 'play';
      }
    }
    if (this.state === 'over') {
      if (k !== 'Enter' && k !== ' ') return;
      if (this.mode === 'versus') this.nextRound();
      else { this.hidden = []; this.state = 'menu'; }
      return;
    }
    if (this.state === 'win') {
      if (k !== 'Enter' && k !== ' ') return;
      if (this.mode === 'single') this.nextLevel();
      else { this.hidden = []; this.state = 'menu'; }
      return;
    }
    if (k === 'm' || k === 'M') Sfx.muted = !Sfx.muted;
  },

  confirmMenu() {
    Sfx.confirm();
    this.reset(this.menuIndex === 0 ? 'single' : 'versus');
  },

  /* ---------- 泡泡 ---------- */
  placeBomb(p) {
    // 遥控引爆：泡泡放满了再按键 → 引爆自己最早的一颗
    if (p.bombActive >= p.bombMax) {
      if (p.remote) {
        const mine = this.bombs.filter(b => b.owner === p && b.timer > 0);
        if (mine.length) mine[0].timer = 0.01;
      }
      return;
    }
    const tx = p.tx, ty = p.ty;
    if (this.bombs.some(b => b.tx === tx && b.ty === ty)) return;
    p.bombActive++;
    this.bombs.push({ tx, ty, timer: 2.4, range: p.fire, owner: p, pass: new Set([p]) });
    Sfx.place();
  },

  // 泡泡能否滑进目标格
  canSlideTo(b, nx, ny) {
    if (!inMap(nx, ny)) return false;
    if (this.map[idx(nx, ny)] !== EMPTY) return false;
    if (this.bombs.some(o => o !== b && o.tx === nx && o.ty === ny)) return false;
    if ([...this.players, ...this.enemies].some(e => e.alive && e.tx === nx && e.ty === ny)) return false;
    return true;
  },

  explode(b) {
    b.timer = -1;
    b.owner.bombActive = Math.max(0, b.owner.bombActive - 1);
    Sfx.boom();
    this.shakeT = 0.25;
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
          break;
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
    // 隐藏道具：对战模式埋在 hidden；闯关模式概率生成
    let type = null;
    if (this.mode === 'versus' && this.hidden && this.hidden[idx(x, y)] != null) {
      type = this.hidden[idx(x, y)]; this.hidden[idx(x, y)] = null;
    } else if (this.mode === 'single' && Math.random() < 0.38) {
      type = [ITEM_BOMB, ITEM_FIRE, ITEM_FIRE, ITEM_SPEED, ITEM_SPEED, ITEM_KICK, ITEM_KICK, ITEM_SHIELD, ITEM_REMOTE][randi(0, 8)];
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
        const step = en.speed * dt;
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
      const nearPlayer = this.players.some(p => p.alive && Math.abs(p.tx - en.tx) + Math.abs(p.ty - en.ty) <= 2);
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
      if (t !== EMPTY) return false;
      if (this.bombs.some(b => b.tx === en.tx+dx && b.ty === en.ty+dy)) return false;
      if (danger[idx(en.tx+dx, en.ty+dy)]) return false;
      return true;
    });
    if (!dirs.length) { en.target = null; return; }
    // 追踪玩家：优先朝玩家方向
    const p = this.players.find(p => p.alive);
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
    if (this.msgT > 0) this.msgT -= dt;
    if (this.shakeT > 0) this.shakeT -= dt;

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
      if (p.shield > 0) p.shield -= dt;
      if (!p.alive) continue;
      p.anim += dt;
      if (this.mode === 'versus' && p === this.players[1]) {
        let dx = (keys['a'] ? -1 : 0) + (keys['d'] ? 1 : 0);
        let dy = (keys['w'] ? -1 : 0) + (keys['s'] ? 1 : 0);
        this.applyMove(p, dx, dy, dt);
        if (keys['f']) this.placeBomb(p);
      } else {
        let dx = (keys['ArrowLeft'] ? -1 : 0) + (keys['ArrowRight'] ? 1 : 0);
        let dy = (keys['ArrowUp'] ? -1 : 0) + (keys['ArrowDown'] ? 1 : 0);
        this.applyMove(p, dx, dy, dt);
        if (keys[' ']) this.placeBomb(p);
      }
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
          this.showMsg(p.name + [
            ' 泡泡+1!', ' 火力+1!', ' 速度+1!',
            ' 获得踢鞋！顶着泡泡把它踢飞！', ' 护盾！6 秒无敌！', ' 遥控器！泡泡满时按键引爆！',
          ][it.type]);
        }
      }
    }

    // 玩家死亡结算
    for (const p of this.players) {
      if (p.dying > 0 && !p.alive) {
        p.dying -= dt;
        if (p.dying <= 0) {
          if (this.mode === 'single') {
            p.lives--;
            if (p.lives > 0) {
              p.alive = true; p.dead = false;
              p.x = cx(1); p.y = cy(1); p.tx = 1; p.ty = 1;
              p.invincible = 2.5;
            } else {
              p.dead = true;
              this.state = 'over';
              Sfx.lose();
            }
          } else {
            p.dead = true;
            const winner = this.players.find(q => q !== p);
            winner.score++;
            this.state = 'over';
            this.roundEndT = 0;
            if (winner.score >= 3) { this.state = 'win'; Sfx.win(); }
            else Sfx.lose();
          }
        }
      }
    }

    // 单人模式：敌人清空（含死亡动画播完）→ 过关
    if (this.mode === 'single' && this.enemies.every(e => !e.alive && e.dying <= 0) && this.state === 'play') {
      if (this.players[0].alive) {
        this.state = 'win';
        Sfx.win();
      }
    }
  },

  applyMove(p, dx, dy, dt) {
    if (dx === 0 && dy === 0) { p.moving = false; return; }
    if (dx !== 0 && dy !== 0) { // 斜向时只保留水平（泡泡堂是四方向）
      dy = 0;
    }
    if (dx !== 0) {
      p.face.x = dx; p.face.y = 0;
      // 垂直方向自动对齐格子中线（走位手感）
      const rowC = cy(p.ty);
      const off = rowC - p.y;
      p.y += clamp(off, -p.speed * dt * 0.8, p.speed * dt * 0.8) * (Math.abs(off) > 1 ? 1 : 0);
      this.moveEntity(p, dx * p.speed * dt, 0, dt);
    } else {
      p.face.y = dy; p.face.x = 0;
      const colC = cx(p.tx);
      const off = colC - p.x;
      p.x += clamp(off, -p.speed * dt * 0.8, p.speed * dt * 0.8) * (Math.abs(off) > 1 ? 1 : 0);
      this.moveEntity(p, 0, dy * p.speed * dt, dt);
    }
    p.moving = true;
  },

  /* ---------- 渲染 ---------- */
  draw() {
    ctx.save();
    if (this.state !== 'menu') {
      // 背景延伸：草地格子 + HUD 深色条一直画到窗口边缘（游戏区外也有背景）
      const vr = viewRect;
      const c0 = Math.floor(vr.x0 / TILE), c1 = Math.ceil(vr.x1 / TILE);
      const r0 = Math.floor((vr.y0 - HUD_H) / TILE), r1 = Math.ceil((vr.y1 - HUD_H) / TILE);
      for (let ry = r0; ry < r1; ry++)
        for (let rx = c0; rx < c1; rx++) {
          ctx.fillStyle = (rx + ry) % 2 ? this.theme.g1 : this.theme.g2;
          ctx.fillRect(rx * TILE, HUD_H + ry * TILE, TILE, TILE);
        }
      if (vr.y0 < HUD_H) {
        ctx.fillStyle = '#20233a';
        ctx.fillRect(vr.x0, vr.y0, vr.x1 - vr.x0, HUD_H - vr.y0);
      }
    }
    if (this.shakeT > 0) {
      ctx.translate(rand(-1, 1) * this.shakeT * 14, rand(-1, 1) * this.shakeT * 14);
    }

    if (this.state === 'menu') { this.drawMenu(); ctx.restore(); return; }

    // 草地背景（按主题配色）
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        ctx.fillStyle = (x + y) % 2 ? this.theme.g1 : this.theme.g2;
        ctx.fillRect(x * TILE, HUD_H + y * TILE, TILE, TILE);
      }

    // 地块
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const t = this.map[idx(x, y)];
        if (t === STONE) this.drawStone(x, y);
        else if (t === SOFT) this.drawSoft(x, y);
      }

    // 道具
    for (const it of this.items) this.drawItem(it);

    // 泡泡
    for (const b of this.bombs) this.drawBomb(b);

    // 火焰
    for (const f of this.flames) this.drawFlame(f);

    // 实体
    const ents = [...this.enemies.filter(e => e.alive || e.dying > 0), ...this.players.filter(p => p.alive || p.dying > 0)];
    ents.sort((a, b) => a.y - b.y);
    for (const e of ents) this.drawChar(e);

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

    // 消息
    if (this.msgT > 0) {
      ctx.globalAlpha = clamp(this.msgT, 0, 1);
      this.drawOutlinedText(this.msg, W / 2, HUD_H + ROWS * TILE / 2 - 160, 26, '#fff');
      ctx.globalAlpha = 1;
    }

    // 遮罩状态
    if (this.state === 'pause') this.drawOverlay('暂停', '按 P 继续');
    if (this.state === 'over') {
      if (this.mode === 'versus') {
        const winner = this.players.find(p => !p.dead);
        const loser = this.players.find(p => p.dead);
        this.drawOverlay(`${winner.name} 得分！`, `比分 ${this.players[0].score} : ${this.players[1].score}\n按 Enter 进入下一回合`);
      } else {
        this.drawOverlay('游戏结束', `消灭敌人 ${this.players[0].score} 个 · 按 Enter 返回菜单`);
      }
    }
    if (this.state === 'win') {
      if (this.mode === 'versus') {
        const w = this.players[0].score >= 3 ? this.players[0] : this.players[1];
        this.drawOverlay(`${w.name} 获得胜利！🎉`, `比分 ${this.players[0].score} : ${this.players[1].score} · 按 Enter 返回菜单`);
      } else {
        this.drawOverlay(`第 ${this.level} 关 通过！`, '按 Enter 进入下一关');
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

  drawStone(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    const th = this.theme;
    ctx.fillStyle = th.stone;
    this.roundRect(px + 1, py + 1, TILE - 2, TILE - 2, 8);
    ctx.fill();
    ctx.fillStyle = th.stoneTop;
    this.roundRect(px + 3, py + 3, TILE - 6, TILE - 12, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    this.roundRect(px + 7, py + 6, TILE - 22, 8, 4);
    ctx.fill();
  },

  drawSoft(x, y) {
    const px = x * TILE, py = HUD_H + y * TILE;
    ctx.fillStyle = '#a9713d';
    this.roundRect(px + 2, py + 2, TILE - 4, TILE - 4, 7);
    ctx.fill();
    ctx.fillStyle = '#c68a4e';
    this.roundRect(px + 4, py + 4, TILE - 8, TILE - 14, 6);
    ctx.fill();
    ctx.strokeStyle = '#8a5a30';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(px + 6, py + TILE / 2 - 3);
    ctx.lineTo(px + TILE - 6, py + TILE / 2 - 3);
    ctx.moveTo(px + TILE / 2, py + 6);
    ctx.lineTo(px + TILE / 2, py + TILE - 8);
    ctx.stroke();
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
    } else {
      const horiz = f.d === 'h';
      ctx.save();
      if (horiz) ctx.rotate(0); else ctx.rotate(Math.PI / 2);
      this.roundRect(-armLen, -armW / 2, armLen * 2, armW, armW / 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  drawItem(it) {
    it.anim += 0.016;
    const bob = Math.sin(it.anim * 3) * 3;
    const px = cx(it.tx), py = cy(it.ty) + bob;
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(cx(it.tx), cy(it.ty) + 16, 12, 4, 0, 0, Math.PI * 2); ctx.fill();

    /* === SVG 道具图片 === */
    const itemNames = {
      [ITEM_BOMB]: 'items/bomb', [ITEM_FIRE]: 'items/fire', [ITEM_SPEED]: 'items/speed',
      [ITEM_KICK]: 'items/kick', [ITEM_SHIELD]: 'items/shield', [ITEM_REMOTE]: 'items/remote',
    };
    const img = Assets.get(itemNames[it.type]);
    if (img) {
      ctx.drawImage(img, px - 14, py - 14, 28, 28);
    } else {
    /* === Canvas 降级 === */
    const colors = { [ITEM_BOMB]: '#3d4a66', [ITEM_FIRE]: '#ff7043', [ITEM_SPEED]: '#42c6ff', [ITEM_KICK]: '#b8863b', [ITEM_SHIELD]: '#8a5cc9', [ITEM_REMOTE]: '#3fa65b' };
    ctx.fillStyle = colors[it.type];
    this.roundRect(px - 14, py - 14, 28, 28, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    this.roundRect(px - 14, py - 14, 28, 12, 8); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    if (it.type === ITEM_BOMB) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px, py + 1, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(px + 4, py - 6); ctx.quadraticCurveTo(px + 9, py - 10, px + 11, py - 7); ctx.stroke();
    } else if (it.type === ITEM_FIRE) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(px, py - 10);
      ctx.quadraticCurveTo(px + 9, py - 2, px + 5, py + 6);
      ctx.quadraticCurveTo(px, py + 12, px - 5, py + 6);
      ctx.quadraticCurveTo(px - 9, py - 2, px, py - 10);
      ctx.fill();
    } else if (it.type === ITEM_KICK) {
      // 踢鞋 + 飞出线
      ctx.fillStyle = '#fff';
      this.roundRect(px - 8, py - 8, 8, 12, 3); ctx.fill();
      this.roundRect(px - 8, py + 1, 14, 6, 3); ctx.fill();
      ctx.lineWidth = 2;
      for (const o of [-3, 1, 5]) {
        ctx.beginPath();
        ctx.moveTo(px + 3, py + o - 2); ctx.lineTo(px + 10, py + o - 2);
        ctx.stroke();
      }
    } else if (it.type === ITEM_SHIELD) {
      // 盾牌
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(px, py - 9);
      ctx.lineTo(px + 8, py - 5); ctx.lineTo(px + 8, py + 2);
      ctx.quadraticCurveTo(px + 8, py + 8, px, py + 10);
      ctx.quadraticCurveTo(px - 8, py + 8, px - 8, py + 2);
      ctx.lineTo(px - 8, py - 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = colors[ITEM_SHIELD];
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    } else if (it.type === ITEM_REMOTE) {
      // 遥控器：按钮 + 信号波
      ctx.fillStyle = '#fff';
      this.roundRect(px - 7, py - 4, 14, 10, 3); ctx.fill();
      ctx.fillStyle = '#ff4757';
      ctx.beginPath(); ctx.arc(px, py + 1, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py - 4, 5, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py - 4, 8.5, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke();
    } else {
      ctx.fillStyle = '#fff';
      this.roundRect(px - 10, py - 3, 12, 6, 3); ctx.fill();
      this.roundRect(px - 10, py + 3, 8, 5, 2); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px + 2, py - 8); ctx.lineTo(px + 10, py); ctx.lineTo(px + 2, py + 8);
      ctx.closePath(); ctx.fill();
    }
    } // 结束 Canvas 降级块
  },

  drawChar(e) {
    const dead = !e.alive;
    let px = e.x, py = e.y, alpha = 1, rot = 0;
    if (dead) {
      const k = 1 - e.dying / 0.8;
      alpha = 1 - k; rot = k * 6; py -= k * 20;
    }
    const blink = e.invincible > 0 && Math.floor(this.time * 10) % 2 === 0;
    if (blink) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(px, py);
    ctx.rotate(rot);
    const bob = e.moving ? Math.abs(Math.sin(e.anim * 10)) * 4 : Math.sin(e.anim * 3) * 1.5;
    const r = 17;
    // 影子
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(0, 17, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, -bob);
    // 护盾光环
    if (e.shield > 0) {
      ctx.strokeStyle = `rgba(255,220,90,${0.5 + Math.sin(this.time * 8) * 0.25})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, r + 6 + Math.sin(this.time * 8) * 1.5, 0, Math.PI * 2); ctx.stroke();
    }

    /* === SVG 角色图片（预加载成功后使用） === */
    const isP2 = (e.name === 'P2');
    const assetKey = e.isAI ? null : (isP2 ? 'chars/player-p2' : 'chars/player-p1');
    const img = e.isAI ? null : Assets.get(assetKey);
    if (img) {
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
      // 手臂动画
      ctx.fillStyle = this.shade(e.color, -12);
      const swing = e.moving ? Math.sin(e.anim * 12) * 4 : 0;
      ctx.beginPath(); ctx.arc(-r - 2 + swing * 0.4, 2 - swing, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r + 2 - swing * 0.4, 2 + swing, 5.5, 0, Math.PI * 2); ctx.fill();
    } else {
    /* === Canvas 降级绘制 === */
    // 身体
    const g = ctx.createRadialGradient(-5, -8, 4, 0, 0, r + 6);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, e.color);
    g.addColorStop(1, this.shade(e.color, -35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2;
    ctx.stroke();
    // 手手
    ctx.fillStyle = this.shade(e.color, -12);
    const swing = e.moving ? Math.sin(e.anim * 12) * 4 : 0;
    ctx.beginPath(); ctx.arc(-r - 2 + swing * 0.4, 2 - swing, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r + 2 - swing * 0.4, 2 + swing, 5.5, 0, Math.PI * 2); ctx.fill();
    // 眼睛（看向移动方向）
    const ex = e.face.x * 3.5, ey = e.face.y * 3;
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(s * 6.5, -5, 5.5, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(s * 6.5 + ex * 0.6, -5 + ey, 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(s * 6.5 + ex * 0.6 - 1, -6.5 + ey, 1, 0, Math.PI * 2); ctx.fill();
    }
    // 腮红
    ctx.fillStyle = 'rgba(255,120,140,.55)';
    ctx.beginPath(); ctx.ellipse(-11, 3, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(11, 3, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    // 嘴
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    ctx.beginPath();
    if (e.isAI || e.name === undefined) {
      ctx.arc(0, 3, 3, Math.PI * 0.15, Math.PI * 0.85); // 敌人坏笑
    } else {
      ctx.arc(0, 3, 3.5, Math.PI * 0.15, Math.PI * 0.85);
    }
    ctx.stroke();
    } // 结束 Canvas 降级块
    ctx.restore();
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
      this.drawOutlinedText(`第 ${this.level} 关`, W * 0.15, y, 22, '#ffe066', 'left');
      this.drawOutlinedText(`敌人 x${alive}`, W * 0.30, y, 22, '#9fd6ff', 'left');
      this.drawOutlinedText(`消灭 ${p.score}`, W * 0.45, y, 22, '#b5e8a0', 'left');
      const perks = `💣 ${p.bombMax}  🔥 ${p.fire}  👟 ${Math.round((p.speed - 150) / 22)}`
        + (p.kick ? '  🥾' : '') + (p.remote ? '  ⏱' : '') + (p.shield > 0 ? `  🛡${Math.ceil(p.shield)}` : '');
      this.drawOutlinedText(perks, W - 16, y, 20, '#fff', 'right');
    } else {
      const [a, b] = this.players;
      this.drawOutlinedText(`P1  ${a.score}`, W * 0.38, HUD_H / 2, 30, '#4f8fdc');
      this.drawOutlinedText(`第 ${this.round} 回合`, W / 2, HUD_H / 2, 18, '#ffe066');
      this.drawOutlinedText(`${b.score}  P2`, W * 0.62, HUD_H / 2, 30, '#e05b5b');
      const perkA = `💣${a.bombMax} 🔥${a.fire}` + (a.kick ? ' 🥾' : '') + (a.remote ? ' ⏱' : '') + (a.shield > 0 ? ` 🛡${Math.ceil(a.shield)}` : '');
      const perkB = `💣${b.bombMax} 🔥${b.fire}` + (b.kick ? ' 🥾' : '') + (b.remote ? ' ⏱' : '') + (b.shield > 0 ? ` 🛡${Math.ceil(b.shield)}` : '');
      this.drawOutlinedText(perkA, 16, HUD_H / 2, 18, '#9fc3ff', 'left');
      this.drawOutlinedText(perkB, W - 16, HUD_H / 2, 18, '#ffb0a8', 'right');
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

  drawMenu() {
    const t = this.time;
    /* ---- 全屏深色渐变 ---- */
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const gb = ctx.createLinearGradient(0, 0, 0, cvs.height);
    gb.addColorStop(0, '#131a32'); gb.addColorStop(0.55, '#1a2342'); gb.addColorStop(1, '#0d1124');
    ctx.fillStyle = gb;
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.restore();

    /* ---- 舞台光束 ---- */
    ctx.save();
    ctx.translate(W / 2, -H * 0.25);
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(Math.sin(t * 0.15 + i * 1.7) * 0.22 + (i - 1.5) * 0.45);
      const bw = W * 0.085;
      const g2 = ctx.createLinearGradient(0, 0, 0, H * 1.5);
      g2.addColorStop(0, 'rgba(130,165,255,0.09)');
      g2.addColorStop(1, 'rgba(130,165,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.moveTo(-bw * 0.22, 0); ctx.lineTo(bw * 0.22, 0);
      ctx.lineTo(bw, H * 1.5); ctx.lineTo(-bw, H * 1.5);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* ---- 上升的柔光泡泡 ---- */
    for (let i = 0; i < 16; i++) {
      const tt = t * 0.22 + i * 2.3;
      const bx = (i * 131.7) % W;
      const by = H - ((tt * 34 + i * 173) % (H + 120));
      const r = 10 + (i % 5) * 9;
      ctx.globalAlpha = 0.05 + (i % 3) * 0.03;
      const rg = ctx.createRadialGradient(bx, by, 1, bx, by, r);
      rg.addColorStop(0, 'rgba(175,205,255,0.95)');
      rg.addColorStop(1, 'rgba(175,205,255,0)');
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* ---- LOGO ---- */
    const ly = H * 0.20;
    const float = Math.sin(t * 1.6) * 5;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // 眉题
    ctx.font = `bold ${Math.round(H * 0.024 + 8)}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = 'rgba(255,214,90,0.8)';
    ctx.fillText('B U B B L E   B L A S T', W / 2, ly - H * 0.088);
    // 主标题（辉光 + 金属渐变）
    ctx.shadowColor = 'rgba(255,215,80,0.5)';
    ctx.shadowBlur = 36;
    const lg = ctx.createLinearGradient(0, ly - H * 0.08, 0, ly + H * 0.08);
    lg.addColorStop(0, '#fff8d8'); lg.addColorStop(0.45, '#ffdf6b'); lg.addColorStop(1, '#eda43c');
    ctx.fillStyle = lg;
    ctx.font = `bold ${Math.round(H * 0.13)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText('泡 泡 堂', W / 2, ly + float);
    ctx.shadowBlur = 0;
    ctx.restore();
    // 分隔线 + 副标题
    const sy = ly + H * 0.098;
    ctx.strokeStyle = 'rgba(255,214,90,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 180, sy); ctx.lineTo(W / 2 - 95, sy);
    ctx.moveTo(W / 2 + 95, sy); ctx.lineTo(W / 2 + 180, sy);
    ctx.stroke();
    this.drawOutlinedText('Q 版 复 刻 · MODERN REMAKE', W / 2, sy, Math.max(14, H * 0.026), '#9fd6ff');

    /* ---- 吉祥物 ---- */
    const myY = H * 0.44;
    const m1 = { x: W / 2 - 120, y: myY + Math.sin(t * 2) * 6, color: '#4f8fdc', face: { x: 1, y: 0 }, anim: t, moving: true, isAI: false, name: 'P1' };
    const m2 = { x: W / 2 + 120, y: myY + Math.cos(t * 2) * 6, color: '#e05b5b', face: { x: -1, y: 0 }, anim: t, moving: true, isAI: false, name: 'P2' };
    for (const m of [m1, m2]) {
      ctx.save(); ctx.translate(m.x, m.y);
      const r = 19;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(0, r + 6, r * 0.8, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      ctx.shadowColor = m.color; ctx.shadowBlur = 22;
      const mg = ctx.createRadialGradient(-5, -7, 3, 0, 0, r + 4);
      mg.addColorStop(0, '#fff'); mg.addColorStop(0.3, m.color); mg.addColorStop(1, this.shade(m.color, -35));
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.stroke();
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(s * 6.5, -5, 6, 7.2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#222';
        ctx.beginPath(); ctx.arc(s * 6.5 + (s > 0 ? 1.6 : -1.6), -5, 2.7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s * 6.5 + (s > 0 ? 0.8 : -2.4), -7, 1.1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,120,140,.55)';
      ctx.beginPath(); ctx.ellipse(-11.5, 3.5, 3.6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11.5, 3.5, 3.6, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 3.5, 4, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      ctx.restore();
    }

    /* ---- 菜单卡片 ---- */
    const items = [
      { title: '单人闯关', en: 'CAMPAIGN', desc: '挑战 AI 敌人 · 无限关卡', color: '#4f8fdc' },
      { title: '双人对战', en: 'VERSUS 1v1', desc: '同屏对决 · 先胜三回合', color: '#e05b5b' },
    ];
    const cardW = Math.min(W * 0.42, 380);
    const cardH = Math.min(H * 0.15, 86);
    const gap = 24;
    const totalW = cardW * 2 + gap;
    const cardY = H * 0.565;
    this.menuRects = [];
    items.forEach((it, i) => {
      const selected = this.menuIndex === i || this.hoverIndex === i;
      const x = W / 2 - totalW / 2 + i * (cardW + gap);
      const y = cardY + Math.sin(t * 2 + i * 2.5) * 2.5;
      this.menuRects.push({ x, y: cardY, w: cardW, h: cardH });
      ctx.save();
      if (selected) { ctx.shadowColor = it.color; ctx.shadowBlur = 28; }
      ctx.fillStyle = selected ? 'rgba(40,52,92,0.95)' : 'rgba(22,28,54,0.72)';
      this.roundRect(x, y, cardW, cardH, 14); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = selected ? it.color : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = selected ? 2.5 : 1.5;
      this.roundRect(x, y, cardW, cardH, 14); ctx.stroke();
      // 左侧迷你角色
      ctx.save();
      ctx.translate(x + 36, y + cardH / 2);
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(0, 17, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
      const mg = ctx.createRadialGradient(-4, -5, 2, 0, 0, 18);
      mg.addColorStop(0, '#fff'); mg.addColorStop(0.3, it.color); mg.addColorStop(1, this.shade(it.color, -35));
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(-4, -2.5, 3.4, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(4, -2.5, 3.4, 4.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#222';
      ctx.beginPath(); ctx.arc(-4, -2.2, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(4, -2.2, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // 选中指示箭头
      if (selected) {
        const ax = x - 20 + Math.sin(t * 6) * 3;
        ctx.fillStyle = it.color;
        ctx.beginPath();
        ctx.moveTo(ax, y + cardH / 2 - 8); ctx.lineTo(ax + 12, y + cardH / 2); ctx.lineTo(ax, y + cardH / 2 + 8);
        ctx.closePath(); ctx.fill();
      }
      // 文案
      this.drawOutlinedText(it.title, x + 64, y + cardH * 0.32, 23, selected ? '#ffe066' : '#dfe6ff', 'left');
      this.drawOutlinedText(it.desc, x + 64, y + cardH * 0.70, 14, selected ? '#aab7e8' : '#7d86ad', 'left');
      this.drawOutlinedText(it.en, x + cardW - 14, y + cardH / 2, 12, selected ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)', 'right');
      ctx.restore();
    });

    /* ---- 键帽按键提示 ---- */
    const fy = H * 0.90;
    const segs = [
      { caps: ['↑', '↓'], label: '选择' },
      { caps: ['Enter'], label: '确认' },
      { caps: ['1'], label: '单人' },
      { caps: ['2'], label: '对战' },
      { caps: ['V'], label: '全屏' },
      { caps: ['M'], label: '音效' },
    ];
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    let total = 0;
    const widths = segs.map(s => {
      const w = s.caps.length * 30 + ctx.measureText(s.label).width + 14 + 26;
      total += w;
      return w;
    });
    let fx = W / 2 - total / 2;
    segs.forEach((s, i) => {
      let x = fx;
      for (const c of s.caps) { this.drawKeycap(x + 13, fy, c); x += 30; }
      ctx.fillStyle = 'rgba(200,208,236,0.6)';
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, x + 8, fy + 1);
      fx += widths[i];
    });

    /* ---- 页脚 ---- */
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('v1.0.0', 14, H - 14);
    ctx.textAlign = 'right';
    ctx.fillText('BubbleBlast · 纯 Canvas 打造 · 无任何依赖', W - 14, H - 14);

    /* ---- 电影感暗角 ---- */
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const vg = ctx.createRadialGradient(cvs.width / 2, cvs.height / 2, Math.min(cvs.width, cvs.height) * 0.38, cvs.width / 2, cvs.height / 2, Math.max(cvs.width, cvs.height) * 0.75);
    vg.addColorStop(0, 'rgba(5,8,20,0)');
    vg.addColorStop(1, 'rgba(5,8,20,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cvs.width, cvs.height);
    ctx.restore();
  },
};

/* ---------- 主循环 ---------- */
let last = performance.now();
let lastWinW = innerWidth, lastWinH = innerHeight;
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  // 兜底：某些环境（内嵌视口模拟）不派发 resize 事件，手动检测窗口尺寸变化
  if (innerWidth !== lastWinW || innerHeight !== lastWinH) {
    lastWinW = innerWidth; lastWinH = innerHeight;
    fitCanvas();
    Game.onResize();
  }
  Game.update(dt);
  Game.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 窗口尺寸变化 → 场地比例跟随重建（fitCanvas 内部已重算 COLS/ROWS）
window.addEventListener('resize', () => Game.onResize());
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => Game.onResize());
