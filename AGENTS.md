# Desktop Icon Hider - Development Guide

## Project Overview
A desktop icon management tool that provides a single virtual partition to organize and hide/show desktop icons using a collapsible window.

## Build Commands

### Development
```bash
npm start              # Start the application
npm run dev            # Start with logging enabled
```

### Building
```bash
npm run build          # Build for all platforms
npm run build:win      # Build Windows installer and portable
```

### Testing & Quality
```bash
npm run lint          # Run ESLint
npm test              # Run Jest tests
```

## Code Style Guidelines

### File Structure
- All source code in `src/` directory
- Main process: `src/main/`
- Renderer process: `src/renderer/`
- Preload scripts: `src/preload/`
- Utilities: `src/utils/`

### JavaScript Conventions
- Use ES6+ syntax (const/let, arrow functions, template literals)
- Use async/await for asynchronous operations
- Add JSDoc comments for all public functions
- Maximum line length: 120 characters

### Naming Conventions
- **Files**: kebab-case (e.g., `window-manager.js`)
- **Variables**: camelCase (e.g., `mainWindow`, `isCollapsed`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `WINDOW_CONFIG`)
- **Classes**: PascalCase (e.g., `WindowManager`)
- **Functions**: camelCase, descriptive verbs (e.g., `createMainWindow`, `handleToggleCollapse`)

### Import/Export
- Use ES6 imports/exports
- Group imports: Node.js modules → External modules → Internal modules
- Order by alphabetical within groups
```javascript
const { app, BrowserWindow } = require('electron');
const Store = require('electron-store');
const { createMainWindow } = require('./window-manager');
const { getDesktopIcons } = require('./desktop-api');
```

### Error Handling
- Always use try-catch for async operations
- Provide meaningful error messages
- Log errors for debugging
- Graceful degradation for API failures

### Electron Best Practices
- Keep main process lightweight
- Use IPC for main-renderer communication
- Implement proper cleanup in app shutdown
- Use preload scripts for secure IPC bridges

### Windows API Integration
- All Windows API calls wrapped in try-catch
- Provide fallback mechanisms for API failures
- Log all API calls for debugging
- Handle different Windows versions gracefully

### UI/UX Guidelines
- Implement collapsible header with triangle indicator (▼ for expanded, ▶ for collapsed)
- Window should be transparent and always on top
- Header should be draggable
- Smooth animations for collapse/expand transitions
- Preserve state (position, collapse state) between sessions

### Configuration Management
- Use electron-store for persistent settings
- Store window position, collapse state, and user preferences
- Default values for all settings
- Migration strategy for config changes

### Testing Requirements
- Unit tests for utility functions
- Integration tests for IPC communication
- Manual testing required for Windows API functionality
- Test on Windows 10 and Windows 11

### Security Considerations
- Validate all user inputs
- Sanitize file paths
- Use contextIsolation: true
- Disable node integration in renderer
- Implement proper IPC validation

## Key Implementation Notes

### Window States
- **Expanded**: Full screen height with all icons visible
- **Collapsed**: Only header visible (30-40px height)
- **Draggable**: Header allows window repositioning
- **Persistent**: Remember last state and position

### Windows API Fallbacks
If primary method fails, implement these alternatives:
1. Registry-based icon hiding
2. COM interface with error recovery
3. Fallback to manual icon management

### Performance
- Minimize main thread blocking
- Use web workers for heavy operations
- Debounce window resize events
- Cache desktop icon data

### Debugging
- Enable verbose logging in dev mode
- Log all IPC communications
- Track Windows API calls
- Monitor memory usage

## Cursor/Copilot Rules (if any)
- Prioritize user experience and simplicity
- Maintain clean, readable code
- Follow existing project patterns
- Test Windows compatibility thoroughly
- Provide helpful error messages to users
