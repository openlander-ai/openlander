# Contributing to OpenLander

Thanks for your interest in contributing to OpenLander. This guide will help you get started.

## Prerequisites

- Node.js >= 22
- Docker installed and running

## Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/openlander.git
cd openlander

# Install dependencies
npm install

# Start development mode
npm run dev
```

The dev command runs `tsup --watch` to build the project in watch mode.

## Available Scripts

| Script                 | Description                        |
| ---------------------- | ---------------------------------- |
| `npm run dev`          | Build in watch mode (tsup --watch) |
| `npm run build`        | Build the project for production   |
| `npm run start`        | Start the application              |
| `npm run lint`         | Run ESLint to check code quality   |
| `npm run lint:fix`     | Fix ESLint issues automatically    |
| `npm run format`       | Format code with Prettier          |
| `npm run format:check` | Check code formatting              |
| `npm run typecheck`    | Run TypeScript type checking       |
| `npm test`             | Run all tests                      |
| `npm run test:watch`   | Run tests in watch mode            |
| `npm run clean`        | Clean build artifacts              |

## Code Style

We use ESLint with strictTypeChecked mode and Prettier to maintain code quality.

- ESM only, no CommonJS
- Strict TypeScript configuration
- No `as any` type assertions
- No `@ts-ignore` comments
- Follow existing code patterns and formatting

## Project Structure

The `src/` directory contains the main application code:

- `agent/` - Agent orchestration and execution logic
- `pipeline/` - Deployment pipeline components
- `tui/` - Terminal user interface
- `web/` - Web interface components
- `cli/` - Command line interface
- `db/` - Database layer and models
- `channels/` - Communication channels
- `mcp/` - MCP (Model Context Protocol) integration

## Testing

We use Vitest for testing.

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch
```

Test files are located in the `test/` directory. Follow existing patterns for writing tests:

- Mock contexts and LLM interactions
- Keep tests focused and isolated
- Use descriptive test names

## Submitting Changes

1. Fork the repository
2. Create a feature branch from main
3. Implement your changes
4. Test thoroughly
5. Submit a pull request

For major changes, please open an issue first to discuss the proposed changes.

## Commit Convention

We use Conventional Commits format:

- `feat:` - New feature
- `fix:` - Bug fix
- `chore:` - Maintenance tasks
- `docs:` - Documentation changes
- `test:` - Test additions or changes
- `refactor:` - Code refactoring

Example: `feat: add support for Node.js 22`

## Code of Conduct

We follow the Contributor Covenant Code of Conduct. Please be respectful and inclusive in all interactions.
