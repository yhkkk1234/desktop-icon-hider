/**
 * 彩虹拖尾特效
 *
 * 七彩渐变的烟花状喷尾：鼠标移动时从轨迹后方喷射一串彩色粒子，
 * 色相随生成连续滚动形成彩虹渐变，粒子向后散开并快速缩小淡出。
 */

const MAX_PARTICLES = 90;
const TRAIL_SPAWN_DIST = 4;

class FxTrail extends window.FxBase {
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
    if (d < TRAIL_SPAWN_DIST && last.x > -1e8) return;
    this.lastSpawn = { x, y };
    if (d < 1) return;
    // 喷射方向：移动方向的反方向（向后）+ 锥形散开
    const backAng = Math.atan2(dy, dx) + Math.PI;
    const count = speed > 1.5 ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const ang = backAng + (Math.random() - 0.5) * 0.95;
      this.spawn(x, y, ang, speed);
    }
  }

  spawn(x, y, ang, speed) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.hue = (this.hue + 10) % 360;
    const v = 1.0 + Math.random() * 1.6 + speed * 0.3;
    this.particles.push({
      x,
      y,
      vx: Math.cos(ang) * v,
      vy: Math.sin(ang) * v,
      size: 3 + Math.random() * 3.5,
      life: 1,
      decay: 0.03 + Math.random() * 0.02,
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
      p.vx *= 0.95;
      p.vy *= 0.95;
      this.drawParticle(ctx, p);
    }
  }

  drawParticle(ctx, p) {
    const r = Math.max(p.size * p.life, 0.4);
    // 外圈光晕
    ctx.globalAlpha = p.life * 0.3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p.hue}, 100%, 70%)`;
    ctx.fill();
    // 内圈实心
    ctx.globalAlpha = p.life;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${p.hue}, 100%, 62%)`;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  stop() {
    super.stop();
    this.particles = [];
    if (this.ctx && this.w) {
      const dpr = this.dpr || 1;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }
}

window.FxTrail = FxTrail;
