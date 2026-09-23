const fs = require('fs');
let content = fs.readFileSync('G:/code/paopaotang/game.js', 'utf8');

// Find and replace drawMenu function
const startMarker = '  drawMenu() {';
const endMarker = '  },\n};\n\n/* ---------- 主循环 ---------- */';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.log('ERROR: Could not find markers. startIndex=' + startIndex + ', endIndex=' + endIndex);
  process.exit(1);
}

const newDrawMenu = `  drawMenu() {
    const t = this.time;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* ==== 背景：动态渐变 + 漂浮光球 ==== */
    const bgImg = Assets.get('bg/menu');
    if (bgImg) {
      ctx.drawImage(bgImg, 0, 0, cvs.width, cvs.height);
    } else {
      const gb = ctx.createLinearGradient(0, 0, 0, cvs.height);
      gb.addColorStop(0, '#1a237e'); gb.addColorStop(0.4, '#283593'); gb.addColorStop(1, '#0d1540');
      ctx.fillStyle = gb;
      ctx.fillRect(0, 0, cvs.width, cvs.height);
    }

    /* 漂浮光球 */
    for (let i = 0; i < 6; i++) {
      const cx = cvs.width * (0.15 + i * 0.14) + Math.sin(t * 0.5 + i * 2) * 30;
      const cy = cvs.height * (0.3 + i * 0.08) + Math.cos(t * 0.3 + i) * 20;
      const r = Math.max(1, 30 + i * 15 + Math.sin(t * 0.8 + i * 1.5) * 10);
      const colors = ['rgba(79,143,220,0.06)', 'rgba(224,91,91,0.05)', 'rgba(255,224,102,0.04)', 'rgba(63,166,91,0.05)', 'rgba(200,63,122,0.04)', 'rgba(100,200,255,0.05)'];
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, colors[i]);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    /* ==== 装饰闪光粒子 (增强版) ==== */
    const sparkleImg = Assets.get('effects/sparkle');
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const seed = i * 137.5;
      const px = (Math.sin(t * 0.2 + seed) * 0.5 + 0.5) * cvs.width;
      const py = (Math.cos(t * 0.15 + seed * 0.7) * 0.5 + 0.5) * cvs.height;
      const sz = 2 + Math.sin(t * 1.5 + i) * 1.5;
      const alpha = 0.2 + Math.sin(t * 2 + i * 0.5) * 0.3;
      if (sparkleImg && i % 3 === 0) {
        ctx.globalAlpha = alpha;
        ctx.drawImage(sparkleImg, px - sz, py - sz, sz * 2, sz * 2);
      } else {
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = i % 2 === 0 ? '#ffe066' : '#7ea8ff';
        ctx.beginPath(); ctx.arc(px, py, Math.max(0.5, sz), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    /* ==== 右侧海报主视觉 ==== */
    if (W >= 980) {
      const posterImg = Assets.get('bg/titlePoster');
      if (posterImg) {
        const px = W * 0.72, py = H * 0.50;
        const s = Math.min(W * 0.42 / 800, H * 0.60 / 600);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-0.045 + Math.sin(t * 0.3) * 0.01);
        ctx.scale(s, s);
        /* 光晕背景 */
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = 'rgba(255,224,102,0.1)';
        ctx.beginPath(); ctx.arc(400, 300, 350, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.drawImage(posterImg, -400, -300, 800, 600);
        ctx.restore();
      } else {
        this.drawPoster(t);
      }
    }

    /* ==== 左侧区域：标题 + 菜单 ==== */
    const mx = Math.max(48, W * 0.07);
    const titleAreaH = H * 0.28;
    const listY = H * 0.36;

    /* --- 大标题区 --- */
    if (W < 980) {
      const titleImg = Assets.get('bg/titlePoster');
      if (titleImg) {
        const ts = Math.min(W * 0.55 / 800, 0.4);
        ctx.save();
        ctx.globalAlpha = 0.7 + Math.sin(t * 1.5) * 0.1;
        ctx.drawImage(titleImg, mx - 20, H * 0.04, 800 * ts, 600 * ts);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    } else {
      const titleImg = Assets.get('bg/titlePoster');
      if (titleImg) {
        const ts = 0.15;
        ctx.save();
        ctx.globalAlpha = 0.55 + Math.sin(t * 1.2) * 0.08;
        ctx.drawImage(titleImg, mx - 60, H * 0.02, 800 * ts, 600 * ts);
        ctx.globalAlpha = 1;
        ctx.restore();
      }
      /* 左侧装饰条 */
      const decImg = Assets.get('ui/star-badge');
      if (decImg) {
        ctx.drawImage(decImg, mx + 4, H * 0.08 + 24, 22, 22);
      } else {
        ctx.fillStyle = '#ffd23d';
        ctx.fillRect(mx + 4, H * 0.08 + 24, 56, 5);
      }
    }

    /* ==== 增强版菜单按钮 ==== */
    const menuItems = [
      { title: '单人闯关', desc: '挑战 AI 敌人 · 关卡无限', color: '#4f8fdc', icon: 'items/bomb' },
      { title: '双人对战', desc: '同屏 1v1 · 先胜三回合', color: '#e05b5b', icon: 'items/fire' },
      { title: '道具挑战', desc: '限定道具 · 极致操作', color: '#ffd23d', icon: 'items/shield' },
      { title: '无尽模式', desc: '越战越勇 · 冲击极限', color: '#3fa65b', icon: 'ui/star-badge' },
    ];
    const rowW = Math.min(W * 0.32, 340);
    const rowH = Math.min(H * 0.12, 82);
    const listX = mx;
    this.menuRects = [];

    menuItems.forEach((it, i) => {
      const selected = this.menuIndex === i || this.hoverIndex === i;
      const y = listY + i * rowH;
      const btnX = listX - 18;
      const btnW = rowW + 36;
      const btnH = rowH - 12;
      this.menuRects.push({ x: btnX, y, w: btnW, h: btnH });

      const isHover = this.hoverIndex === i;
      const isSelected = this.menuIndex === i;

      /* 按钮卡片背景 */
      const cardAlpha = isSelected ? 0.12 : isHover ? 0.08 : 0.04;
      ctx.fillStyle = 'rgba(0,0,0,' + cardAlpha + ')';
      this.roundRect(btnX, y, btnW, btnH, 14); ctx.fill();

      /* 选中/悬停发光边框 */
      if (isSelected || isHover) {
        const glowAlpha = isSelected ? 0.6 + Math.sin(t * 4) * 0.15 : 0.35;
        /* 外发光 */
        ctx.save();
        ctx.shadowColor = it.color;
        ctx.shadowBlur = isSelected ? 20 : 10;
        ctx.strokeStyle = it.color;
        ctx.globalAlpha = glowAlpha;
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        this.roundRect(btnX, y, btnW, btnH, 14); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.restore();

        /* 左侧色条 */
        ctx.save();
        ctx.shadowColor = it.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = it.color;
        this.roundRect(btnX + 4, y + 10, 5, btnH - 36, 2.5); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();

        /* 选中时的彩色光晕底部 */
        if (isSelected) {
          const selGrad = ctx.createLinearGradient(btnX, y + btnH - 4, btnX, y + btnH);
          selGrad.addColorStop(0, it.color);
          selGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.globalAlpha = 0.3 + Math.sin(t * 3) * 0.1;
          ctx.fillStyle = selGrad;
          ctx.fillRect(btnX + 10, y + btnH - 4, btnW - 20, 4);
          ctx.globalAlpha = 1;
        }
      }

      /* 图标背景圆 */
      const iconR = 16;
      const iconCx = btnX + 36;
      const iconCy = y + btnH / 2;
      const iconGrad = ctx.createRadialGradient(iconCx - 4, iconCy - 4, 2, iconCx, iconCy, iconR);
      iconGrad.addColorStop(0, it.color + '33');
      iconGrad.addColorStop(1, it.color + '11');
      ctx.fillStyle = iconGrad;
      ctx.beginPath(); ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = it.color;
      ctx.globalAlpha = isSelected ? 0.7 : 0.4;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(iconCx, iconCy, iconR, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;

      /* 左侧图标 (用 SVG 道具图) */
      const iconImg = Assets.get(it.icon);
      if (iconImg) {
        ctx.save();
        ctx.globalAlpha = isSelected ? 1 : 0.7;
        ctx.drawImage(iconImg, iconCx - 14, iconCy - 14, 28, 28);
        ctx.globalAlpha = 1;
        ctx.restore();
      } else {
        ctx.fillStyle = it.color;
        ctx.globalAlpha = isSelected ? 1 : 0.7;
        ctx.beginPath(); ctx.arc(iconCx, iconCy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }

      /* 文字 (用 Canvas 绘制) */
      const titleColor = isSelected ? '#ffe066' : isHover ? '#d0d8f0' : '#a0aec8';
      const descColor = isSelected ? '#fff8d0' : '#7080a8';
      this.drawOutlinedText(it.title, btnX + 68, iconCy - 6, 23, titleColor, 'left');
      this.drawOutlinedText(it.desc, btnX + 68, iconCy + 14, 13, descColor, 'left');
    });

    /* ==== 分隔装饰线 ==== */
    const sepY = listY + rowH * menuItems.length + 6;
    ctx.strokeStyle = 'rgba(255,224,102,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(listX, sepY);
    ctx.lineTo(listX + rowW + 40, sepY);
    ctx.stroke();
    /* 中间菱形装饰 */
    const dcx = listX + (rowW + 40) / 2;
    ctx.fillStyle = 'rgba(255,224,102,0.3)';
    ctx.beginPath();
    ctx.moveTo(dcx, sepY - 3);
    ctx.lineTo(dcx + 4, sepY);
    ctx.lineTo(dcx, sepY + 3);
    ctx.lineTo(dcx - 4, sepY);
    ctx.closePath();
    ctx.fill();

    /* ==== 底部信息栏 ==== */
    const ky = sepY + 24;

    /* 用 keycap SVG 做按键提示 */
    const keycapImg = Assets.get('ui/keycap');
    const segs = [
      { caps: ['↑', '↓'], label: '选择' },
      { caps: ['Enter'], label: '确认' },
      { caps: ['V'], label: '全屏' },
      { caps: ['M'], label: '音效' },
    ];
    let fx = listX;
    ctx.font = '12px "Microsoft YaHei", sans-serif';
    segs.forEach(s => {
      let x = fx;
      for (const c of s.caps) {
        if (keycapImg) {
          ctx.drawImage(keycapImg, x + 6, ky - 10, 22, 22);
        } else {
          this.drawKeycap(x + 13, ky, c);
        }
        x += 30;
      }
      ctx.fillStyle = 'rgba(200,208,236,0.5)';
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(s.label, x + 8, ky + 1);
      fx = x + 8 + ctx.measureText(s.label).width + 30;
    });

    /* 版本号 + 版权 */
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('v1.0.0', 14, H - 14);
    const copyImg = Assets.get('ui/coin');
    if (copyImg) {
      ctx.drawImage(copyImg, 60, H - 26, 16, 16);
    }

    /* ==== 电影感暗角 (增强) ==== */
    const vg = ctx.createRadialGradient(cvs.width / 2, cvs.height / 2, Math.min(cvs.width, cvs.height) * 0.35, cvs.width / 2, cvs.height / 2, Math.max(cvs.width, cvs.height) * 0.78);
    vg.addColorStop(0, 'rgba(5,8,20,0)');
    vg.addColorStop(0.6, 'rgba(5,8,20,0.2)');
    vg.addColorStop(1, 'rgba(5,8,20,0.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, cvs.width, cvs.height);

    /* ==== 顶部光带装饰 ==== */
    const topGrad = ctx.createLinearGradient(0, 0, 0, 60);
    topGrad.addColorStop(0, 'rgba(255,224,102,0.06)');
    topGrad.addColorStop(1, 'rgba(255,224,102,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, cvs.width, 60);

    ctx.restore();
  },
};

/* ---------- 主循环 ---------- */`;

const before = content.substring(0, startIndex);
const after = content.substring(endIndex);
const newContent = before + newDrawMenu + after;

fs.writeFileSync('G:/code/paopaotang/game.js', newContent);
console.log('SUCCESS: drawMenu() replaced. Lines replaced: ' + (endIndex - startIndex));
