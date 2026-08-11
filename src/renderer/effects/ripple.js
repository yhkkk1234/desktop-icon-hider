/**
 * 水波涟漪特效
 *
 * 两种模式：
 * - webgl：有自定义背景图且 WebGL 可用时，以背景图作为纹理做真实 UV 折射扭曲。
 *   背景的 blur/亮度等滤镜由 CSS 合成层作用于 canvas 元素（与 bg-image 规则一致）。
 * - fallback：无背景图或 WebGL 不可用时，在顶层画布绘制扩散圆环模拟涟漪。
 *
 * 速度映射：鼠标速度越快（px/ms），涟漪振幅越大——"速度越慢涟漪越小，反之越大"。
 */

const RIPPLE_VS = [
  'attribute vec2 aPos;',
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = aPos * 0.5 + 0.5;',
  '  gl_Position = vec4(aPos, 0.0, 1.0);',
  '}'
].join('\n');

const RIPPLE_FS = [
  'precision mediump float;',
  'uniform sampler2D uTexture;',
  'uniform float uZoomX;',
  'uniform float uZoomY;',
  'uniform float uTime;',
  'uniform vec2 uWavePos[8];',
  'uniform float uWaveAge[8];',
  'uniform float uWaveAmp[8];',
  'uniform float uWaveActive[8];',
  'varying vec2 vUv;',
  'void main() {',
  '  vec2 uv = vUv;',
  '  for (int i = 0; i < 8; i++) {',
  '    if (uWaveActive[i] > 0.5) {',
  '      float age = uWaveAge[i];',
  '      if (age < 3.0) {',
  '        vec2 delta = uv - uWavePos[i];',
  '        float d = length(delta);',
  '        float amp = uWaveAmp[i] * exp(-age * 1.8);',
  '        float ph = sin(d * 65.0 - age * 10.0);',
  '        float strength = ph * amp * exp(-d * 6.5);',
  '        uv += (delta / max(d, 0.0001)) * strength * 0.036;',
  '      }',
  '    }',
  '  }',
  '  vec2 texUv = vec2(0.5 + (uv.x - 0.5) * uZoomX, 0.5 + (uv.y - 0.5) * uZoomY);',
  '  gl_FragColor = texture2D(uTexture, clamp(texUv, 0.001, 0.999));',
  '}'
].join('\n');

const MAX_WAVES = 8;

class FxRipple extends window.FxBase {
  constructor({ bgCanvas, fgCanvas, bgImage, bgLayer, bgEnabled }) {
    super();
    this.idleMs = 5000;
    this.bgCanvas = bgCanvas;
    this.fgCanvas = fgCanvas;
    this.bgImage = bgImage;
    this.bgLayer = bgLayer;
    this.bgEnabled = !!bgEnabled;

    this.mode = 'fallback';
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.texture = null;
    this.uni = {};
    this.textureReady = false;
    this.uploadedSrc = null;
    this.webglChecked = false;
    this.webglOk = false;
    this.loadListenerAdded = false;

    this.ctx2d = null;
    this.waves = [];

    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.zoomX = 1;
    this.zoomY = 1;
    // canvas 元素相对视口的位置（CSS px）：custom 模式下画布与窗口错位，
    // 波源必须换算到画布局部坐标才能与涟漪渲染位置匹配
    this.canvasRect = null;
  }

  start() {
    this.refreshMode();
    super.start();
  }

  stop() {
    super.stop();
    if (this.bgImage) this.bgImage.style.display = '';
    if (this.bgCanvas) this.bgCanvas.style.display = 'none';
  }

  onBgChanged(enabled) {
    this.bgEnabled = !!enabled;
    this.refreshMode();
  }

