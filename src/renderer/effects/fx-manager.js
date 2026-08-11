/**
 * 鼠标特效统一管理器
 *
 * - 惰性初始化：关闭时无 canvas 上下文、无事件监听、无动画循环，零性能开销
 * - 速度采样：平滑计算鼠标速度（px/ms），供"速度越快涟漪越大"的水波特效使用
 * - 静止暂停：鼠标静止 5 秒后动画循环自动停止（保留最后一帧），移动时恢复
 * - WebGL 自检：上下文创建失败时水波特效自动降级为假涟漪（扩散圆环）
 */
class FxManager {
  constructor() {
    this.enabled = false;
    this.type = 'stars';
    this.customCursor = 'none';
    this.bgEnabled = false;

    this.fgCanvas = document.getElementById('fx-fg-canvas');
    this.cursorCanvas = document.getElementById('fx-cursor-canvas');
    this.bgCanvas = document.getElementById('fx-bg-canvas');
    this.bgLayer = document.getElementById('bg-layer');
    this.bgImage = document.getElementById('bg-image');

    this.effect = null;
    this.cursorFx = null;

    this.lastPointer = null;
    this.speed = 0;

    this.pointerBound = false;
    this.resizeTimer = null;
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener('resize', this.onWindowResize);
  }

  /**
   * 应用设置：enabled / type(ripple|stars|trail) / customCursor(none|dot|arrow|star)
   */
  apply(settings) {
    this.enabled = !!settings.enabled;
    this.type = settings.type || 'stars';
    this.customCursor = settings.customCursor || 'none';
    this.applyEffects();
  }

  /** 背景图启用状态变化（水波真扭曲依赖背景图纹理） */
  setBgStatus(enabled) {
    this.bgEnabled = !!enabled;
    if (this.effect && this.effect.onBgChanged) {
      this.effect.onBgChanged(this.bgEnabled);
    }
  }

  /** 背景布局变化（custom 模式拖动偏移/缩放滑块）后同步特效画布 */
  syncBgLayout() {
    if (this.effect && this.effect.syncCanvasLayout) {
      this.effect.syncCanvasLayout();
    }
  }

  applyEffects() {
    this.teardown();
    document.body.classList.toggle('fx-cursor-hidden', this.enabled && this.customCursor !== 'none');
    if (!this.enabled) {
      if (this.fgCanvas) this.fgCanvas.style.display = 'none';
      if (this.cursorCanvas) this.cursorCanvas.style.display = 'none';
      return;
    }
    if (this.fgCanvas) this.fgCanvas.style.display = 'block';
    this.bindPointer();

    if (this.customCursor !== 'none') {
      this.cursorFx = new window.FxCursor({ canvas: this.cursorCanvas, style: this.customCursor });
      if (this.cursorCanvas) this.cursorCanvas.style.display = 'block';
    }

    const opts = {
      bgCanvas: this.bgCanvas,
      fgCanvas: this.fgCanvas,
      bgImage: this.bgImage,
      bgLayer: this.bgLayer,
      bgEnabled: this.bgEnabled
    };
    switch (this.type) {
    case 'ripple':
      this.effect = new window.FxRipple(opts);
      break;
    case 'trail':
      this.effect = new window.FxTrail(opts);
      break;
    default:
      this.effect = new window.FxStars(opts);
    }
    // 特效每帧绘制完成后叠加自定义光标（光标始终处于最上层）
    const cursorFx = this.cursorFx;
    this.effect.onFrame = () => {
      if (cursorFx && this.lastPointer) {
        cursorFx.paint(this.lastPointer.x, this.lastPointer.y);
      }
    };
    this.effect.start();
    this.resize();
  }

  teardown() {
    if (this.effect) {
      this.effect.stop();
      this.effect = null;
    }
    if (this.cursorFx) {
      this.cursorFx.stop();
      this.cursorFx = null;
    }
    this.unbindPointer();
    this.speed = 0;
    this.lastPointer = null;
    if (this.bgCanvas) this.bgCanvas.style.display = 'none';
    if (this.bgImage) this.bgImage.style.display = '';
    if (this.cursorCanvas) this.cursorCanvas.style.display = 'none';
  }

  bindPointer() {
    if (!this.pointerBound) {
      window.addEventListener('pointermove', this.onPointerMove, { passive: true });
      this.pointerBound = true;
    }
  }

  unbindPointer() {
    if (this.pointerBound) {
      window.removeEventListener('pointermove', this.onPointerMove);
      this.pointerBound = false;
    }
  }

  onPointerMove(e) {
    const now = performance.now();
    const x = e.clientX;
    const y = e.clientY;
    if (this.lastPointer) {
      const dt = now - this.lastPointer.t;
      if (dt > 0) {
        const dist = Math.hypot(x - this.lastPointer.x, y - this.lastPointer.y);
        const instant = dist / dt;
        this.speed = this.speed * 0.6 + instant * 0.4;
      }
    }
    this.lastPointer = { x, y, t: now };
    if (this.effect) this.effect.onMove(x, y, this.speed, now);
  }

  onWindowResize() {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.resize(), 150);
  }

  resize() {
    if (!this.fgCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = this.fgCanvas.clientWidth || window.innerWidth;
    const h = this.fgCanvas.clientHeight || window.innerHeight;
    this.fgCanvas.width = Math.round(w * dpr);
    this.fgCanvas.height = Math.round(h * dpr);
    if (this.cursorCanvas) {
      this.cursorCanvas.width = Math.round(w * dpr);
      this.cursorCanvas.height = Math.round(h * dpr);
    }
    if (this.effect && this.effect.onResize) {
      this.effect.onResize(w, h, dpr);
    }
  }
}

/**
 * 特效模块公共基类
 * - rAF 动画循环管理（start/stop/tick）
 * - 静止自动暂停：超过 idleMs 未收到鼠标移动则停止循环，移动时自动恢复
 * - onFrame 回调：每帧绘制完成后调用（供管理器叠加自定义光标）
 */
class FxBase {
  constructor() {
    this.running = false;
    this.raf = null;
    this.lastMoveAt = 0;
    this.idleMs = 5000;
    this.onFrame = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastMoveAt = performance.now();
    this.tick();
  }

  stop() {
    this.running = false;
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  tick() {
    if (!this.running) return;
    if (performance.now() - this.lastMoveAt > this.idleMs) {
      this.stop();
      return;
    }
    this.frame();
    if (this.onFrame) this.onFrame();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  onMove(x, y, speed, now) {
    this.lastMoveAt = now;
    if (!this.running) this.start();
  }

  frame() {}

  onResize() {}

  onBgChanged() {}
}

window.FxManager = FxManager;
window.FxBase = FxBase;
window.fxManager = new FxManager();
