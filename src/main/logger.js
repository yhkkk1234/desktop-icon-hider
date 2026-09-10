// logger.js - 主进程日志
//
// 目的：用户报问题时能附带一份日志。此前项目完全没有日志设施，打包版的主进程
// console 输出无人可见（没有控制台窗口），"看一眼控制台"对用户不是可执行的动作。
//
// 设计（保持零依赖，与本项目自建 ICO 编码器等做法一致）：
// - 写入 <userData>/logs/main.log，单文件超过上限时滚动 main.log.1/.2/.3
// - 行缓冲 + 定时落盘 + 退出前 flush，避免高频日志变成同步 IO 抖动
// - attachConsole() 把 console 的 warn/error 同时抄送进文件：这样各模块现有的
//   诊断输出（例如 agent-monitor 的数据源漂移告警）无需改动即被记录
// - 捕获 uncaughtException / unhandledRejection 并先落盘再交回默认行为
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024; // 单文件 1MB
const KEEP_FILES = 3; // 滚动保留 main.log.1 ~ .3
const FLUSH_INTERVAL_MS = 1000;

let logDir = '';
let logFile = '';
let queue = [];
let flushTimer = null;
let consoleAttached = false;
let originalConsole = null;

/** 时间戳：本地时间 + 毫秒，便于与用户描述的时刻对齐 */
function stamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 任意值 → 单行字符串（Error 带栈；对象尽力 JSON 化，失败则退回 String） */
function stringify(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || `${v.name}: ${v.message}`;
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return Object.prototype.toString.call(v);
    }
  }
  return String(v);
}

/** 滚动：main.log → .1 → .2 → .3，超出 KEEP_FILES 的丢弃 */
function rotate() {
  try {
    if (!fs.existsSync(logFile) || fs.statSync(logFile).size < MAX_BYTES) return;
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = `${logFile}.${i}`;
      const to = `${logFile}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(logFile, `${logFile}.1`);
  } catch (e) {
    // 滚动失败不应影响应用
  }
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!logFile || queue.length === 0) return;
  const chunk = queue.join('\n') + '\n';
  queue = [];
  try {
    rotate();
    fs.appendFileSync(logFile, chunk, 'utf8');
  } catch (e) {
    // 落盘失败（磁盘满/权限）不应影响应用
  }
}

function schedule() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

/**
 * 初始化日志目录。必须在 app ready 之后调用（需要 userData 路径）。
 * @param {string} dir 日志目录（通常为 path.join(app.getPath('userData'), 'logs')）
 * @returns {string} 实际使用的日志文件路径；初始化失败返回空字符串
 */
function init(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    logDir = dir;
    logFile = path.join(dir, 'main.log');
    rotate();
    info(`--- 日志开始 pid=${process.pid} electron=${process.versions.electron} `
      + `node=${process.versions.node} ${process.platform}/${process.arch} ---`);
    return logFile;
  } catch (e) {
    logDir = '';
    logFile = '';
    return '';
  }
}

/** 写入一行（level 仅用于标注） */
function write(level, args) {
  if (!logFile) return;
  const line = `[${stamp()}] [${level}] ${args.map(stringify).join(' ')}`;
  queue.push(line);
  // 队列过长时立即落盘，避免内存里堆积
  if (queue.length >= 200) flush();
  else schedule();
}

const info = (...args) => write('info', args);
const warn = (...args) => write('warn', args);
const error = (...args) => write('error', args);

/**
 * 把 console 的 warn/error 抄送进日志文件（原行为保持不变，仍输出到控制台）。
 * 这样各模块现成的诊断输出无需改动即可被记录。
 */
function attachConsole() {
  if (consoleAttached) return;
  consoleAttached = true;
  originalConsole = { warn: console.warn, error: console.error };
  console.warn = (...args) => {
    write('warn', args);
    originalConsole.warn.apply(console, args);
  };
  console.error = (...args) => {
    write('error', args);
    originalConsole.error.apply(console, args);
  };
  process.on('uncaughtException', (err) => {
    write('error', ['uncaughtException:', err]);
    flush(); // 崩溃前必须落盘
  });
  process.on('unhandledRejection', (reason) => {
    write('error', ['unhandledRejection:', reason]);
    flush();
  });
  process.on('exit', flush);
}

/** 当前日志文件路径（未初始化时为空字符串） */
function getLogFile() {
  return logFile;
}

/** 日志目录（未初始化时为空字符串） */
function getLogDir() {
  return logDir;
}

module.exports = {
  init,
  info,
  warn,
  error,
  attachConsole,
  flush,
  getLogFile,
  getLogDir,
  MAX_BYTES,
  KEEP_FILES
};