  onResize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.syncCanvasLayout();
    this.updateZoom();
  }

  onMove(x, y, speed, now) {
    super.onMove(x, y, speed, now);
    // 速度 → 振幅：慢速(≈0.5px/ms)约0.2，快速(≈3px/ms)约0.7，上限1.1
    const amp = Math.min(0.1 + speed * 0.2, 1.1);
    this.waves.push({ x, y, t0: now / 1000, amp });
    if (this.waves.length > MAX_WAVES) this.waves.shift();
  }

  /** 根据背景图/WebGL 可用性决定模式并切换显示 */
  refreshMode() {
    const webglOk = this.bgEnabled && this.checkWebgl();
    // 背景图尚未加载完成：注册一次性 load 监听，加载后自动升级为真涟漪
    // （否则启动瞬间判定为 fallback 后永远停留在降级效果，直到手动重新触发）
    if (webglOk && !this.isBgReady() && this.bgImage && !this.loadListenerAdded) {
      this.loadListenerAdded = true;
      this.bgImage.addEventListener('load', () => {
        this.loadListenerAdded = false;
        this.textureReady = false;
        this.uploadedSrc = null;
        this.refreshMode();
      }, { once: true });
    }
    const wantWebgl = webglOk && this.isBgReady();
    const was = this.mode;
    this.mode = wantWebgl ? 'webgl' : 'fallback';

    if (this.mode === 'webgl' && (!this.gl || !this.program)) {
      this.setupWebgl();
    }
    if (this.mode === 'fallback' && !this.ctx2d) {
      this.ctx2d = this.fgCanvas ? this.fgCanvas.getContext('2d') : null;
    }
    if (this.mode === 'webgl' && was !== 'webgl') {
      this.bgCanvas.style.display = 'block';
      if (this.bgImage) this.bgImage.style.display = 'none';
      this.syncCanvasLayout();
      this.updateZoom();
    } else if (this.mode === 'fallback' && was !== 'fallback') {
      this.bgCanvas.style.display = 'none';
      if (this.bgImage) this.bgImage.style.display = '';
    }
  }

  checkWebgl() {
    if (!this.webglChecked) {
      try {
        const gl = this.bgCanvas.getContext('webgl', { alpha: false, antialias: false })
          || this.bgCanvas.getContext('experimental-webgl', { alpha: false, antialias: false });
        this.gl = gl;
        this.webglOk = !!gl;
      } catch (e) {
        this.webglOk = false;
      }
      this.webglChecked = true;
    }
    return this.webglOk;
  }

  isBgReady() {
    return !!(this.bgImage && this.bgImage.complete && this.bgImage.naturalWidth > 0);
  }

  setupWebgl() {
    const gl = this.gl;
    if (!gl) return;
    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, RIPPLE_VS);
    const fs = compile(gl.FRAGMENT_SHADER, RIPPLE_FS);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    this.program = program;

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.uni = {
      uTexture: gl.getUniformLocation(program, 'uTexture'),
      uZoomX: gl.getUniformLocation(program, 'uZoomX'),
      uZoomY: gl.getUniformLocation(program, 'uZoomY'),
      uTime: gl.getUniformLocation(program, 'uTime'),
      uWavePos: gl.getUniformLocation(program, 'uWavePos'),
      uWaveAge: gl.getUniformLocation(program, 'uWaveAge'),
      uWaveAmp: gl.getUniformLocation(program, 'uWaveAmp'),
      uWaveActive: gl.getUniformLocation(program, 'uWaveActive')
    };

    this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadedSrc = null;
    this.textureReady = false;
  }

  uploadTexture() {
    const gl = this.gl;
    if (!gl || !this.isBgReady()) return;
    if (this.uploadedSrc === this.bgImage.src && this.textureReady) return;
    this.uploadedSrc = this.bgImage.src;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // DOM 图片行序自上而下，而纹理 v 轴向上增长，不翻转会导致壁纸上下颠倒
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.bgImage);
    this.textureReady = true;
  }

  /** cover/fill/contain/custom 模式下的纹理缩放映射：
   *  cover: max 缩放裁切填满；contain: min 缩放完整显示（留边由 clamp 填充）；
   *  fill/custom: 1:1 完整显示（custom 的布局/缩放由 syncCanvasLayout 处理） */
  updateZoom() {
    const img = this.bgImage;
    if (!img || !img.naturalWidth || !this.w || !this.h) return;
    const mode = this.bgLayer ? (this.bgLayer.dataset.mode || 'cover') : 'cover';
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (mode === 'fill' || mode === 'custom') {
      this.zoomX = 1;
      this.zoomY = 1;
      return;
    }
    const su = this.w / iw;
    const sv = this.h / ih;
    const scale = mode === 'contain' ? Math.min(su, sv) : Math.max(su, sv);
    this.zoomX = this.w / (iw * scale);
    this.zoomY = this.h / (ih * scale);
  }

  /** 同步背景画布布局与缓冲尺寸：
   *  custom 模式照抄 bg-image 的内联布局（updateBgCustomSize 算好的
   *  尺寸/位置/偏移/缩放），保证画布显示与平时完全一致；
   *  其余模式由 CSS 负责，缓冲 = 窗口尺寸 */
  syncCanvasLayout() {
    const img = this.bgImage;
    const canvas = this.bgCanvas;
    if (!img || !canvas) return;
    const mode = this.bgLayer ? (this.bgLayer.dataset.mode || 'cover') : 'cover';
    const dpr = this.dpr || 1;
    if (mode === 'custom') {
      // 复制 img 内联布局（width/height/left/top/transform）
      for (const prop of ['width', 'height', 'left', 'top', 'transform']) {
        const val = img.style.getPropertyValue(prop);
        if (val) {
          canvas.style.setProperty(prop, val);
        } else {
          canvas.style.removeProperty(prop);
        }
      }
      // 缓冲 = 元素 CSS 尺寸 × dpr（与图片同比例，完整显示无变形）
      const cw = parseFloat(img.style.width) || this.w || 1;
      const ch = parseFloat(img.style.height) || this.h || 1;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    } else {
      // 恢复 CSS 默认布局（cover 的 120% 放大由 CSS 规则处理）
      for (const prop of ['width', 'height', 'left', 'top', 'transform']) {
        canvas.style.removeProperty(prop);
      }
      canvas.width = Math.round((this.w || 1) * dpr);
      canvas.height = Math.round((this.h || 1) * dpr);
    }
    if (this.gl) this.gl.viewport(0, 0, canvas.width, canvas.height);
    // 布局可能刚被修改，getBoundingClientRect 会强制重排并返回最新位置
    this.canvasRect = canvas.getBoundingClientRect();
  }

  frame() {
    if (this.mode === 'webgl') {
      this.frameWebgl();
    } else {
      this.frameFallback();
    }
  }

  frameWebgl() {
    const gl = this.gl;
    if (!gl || !this.program) return;
    // 纹理未就绪：直接尝试上传（背景图加载完成由 refreshMode 的 load 监听自动升级模式）
    if (!this.textureReady) {
      if (this.isBgReady()) this.uploadTexture();
      return;
    }

    const now = performance.now() / 1000;
    const pos = new Float32Array(MAX_WAVES * 2);
    const age = new Float32Array(MAX_WAVES);
    const amp = new Float32Array(MAX_WAVES);
    const active = new Float32Array(MAX_WAVES);
    // 波源换算到画布局部坐标（画布与窗口可能错位，如 custom 模式的偏移布局）
    const rect = this.canvasRect;
    const cw = rect ? rect.width : this.w;
    const ch = rect ? rect.height : this.h;
    const ox = rect ? rect.left : 0;
    const oy = rect ? rect.top : 0;
    let kept = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const wv = this.waves[i];
      const a = now - wv.t0;
      if (a >= 3) continue;
      // shader 中 uv.y 向上增长（vUv.y=1 为画布顶部），CSS 鼠标坐标向下增长，需翻转
      pos[kept * 2] = (wv.x - ox) / Math.max(cw, 1);
      pos[kept * 2 + 1] = 1 - (wv.y - oy) / Math.max(ch, 1);
      age[kept] = a;
      amp[kept] = wv.amp;
      active[kept] = 1;
      kept++;
      if (kept >= MAX_WAVES) break;
    }
    this.waves = this.waves.filter((wv) => now - wv.t0 < 3);

    gl.useProgram(this.program);
    gl.uniform1i(this.uni.uTexture, 0);
    gl.uniform1f(this.uni.uZoomX, this.zoomX);
    gl.uniform1f(this.uni.uZoomY, this.zoomY);
    gl.uniform1f(this.uni.uTime, now);
    gl.uniform2fv(this.uni.uWavePos, pos);
    gl.uniform1fv(this.uni.uWaveAge, age);
    gl.uniform1fv(this.uni.uWaveAmp, amp);
    gl.uniform1fv(this.uni.uWaveActive, active);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  frameFallback() {
    const ctx = this.ctx2d;
    if (!ctx || !this.w) return;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    const now = performance.now() / 1000;
    this.waves = this.waves.filter((wv) => now - wv.t0 < 2);
    for (const wv of this.waves) {
      const age = now - wv.t0;
      const r = 10 + age * 95;
      const alpha = Math.max(wv.amp * 0.5 * (1 - age / 2), 0);
      if (alpha <= 0) continue;
      ctx.beginPath();
      ctx.arc(wv.x, wv.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(wv.x, wv.y, r * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180, 225, 255, ${alpha * 0.6})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

window.FxRipple = FxRipple;
