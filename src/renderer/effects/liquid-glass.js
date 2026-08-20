/**
 * 拟态液体玻璃 (Liquid Glass) 特效与材质控制器
 *
 * 核心功能：
 * 1. 动态管理与配置 SVG 物理位移与色散滤镜（feTurbulence + feDisplacementMap + 3路 RGB 色差分光 + feSpecularLighting）；
 * 2. 将 6 项材质调节参数（光线、折射、深度、色散、霜化、展开、金属光泽）实时同步为 CSS 变量；
 * 3. 处理参数滑块与主进程持久化存储之间的双向绑定；
 * 4. 零性能负担调度：静止时静态呈现，切换离开时完整释放。
 */

const DEFAULT_LQ_SETTINGS = {
  light: 70,
  lightAngle: 135,
  refraction: 35,
  depth: 45,
  dispersion: 50,
  frost: 18,
  spread: 55,
  chromaticMetal: 75
};

class LiquidGlassController {
  constructor() {
    this.settings = { ...DEFAULT_LQ_SETTINGS };
    this.active = false;
    this.saveTimer = null;
    this.filterSvg = null;
    this.initialized = false;
  }

  /** 初始化绑定与 SVG 滤镜图 */
  init() {
    if (this.initialized) return;
    this.ensureFilterSvg();
    this.initialized = true;
  }

