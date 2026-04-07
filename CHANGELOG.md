# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-03-31

### Added

- Initial release of Desktop Icon Hider
- Single virtual partition for desktop icons
- Collapsible window with triangle indicator (▼/▶)
- Draggable header for window positioning
- Always-on-top transparent window with glass effect
- State persistence (position, collapse state)
- Boot auto-start functionality
- Desktop icons display and management
- Windows API integration for icon hiding/showing
- Multiple fallback methods for icon management
- Loading states and error handling
- Minimize and quit functionality
- Logging system (file and console)
- Configuration management with electron-store
- Electron auto-launch integration
- Registry-based icon hiding fallback
- Desktop icons reading from file system
- Icon type detection and rendering
- Responsive and modern UI design

### Technical

- Electron 27.0.0 framework
- Node.js native modules integration
- IPC communication between main and renderer processes
- Context isolation and security best practices
- Comprehensive error handling and logging
- Modular code structure with separation of concerns
- ESLint configuration for code quality
- Jest testing framework
- Electron Builder for packaging
- Cross-platform build configuration

## [Unreleased]

### Planned Features

- System tray icon integration
- Multiple virtual partitions support
- Icon search functionality
- Custom themes
- Keyboard shortcuts
- Icon sorting and filtering options
- Right-click context menu for icons
- Icon dragging and rearranging
- Export/import settings
- Update checker

### Planned Improvements

- Better Windows version compatibility
- Performance optimizations
- Memory usage reduction
- Startup time improvements
- More robust error recovery
- Enhanced logging and debugging tools
