const path = require('path');

const FILE_ICONS = {
  'folder': '📁',
  'txt': '📄',
  'pdf': '📕',
  'doc': '📘',
  'docx': '📘',
  'xls': '📗',
  'xlsx': '📗',
  'ppt': '📙',
  'pptx': '📙',
  'jpg': '🖼️',
  'jpeg': '🖼️',
  'png': '🖼️',
  'gif': '🖼️',
  'mp3': '🎵',
  'wav': '🎵',
  'mp4': '🎬',
  'avi': '🎬',
  'mkv': '🎬',
  'zip': '📦',
  'rar': '📦',
  '7z': '📦',
  'exe': '⚙️',
  'msi': '⚙️',
  'js': '📜',
  'html': '🌐',
  'css': '🎨',
  'json': '📋',
  'default': '📄'
};

function getFileIcon(filename, isDirectory = false) {
  if (isDirectory) {
    return '📁';
  }
  
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  
  return FILE_ICONS[ext] || FILE_ICONS['default'];
}

function getFileIconSVG(filename, isDirectory = false) {
  if (isDirectory) {
    return '<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/></svg>';
  }
  
  return '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2L18 22c1.1 0 2-.9 2-2V8l-6-6z"/></svg>';
}

function getFileTypeDescription(filename, isDirectory = false) {
  if (isDirectory) {
    return '文件夹';
  }
  
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  
  const typeMap = {
    'txt': '文本文档',
    'pdf': 'PDF文档',
    'doc': 'Word文档',
    'docx': 'Word文档',
    'xls': 'Excel表格',
    'xlsx': 'Excel表格',
    'ppt': 'PowerPoint演示',
    'pptx': 'PowerPoint演示',
    'jpg': '图像文件',
    'jpeg': '图像文件',
    'png': '图像文件',
    'gif': '图像文件',
    'mp3': '音频文件',
    'wav': '音频文件',
    'mp4': '视频文件',
    'avi': '视频文件',
    'mkv': '视频文件',
    'zip': '压缩文件',
    'rar': '压缩文件',
    '7z': '压缩文件',
    'exe': '应用程序',
    'msi': '安装程序',
    'js': 'JavaScript文件',
    'html': '网页文件',
    'css': '样式表文件',
    'json': '数据文件'
  };
  
  return typeMap[ext] || '文件';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

module.exports = {
  getFileIcon,
  getFileIconSVG,
  getFileTypeDescription,
  formatFileSize
};
