/* ============================================================
 *  AssetLoader · SVG/PNG 素材预加载器
 *  用法：先调用 init() 预加载所有资源，再在 draw 中使用
 * ============================================================ */
'use strict';

const Assets = {
  _cache: new Map(),
  _listeners: [],

  /** 注册要加载的资源列表 */
  manifest: {
    // 道具
    items: {
      bomb:     'assets/items/bomb.svg',
      fire:     'assets/items/fire.svg',
      speed:    'assets/items/speed.svg',
      heart:    'assets/items/heart.svg',
    },
    // 效果
    effects: {
      explosion: 'assets/effects/explosion.svg',
      flame:     'assets/effects/flame.svg',
      sparkle:   'assets/effects/sparkle.svg',
      death:     'assets/effects/death.svg',
      pickup:    'assets/effects/pickup.svg',
    },
    // 背景
    bg: {
      grass:     'assets/bg/grass.svg',
      stone:     'assets/bg/stone.svg',
      softBrick: 'assets/bg/soft-brick.svg',
      menu:      'assets/bg/bg-menu.svg',
      overlay:   'assets/bg/bg-overlay.svg',
    },
    // 角色
    chars: {
      p1:      'assets/chars/player-p1.svg',
      p2:      'assets/chars/player-p2.svg',
      enemy1:  'assets/chars/enemy-1.svg',
      enemy2:  'assets/chars/enemy-2.svg',
      enemy3:  'assets/chars/enemy-3.svg',
      enemy4:  'assets/chars/enemy-4.svg',
    },
    // UI
    ui: {
      life:   'assets/ui/life.svg',
      coin:   'assets/ui/coin.svg',
      pause:  'assets/ui/btn-pause.svg',
      start:  'assets/ui/btn-start.svg',
    },
  },

  /** 预加载全部资源 */
  async init() {
    const urls = [];
    for (const [cat, items] of Object.entries(this.manifest)) {
      for (const [name, url] of Object.entries(items)) {
        urls.push({ cat, name, url });
      }
    }
    let loaded = 0;
    const total = urls.length;
    for (const { cat, name, url } of urls) {
      try {
        const img = await this._load(url);
        this._cache.set(`${cat}/${name}`, img);
        loaded++;
        console.log(`[AssetLoader] ${loaded}/${total} loaded: ${cat}/${name}`);
      } catch (e) {
        console.warn(`[AssetLoader] Failed to load: ${url}`, e);
      }
    }
    console.log(`[AssetLoader] Done. ${this._cache.size}/${total} assets ready.`);
    this._listeners.forEach(fn => fn(this._cache.size, total));
    return this._cache.size;
  },

  _load(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  },

  /** 获取已加载的图片 */
  get(catName) {
    return this._cache.get(catName) || null;
  },

  /** 绘制到 canvas */
  draw(ctx, catName, x, y, w, h) {
    const img = this.get(catName);
    if (img) {
      ctx.drawImage(img, x, y, w, h);
      return true;
    }
    return false;
  },

  /** 获取指定分类下所有资源 */
  getAll(cat) {
    const result = {};
    for (const [key, val] of this._cache) {
      if (key.startsWith(cat + '/')) {
        result[key.split('/')[1]] = val;
      }
    }
    return result;
  },

  /** 加载进度回调 */
  onProgress(fn) { this._listeners.push(fn); },

  /** 是否全部加载完成 */
  get ready() { return this._cache.size > 0; },
  get count() { return this._cache.size; },
};

/* ============================================================
 *  CanvasDraw · 用 Canvas 手绘替代 SVG 的高性能版本
 *  当 SVG 加载失败或追求性能时使用
 * ============================================================ */
