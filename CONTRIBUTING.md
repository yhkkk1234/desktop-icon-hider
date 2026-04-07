# Contributing to Desktop Icon Hider

Thank you for your interest in contributing to Desktop Icon Hider! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When creating a bug report, include:

- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Screenshots if applicable
- Your operating system and version
- Version of the application
- Any relevant logs or error messages

### Suggesting Enhancements

Enhancement suggestions are welcome! Please:

- Use a clear and descriptive title
- Provide a detailed description of the enhancement
- Explain why this enhancement would be useful
- Provide examples of how the enhancement would work
- Consider if this is a feature that would benefit many users

### Pull Requests

#### Fork and Clone

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/desktop-icon-hider.git`
3. Add upstream remote: `git remote add upstream https://github.com/original-username/desktop-icon-hider.git`

#### Create a Branch

Create a new branch for your feature or bugfix:
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

#### Make Changes

- Follow the code style guidelines in AGENTS.md
- Write clear, descriptive commit messages
- Add tests for new functionality
- Update documentation as needed
- Ensure all tests pass: `npm test`
- Run linter: `npm run lint`

#### Commit Your Changes

```bash
git add .
git commit -m "feat: add your feature description"
# or
git commit -m "fix: describe the bug fix"
```

#### Push and Create Pull Request

1. Push your branch: `git push origin feature/your-feature-name`
2. Create a pull request on GitHub
3. Fill in the PR template with details about your changes
4. Wait for review and address any feedback

## Development Setup

### Prerequisites

- Node.js 16.0 or higher
- npm or yarn
- Git

### Installation

1. Clone the repository:
```bash
git clone https://github.com/your-username/desktop-icon-hider.git
cd desktop-icon-hider
```

2. Install dependencies:
```bash
npm install
```

3. Start development server:
```bash
npm start
```

### Running Tests

```bash
npm test
```

### Building

```bash
npm run build:win
```

## Coding Guidelines

### Code Style

Follow the coding guidelines outlined in AGENTS.md:

- Use ES6+ syntax
- Follow naming conventions (camelCase, PascalCase, UPPER_SNAKE_CASE)
- Keep functions small and focused
- Add JSDoc comments for public functions
- Maximum line length: 120 characters

### Commit Messages

Follow conventional commits format:

```
<type>: <subject>

<body>

<footer>
```

Types: feat, fix, docs, style, refactor, test, chore

Example:
```
feat: add system tray icon

Add system tray icon with right-click menu for quick access to
common functions like hide/show desktop icons and minimize to tray.

Closes #123
```

### Testing

- Write unit tests for new functions
- Test edge cases and error conditions
- Ensure existing tests still pass
- Manual testing for UI changes

## Project Structure

```
desktop-icon-hider/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # Renderer process (UI)
│   ├── preload/           # Preload scripts
│   └── utils/             # Utility functions
├── __tests__/             # Test files
├── build/                 # Build scripts
├── dist/                  # Build output (not in git)
├── node_modules/          # Dependencies (not in git)
└── docs/                  # Documentation
```

## Documentation

- Keep README.md updated with new features
- Update AGENTS.md for code changes
- Add comments to complex code
- Document new APIs or functions
- Update CHANGELOG.md for user-facing changes

## Getting Help

- Check existing issues and pull requests
- Read the documentation
- Ask questions in GitHub Discussions
- Contact maintainers directly if needed

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in the project's contributors section. Thank you for your contributions!
