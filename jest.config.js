module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/main/index.js',
    '!src/preload/preload.js'
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js']
};