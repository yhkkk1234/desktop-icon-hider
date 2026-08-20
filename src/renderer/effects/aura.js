/**
 * 极光流体特效（Aura Fluid，原 AuraCursor — Originkit 移植）
 *
 * 在专用顶层画布上运行经典的 WebGL 2D 流体求解器（Navier-Stokes）：
 * 鼠标移动向速度场注入动量、向染料场注入极光色，鼠标点击迸发一次溅射；
 * 染料随速度场对流并消散，产生跟随光标的流动光带（aura）。
 *
 * 移植说明（相对原 React 组件）：
 * - 移除 React/JSX/标签/悬停区概念：特效满窗口生效，画布为应用自己的独立层
 * - 指针输入由 FxManager 的 onMove 驱动，点击溅射自持 pointerdown 监听
 * - 静止 5 秒由 FxBase 自动暂停（保留最后一帧），移动自动恢复
 * - WebGL2 优先，WebGL1 回退（半浮点纹理格式逐级降级），无 WebGL 时静默停用；
 *   上下文丢失/恢复自动重建求解器（与原生一致）
 *
 * 默认参数与原组件保持一致（densityDissipation=7、curl=3、splatRadius=4、
 * splatForce=6、SIM=128、DYE=1440、压力迭代 20 次）。
 */

const DEFAULTS = {
  backdrop: 'dark', // 染料亮度基调: dark=0.5 / light=0.85
  densityDissipation: 7,
  curl: 3,
  splatRadius: 4,
  splatForce: 6
};

const SHADING = true;
// 调色板循环速度（每秒经过的色相数），连续推进使相邻两次溅射颜色相邻而不跳变
const COLOR_SPEED = 0.125;
const VELOCITY_DISSIPATION = 2;
const PRESSURE = 1 / 20;
const SIM_RESOLUTION = 128;
const DYE_RESOLUTION = 1440;
const PRESSURE_ITERATIONS = 20;

const DEFAULT_PALETTE = ['#A855F7', '#EC4899', '#3B82F6'];

const BASE_VERTEX_SHADER = [
  'precision highp float;',
  'attribute vec2 aPosition;',
  'varying vec2 vUv;',
  'varying vec2 vL;',
  'varying vec2 vR;',
  'varying vec2 vT;',
  'varying vec2 vB;',
  'uniform vec2 texelSize;',
  '',
  'void main () {',
  '  vUv = aPosition * 0.5 + 0.5;',
  '  vL = vUv - vec2(texelSize.x, 0.0);',
  '  vR = vUv + vec2(texelSize.x, 0.0);',
  '  vT = vUv + vec2(0.0, texelSize.y);',
  '  vB = vUv - vec2(0.0, texelSize.y);',
  '  gl_Position = vec4(aPosition, 0.0, 1.0);',
  '}'
].join('\n');

const COPY_SHADER = [
  'precision mediump float;',
  'precision mediump sampler2D;',
  'varying highp vec2 vUv;',
  'uniform sampler2D uTexture;',
  '',
  'void main () {',
  '  gl_FragColor = texture2D(uTexture, vUv);',
  '}'
].join('\n');

const CLEAR_SHADER = [
  'precision mediump float;',
  'precision mediump sampler2D;',
  'varying highp vec2 vUv;',
  'uniform sampler2D uTexture;',
  'uniform float value;',
  '',
  'void main () {',
  '  gl_FragColor = value * texture2D(uTexture, vUv);',
  '}'
].join('\n');

const DISPLAY_SHADER = [
  'precision highp float;',
  'precision highp sampler2D;',
  'varying vec2 vUv;',
  'varying vec2 vL;',
  'varying vec2 vR;',
  'varying vec2 vT;',
  'varying vec2 vB;',
  'uniform sampler2D uTexture;',
  'uniform vec2 texelSize;',
  '',
  'void main () {',
  '  vec3 c = texture2D(uTexture, vUv).rgb;',
  '  #ifdef SHADING',
  '    vec3 lc = texture2D(uTexture, vL).rgb;',
  '    vec3 rc = texture2D(uTexture, vR).rgb;',
  '    vec3 tc = texture2D(uTexture, vT).rgb;',
  '    vec3 bc = texture2D(uTexture, vB).rgb;',
  '',
  '    float dx = length(rc) - length(lc);',
  '    float dy = length(tc) - length(bc);',
  '',
  '    vec3 n = normalize(vec3(dx, dy, length(texelSize)));',
  '    vec3 l = vec3(0.0, 0.0, 1.0);',
  '',
  '    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);',
  '    c *= diffuse;',
  '  #endif',
  '',
  '  float a = max(c.r, max(c.g, c.b));',
  '  gl_FragColor = vec4(c, a);',
  '}'
].join('\n');

