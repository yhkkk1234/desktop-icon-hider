/**
 * 巡航流光边框控制器 (Border Beam Controller)
 * 提供 60FPS 硬件加速的圆角光束巡航动效系统，支持四大场景独立联动与多种色彩预设。
 */

const DEFAULT_BEAM_SETTINGS = {
  enabled: false,
  windowBeam: true,
  agentBeam: true,
  dropBeam: true,
  searchBeam: true,
  colorMode: 'theme',
  speed: 4
};

// 色彩预设调色盘 (from -> to)
const BEAM_PALETTES = {
  theme: {
    from: 'var(--accent-primary, #60a5fa)',
    to: 'var(--accent-secondary, #38bdf8)',
    glow: 'rgba(96, 165, 250, 0.45)'
  },
  aurora: {
    from: '#38bdf8',
    to: '#a855f7',
    glow: 'rgba(168, 85, 247, 0.45)'
  },
  cyan: {
    from: '#06b6d4',
    to: '#3b82f6',
    glow: 'rgba(6, 182, 212, 0.45)'
  },
  gold: {
    from: '#f59e0b',
    to: '#fbbf24',
    glow: 'rgba(245, 158, 11, 0.45)'
  },
  purple: {
    from: '#ec4899',
    to: '#8b5cf6',
    glow: 'rgba(236, 72, 153, 0.45)'
  }
};

class BorderBeamController {
  constructor() {
    this.settings = { ...DEFAULT_BEAM_SETTINGS };
    this.saveTimer = null;
    this.activeDropEl = null;
  }

  /**
   * 初始化并载入持久化配置
   * @param {Object} [saved] 
   */
  init(saved) {
    if (saved && typeof saved === 'object') {
      this.settings = { ...this.settings, ...saved };
    }
    this.apply();
  }

  /**
   * 应用最新参数并刷新 DOM 与 CSS 变量
   * @param {Object} [partial] 
   */
  apply(partial) {
    if (partial && typeof partial === 'object') {
      this.settings = { ...this.settings, ...partial };
    }
    const s = this.settings;
    const root = document.documentElement;

    // 1. 同步根属性与开关标记
    root.dataset.borderBeam = s.enabled ? 'true' : 'false';
    root.dataset.beamColor = s.colorMode || 'theme';

    // 2. 写入 CSS 变量（速度与色彩）
    root.style.setProperty('--beam-speed', (s.speed || 4) + 's');

    const palette = BEAM_PALETTES[s.colorMode] || BEAM_PALETTES.theme;
    root.style.setProperty('--beam-color-from', palette.from);
    root.style.setProperty('--beam-color-to', palette.to);
    root.style.setProperty('--beam-glow-color', palette.glow);

    // 3. 主窗口常驻流光挂载
    const appEl = document.getElementById('app');
    if (appEl) {
      if (s.enabled && s.windowBeam) {
        appEl.classList.add('has-window-beam');
      } else {
        appEl.classList.remove('has-window-beam');
      }
    }
  }

  /**
   * 触发拖拽进组磁吸流光
   * @param {HTMLElement} el 目标元素（如分组 Tab 或文件夹）
   * @param {boolean} active 是否激活
   */
  triggerDropBeam(el, active) {
    if (!this.settings.enabled || !this.settings.dropBeam) {
      if (this.activeDropEl) {
        this.activeDropEl.classList.remove('beam-drop-target');
        this.activeDropEl = null;
      }
      return;
    }

    if (this.activeDropEl && this.activeDropEl !== el) {
      this.activeDropEl.classList.remove('beam-drop-target');
      this.activeDropEl = null;
    }

    if (el) {
      if (active) {
        el.classList.add('beam-drop-target');
        this.activeDropEl = el;
      } else {
        el.classList.remove('beam-drop-target');
        if (this.activeDropEl === el) this.activeDropEl = null;
      }
    }
  }

  /**
   * 触发搜索栏激活流光
   * @param {boolean} active 
   */
  triggerSearchBeam(active) {
    if (!this.settings.enabled || !this.settings.searchBeam) return;

    const searchBar = document.querySelector('.search-bar');
    const everythingBar = document.querySelector('.everything-bar');

    [searchBar, everythingBar].forEach((bar) => {
      if (bar) {
        if (active) {
          bar.classList.add('beam-search-active');
        } else {
          bar.classList.remove('beam-search-active');
        }
      }
    });
  }

  /**
   * 更新 AI Agent 监控小组件及列表条目的流光状态
   * @param {Object} status { hasRunning: boolean, hasWaiting: boolean }
   */
  updateAgentBeam(status) {
    const isEnabled = this.settings.enabled && this.settings.agentBeam;
    const widgets = document.querySelectorAll('.widget-agent, .agent-widget');
    for (const widget of widgets) {
      if (isEnabled && (status.hasRunning || status.hasWaiting)) {
        widget.classList.add('beam-agent-active');
        widget.classList.toggle('beam-running', !!status.hasRunning);
        widget.classList.toggle('beam-waiting', !status.hasRunning && !!status.hasWaiting);
      } else {
        widget.classList.remove('beam-agent-active', 'beam-running', 'beam-waiting');
      }
    }
  }

  /**
   * 防抖持久化到主进程 store
   */
  saveToStore() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(async () => {
      if (window.api && window.api.setBorderBeamSettings) {
        try {
          await window.api.setBorderBeamSettings(this.settings);
        } catch (err) {
          console.warn('保存流光边框参数失败:', err);
        }
      }
    }, 300);
  }
}

window.BorderBeamController = BorderBeamController;
window.borderBeamController = new BorderBeamController();
