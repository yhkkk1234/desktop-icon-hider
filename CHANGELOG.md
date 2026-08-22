# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Agent Sessions widget: four new harness adapters, all read-only and
  auto-detected at their default data locations (no settings needed; a
  harness that isn't installed simply stays hidden):
  - **ZCode** (`createZcodeAdapter`): reads `~/.zcode/cli/db/db.sqlite`.
    Its schema is a sibling of opencode's (session/part tables, the same
    `step-finish` part type), so it reuses the shared SQLite adapter
    factory; internal sub-agent sessions (`task_type='subagent_child'`)
    are filtered out. `ZCODE_HOME` env var overrides the root directory
  - **Antigravity** (Google, `createAntigravityAdapter`): scans
    `~/.gemini/antigravity/conversations/*.db` - one SQLite DB per
    conversation. Activity = file mtime; status = last `steps` row
    (3=finished / 9=running / 2,6,7=failed) mapped onto the shared
    classifier. Titles are best-effort (brain plan summary → workspace
    folder + time → uuid). Unchanged DBs are served from an mtime cache,
    so steady-state polls open zero SQLite connections
  - **Codex** (`createCodexAdapter`): reads the newest
    `~/.codex/state_*.sqlite` `threads` table (title/cwd/updated_at) and
    maps each rollout JSONL tail (`event_msg/task_complete` → turn
    finished); falls back to scanning `sessions/YYYY/MM/DD/*.jsonl` when
    no state DB exists. The `\\?\` extended-path prefix is stripped from
    cwd
  - **Claude Code** (`createClaudeAdapter`): scans the standard
    `~/.claude/projects/**/*.jsonl` layout; turn end = `type:'result'`
    line (success → done, error_* → interrupted), titles come from the
    summary line or first user message. Only changed files are re-parsed
    (head+tail slices, never the whole file)
  - Also fixed a latent bug in the shared SQLite adapter: the batch
    last-part query built a fixed 100 placeholders, so any opencode
    install with fewer than 100 sessions threw a bind-count error and
    the adapter always returned an empty list; placeholders are now
    built per actual row count
- Widget opacity: each widget type (clock / calendar / weather / monitor /
  agent / everything) now has its own opacity multiplier (30-100%, default
  100%) in Settings → Widget Opacity. It composes with the theme's own
  transparency instead of replacing it (implemented with `color-mix`, so
  material themes like glass keep their own surface formulas): effective
  alpha = theme base alpha × widget multiplier. Settings are persisted via
  the new `widget-opacity` store key and applied live to all widget nodes.
- DeepSeek Harness (dsh) support in the Agent Sessions widget via a new
  harness adapter (`createDshAdapter`):
  - Reads `~/.dsh/storages/session_projcache.json` (live projection cache)
    plus per-session transcript file mtimes; zero native dependencies
  - Status rules: `openStep`/`pendingCalls` → running; goal `phase`
    complete → done, blocked/paused → interrupted; otherwise transcript
    freshness fallback
  - Sessions appear in their own "DeepSeek Harness" group; the harness runs
    are detected independently (web port probe on 3080 by default, or
    headless detection via projection cache write activity), so each group
    shows its own "(off)" tag when that harness is not running
  - New settings: DeepSeek Harness port + data directory
    (`agentConfigs.dsh.{port,home}`), applied live without restart
- Agent Sessions widget: each harness group header now has a small collapse
  triangle; clicking it collapses/expands that harness's notification list
  (e.g. opencode or DeepSeek Harness independently). Collapsed state is
  persisted per harness (`agentCollapsedHarnesses`) and survives restarts;
  the count badge keeps updating while collapsed
- New "Window Height" setting (`rememberWindowHeight`): when enabled, the
  expanded window restores the height you manually set last time (clamped to
  the current work area); when disabled it keeps the original design -
  expanded always fills the work area height above the taskbar. Startup
  restore and the collapse/expand toggle share the same helper, so both
  behave consistently
- Clock widget now offers four switchable styles via a style button on the
  widget (persisted per widget in the `widgets` array):
  - digital (default): the original large digits + date
  - minimal: thin large HH:MM with a muted small date
  - flip: flip-clock cards with a 3D roll animation (opaque rolling halves
    with brightness fold shading, gated by prefers-reduced-motion; colon
    blinks each second)
  - seven: red glowing 7-segment display with blinking colons
- Clock style fixes:
  - Flip half pages now use absolute positioning with complementary
    clipping so the bottom half always shows the lower part of the digit
    (previously both halves rendered the same top half)
  - Flip roll animation made more visible: rolling halves get an opaque
    background + hidden backface so the fold truly occludes the static half,
    stronger perspective, a longer 360ms asymmetric ease (top falls in, bottom
    lands out), and a brightness fold shading
  - Switching to flip/seven clears and hides the top text area (previously a
    stale digital time remained above the styled face)
  - 7-segment digit rebuilt with thinner 4px segments (16×30 digit, smaller
    colon dots)

### Changed

- Agent widget menu label renamed from "OpenCode Sessions" to "Agent
  Sessions"; runtime detection is now per-harness (opencode + dsh) and the
  renderer marks groups offline individually
- `AgentMonitor.poll` prefers an adapter-provided `status` (dsh) and falls
  back to the shared `classifySession` (opencode semantics)

- Agent Sessions widget is now a pure status notifier (no jump/open):
  - Running sessions are live status indicators and are not clickable
  - Finished/interrupted sessions are messages: click marks them read and
    removes them from the list (kept until clicked, within the retention
    days setting)
  - Resumed sessions automatically flip back to "running" in place (same id,
    no duplicate entries); sessions that complete again re-appear because
    read marks are cleared on status transitions
  - Removed all client-ecosystem dependencies: no deep links, no process/
    window detection, no terminal spawning, no runtime click guard
    (DB polling is the only source of truth)
  - Dropped `open-agent-session` IPC and `check-agent-runtime` IPC (the
    "opencode not running" indicator still works via periodic detection)
  - Agent config storage is now nested per harness
    (`agentConfigs.opencode.{port,password}`) with automatic migration from
    the old flat keys; the IPC is generalized to `set-agent-config(harness,
    config)` so future agents (Codex, Claude Code, ...) each get their own
    config group without touching the settings plumbing

### Fixed

- Monitor widget VRAM value (e.g. "534 MB") no longer wraps the number and
  unit onto two lines: the number and unit are joined with a non-breaking
  space, the value elements use `white-space: nowrap`, and the chart/bar
  value columns use `min-width` instead of a fixed width
- Weather widget no longer flashes the "loading" placeholder on refresh:
  the loading state now shows only on first load, keeping the previous
  weather content visible until new data arrives

## [1.9.0] - 2026-08-10

### Added

- New "Agent Sessions" widget that monitors running local AI agent (harness)
  conversations at a glance:
  - Groups sessions by harness (currently opencode), each group shows a list
    of rounded session rows (project name + conversation title + status)
  - Running sessions show a spinning indicator; finished ones show a green
    checkmark; interrupted ones (Ctrl+C / closed terminal) show a warning mark
  - Clicking a session opens it in a new terminal window running
    `opencode -s <id>` via `cmd /c start` (forces a new console window;
    the deep-link to the Desktop app was dropped — it has no per-session
    deep link and cross-client detection proved fragile). Running sessions
    are not clickable (they are already running in some client) and show a
    hint instead; clicking finished/interrupted sessions marks them read
    and hides them from the list
  - Status is derived by polling the opencode SQLite database (last activity
    timestamp + last message part type, e.g. `step-finish`)
  - Read sessions are persisted locally and the active window threshold
    (default 120s) can be tuned via `agentActiveThreshold`
  - Widget scrollbar follows the app theme; scrolling temporarily disables the
    backdrop blur to avoid stutter
  - Performance: the opencode poll query went from ~700ms to ~1ms per cycle by
    caching last-message-part lookups (the `part` table has no usable index, so
    per-session subqueries used to scan 100k+ rows on every poll and froze the
    UI ~0.7s every 2.5s); snapshots are only pushed to the renderer when the
    session list/status actually changes
  - Status calibration via the opencode server: the app probes for a local
    opencode server (`opencode serve` on 4096 by default, custom port/password
    configurable in settings; authenticated with `OPENCODE_SERVER_PASSWORD` or
    open if unset) and subscribes to its SSE `/event` stream. Authoritative
    `session.status` events (busy/retry → running, idle → finished) override the
    DB-based inference in real time; when no server is reachable it silently
    falls back to DB inference. Note: the OpenCode Desktop sidecar uses a
    random port and a random password (verified: `/global/health` returns 401),
    so the calibration channel only works with a user-run `opencode serve`
  - Faster completion detection without a server: a session whose last message
    part is `step-finish` now flips to "done" after a 15s confirmation window
    instead of waiting for the 120s activity threshold
  - Clicking a session no longer freezes the UI: the desktop-client check runs
    asynchronously (spawn instead of a blocking ~230ms `tasklist` call) with a
    10s result cache; the poll snapshot signature ignores `time_updated`, so
    running sessions don't trigger a renderer push every 2.5s
  - Robustness: terminal shell detection (pwsh/powershell/cmd) is also
    asynchronous with a 10s cache; SSE reconnect re-probes ports after 5
    failures (desktop restart / port changes) and stops retrying on auth
    errors; the server status provider is disposed on app quit
  - Finished-session retention: sessions completed more than N days ago (default
    7, configurable in settings, 0 = keep all) are hidden from the widget list
    until they become active again
  - The Agent widget is resizable: drag the bottom-right corner handle to grow
    the list area (min 220x140 to keep content visible, size persisted per
    widget); backdrop blur is suspended while resizing to avoid stutter.
    Double-click the handle to reset to the default size (content-adaptive
    height)
  - When opencode is not running the widget greys out the session rows
    (clicks are ignored, no read-marking) and appends a light "(off)" tag to
    the harness name. Runtime detection combines desktop/CLI process checks
    (5s cache) with a real-time port probe and a short 15s confirmation
    window, so the closed state is reflected within ~20s instead of relying
    on a slow 60s+ settle
  - Clicking a session now re-verifies the runtime in real time (uncached
    process + port probe, ~300ms) before jumping: even within the 15s
    confirmation window, clicking after opencode closed is rejected — no
    terminal launch, no read-marking, the row stays put
  - Deep links now send Windows backslash paths (`F:\project`) matching what
    the desktop app stores internally — the forward slashes from the DB were
    treated as a different project, causing duplicate project windows instead
    of focusing the already-open one (per official deep-links docs)

## [1.8.4] - 2026-08-06

### Fixed

- Calendar widget now rolls over at midnight: a 60s timer detects date
  changes and re-renders the calendar (previously it stayed on the old date
  until the widget was recreated)

## [1.8.3] - 2026-08-04

### Added

- Weather widget shows today's high/low range (small line under the live
  temperature, e.g. "今日 ↑38° ↓27°")
- Weather widget can re-configure the city anytime via a hover "⚙" button
  (was only configurable on first setup); city search supports districts
  (e.g. 通州/Tongzhou)

## [1.8.2] - 2026-08-04

### Fixed

- Weather widget no longer turns into a clock after restart: the widget
  type whitelist in set-widgets was missing 'weather' and coerced it to
  'clock' when persisting

## [1.8.1] - 2026-08-04

### Fixed

- Settings panel and rules list scrollbars now use the themed style
  (were the default Windows scrollbars)

## [1.8.0] - 2026-08-04

### Added

- Weather widget (phase 3): Open-Meteo (free, no API key). Click to configure
  a city (geocoding search), shows emoji condition, temperature, humidity and
  wind; refreshes every 30 min with 10-min server-side cache

## [1.7.3] - 2026-08-04

### Fixed

- Widget drag tracking at high speed: setPointerCapture could throw
  ("No active pointer") on rapid clicks, aborting the drag setup. The
  window-level mouse fallback listeners are now attached BEFORE
  setPointerCapture, and capture failures are caught and ignored, so the
  widget always follows the cursor within the window

## [1.7.2] - 2026-08-04

### Fixed

- Widget dragging no longer stutters: backdrop-filter is disabled while
  dragging (was recalculating the blur every frame), with a stronger shadow
  as visual feedback; added pointercancel / document pointerup / window blur
  fallbacks so the drag can never get stuck

## [1.7.1] - 2026-08-04

### Fixed

- Widget add menu (🧩) now opens correctly: groups-bar is the positioning
  context for the absolute-positioned menu (previously it rendered off-position)

## [1.7.0] - 2026-08-04

### Added

- Widgets (phase 2): clock (live seconds) and calendar (month navigation)
  widgets rendered in a fixed layer above the icon grid; drag to reposition
  (percentage coords, persisted); add via 🧩 in the group bar, remove via
  hover ×; show/hide toggle in settings; hidden while window is collapsed

## [1.6.2] - 2026-08-04

### Added

- Group folder thumbnails can now use real file icons (default, async load via
  the icon extraction/cache pipeline) or type emoji icons - switchable in
  settings

## [1.6.1] - 2026-08-04

### Fixed

- Switching back to tab mode now properly re-renders the group tabs
- Folder mode main view hides icons already stored in groups (system icons
  stay visible), like phone desktops
- Group folder icon is now a rounded square with a 2x2 grid of the group's
  first four file thumbnails (type emojis) plus a count badge

## [1.6.0] - 2026-08-04

### Added

- Folder-style groups (phone-desktop style): groups render as openable folder
  icons in the grid with count badges; click to open (return bar + group
  contents), drag icons onto a folder to add (auto-named by file type when
  the group has a default name), drag out of the group view to remove
- Setting to switch between "Folder" mode and the classic "Top tabs" mode
  (same groups data, both modes share everything)

## [1.5.7] - 2026-08-04

### Fixed

- Background image now follows the UI opacity setting (--opacity-bg), so the
  window stays semi-transparent in background mode like in theme mode

## [1.5.6] - 2026-08-04

### Changed

- Background image edge shadow deepened (32px / 0.42 alpha) for a cleaner,
  fully shadowed border in background mode

## [1.5.5] - 2026-08-04

### Fixed

- Background image mode: added an inset edge shadow and increased the image
  zoom (1.12 -> 1.2) so bright blurred image edges no longer show as a
  faint light border at the window edge (edge color varied with image)

## [1.5.4] - 2026-08-04

### Fixed

- Background image mode: removed the header's own 1px top inset highlight,
  which showed as a thin white edge once the window-level highlight was gone

## [1.5.3] - 2026-08-04

### Fixed

- Background image mode: removed the 1px top inset highlight and light border
  that became visible as a thin white edge on the transparent window

## [1.5.2] - 2026-08-04

### Fixed

- Background image layer now inherits the window's border-radius so the
  rounded corners stay rounded in background-image mode (no straight-corner
  bleed)

## [1.5.1] - 2026-08-04

### Fixed

- Background image layer no longer covers icons/text: moved to z-index -1 so
  content stays above it (previously the absolutely-positioned layer rendered
  over non-positioned content)

## [1.5.0] - 2026-08-04

### Added

- Custom background image: pick any local image as the window background with
  blur and dim sliders (default 24px blur / 45% dim) for a soft, readable
  ambience; stored as compressed JPEG in userData; themes still control text
  and controls

## [1.4.4] - 2026-08-04

### Fixed

- Multi-select icons can now be dragged into a group in one go (all added,
  items already in the group are skipped); single drag keeps toggle semantics

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
