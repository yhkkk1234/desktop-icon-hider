/**
 * 卡通星星特效
 *
 * 鼠标移动时沿轨迹从鼠标后方以弧线喷洒出一簇星星（四角/五角混合），
 * 每颗带初始喷射速度，旋转、绽放后淡出。纯 canvas2D 实现。
 */

const MAX_STARS = 70;
const STAR_SPAWN_DIST = 15;

class FxStars extends window.FxBase {
  constructor({ fgCanvas }) {
    super();
    this.idleMs = 5000;
    this.canvas = fgCanvas;
    this.ctx = fgCanvas ? fgCanvas.getContext('2d') : null;
    this.particles = [];
    this.lastSpawn = { x: -1e9, y: -1e9 };
    this.hue = 0;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
  }

  onResize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
  }

  onMove(x, y, speed, now) {
    super.onMove(x, y, speed, now);
    const last = this.lastSpawn;
    const dx = x - last.x;
    const dy = y - last.y;
    const d = Math.hypot(dx, dy);
    if (d < STAR_SPAWN_DIST && last.x > -1e8) return;
    this.lastSpawn = { x, y };
    if (d < 1) return;
    // 喷射方向：鼠标移动方向的反方向（向后）+ 弧线散开
    const backAng = Math.atan2(dy, dx) + Math.PI;
    const count = 1 + (Math.random() < 0.35 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const ang = backAng + (Math.random() - 0.5) * 1.0;
      this.spawn(x, y, ang, speed);
    }
  }

  spawn(x, y, ang, speed) {
    if (this.particles.length >= MAX_STARS) this.particles.shift();
    this.hue = (this.hue + 30 + Math.random() * 30) % 360;
    const v = 0.5 + Math.random() * 1.1 + speed * 0.25;
    this.particles.push({
      x,
      y,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      spikes: Math.random() < 0.4 ? 4 : 5, // 四角星/五角星混合
      size: 3.5 + Math.random() * 10,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.16,
      life: 1,
      decay: 1.5 / 60 + Math.random() * 0.012,
      hue: this.hue
    });
  }

  frame() {
    const ctx = this.ctx;
    if (!ctx || !this.w) return;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.rot += p.rotSpeed;
      this.drawStar(ctx, p);
    }
  }

  drawStar(ctx, p) {
    const spikes = p.spikes;
    const outer = p.size;
    const inner = p.size * 0.45;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = p.rot + (i * Math.PI) / spikes;
      const px = p.x + Math.cos(a) * r;
      const py = p.y + Math.sin(a) * r;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${p.life})`;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `hsla(${p.hue}, 100%, 88%, ${p.life * 0.8})`;
    ctx.stroke();
  }
}

window.FxStars = FxStars;