const SPLAT_SHADER = [
  'precision highp float;',
  'precision highp sampler2D;',
  'varying vec2 vUv;',
  'uniform sampler2D uTarget;',
  'uniform float aspectRatio;',
  'uniform vec3 color;',
  'uniform vec2 point;',
  'uniform float radius;',
  '',
  'void main () {',
  '  vec2 p = vUv - point.xy;',
  '  p.x *= aspectRatio;',
  '  vec3 splat = exp(-dot(p, p) / radius) * color;',
  '  vec3 base = texture2D(uTarget, vUv).xyz;',
  '  gl_FragColor = vec4(base + splat, 1.0);',
  '}'
].join('\n');

const ADVECTION_SHADER = [
  'precision highp float;',
  'precision highp sampler2D;',
  'varying vec2 vUv;',
  'uniform sampler2D uVelocity;',
  'uniform sampler2D uSource;',
  'uniform vec2 texelSize;',
  'uniform vec2 dyeTexelSize;',
  'uniform float dt;',
  'uniform float dissipation;',
  '',
  'vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {',
  '  vec2 st = uv / tsize - 0.5;',
  '  vec2 iuv = floor(st);',
  '  vec2 fuv = fract(st);',
  '',
  '  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);',
  '  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);',
  '  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);',
  '  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);',
  '',
  '  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);',
  '}',
  '',
  'void main () {',
  '  #ifdef MANUAL_FILTERING',
  '    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
  '    vec4 result = bilerp(uSource, coord, dyeTexelSize);',
  '  #else',
  '    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;',
  '    vec4 result = texture2D(uSource, coord);',
  '  #endif',
  '  float decay = 1.0 + dissipation * dt;',
  '  gl_FragColor = result / decay;',
  '}'
].join('\n');

const DIVERGENCE_SHADER = [
  'precision mediump float;',
  'precision mediump sampler2D;',
  'varying highp vec2 vUv;',
  'varying highp vec2 vL;',
  'varying highp vec2 vR;',
  'varying highp vec2 vT;',
  'varying highp vec2 vB;',
  'uniform sampler2D uVelocity;',
  '',
  'void main () {',
  '  float L = texture2D(uVelocity, vL).x;',
  '  float R = texture2D(uVelocity, vR).x;',
  '  float T = texture2D(uVelocity, vT).y;',
  '  float B = texture2D(uVelocity, vB).y;',
  '',
  '  vec2 C = texture2D(uVelocity, vUv).xy;',
  '  if (vL.x < 0.0) { L = -C.x; }',
  '  if (vR.x > 1.0) { R = -C.x; }',
  '  if (vT.y > 1.0) { T = -C.y; }',
  '  if (vB.y < 0.0) { B = -C.y; }',
  '',
  '  float div = 0.5 * (R - L + T - B);',
  '  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);',
  '}'
].join('\n');

const CURL_SHADER = [
  'precision mediump float;',
  'precision mediump sampler2D;',
  'varying highp vec2 vUv;',
  'varying highp vec2 vL;',
  'varying highp vec2 vR;',
  'varying highp vec2 vT;',
  'varying highp vec2 vB;',
  'uniform sampler2D uVelocity;',
  '',
  'void main () {',
  '  float L = texture2D(uVelocity, vL).y;',
  '  float R = texture2D(uVelocity, vR).y;',
  '  float T = texture2D(uVelocity, vT).x;',
  '  float B = texture2D(uVelocity, vB).x;',
  '  float vorticity = R - L - T + B;',
  '  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);',
  '}'
].join('\n');

const VORTICITY_SHADER = [
  'precision highp float;',
  'precision highp sampler2D;',
  'varying vec2 vUv;',
  'varying vec2 vL;',
  'varying vec2 vR;',
  'varying vec2 vT;',
  'varying vec2 vB;',
  'uniform sampler2D uVelocity;',
  'uniform sampler2D uCurl;',
  'uniform float curl;',
  'uniform float dt;',
  '',
  'void main () {',
  '  float L = texture2D(uCurl, vL).x;',
  '  float R = texture2D(uCurl, vR).x;',
  '  float T = texture2D(uCurl, vT).x;',
  '  float B = texture2D(uCurl, vB).x;',
  '  float C = texture2D(uCurl, vUv).x;',
  '',
  '  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
  '  force /= length(force) + 0.0001;',
  '  force *= curl * C;',
  '  force.y *= -1.0;',
  '',
  '  vec2 velocity = texture2D(uVelocity, vUv).xy;',
  '  velocity += force * dt;',
  '  velocity = min(max(velocity, -1000.0), 1000.0);',
  '  gl_FragColor = vec4(velocity, 0.0, 1.0);',
  '}'
].join('\n');

const PRESSURE_SHADER = [
  'precision mediump float;',
  'precision mediump sampler2D;',
  'varying highp vec2 vUv;',
  'varying highp vec2 vL;',
  'varying highp vec2 vR;',
  'varying highp vec2 vT;',
  'varying highp vec2 vB;',
  'uniform sampler2D uPressure;',
  'uniform sampler2D uDivergence;',
  '',
  'void main () {',
  '  float L = texture2D(uPressure, vL).x;',
  '  float R = texture2D(uPressure, vR).x;',
  '  float T = texture2D(uPressure, vT).x;',
  '  float B = texture2D(uPressure, vB).x;',
  '  float divergence = texture2D(uDivergence, vUv).x;',
  '  float pressure = (L + R + B + T - divergence) * 0.25;',
  '  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);',
  '}'
].join('\n');

