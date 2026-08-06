const fs = require('fs');
const os = require('os');
const path = require('path');
const DesktopAPI = require('../src/main/desktop-api');

let tmpDir = null;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dih-test-'));
  await DesktopAPI.initializeDesktopAPI(tmpDir);
});

afterEach(() => {
  // 清除缓存与未落盘的防抖定时器，避免跨测试残留
  DesktopAPI.clearIconCache();
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (e) { /* 忽略 */ }
});

// 原生模块可用时返回真实 PNG data URL，不可用时回退 emoji
function expectIconResult(value, fallbackEmoji) {
  const isPng = typeof value === 'string' && value.startsWith('data:image/png;base64,');
  expect(value === fallbackEmoji || isPng).toBe(true);
}

describe('desktop-api', () => {
  test('getSystemIconEmoji should map known CLSIDs', () => {
    expect(DesktopAPI.getSystemIconEmoji('::{645FF040-5081-101B-9F08-00AA002F954E}')).toBe('\u{1F5D1}\uFE0F'); // 回收站
    expect(DesktopAPI.getSystemIconEmoji('::{20D04FE0-3AEA-1069-A2D8-08002B30309D}')).toBe('\u{1F5A5}\uFE0F'); // 此电脑
  });

  test('getSystemIconEmoji should fall back for unknown paths', () => {
    expect(DesktopAPI.getSystemIconEmoji('::{UNKNOWN-CLSID}')).toBe('\u{1F4C1}');
    expect(DesktopAPI.getSystemIconEmoji('C:\\Users\\test\\Desktop\\a.txt')).toBeNull();
  });

  test('getFileIcons should return icon for virtual folders', async () => {
    const files = [{ path: '::{645FF040-5081-101B-9F08-00AA002F954E}', isDirectory: true }];
    const result = await DesktopAPI.getFileIcons(files);
    expectIconResult(result['::{645FF040-5081-101B-9F08-00AA002F954E}'], '\u{1F5D1}\uFE0F');
  });

  test('getFileIcons should return fallback icon for unknown real files', async () => {
    const files = [{ path: 'C:\\nonexistent-dir\\x.txt', isDirectory: false }];
    const result = await DesktopAPI.getFileIcons(files);
    expectIconResult(result['C:\\nonexistent-dir\\x.txt'], '\u{1F4C4}');
  });

  test('clearIconCache should clear cached entries and remove cache file', async () => {
    const files = [{ path: '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}', isDirectory: false }];
    await DesktopAPI.getFileIcons(files);

    DesktopAPI.clearIconCache();
    const cacheFile = path.join(tmpDir, 'icon-cache.json');
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  test('cleanupIconCache should not throw and keep working', async () => {
    DesktopAPI.cleanupIconCache(['::aaa']);
    const result = await DesktopAPI.getFileIcons([
      { path: '::aaa', isDirectory: false },
      { path: '::bbb', isDirectory: false }
    ]);
    expect(result['::aaa']).toBeTruthy();
    expect(result['::bbb']).toBeTruthy();
  });
});