const CanvasDraw = {
  /** 绘制草地格 */
  grass(ctx, x, y, t) {
    const g = ctx.createLinearGradient(x, y, x, y + t);
    g.addColorStop(0, '#7ec850');
    g.addColorStop(1, '#74bf4a');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, t, t);
    // 草丛点缀
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#5a9e3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x+t*0.2, y+t*0.1); ctx.lineTo(x+t*0.25, y+t*0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+t*0.6, y+t*0.3); ctx.lineTo(x+t*0.65, y+t*0.7); ctx.stroke();
    ctx.globalAlpha = 1;
  },

  /** 绘制石砖 */
  stone(ctx, x, y, t) {
    const r = 8;
    ctx.fillStyle = '#5a6579';
    // 圆角矩形
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.arcTo(x+t, y, x+t, y+t, r);
    ctx.arcTo(x+t, y+t, x, y+t, r);
    ctx.arcTo(x, y+t, x, y, r);
    ctx.arcTo(x, y, x+t, y, r);
    ctx.closePath(); ctx.fill();
    // 顶高光
    ctx.fillStyle = '#6d7891';
    ctx.beginPath();
    ctx.moveTo(x+r+2, y+2); ctx.arcTo(x+t-2, y+2, x+t-2, y+t/2, r-2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x+7, y+6, t-22, 8);
  },

  /** 绘制软砖 */
  softBrick(ctx, x, y, t) {
    const r = 7;
    ctx.fillStyle = '#a9713d';
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.arcTo(x+t, y, x+t, y+t, r);
    ctx.arcTo(x+t, y+t, x, y+t, r);
    ctx.arcTo(x, y+t, x, y, r);
    ctx.arcTo(x, y, x+t, y, r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c68a4e';
    ctx.beginPath();
    ctx.moveTo(x+r+2, y+2); ctx.arcTo(x+t-4, y+2, x+t-4, y+t/2, r-2);
    ctx.fill();
    // 砖纹
    ctx.strokeStyle = '#8a5a30';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x+6, y+t/2-3); ctx.lineTo(x+t-6, y+t/2-3);
    ctx.moveTo(x+t/2, y+6); ctx.lineTo(x+t/2, y+t-8);
    ctx.stroke();
  },

  /** 绘制角色（Q版） */
  char(ctx, e, time) {
    const dead = !e.alive;
    let px = e.x, py = e.y, alpha = 1, rot = 0;
    if (dead) {
      const k = 1 - e.dying / 0.8;
      alpha = 1 - k; rot = k * 6; py -= k * 20;
    }
    const blink = e.invincible > 0 && Math.floor(time * 10) % 2 === 0;
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
    // 身体渐变
    const g = ctx.createRadialGradient(-5, -8, 4, 0, 0, r + 6);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, e.color);
    g.addColorStop(1, this._shade(e.color, -35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 2; ctx.stroke();
    // 配饰绘制（差异化关键）
    this._drawAccessory(ctx, e, r);
    // 手手
    ctx.fillStyle = this._shade(e.color, -12);
    const swing = e.moving ? Math.sin(e.anim * 12) * 4 : 0;
    ctx.beginPath(); ctx.arc(-r - 2 + swing * 0.4, 2 - swing, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r + 2 - swing * 0.4, 2 + swing, 5.5, 0, Math.PI * 2); ctx.fill();
    // 眼睛
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
    if (e.isAI) {
      ctx.arc(0, 3, 3, Math.PI * 0.15, Math.PI * 0.85);
    } else {
      ctx.arc(0, 3, 3.5, Math.PI * 0.15, Math.PI * 0.85);
    }
    ctx.stroke();
    ctx.restore();
  },

  /** 绘制角色配饰（差异化） */
  _drawAccessory(ctx, e, r) {
    const c = e.color;
    // P1 帽子
    if (e.name === 'P1') {
      ctx.fillStyle = '#e05b5b';
      ctx.beginPath();
      ctx.ellipse(0, -r*0.5, r*0.9, r*0.35, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-r*0.85, -r*0.5, r*1.7, r*0.3);
    }
    // P2 围巾
    if (e.name === 'P2') {
      ctx.fillStyle = '#ffd23d';
      ctx.globalAlpha = ctx.globalAlpha * 0.8;
      ctx.beginPath();
      ctx.ellipse(0, -r*0.3, r*0.7, r*0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = ctx.globalAlpha;
    }
    // E1 尖角
    if (e.color === '#8a5cc9') {
      ctx.fillStyle = '#a87fd4';
      ctx.beginPath();
      ctx.moveTo(-r*0.5, -r*0.7); ctx.lineTo(-r*0.3, -r*1.2); ctx.lineTo(-r*0.1, -r*0.7);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r*0.5, -r*0.7); ctx.lineTo(r*0.3, -r*1.2); ctx.lineTo(r*0.1, -r*0.7);
      ctx.fill();
    }
    // E4 王冠
    if (e.color === '#c93f7a') {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      const cx = 0, cy = -r - 4;
      ctx.moveTo(cx-6, cy); ctx.lineTo(cx-4, cy-5); ctx.lineTo(cx-1, cy-2);
      ctx.lineTo(cx+1, cy-6); ctx.lineTo(cx+4, cy-2); ctx.lineTo(cx+6, cy-5);
      ctx.lineTo(cx+8, cy);
      ctx.fill();
      ctx.fillStyle = '#ff4757';
      ctx.beginPath(); ctx.arc(cx+2, cy-3, 1.5, 0, Math.PI*2); ctx.fill();
    }
  },

  /** 绘制道具图标 */
  item(ctx, it, type, px, py, t = 28) {
    const bob = Math.sin(it.anim * 3) * 3;
    const cx2 = px, cy2 = py + bob;
    const colors = { 0: '#3d4a66', 1: '#ff7043', 2: '#42c6ff' };
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.beginPath(); ctx.ellipse(cx2, cy2+16, 12, 4, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = colors[type];
    ctx.beginPath(); ctx.arc(cx2, cy2, t/2, 0, Math.PI*2); ctx.fill();
    // 高光
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.beginPath(); ctx.arc(cx2-t*0.2, cy2-t*0.2, t*0.25, 0, Math.PI*2); ctx.fill();
    // 图标绘制
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    if (type === 0) { // 炸弹
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx2, cy2+1, t*0.25, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(cx2+t*0.15, cy2-t*0.3); ctx.quadraticCurveTo(cx2+t*0.4, cy2-t*0.45, cx2+t*0.45, cy2-t*0.25); ctx.stroke();
    } else if (type === 1) { // 火焰
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(cx2, cy2-t*0.35);
      ctx.quadraticCurveTo(cx2+t*0.3, cy2-t*0.07, cx2+t*0.17, cy2+t*0.2);
      ctx.quadraticCurveTo(cx2, cy2+t*0.4, cx2-t*0.17, cy2+t*0.2);
      ctx.quadraticCurveTo(cx2-t*0.3, cy2-t*0.07, cx2, cy2-t*0.35);
      ctx.fill();
    } else { // 速度
      ctx.fillStyle = '#fff';
      const s = t*0.35;
      ctx.beginPath();
      ctx.moveTo(cx2, cy2-s); ctx.lineTo(cx2+s*0.3, cy2-s*0.1);
      ctx.lineTo(cx2+s*0.1, cy2+s*0.3); ctx.lineTo(cx2, cy2+s*0.1);
      ctx.lineTo(cx2-s*0.1, cy2+s*0.3); ctx.lineTo(cx2-s*0.3, cy2-s*0.1);
      ctx.closePath(); ctx.fill();
    }
  },

  /** 绘制爆炸效果 */
  explosion(ctx, x, y, size = 24) {
    const t = performance.now() / 1000;
    // 核心
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, '#fffbe6');
    g.addColorStop(0.4, '#ffd23d');
    g.addColorStop(1, '#ff6b3d');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI*2); ctx.fill();
    // 冲击环
    ctx.strokeStyle = '#ff6b3d'; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(x, y, size*1.5, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
  },

  /** 绘制火焰 */
  flame(ctx, x, y, dir = 'c', size = 24) {
    ctx.save();
    ctx.translate(x, y);
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, size);
    grad.addColorStop(0, '#fff8d0');
    grad.addColorStop(0.5, '#ffd23d');
    grad.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = grad;
    if (dir === 'c') {
      ctx.beginPath(); ctx.arc(0, 0, size, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath();
      const len = size, w = size*0.4;
      if (dir === 'h') {
        ctx.roundRect(-len, -w/2, len*2, w, w/2);
      } else {
        ctx.rotate(Math.PI/2);
        ctx.roundRect(-len, -w/2, len*2, w, w/2);
      }
      ctx.fill();
    }
    ctx.restore();
  },

  _shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (n >> 16) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r},${g},${b})`;
  }
};