const GRADIENT_SUBTRACT_SHADER = [
  'precision mediump float;',
  'precision mediump sampler2D;',
  'varying highp vec2 vUv;',
  'varying highp vec2 vL;',
  'varying highp vec2 vR;',
  'varying highp vec2 vT;',
  'varying highp vec2 vB;',
  'uniform sampler2D uPressure;',
  'uniform sampler2D uVelocity;',
  '',
  'void main () {',
  '  float L = texture2D(uPressure, vL).x;',
  '  float R = texture2D(uPressure, vR).x;',
  '  float T = texture2D(uPressure, vT).x;',
  '  float B = texture2D(uPressure, vB).x;',
  '  vec2 velocity = texture2D(uVelocity, vUv).xy;',
  '  velocity.xy -= vec2(R - L, T - B);',
  '  gl_FragColor = vec4(velocity, 0.0, 1.0);',
  '}'
].join('\n');

/** 颜色解析：支持 #hex/#rgba，按 multiplier 缩放（染料亮度基调） */
function parseColor(input, multiplier) {
  const black = { r: 0, g: 0, b: 0 };
  if (typeof input !== 'string' || !input) return black;
  const str = input.trim();

  const rgb = str.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) {
    return {
      r: (parseFloat(rgb[1]) / 255) * multiplier,
      g: (parseFloat(rgb[2]) / 255) * multiplier,
      b: (parseFloat(rgb[3]) / 255) * multiplier
    };
  }

  let val = str.replace('#', '');
  if (val.length === 3 || val.length === 4) {
    val = val
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(val.slice(0, 6), 16);
  if (!Number.isFinite(n)) return black;
  return {
    r: (((n >> 16) & 255) / 255) * multiplier,
    g: (((n >> 8) & 255) / 255) * multiplier,
    b: ((n & 255) / 255) * multiplier
  };
}

class FxAura extends window.FxBase {
  /**
   * @param {Object} opts
   * @param {HTMLCanvasElement} opts.canvas 专用顶层画布（#fx-aura-canvas）
   * @param {Object} [opts.config] 可选参数覆盖（backdrop/paletteColors/densityDissipation/...）
   */
  constructor({ canvas, config }) {
    super();
    this.idleMs = 5000;
    this.canvas = canvas || null;
    this.config = config || {};
    const c = this.config;

    // 求解器实时参数（本次移植固定为默认值，保留 live 结构便于后续接设置项）
    this.live = {
      paletteColors: Array.isArray(c.paletteColors) && c.paletteColors.length
        ? c.paletteColors
        : DEFAULT_PALETTE,
      backdrop: c.backdrop || DEFAULTS.backdrop,
      densityDissipation: (c.densityDissipation || DEFAULTS.densityDissipation) * 0.5,
      curl: c.curl || DEFAULTS.curl,
      splatRadius: (c.splatRadius || DEFAULTS.splatRadius) / 20,
      splatForce: (c.splatForce || DEFAULTS.splatForce) * 1000
    };

    // GL 资源（initGL 中创建，dispose 中释放）
    this.gl = null;
    this.glAttempted = false;
    this.isWebGL2 = true;
    this.halfFloat = null;
    this.supportLinearFiltering = null;
    this.halfFloatTexType = null;
    this.formatRGBA = null;
    this.formatRG = null;
    this.formatR = null;
    this.programs = {};
    this.displayMaterial = null;
    this.quadBuffer = null;
    this.quadIndices = null;
    this.dye = null;
    this.velocity = null;
    this.divergence = null;
    this.curlFBO = null;
    this.pressureFBO = null;

    this.colorPhase = Math.random();
    this.firstMove = true;
    this.needsResize = true;
    this.lastUpdateTime = performance.now();

    this.pointer = {
      texcoordX: 0,
      texcoordY: 0,
      prevTexcoordX: 0,
      prevTexcoordY: 0,
      deltaX: 0,
      deltaY: 0,
      moved: false,
      color: { r: 0, g: 0, b: 0 },
      clientX: 0,
      clientY: 0
    };

    // 点击溅射监听：自持、passive、不拦截页面
    this.onDown = (e) => {
      if (!this.gl || !this.canvas || e.button !== 0) return;
      const tc = this.texcoords(e.clientX, e.clientY);
      this.pointer.clientX = e.clientX;
      this.pointer.clientY = e.clientY;
      this.pointer.texcoordX = tc.x;
      this.pointer.texcoordY = tc.y;
      this.pointer.prevTexcoordX = this.pointer.texcoordX;
      this.pointer.prevTexcoordY = this.pointer.texcoordY;
      this.pointer.deltaX = 0;
      this.pointer.deltaY = 0;
      this.pointer.moved = false;
      this.pointer.color = this.paletteAt(this.colorPhase);
      this.clickSplat();
    };
    window.addEventListener('pointerdown', this.onDown, { passive: true });

    // 上下文丢失/恢复监听在构造时绑定：即使求解器初始化中途退出
    // （无 WebGL / 半浮点不可用 / 初始化时已丢失），恢复事件也能触达
    this._onContextLost = (e) => e.preventDefault();
    this._onContextRestored = () => {
      this.teardownGL();
      this.glAttempted = false;
      this.initGL();
      if (this.gl && !this.running) {
        this.lastUpdateTime = performance.now();
        super.start();
      }
    };
    if (canvas) {
      canvas.addEventListener('webglcontextlost', this._onContextLost);
      canvas.addEventListener('webglcontextrestored', this._onContextRestored);
    }
  }

