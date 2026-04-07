const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

function ensureLogDirectory() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function log(level, message, data = null) {
  ensureLogDirectory();
  
  const timestamp = new Date().toISOString();
  
  const logLine = `[${timestamp}] [${level}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
  
  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (error) {
    console.error('Failed to write log:', error);
  }
  
  if (level === 'error') {
    console.error(logLine);
  } else if (level === 'warn') {
    console.warn(logLine);
  } else {
    console.log(logLine);
  }
}

const logger = {
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),
  debug: (message, data) => {
    if (process.env.NODE_ENV === 'development' || process.argv.includes('--enable-logging')) {
      log('debug', message, data);
    }
  }
};

module.exports = logger;
