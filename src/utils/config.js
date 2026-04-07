const Store = require('electron-store');

const store = new Store({
  name: 'desktop-icon-hider',
  defaults: {
    windowBounds: null,
    isCollapsed: false,
    autoLaunch: false,
    theme: 'light',
    language: 'zh-CN',
    lastPosition: null,
    windowState: 'normal'
  }
});

function getConfig(key) {
  return store.get(key);
}

function setConfig(key, value) {
  store.set(key, value);
}

function getAllConfig() {
  return store.store;
}

function resetConfig() {
  store.clear();
}

function updateConfig(updates) {
  Object.keys(updates).forEach(key => {
    store.set(key, updates[key]);
  });
}

function deleteConfig(key) {
  store.delete(key);
}

function hasConfig(key) {
  return store.has(key);
}

module.exports = {
  store,
  getConfig,
  setConfig,
  getAllConfig,
  resetConfig,
  updateConfig,
  deleteConfig,
  hasConfig
};