  /** 管理器启动特效：显示画布、按需初始化 GL、开始动画循环 */
  start() {
    if (this.canvas) this.canvas.style.display = 'block';
    if (!this.gl) {
      if (!this.glAttempted) {
        this.glAttempted = true;
        this.initGL();
      }
      if (!this.gl) return; // 无 WebGL：静默停用（保留空画布）
    }
    super.start();
  }

  /** 静止暂停（FxBase 触发）与特效结束共用入口；dispose 负责完整清理 */
  stop() {
    super.stop();
  }

  /** 完整释放：停止循环、移除监听、释放 GL 资源、隐藏画布（管理器 teardown 调用） */
  dispose() {
    this.stop();
    window.removeEventListener('pointerdown', this.onDown);
    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      this.canvas.style.display = 'none';
    }
    this.teardownGL();
  }

  /** 构建 WebGL 求解器（上下文丢失后由 restore 事件重建） */
  initGL() {
    const canvas = this.canvas;
    if (!canvas) return;

    const params = {
      alpha: true,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false
    };
    let isWebGL2 = true;
    let gl = canvas.getContext('webgl2', params);
    if (!gl) {
      isWebGL2 = false;
      gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    }
    if (!gl) return; // 无 WebGL 可用：不渲染
    const g = gl;

    // 上下文已丢失（通常因组件历史上曾被挂载过）：先请求恢复，等待 restore 事件重建
    if (g.isContextLost()) {
      if (g.getExtension && g.getExtension('WEBGL_lose_context')) {
        g.getExtension('WEBGL_lose_context').restoreContext();
      }
      return;
    }

    let halfFloat = null;
    let supportLinearFiltering = null;
    if (isWebGL2) {
      g.getExtension('EXT_color_buffer_float');
      supportLinearFiltering = g.getExtension('OES_texture_float_linear');
    } else {
      halfFloat = g.getExtension('OES_texture_half_float');
      supportLinearFiltering = g.getExtension('OES_texture_half_float_linear');
    }
    g.clearColor(0, 0, 0, 1);
    const halfFloatTexType = isWebGL2
      ? g.HALF_FLOAT
      : (halfFloat && halfFloat.HALF_FLOAT_OES);

    const supportRenderTextureFormat = (internalFormat, format, type) => {
      const texture = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, texture);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
      const fbo = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
      const ok = g.checkFramebufferStatus(g.FRAMEBUFFER) === g.FRAMEBUFFER_COMPLETE;
      g.deleteFramebuffer(fbo);
      g.deleteTexture(texture);
      return ok;
    };

    const getSupportedFormat = (internalFormat, format, type) => {
      if (!supportRenderTextureFormat(internalFormat, format, type)) {
        switch (internalFormat) {
        case g.R16F:
          return getSupportedFormat(g.RG16F, g.RG, type);
        case g.RG16F:
          return getSupportedFormat(g.RGBA16F, g.RGBA, type);
        default:
          return null;
        }
      }
      return { internalFormat, format };
    };

    // 弱 GPU 无线性过滤时：染料纹理封顶 256 且关闭光照着色，均通过读取函数
    // 限制，避免后续配置把硬件不支持的回调回去
    const effectiveDyeRes = () => (supportLinearFiltering
      ? DYE_RESOLUTION
      : Math.min(DYE_RESOLUTION, 256));
    const effectiveShading = () => (supportLinearFiltering ? SHADING : false);

    const formatRGBA = isWebGL2
      ? getSupportedFormat(g.RGBA16F, g.RGBA, halfFloatTexType)
      : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
    const formatRG = isWebGL2
      ? getSupportedFormat(g.RG16F, g.RG, halfFloatTexType)
      : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
    const formatR = isWebGL2
      ? getSupportedFormat(g.R16F, g.RED, halfFloatTexType)
      : getSupportedFormat(g.RGBA, g.RGBA, halfFloatTexType);
    if (!formatRGBA || !formatRG || !formatR) {
      // 半浮点渲染不可用：放弃（无法支撑求解器）
      return;
    }

    const hashCode = (s) => {
      let hash = 0;
      for (let i = 0; i < s.length; i++) {
        hash = (hash << 5) - hash + s.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    };

    const compileShader = (type, source, keywords) => {
      const withDefines = keywords
        ? keywords.map((k) => `#define ${k}\n`).join('') + source
        : source;
      const shader = g.createShader(type);
      g.shaderSource(shader, withDefines);
      g.compileShader(shader);
      if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) {
        console.warn('Aura 特效着色器:', g.getShaderInfoLog(shader));
      }
      return shader;
    };

    const createProgram = (vs, fs) => {
      const program = g.createProgram();
      g.attachShader(program, vs);
      g.attachShader(program, fs);
      g.linkProgram(program);
      if (!g.getProgramParameter(program, g.LINK_STATUS)) {
        console.warn('Aura 特效链接:', g.getProgramInfoLog(program));
      }
      return program;
    };

    const getUniforms = (program) => {
      const uniforms = {};
      const count = g.getProgramParameter(program, g.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const name = g.getActiveUniform(program, i).name;
        uniforms[name] = g.getUniformLocation(program, name);
      }
      return uniforms;
    };

    const baseVertexShader = compileShader(g.VERTEX_SHADER, BASE_VERTEX_SHADER);
    const makeProgram = (fs) => new Program(baseVertexShader, fs);

    class Program {
      constructor(vs, fs) {
        this.program = createProgram(vs, fs);
        this.uniforms = getUniforms(this.program);
      }
      bind() {
        g.useProgram(this.program);
      }
    }

    /** 同一份 fragment 源码按关键字集编译多个变体 */
    class Material {
      constructor(vertexShader, fragmentShaderSource) {
        this.programs = {};
        this.activeProgram = null;
        this.uniforms = {};
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
      }
      setKeywords(keywords) {
        let hash = 0;
        for (const k of keywords) hash += hashCode(k);
        let program = this.programs[hash];
        if (program == null) {
          const fs = compileShader(g.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
          program = createProgram(this.vertexShader, fs);
          this.programs[hash] = program;
        }
        if (program === this.activeProgram) return;
        this.uniforms = getUniforms(program);
        this.activeProgram = program;
      }
      bind() {
        g.useProgram(this.activeProgram);
      }
    }

    this.gl = g;
    this.isWebGL2 = isWebGL2;
    this.halfFloat = halfFloat;
    this.supportLinearFiltering = supportLinearFiltering;
    this.halfFloatTexType = halfFloatTexType;
    this._effectiveDyeRes = effectiveDyeRes;
    this._effectiveShading = effectiveShading;
    this._formatRGBA = formatRGBA;
    this._formatRG = formatRG;
    this._formatR = formatR;

    const copyProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, COPY_SHADER));
    const clearProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, CLEAR_SHADER));
    const splatProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, SPLAT_SHADER));
    const advectionProgram = makeProgram(compileShader(
      g.FRAGMENT_SHADER,
      ADVECTION_SHADER,
      supportLinearFiltering ? undefined : ['MANUAL_FILTERING']
    ));
    const divergenceProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, DIVERGENCE_SHADER));
    const curlProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, CURL_SHADER));
    const vorticityProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, VORTICITY_SHADER));
    const pressureProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, PRESSURE_SHADER));
    const gradientSubtractProgram = makeProgram(compileShader(g.FRAGMENT_SHADER, GRADIENT_SUBTRACT_SHADER));
    const displayMaterial = new Material(baseVertexShader, DISPLAY_SHADER);
    this.programs = {
      copyProgram,
      clearProgram,
      splatProgram,
      advectionProgram,
      divergenceProgram,
      curlProgram,
      vorticityProgram,
      pressureProgram,
      gradientSubtractProgram
    };
    this.displayMaterial = displayMaterial;

    const quadBuffer = g.createBuffer();
    const quadIndices = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, quadBuffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), g.STATIC_DRAW);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, quadIndices);
    g.bufferData(g.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), g.STATIC_DRAW);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.enableVertexAttribArray(0);
    this.quadBuffer = quadBuffer;
    this.quadIndices = quadIndices;

    this.blit = (target, clear) => {
      if (target == null) {
        g.viewport(0, 0, g.drawingBufferWidth, g.drawingBufferHeight);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
      } else {
        g.viewport(0, 0, target.width, target.height);
        g.bindFramebuffer(g.FRAMEBUFFER, target.fbo);
      }
      if (clear) {
        // 画布自身清透明，求解器内部目标清不透明黑：透明窗口下黑底会遮住下层内容
        g.clearColor(0, 0, 0, target == null ? 0 : 1);
        g.clear(g.COLOR_BUFFER_BIT);
      }
      g.drawElements(g.TRIANGLES, 6, g.UNSIGNED_SHORT, 0);
    };

    const createFBO = (w, h, internalFormat, format, type, param) => {
      g.activeTexture(g.TEXTURE0);
      const texture = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, texture);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, param);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, param);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texImage2D(g.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
      const fbo = g.createFramebuffer();
      g.bindFramebuffer(g.FRAMEBUFFER, fbo);
      g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, texture, 0);
      g.viewport(0, 0, w, h);
      g.clear(g.COLOR_BUFFER_BIT);
      return {
        texture,
        fbo,
        width: w,
        height: h,
        texelSizeX: 1 / w,
        texelSizeY: 1 / h,
        attach(id) {
          g.activeTexture(g.TEXTURE0 + id);
          g.bindTexture(g.TEXTURE_2D, texture);
          return id;
        }
      };
    };

    const destroyFBO = (target) => {
      if (!target) return;
      g.deleteFramebuffer(target.fbo);
      g.deleteTexture(target.texture);
    };
    const destroyDoubleFBO = (target) => {
      if (!target) return;
      destroyFBO(target.read);
      destroyFBO(target.write);
    };

    const createDoubleFBO = (w, h, internalFormat, format, type, param) => {
      let fbo1 = createFBO(w, h, internalFormat, format, type, param);
      let fbo2 = createFBO(w, h, internalFormat, format, type, param);
      return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read() {
          return fbo1;
        },
        set read(v) {
          fbo1 = v;
        },
        get write() {
          return fbo2;
        },
        set write(v) {
          fbo2 = v;
        },
        swap() {
          const t = fbo1;
          fbo1 = fbo2;
          fbo2 = t;
        }
      };
    };

    const resizeFBO = (target, w, h, internalFormat, format, type, param) => {
      const next = createFBO(w, h, internalFormat, format, type, param);
      copyProgram.bind();
      g.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
      this.blit(next);
      destroyFBO(target);
      return next;
    };

    const resizeDoubleFBO = (target, w, h, internalFormat, format, type, param) => {
      if (target.width === w && target.height === h) return target;
      target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
      destroyFBO(target.write);
      target.write = createFBO(w, h, internalFormat, format, type, param);
      target.width = w;
      target.height = h;
      target.texelSizeX = 1 / w;
      target.texelSizeY = 1 / h;
      return target;
    };

    const getResolution = (resolution) => {
      let aspectRatio = g.drawingBufferWidth / g.drawingBufferHeight;
      if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
      const min = Math.round(resolution);
      const max = Math.round(resolution * aspectRatio);
      return g.drawingBufferWidth > g.drawingBufferHeight
        ? { width: max, height: min }
        : { width: min, height: max };
    };

    let dye = null;
    let velocity = null;
    let divergence = null;
    let curlFBO = null;
    let pressureFBO = null;

    const initFramebuffers = () => {
      const simRes = getResolution(SIM_RESOLUTION);
      const dyeRes = getResolution(effectiveDyeRes());
      const texType = halfFloatTexType;
      const filtering = supportLinearFiltering ? g.LINEAR : g.NEAREST;
      g.disable(g.BLEND);

      dye = dye
        ? resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering)
        : createDoubleFBO(dyeRes.width, dyeRes.height, formatRGBA.internalFormat, formatRGBA.format, texType, filtering);
      velocity = velocity
        ? resizeDoubleFBO(velocity, simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering)
        : createDoubleFBO(simRes.width, simRes.height, formatRG.internalFormat, formatRG.format, texType, filtering);

      // 临时目标只依赖模拟分辨率，未变化时跳过重建，避免每次窗口抖动都清空压力场
      if (divergence && divergence.width === simRes.width && divergence.height === simRes.height) {
        return;
      }

      destroyFBO(divergence);
      destroyFBO(curlFBO);
      destroyDoubleFBO(pressureFBO);
      divergence = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
      curlFBO = createFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
      pressureFBO = createDoubleFBO(simRes.width, simRes.height, formatR.internalFormat, formatR.format, texType, g.NEAREST);
    };

    const updateKeywords = () => {
      displayMaterial.setKeywords(effectiveShading() ? ['SHADING'] : []);
    };
    updateKeywords();
    initFramebuffers();

    this._initFramebuffers = initFramebuffers;
    this._updateKeywords = updateKeywords;
    this._getResolution = getResolution;
    this.dye = () => dye;
    this.velocity = () => velocity;
    this.divergence = () => divergence;
    this.curlFBO = () => curlFBO;
    this.pressureFBO = () => pressureFBO;
    this._destroyFBO = destroyFBO;
    this._destroyDoubleFBO = destroyDoubleFBO;
    this._createFBO = createFBO;
    this._createDoubleFBO = createDoubleFBO;
    this._resizeDoubleFBO = resizeDoubleFBO;
  }

  /** 释放全部 GL 资源（上下文恢复重建与 dispose 共用；监听器由构造/dispose 管理） */
  teardownGL() {
    const g = this.gl;
    if (g) {
      if (this._destroyDoubleFBO) {
        this._destroyDoubleFBO(this.dye && this.dye());
        this._destroyDoubleFBO(this.velocity && this.velocity());
        this._destroyDoubleFBO(this.pressureFBO && this.pressureFBO());
      }
      if (this._destroyFBO) {
        this._destroyFBO(this.divergence && this.divergence());
        this._destroyFBO(this.curlFBO && this.curlFBO());
      }
      if (this.quadBuffer) g.deleteBuffer(this.quadBuffer);
      if (this.quadIndices) g.deleteBuffer(this.quadIndices);
    }
    this.gl = null;
    this.programs = {};
    this.displayMaterial = null;
    this.quadBuffer = null;
    this.quadIndices = null;
    this.blit = null;
    this.dye = null;
    this.velocity = null;
    this.divergence = null;
    this.curlFBO = null;
    this.pressureFBO = null;
    this._initFramebuffers = null;
    this._updateKeywords = null;
    this._getResolution = null;
    this._destroyFBO = null;
    this._destroyDoubleFBO = null;
    this._createFBO = null;
    this._createDoubleFBO = null;
    this._resizeDoubleFBO = null;
  }

  /** 鼠标位置（CSS 坐标）→ 0..1 画布纹理坐标（y 向上） */
  texcoords(clientX, clientY) {
    const canvas = this.canvas;
    if (!canvas) return { x: 0, y: 0 };
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    return {
      x: (clientX - canvas.getBoundingClientRect().left) / w,
      y: 1 - (clientY - canvas.getBoundingClientRect().top) / h
    };
  }

  /** 调色板连续环：相邻两色混合，颜色随鼠标移动连续漂移不跳变 */
  paletteAt(phase) {
    const p = this.live;
    const list = p.paletteColors.length ? p.paletteColors : DEFAULT_PALETTE;
    const t = p.backdrop === 'dark' ? 0.5 : 0.85;
    if (list.length === 1) return parseColor(list[0], t);
    const scaled = phase * list.length;
    const i = Math.floor(scaled) % list.length;
    const a = parseColor(list[i], t);
    const b = parseColor(list[(i + 1) % list.length], t);
    const f = scaled - Math.floor(scaled);
    return {
      r: a.r + (b.r - a.r) * f,
      g: a.g + (b.g - a.g) * f,
      b: a.b + (b.b - a.b) * f
    };
  }

  correctRadius(radius) {
    const canvas = this.canvas;
    if (!canvas || !canvas.width) return radius;
    const aspectRatio = canvas.width / canvas.height;
    return aspectRatio > 1 ? radius * aspectRatio : radius;
  }

  correctDeltaX(delta) {
    const canvas = this.canvas;
    if (!canvas || !canvas.width) return delta;
    const aspectRatio = canvas.width / canvas.height;
    return aspectRatio < 1 ? delta * aspectRatio : delta;
  }

  correctDeltaY(delta) {
    const canvas = this.canvas;
    if (!canvas || !canvas.width) return delta;
    const aspectRatio = canvas.width / canvas.height;
    return aspectRatio > 1 ? delta / aspectRatio : delta;
  }

  /** 管理器指针驱动：记录位置与速度，标记本帧需要注入 */
  onMove(x, y, speed, now) {
    super.onMove(x, y, speed, now);
    const tc = this.texcoords(x, y);
    this.pointer.clientX = x;
    this.pointer.clientY = y;
    this.pointer.prevTexcoordX = this.pointer.texcoordX;
    this.pointer.prevTexcoordY = this.pointer.texcoordY;
    this.pointer.texcoordX = tc.x;
    this.pointer.texcoordY = tc.y;
    this.pointer.deltaX = this.correctDeltaX(this.pointer.texcoordX - this.pointer.prevTexcoordX);
    this.pointer.deltaY = this.correctDeltaY(this.pointer.texcoordY - this.pointer.prevTexcoordY);
    this.pointer.moved = !this.firstMove &&
      (Math.abs(this.pointer.deltaX) > 0 || Math.abs(this.pointer.deltaY) > 0);
    if (this.firstMove) {
      this.pointer.color = this.paletteAt(this.colorPhase);
      this.firstMove = false;
    }
  }

  /** 窗口尺寸变化（FxManager.resize 驱动）：下一帧重建帧缓冲 */
  onResize() {
    this.needsResize = true;
  }

  frame() {
    const g = this.gl;
    if (!g) return;
    // 上下文丢失时暂停循环，恢复事件负责重建并重启
    if (g.isContextLost()) {
      this.stop();
      return;
    }
    const now = performance.now();
    // dt 封顶 60fps 步长，避免长时间卡顿一次把求解器炸掉
    const dt = Math.min((now - this.lastUpdateTime) / 1000, 0.016666);
    this.lastUpdateTime = now;

    if (this.needsResize) {
      this.needsResize = false;
      const canvas = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.floor((canvas.clientWidth || canvas.width || 1) * dpr);
      const h = Math.floor((canvas.clientHeight || canvas.height || 1) * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        this._initFramebuffers();
      }
    }

    // 颜色沿调色板环连续推进：相邻溅射为邻近色，避免闪烁
    this.colorPhase = (this.colorPhase + dt * COLOR_SPEED) % 1;
    this.pointer.color = this.paletteAt(this.colorPhase);

    this.applyInputs();
    this.step(dt);
    this.render();
  }

  applyInputs() {
    if (!this.pointer.moved) return;
    this.pointer.moved = false;
    this.splatPointer();
  }

  splat(x, y, dx, dy, c) {
    const g = this.gl;
    const p = this.live;
    const splatProgram = this.programs.splatProgram;
    // 溅射在 step() 之前执行，上一帧合成开启的混合还生效；溅射 shader 自身
    // 已写出合并值，pass 必须掌握自己的混合状态（WebGL2 对半浮点目标混合依驱动而异）
    g.disable(g.BLEND);
    splatProgram.bind();
    g.uniform1i(splatProgram.uniforms.uTarget, this.velocity().read.attach(0));
    g.uniform1f(splatProgram.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
    g.uniform2f(splatProgram.uniforms.point, x, y);
    g.uniform3f(splatProgram.uniforms.color, dx, dy, 0);
    g.uniform1f(splatProgram.uniforms.radius, this.correctRadius(p.splatRadius / 100));
    this.blit(this.velocity().write);
    this.velocity().swap();

    g.uniform1i(splatProgram.uniforms.uTarget, this.dye().read.attach(0));
    g.uniform3f(splatProgram.uniforms.color, c.r, c.g, c.b);
    this.blit(this.dye().write);
    this.dye().swap();
  }

  splatPointer() {
    this.splat(
      this.pointer.texcoordX,
      this.pointer.texcoordY,
      this.pointer.deltaX * this.live.splatForce,
      this.pointer.deltaY * this.live.splatForce,
      this.pointer.color
    );
  }

  clickSplat() {
    const c = this.paletteAt(this.colorPhase);
    this.splat(
      this.pointer.texcoordX,
      this.pointer.texcoordY,
      10 * (Math.random() - 0.5),
      30 * (Math.random() - 0.5),
      { r: c.r * 10, g: c.g * 10, b: c.b * 10 }
    );
  }

  step(dt) {
    const g = this.gl;
    const p = this.live;
    const progs = this.programs;
    const velocity = this.velocity();
    const dye = this.dye();
    const divergence = this.divergence();
    const curlFBO = this.curlFBO();
    const pressureFBO = this.pressureFBO();
    g.disable(g.BLEND);

    // 涡量 → 涡量力（curl）
    progs.curlProgram.bind();
    g.uniform2f(progs.curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    g.uniform1i(progs.curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    this.blit(curlFBO);

    progs.vorticityProgram.bind();
    g.uniform2f(progs.vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    g.uniform1i(progs.vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    g.uniform1i(progs.vorticityProgram.uniforms.uCurl, curlFBO.attach(1));
    g.uniform1f(progs.vorticityProgram.uniforms.curl, p.curl);
    g.uniform1f(progs.vorticityProgram.uniforms.dt, dt);
    this.blit(velocity.write);
    velocity.swap();

    // 散度 → 压力场 Jacobi 迭代 → 梯度投影（不可压缩约束）
    progs.divergenceProgram.bind();
    g.uniform2f(progs.divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    g.uniform1i(progs.divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    this.blit(divergence);

    progs.clearProgram.bind();
    g.uniform1i(progs.clearProgram.uniforms.uTexture, pressureFBO.read.attach(0));
    g.uniform1f(progs.clearProgram.uniforms.value, PRESSURE);
    this.blit(pressureFBO.write);
    pressureFBO.swap();

    progs.pressureProgram.bind();
    g.uniform2f(progs.pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    g.uniform1i(progs.pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      g.uniform1i(progs.pressureProgram.uniforms.uPressure, pressureFBO.read.attach(1));
      this.blit(pressureFBO.write);
      pressureFBO.swap();
    }

    progs.gradientSubtractProgram.bind();
    g.uniform2f(progs.gradientSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    g.uniform1i(progs.gradientSubtractProgram.uniforms.uPressure, pressureFBO.read.attach(0));
    g.uniform1i(progs.gradientSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    this.blit(velocity.write);
    velocity.swap();

    // 速度场对流
    progs.advectionProgram.bind();
    g.uniform2f(progs.advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!this.supportLinearFiltering) {
      g.uniform2f(progs.advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    }
    const velocityId = velocity.read.attach(0);
    g.uniform1i(progs.advectionProgram.uniforms.uVelocity, velocityId);
    g.uniform1i(progs.advectionProgram.uniforms.uSource, velocityId);
    g.uniform1f(progs.advectionProgram.uniforms.dt, dt);
    g.uniform1f(progs.advectionProgram.uniforms.dissipation, VELOCITY_DISSIPATION);
    this.blit(velocity.write);
    velocity.swap();

    // 染料场对流（跟随速度场 + 消散）
    if (!this.supportLinearFiltering) {
      g.uniform2f(progs.advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    }
    g.uniform1i(progs.advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    g.uniform1i(progs.advectionProgram.uniforms.uSource, dye.read.attach(1));
    g.uniform1f(progs.advectionProgram.uniforms.dissipation, p.densityDissipation);
    this.blit(dye.write);
    dye.swap();
  }

  render() {
    const g = this.gl;
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.enable(g.BLEND);
    this.displayMaterial.bind();
    if (this._effectiveShading()) {
      g.uniform2f(
        this.displayMaterial.uniforms.texelSize,
        1 / g.drawingBufferWidth,
        1 / g.drawingBufferHeight
      );
    }
    g.uniform1i(this.displayMaterial.uniforms.uTexture, this.dye().read.attach(0));
    // 先清后合并：避免未合成的帧在下一帧叠加翻倍闪烁
    this.blit(null, true);
  }
}

window.FxAura = FxAura;