  /** 确保页面底部存在拟态液体玻璃的专用 SVG Filter 矩阵 */
  ensureFilterSvg() {
    let svg = document.getElementById('liquid-glass-svg-defs');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', 'liquid-glass-svg-defs');
      svg.setAttribute('class', 'liquid-glass-svg-defs');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      svg.style.width = '0';
      svg.style.height = '0';
      svg.style.overflow = 'hidden';
      svg.style.pointerEvents = 'none';

      svg.innerHTML = `
        <defs>
          <!-- 拟态液体玻璃：折射 + RGB 3路色散 + 霜化模糊 + 镜面光照滤镜流水线 -->
          <filter id="liquid-glass-filter" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
            <!-- 1. 湍流/透镜凹凸高度场 -->
            <feTurbulence id="lq-fe-turb" type="fractalNoise" baseFrequency="0.012" numOctaves="2" result="lq_noise" />
            
            <!-- 2. RGB 3路独立位移色散 (Chromatic Aberration) -->
            <feDisplacementMap id="lq-fe-disp-r" in="SourceGraphic" in2="lq_noise" scale="35" xChannelSelector="R" yChannelSelector="G" result="lq_disp_r" />
            <feDisplacementMap id="lq-fe-disp-g" in="SourceGraphic" in2="lq_noise" scale="30" xChannelSelector="R" yChannelSelector="G" result="lq_disp_g" />
            <feDisplacementMap id="lq-fe-disp-b" in="SourceGraphic" in2="lq_noise" scale="40" xChannelSelector="R" yChannelSelector="G" result="lq_disp_b" />
            
            <!-- 3. 色彩通道分离提取 -->
            <feColorMatrix in="lq_disp_r" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="lq_r_only" />
            <feColorMatrix in="lq_disp_g" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="lq_g_only" />
            <feColorMatrix in="lq_disp_b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="lq_b_only" />
            
            <!-- 4. 三通道加色屏幕重组合成彩虹边缘 -->
            <feBlend in="lq_r_only" in2="lq_g_only" mode="screen" result="lq_rg_blend" />
            <feBlend in="lq_rg_blend" in2="lq_b_only" mode="screen" result="lq_rgb_combined" />
            
            <!-- 5. 表面霜化 (Frosting) -->
            <feGaussianBlur id="lq-fe-blur" in="lq_rgb_combined" stdDeviation="1.5" result="lq_blurred" />
            
            <!-- 6. 物理镜面高光 (Specular Lighting) -->
            <feSpecularLighting id="lq-fe-specular" in="lq_blurred" surfaceScale="4" specularConstant="1.2" specularExponent="22" result="lq_spec_light">
              <feDistantLight id="lq-fe-light" azimuth="135" elevation="50" />
            </feSpecularLighting>
            
            <!-- 7. 高光叠加与最终输出 -->
            <feComposite in="lq_spec_light" in2="lq_blurred" operator="in" result="lq_spec_masked" />
            <feBlend in="lq_blurred" in2="lq_spec_masked" mode="screen" result="lq_final" />
          </filter>

          <!-- 备用轻量版：用于大面积背景单层快速折射 -->
          <filter id="liquid-glass-fast" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
            <feTurbulence id="lq-fast-turb" type="fractalNoise" baseFrequency="0.015" numOctaves="1" result="f_noise" />
            <feDisplacementMap id="lq-fast-disp" in="SourceGraphic" in2="f_noise" scale="20" xChannelSelector="R" yChannelSelector="G" result="f_disp" />
            <feGaussianBlur id="lq-fast-blur" in="f_disp" stdDeviation="1" />
          </filter>
        </defs>
      `;
      document.body.appendChild(svg);
    }
    this.filterSvg = svg;
  }

  /**
   * 应用设置并刷新 SVG 滤镜与 CSS 变量
   * @param {Object} [partialSettings] 可选部分覆盖
   */
  apply(partialSettings) {
    if (partialSettings && typeof partialSettings === 'object') {
      this.settings = { ...this.settings, ...partialSettings };
    }
    this.init();
    this.updateCssVariables();
    this.updateSvgFilters();
  }

  /** 同步更新 CSS 变量到 :root 与 #app */
  updateCssVariables() {
    const s = this.settings;
    const root = document.documentElement;
    if (!root) return;

    // 基础映射
    const lightRatio = Number((s.light / 100).toFixed(2));
    const lightAngle = `${s.lightAngle}deg`;
    const oppositeAngle = `${(s.lightAngle + 180) % 360}deg`;
    const depthPower = Number((s.depth / 100).toFixed(2));
    const dispersionPx = Number((s.dispersion * 0.08).toFixed(1));
    const frostBlur = `${(s.frost * 0.5).toFixed(1)}px`;
    const metalRatio = Number((s.chromaticMetal / 100).toFixed(2));
    const spreadPct = s.spread;
    const borderRadius = `${Math.round(8 + s.spread * 0.12)}px`;

    // 动态注入 CSS Token
    root.style.setProperty('--lq-light-ratio', lightRatio);
    root.style.setProperty('--lq-light-angle', lightAngle);
    root.style.setProperty('--lq-light-opposite-angle', oppositeAngle);
    root.style.setProperty('--lq-refraction-num', s.refraction);
    root.style.setProperty('--lq-depth-power', depthPower);
    root.style.setProperty('--lq-dispersion-px', `${dispersionPx}px`);
    root.style.setProperty('--lq-frost-blur', frostBlur);
    root.style.setProperty('--lq-metal-ratio', metalRatio);
    root.style.setProperty('--lq-spread-pct', `${spreadPct}%`);
    root.style.setProperty('--lq-border-radius', borderRadius);

    // 表面透明度与背景色（更清澈透光，避免灰暗）
    const surfaceAlpha = (0.18 + 0.28 * (s.frost / 60)).toFixed(2);
    const widgetAlpha = (0.28 + 0.32 * (s.frost / 60)).toFixed(2);
    root.style.setProperty('--lq-surface-bg', `rgba(16, 24, 44, ${surfaceAlpha})`);
    root.style.setProperty('--lq-widget-bg', `rgba(20, 32, 58, ${widgetAlpha})`);

    // 动态彩虹薄膜干涉渐变边框 (Iridescent Sheen)
    const rainbowBorder = `conic-gradient(
      from ${lightAngle},
      rgba(255, 255, 255, ${(0.5 * lightRatio).toFixed(2)}) 0deg,
      rgba(168, 85, 247, ${(0.55 * metalRatio).toFixed(2)}) 60deg,
      rgba(59, 130, 246, ${(0.6 * metalRatio).toFixed(2)}) 120deg,
      rgba(16, 185, 129, ${(0.5 * metalRatio).toFixed(2)}) 180deg,
      rgba(245, 158, 11, ${(0.55 * metalRatio).toFixed(2)}) 240deg,
      rgba(236, 72, 153, ${(0.6 * metalRatio).toFixed(2)}) 300deg,
      rgba(255, 255, 255, ${(0.5 * lightRatio).toFixed(2)}) 360deg
    )`;
    root.style.setProperty('--lq-rainbow-sheen', rainbowBorder);

    // 水滴凸透镜与多通道色散阴影 (仅针对内部小组件/卡片，不用于根容器 #app)
    const shadowY = (4 + depthPower * 14).toFixed(0);
    const shadowBlur = (12 + depthPower * 24).toFixed(0);
    const shadowAlpha = (0.22 + 0.35 * depthPower).toFixed(2);
    const dispSpread = (6 + dispersionPx).toFixed(0);
    const pinkAlpha = (0.35 * metalRatio).toFixed(2);
    const blueAlpha = (0.35 * metalRatio).toFixed(2);
    const topSpec = (0.85 * lightRatio).toFixed(2);
    const botBounce = (0.25 * lightRatio).toFixed(2);

    const chromaticShadow = `0 ${shadowY}px ${shadowBlur}px rgba(0, 0, 0, ${shadowAlpha}), -${dispersionPx}px 0 ${dispSpread}px rgba(236, 72, 153, ${pinkAlpha}), ${dispersionPx}px 0 ${dispSpread}px rgba(59, 130, 246, ${blueAlpha}), inset 0 1.5px 1px rgba(255, 255, 255, ${topSpec}), inset 0 -1.5px 2px rgba(255, 255, 255, ${botBounce})`;
    root.style.setProperty('--lq-chromatic-shadow', chromaticShadow);

    // 根容器专用：纯 inset 高光，杜绝外阴影污染透明窗口四角
    const topSpecular = `inset 0 1.5px 1px rgba(255, 255, 255, ${topSpec})`;
    const bottomBounce = `inset 0 -1.5px 2px rgba(255, 255, 255, ${botBounce})`;
    root.style.setProperty('--lq-lens-shadow', `${topSpecular}, ${bottomBounce}`);
  }

  /** 同步更新 SVG 滤镜流水线各节点的物理参数 */
  updateSvgFilters() {
    if (!this.filterSvg) return;
    const s = this.settings;

    // 1. 折射与位移 scale
    const baseScale = (s.refraction * 0.7).toFixed(1);
    const dispSpread = (s.dispersion * 0.15).toFixed(1);

    const rScale = (Number(baseScale) + Number(dispSpread)).toFixed(1);
    const gScale = baseScale;
    const bScale = Math.max(0, Number(baseScale) - Number(dispSpread)).toFixed(1);

    const dispR = document.getElementById('lq-fe-disp-r');
    const dispG = document.getElementById('lq-fe-disp-g');
    const dispB = document.getElementById('lq-fe-disp-b');
    if (dispR) dispR.setAttribute('scale', rScale);
    if (dispG) dispG.setAttribute('scale', gScale);
    if (dispB) dispB.setAttribute('scale', bScale);

    // 2. 霜化高斯模糊
    const blurNode = document.getElementById('lq-fe-blur');
    if (blurNode) {
      const stdDev = (s.frost * 0.06).toFixed(2);
      blurNode.setAttribute('stdDeviation', stdDev);
    }

    // 3. 镜面光照
    const specNode = document.getElementById('lq-fe-specular');
    const lightNode = document.getElementById('lq-fe-light');
    if (specNode) {
      specNode.setAttribute('surfaceScale', (2 + (s.depth / 100) * 6).toFixed(1));
      specNode.setAttribute('specularConstant', (0.6 + (s.light / 100) * 1.4).toFixed(2));
      specNode.setAttribute('specularExponent', (15 + (100 - s.frost) * 0.3).toFixed(0));
    }
    if (lightNode) {
      lightNode.setAttribute('azimuth', s.lightAngle);
      lightNode.setAttribute('elevation', (35 + (s.depth / 100) * 35).toFixed(0));
    }

    // 4. 快速版滤镜同步
    const fastDisp = document.getElementById('lq-fast-disp');
    const fastBlur = document.getElementById('lq-fast-blur');
    if (fastDisp) fastDisp.setAttribute('scale', (s.refraction * 0.4).toFixed(1));
    if (fastBlur) fastBlur.setAttribute('stdDeviation', (s.frost * 0.04).toFixed(2));
  }

  /**
   * 触发持久化保存到主进程 store（防抖 300ms）
   */
  saveToStore() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      if (window.api && window.api.setLiquidGlassSettings) {
        try {
          await window.api.setLiquidGlassSettings(this.settings);
        } catch (err) {
          console.warn('保存液体玻璃参数失败:', err);
        }
      }
    }, 300);
  }

  /** 恢复默认预设值 */
  resetDefaults() {
    this.apply(DEFAULT_LQ_SETTINGS);
    this.saveToStore();
    return { ...DEFAULT_LQ_SETTINGS };
  }

  /** 离开主题时清理 */
  teardown() {
    this.active = false;
    if (this.saveTimer) clearTimeout(this.saveTimer);
  }
}

window.LiquidGlassController = LiquidGlassController;
window.liquidGlassController = new LiquidGlassController();
