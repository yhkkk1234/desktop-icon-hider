const fs = require('fs');
const path = require('path');

let iconExtractor = null;
try {
  iconExtractor = require('../../build/Release/icon_extractor.node');
} catch (e) {
  try {
    const nativePath = require('path').join(process.resourcesPath, 'app.asar.unpacked', 'build', 'Release', 'icon_extractor.node');
    iconExtractor = require(nativePath);
  } catch (e2) {
    console.warn('Native icon extractor not available, falling back to emoji:', e.message, e2.message);
  }
}

const iconCache = new Map();
let cacheFile = null;

const SYSTEM_ICON_EMOJI = {
  '20D04FE0-3AEA-1069-A2D8-08002B30309D': '\u{1F5A5}\uFE0F',
  '645FF040-5081-101B-9F08-00AA002F954E': '\u{1F5D1}\uFE0F',
  '26EE0668-A00A-44D7-9371-BEB064C98683': '\u{2699}\uFE0F',
  'F02C1A0D-BE21-4350-88B0-7367FC96EF3C': '\u{1F310}',
  '031E4825-7B94-4DC3-B131-E946B44C8DD5': '\u{1F4DA}',
  '5399E694-6CE5-4D6C-8FCE-1D8870FDCBA0': '\u{2699}\uFE0F',
};

function getSystemIconEmoji(path) {
  if (!path || !path.startsWith('::')) return null;
  for (const [clsid, emoji] of Object.entries(SYSTEM_ICON_EMOJI)) {
    if (path.includes(clsid)) return emoji;
  }
  return '\u{1F4C1}';
}

async function initializeDesktopAPI(userDataPath) {
  cacheFile = path.join(userDataPath || __dirname, 'icon-cache.json');
  await loadIconCacheAsync();
}

async function loadIconCacheAsync() {
  try {
    if (cacheFile && fs.existsSync(cacheFile)) {
      const data = await fs.promises.readFile(cacheFile, 'utf8');
      const parsed = JSON.parse(data);
      for (const [key, value] of Object.entries(parsed)) {
        iconCache.set(key, value);
      }
    }
  } catch (error) {
    console.error('Failed to load icon cache:', error.message);
  }
}

function saveIconCache() {
  try {
    if (cacheFile) {
      fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(iconCache)), 'utf8');
    }
  } catch (error) {
    console.error('Failed to save icon cache:', error.message);
  }
}

async function extractFileIcon(filePath) {
  if (iconCache.has(filePath)) return iconCache.get(filePath);
  if (filePath && filePath.startsWith('::')) return null;
  if (!iconExtractor) return null;

  try {
    const result = iconExtractor.extractIcon(filePath);
    if (result && result.length > 100) {
      iconCache.set(filePath, result);
      saveIconCache();
      return result;
    }
    return null;
  } catch (error) {
    console.error('Native icon extraction failed for', filePath, ':', error.message);
    return null;
  }
}

async function extractDirectoryIcon(dirPath) {
  if (iconCache.has(dirPath)) return iconCache.get(dirPath);
  if (!iconExtractor) return null;

  try {
    const result = iconExtractor.extractIcon(dirPath);
    if (result && result.length > 100) {
      iconCache.set(dirPath, result);
      saveIconCache();
      return result;
    }
    return null;
  } catch (error) {
    console.error('Native directory icon extraction failed for', dirPath, ':', error.message);
    return null;
  }
}

async function getFileIcon(file) {
  try {
    if (file.path && file.path.startsWith('::')) {
      return getSystemIconEmoji(file.path);
    }
    const icon = await extractFileIcon(file.path);
    return icon || (file.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}');
  } catch (error) {
    return file.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';
  }
}

async function getFileIcons(files) {
  try {
    const result = {};
    const filesToExtract = [];
    const dirsToExtract = [];

    for (const file of files) {
      if (iconCache.has(file.path)) {
        result[file.path] = iconCache.get(file.path);
        continue;
      }
      if (file.path && file.path.startsWith('::')) {
        result[file.path] = getSystemIconEmoji(file.path);
        continue;
      }
      if (file.isDirectory) {
        dirsToExtract.push(file);
      } else {
        filesToExtract.push(file);
      }
    }

    if (filesToExtract.length > 0) {
      Object.assign(result, await extractFileIconsBatch(filesToExtract));
    }

    for (const dir of dirsToExtract) {
      try {
        const icon = await extractDirectoryIcon(dir.path);
        result[dir.path] = icon || '\u{1F4C1}';
      } catch (error) {
        result[dir.path] = '\u{1F4C1}';
      }
    }

    for (const file of files) {
      if (!result[file.path]) {
        if (file.path && file.path.startsWith('::')) {
          result[file.path] = getSystemIconEmoji(file.path);
        } else {
          result[file.path] = file.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';
        }
      }
    }

    return result;
  } catch (error) {
    console.error('批量获取图标失败:', error);
    const fallbackResult = {};
    for (const file of files) {
      if (file.path && file.path.startsWith('::')) {
        fallbackResult[file.path] = getSystemIconEmoji(file.path);
      } else {
        fallbackResult[file.path] = file.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';
      }
    }
    return fallbackResult;
  }
}

async function extractFileIconsBatch(files) {
  if (files.length === 0) return {};
  const result = {};

  if (iconExtractor) {
    try {
      const paths = files.map(f => f.path);
      const batchResult = iconExtractor.extractIconsBatch(paths);
      for (const [filePath, iconData] of Object.entries(batchResult)) {
        if (iconData && iconData.length > 100) {
          result[filePath] = iconData;
          iconCache.set(filePath, iconData);
        }
      }
    } catch (error) {
      console.error('Native batch icon extraction failed:', error.message);
    }
  }

  for (const file of files) {
    if (!result[file.path]) {
      if (file.path && file.path.startsWith('::')) {
        result[file.path] = getSystemIconEmoji(file.path);
      } else {
        result[file.path] = file.isDirectory ? '\u{1F4C1}' : '\u{1F4C4}';
      }
    }
  }

  if (Object.keys(result).length > 0) saveIconCache();
  return result;
}

function clearIconCache() {
  iconCache.clear();
  try {
    if (cacheFile && fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
    }
  } catch (error) {
    console.error('删除缓存文件失败:', error.message);
  }
}

function cleanupIconCache(validPaths) {
  const pathSet = new Set(validPaths);
  let changed = false;
  for (const key of iconCache.keys()) {
    if (!pathSet.has(key)) {
      iconCache.delete(key);
      changed = true;
    }
  }
  if (changed) saveIconCache();
}

module.exports = {
  initializeDesktopAPI,
  getFileIcon,
  getFileIcons,
  extractDirectoryIcon,
  clearIconCache,
  cleanupIconCache,
  getSystemIconEmoji,
};