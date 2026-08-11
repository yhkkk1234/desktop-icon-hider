/**
 * 自定义光标
 *
 * 独立画布层绘制替代光标（圆点/箭头/星光），配合 body.fx-cursor-hidden
 * 隐藏系统光标，仅在软件窗口内生效。由特效层每帧绘制完成后叠加
 * （见 FxManager.applyEffects 的 onFrame 钩子）。
 *
 * 绘制前先清除上一帧光标区域；独立画布保证清除操作不会误擦特效画面。
 * 画布坐标按 devicePixelRatio 缩放，避免高 DPI 屏上位置偏移/尺寸变小。
 */

class FxCursor {
  constructor({ canvas, style }) {
    this.canvas = canvas;
    this.style = style || 'dot';
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.hue = 0;
    this.lastX = null;
    this.lastY = null;
  }

  stop() {
    const ctx = this.ctx;
    if (ctx && this.lastX !== null) {
      this.setTransform();
      const m = 28;
      ctx.clearRect(this.lastX - m, this.lastY - m, m * 2, m * 2);
    }
    this.lastX = null;
    this.lastY = null;
  }

  setTransform() {
    const ctx = this.ctx;
    if (!ctx || !this.canvas) return;
    const dpr = this.canvas.width / (this.canvas.clientWidth || 1) || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  paint(x, y) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.setTransform();
    // 先清除上一帧光标区域，避免残影叠加
    const m = 28;
    if (this.lastX !== null) {
      ctx.clearRect(this.lastX - m, this.lastY - m, m * 2, m * 2);
    }
    this.lastX = x;
    this.lastY = y;
    this.hue = (this.hue + 2) % 360;
    switch (this.style) {
    case 'arrow':
      this.drawArrow(ctx, x, y);
      break;
    case 'star':
      this.drawStar(ctx, x, y);
      break;
    default:
      this.drawDot(ctx, x, y);
    }
  }

  drawDot(ctx, x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${this.hue}, 90%, 60%, 0.92)`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }

  drawArrow(ctx, x, y) {
    const s = 15;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + s * 0.9, y + s * 0.6);
    ctx.lineTo(x + s * 0.5, y + s * 0.55);
    ctx.lineTo(x + s * 0.85, y + s * 1.1);
    ctx.lineTo(x + s * 0.55, y + s * 1.2);
    ctx.lineTo(x + s * 0.2, y + s * 0.65);
    ctx.lineTo(x, y + s);
    ctx.closePath();
    ctx.fillStyle = `hsla(${this.hue}, 90%, 62%, 0.95)`;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }

  drawStar(ctx, x, y) {
    const spikes = 4;
    const outer = 10;
    const inner = 4;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + (i * Math.PI) / spikes;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fillStyle = `hsla(${this.hue}, 90%, 62%, 0.95)`;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.stroke();
  }
}

window.FxCursor = FxCursor;
