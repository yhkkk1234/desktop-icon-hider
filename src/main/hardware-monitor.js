// hardware-monitor.js - 性能监控数据源
// 负责 spawn 常驻采样进程 (hardware-sampler.ps1)、解析其 stdout 并缓存最新数据，
// 崩溃自动重启。渲染进程通过 IPC get-system-stats 读取缓存。
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const SAMPLE_DATA_PREFIX = 'DATA: ';
const RESTART_DELAY_MIN = 3000;
const RESTART_DELAY_MAX = 30000;

let child = null;
let latestStats = null; // 最新一次采样的解析结果
let lastError = null; // 最近一次失败信息（供 UI 提示）
let restartDelay = RESTART_DELAY_MIN;
let restartTimer = null;
let stopping = false;

/**
 * 采样脚本路径：
 * - 开发：src/main/hardware-sampler.ps1
 * - 打包：resources/hardware/hardware-sampler.ps1（extraResources）
 */
function getSamplerScriptPath() {
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'hardware', 'hardware-sampler.ps1'))) {
    return path.join(process.resourcesPath, 'hardware', 'hardware-sampler.ps1');
  }
  return path.join(__dirname, 'hardware-sampler.ps1');
}

/**
 * LibreHardwareMonitorLib 所在目录：
 * - 开发：native/hardware/（build-native.ps1 从 NuGet 拉取）
 * - 打包：resources/hardware/
 */
function getLhmDir() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'hardware');
    if (fs.existsSync(path.join(packaged, 'LibreHardwareMonitorLib.dll'))) {
      return packaged;
    }
  }
  const dev = path.join(__dirname, '..', '..', 'native', 'hardware');
  return fs.existsSync(path.join(dev, 'LibreHardwareMonitorLib.dll')) ? dev : '';
}

/**
 * 启动采样子进程。返回是否成功启动。
 */
function startSampler() {
  if (stopping) return false;
  if (child) return true;

  const scriptPath = getSamplerScriptPath();
  if (!fs.existsSync(scriptPath)) {
    lastError = '采样脚本缺失';
    return false;
  }

  try {
    child = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        env: {
          ...process.env,
          DIH_HW_LHM_DIR: getLhmDir()
        }
      }
    );
  } catch (e) {
    lastError = e.message;
    child = null;
    return false;
  }

  // 逐行解析 stdout：`DATA: {json}`
  // spawn 异步失败时 stdout 可能为 null，直接 createInterface 会抛 TypeError
  if (child.stdout) {
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (!line || !line.startsWith(SAMPLE_DATA_PREFIX)) return;
      try {
        const parsed = JSON.parse(line.slice(SAMPLE_DATA_PREFIX.length));
        if (parsed && typeof parsed === 'object') {
          latestStats = parsed;
        }
      } catch (e) {
        // 单行解析失败不影响后续
      }
    });
  }

  child.stderr.on('data', (buf) => {
    const msg = String(buf).trim();
    if (msg) lastError = msg;
  });

  child.on('error', (err) => {
    lastError = err.message;
    child = null;
    scheduleRestart();
  });

  child.on('exit', () => {
    child = null;
    if (!stopping) scheduleRestart();
  });

  restartDelay = RESTART_DELAY_MIN;
  return true;
}

function scheduleRestart() {
  if (stopping || restartTimer || child) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (startSampler()) {
      restartDelay = RESTART_DELAY_MIN;
    } else {
      // 启动失败：指数退避重试
      restartDelay = Math.min(restartDelay * 2, RESTART_DELAY_MAX);
      scheduleRestart();
    }
  }, restartDelay);
}

/**
 * 停止采样子进程（应用退出时调用）。
 */
function stopSampler() {
  stopping = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    try {
      child.kill();
    } catch (e) {
      // 忽略
    }
    child = null;
  }
  // 停止后不再返回陈旧采样数据
  latestStats = null;
  lastError = null;
}

let lastStartAttemptAt = 0;

/**
 * 获取最新性能数据。
 * @returns {{ok: boolean, stats: object|null, error: string|null}}
 */
function getSystemStats() {
  if (!latestStats) {
    // 首次调用时尝试启动采样进程；启动失败限频（脚本缺失等持久失败场景
    // 避免每次 IPC 都重复重试启动）
    const now = Date.now();
    if (!child && now - lastStartAttemptAt >= 10000) {
      lastStartAttemptAt = now;
      startSampler();
    }
    return { ok: false, stats: null, error: lastError };
  }
  return { ok: true, stats: latestStats, error: null };
}

module.exports = {
  startSampler,
  stopSampler,
  getSystemStats
};
