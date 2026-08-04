# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.3] - 2026-08-04

### Performance

- Context menu helper rewritten without WinForms: pure Win32 message window
  (drops System.Windows.Forms assembly load) + /optimize+ compile.
  Process startup measured 81ms -> 52ms average (~36% faster).

## [1.4.2] - 2026-08-04

### Changed

- Folder preview panel now loads real file icons asynchronously (reusing the
  desktop icon extraction/cache pipeline; emoji placeholder while loading,
  emoji fallback on failure)

## [1.4.1] - 2026-08-04

### Fixed

- Preview settings label now covers both folder and image previews
- Image preview panel: widened to fit thumbnails without scrollbars; scrollbar
  corner no longer shows the default white square; panel repositions after
  image decode

## [1.4.0] - 2026-08-04

### Added

- Folder preview panel: double-click an entry to open it
- Image hover preview: hovering image files (jpg/png/gif/bmp/webp/svg/ico/tiff)
  shows a thumbnail (max 480px, files over 25MB skipped, SVG handled specially);
  double-click the preview to open the original

## [1.3.5] - 2026-08-04

### Fixed

- Topo/Ocean themes: brightened muted text colors and gave settings descriptions
  and search placeholders higher-contrast text so they stay readable at low
  opacity settings (75-80%)

## [1.3.4] - 2026-08-04

### Changed

- Topo/Ocean theme textures now visibly drift: animation sped up from 120s to
  30s per loop and texture stroke opacity/width increased (still GPU-composited
  transform, negligible performance cost)

## [1.3.3] - 2026-08-04

### Fixed

- Everything search no longer surprises with UAC prompts: the app now detects
  `run_as_admin=1` in Everything.ini and shows a warning in settings with
  step-by-step instructions to disable admin mode (not needed in service mode)

## [1.3.2] - 2026-08-04

### Fixed

- Folder preview no longer gets knocked out by passing over adjacent folder
  icons: switching previews now requires hovering the new icon for 200ms
  (hover-intent), so moving toward a preview window no longer misfires

## [1.3.1] - 2026-08-04

### Added

- Settings toggle for folder hover preview (can disable entirely)
- Folder preview panel: styled scrollbar matching the theme
- Folder preview now stays visible while the mouse is over the panel (250ms
  delayed hide), allowing scrolling through long contents

## [1.3.0] - 2026-08-04

### Added

- Dynamic texture themes: "Topo" (等高线) and "Ocean" (海洋) with slow-drifting SVG
  contour/wave animation on the title bar (pure CSS, 120s GPU transform loop)

## [1.2.0] - 2026-08-04

### Added

- Everything search integration: settings toggle shows a search bar under the title bar;
  Enter invokes `Everything.exe -search "keyword"` to open the native Everything window
- Auto-detects Everything via registry App Paths and common install locations
- Download prompt with official website link when Everything is not installed

### Performance

- Removed backdrop-filter blur on the main window (major scroll jank fix for transparent windows)
- Context menu now spawns a single process per right-click (was two: cancel + show)
- Removed forced list refresh after context menu closes (fs.watch covers it)
- Replaced exec with spawn for context menu helper process

## [1.1.2] - 2026-08-04

### Fixed

- System icons (This PC, Recycle Bin, Network, Control Panel...) now show real Windows icons:
  native module resolves `::{CLSID}` paths via SHParseDisplayName + SHGFI_PIDL
  (previously SHGetFileInfo fell back to a generic folder icon)

### Technical

- Fixed native build on machines with only Windows SDK 10.0.16299:
  - binding.gyp now pins msvs_windows_target_platform_version
  - source restores min/max macros after NOMINMAX
  - new build-native.ps1 patches node-addon-api's gyp and rebuilds reliably

## [1.1.1] - 2026-08-04

### Fixed

- System icons (This PC, Recycle Bin, etc.) now use native Windows icons via icon extractor, emoji used only as fallback
- Folder hover preview: system virtual folders (This PC/Recycle Bin/Control Panel) now enumerate contents via Shell COM instead of showing empty
- Folder hover preview position: auto flips to left/top when right side has no space
- Selection toolbar only appears for multi-selection (2+ items)
- Click empty area or click a selected item to deselect (toolbar disappears)

## [1.1.0] - 2026-08-04

### Added

- File system auto-watching (fs.watch): desktop changes refresh icons in real time
- Multi-select icons: Ctrl/Shift click + drag-box selection with batch toolbar
- Clipboard file operations: Ctrl+C/X/V copy/cut/paste to desktop
- Folder hover preview popup
- Icon position lock
- Auto-arrange rules (keyword/extension based auto categorization into groups)
- i18n: Simplified Chinese / English
- Customizable global shortcuts (record mode)
- Startup delay option
- Layout export/import (JSON)
- Double-click empty area to hide/show all icons
- Toast notifications

### Changed

- Improved UI: glassmorphism shadows, rounded corners, smoother transitions
- Icon rendering keeps selection state across refreshes (diff rendering)

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
