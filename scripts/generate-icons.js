/**
 * 生成应用图标：SVG 设计稿 → 多尺寸 PNG + Windows ICO
 *
 * 用法：node scripts/generate-icons.js
 * 产出：
 *   build/icon.ico            打包用（含 16/24/32/48/64/128/256）
 *   assets/app-icon.png       窗口/系统图标（256）
 *   assets/tray-icon.png      托盘图标（32）
 *   assets/tray-icon-16.png   托盘图标（16）
 *
 * 修改设计稿 scripts/design/icon.svg 后重新运行即可。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

const svgPath = path.join(__dirname, 'design', 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function renderPng(size) {
  return sharp(svgBuffer).resize(size, size).png().toBuffer();
}

// ICO（Vista+ 支持内嵌 PNG）：ICONDIR 头 + N 个 ICONDIRENTRY + PNG 数据
function buildIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const entrySize = 16;
  let offset = headerSize + entrySize * count;
  const entries = [];
  const blobs = [];

  for (let i = 0; i < count; i++) {
    const png = pngBuffers[i];
    const size = SIZES[i];
    const buf = Buffer.alloc(entrySize);
    // 256 在 ICO 头中用 0 表示
    buf.writeUInt8(size >= 256 ? 0 : size, 0);
    buf.writeUInt8(size >= 256 ? 0 : size, 1);
    buf.writeUInt8(0, 2); // 调色板
    buf.writeUInt8(0, 3); // 保留
    buf.writeUInt16LE(1, 4); // 色彩平面
    buf.writeUInt16LE(32, 6); // 每像素位数
    buf.writeUInt32LE(png.length, 8); // 数据大小
    buf.writeUInt32LE(offset, 12); // 数据偏移
    entries.push(buf);
    blobs.push(png);
    offset += png.length;
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // 保留
  header.writeUInt16LE(1, 2); // 类型：图标
  header.writeUInt16LE(count, 4); // 图像数量

  return Buffer.concat([header, ...entries, ...blobs]);
}

(async () => {
  try {
    ensureDir(path.join(ROOT, 'build'));
    ensureDir(path.join(ROOT, 'assets'));

    const pngs = [];
    for (const size of SIZES) {
      const png = await renderPng(size);
      pngs.push(png);
      console.log(`PNG ${size}x${size}: ${png.length} bytes`);
    }

    const ico = buildIco(pngs);
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico);
    console.log(`ICO: ${ico.length} bytes (${SIZES.length} sizes)`);

    fs.writeFileSync(path.join(ROOT, 'assets', 'app-icon.png'), pngs[SIZES.indexOf(256)]);
    fs.writeFileSync(path.join(ROOT, 'assets', 'tray-icon.png'), pngs[SIZES.indexOf(32)]);
    fs.writeFileSync(path.join(ROOT, 'assets', 'tray-icon-16.png'), pngs[SIZES.indexOf(16)]);

    console.log('图标生成完成');
  } catch (e) {
    console.error('图标生成失败:', e);
    process.exit(1);
  }
})();
