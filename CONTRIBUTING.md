# Contributing to OpenLander

Thanks for your interest in contributing to OpenLander. This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.1 (runtime + test runner)
- Node.js >= 22 (for npm scripts and tsup build)
- Docker installed and running

> **Why both?** Bun is the runtime (`openlander` runs on Bun). npm manages packages and scripts. tsup builds with esbuild. Vitest runs tests (also callable via `bun test`).

## Development Setup

```bash
# Clone the repository
git clone https://github.com/openlander-ai/OpenLander.git
cd OpenLander

# Install dependencies
npm install

# Build once (required before first run)
npm run build

# Start development mode (rebuild on file change)
npm run dev
```

The dev command runs `tsup --watch` which compiles TypeScript via esbuild with SolidJS JSX transform.

To run the TUI after building:

```bash
npm run start
# or directly:
bun --conditions=browser dist/cli/index.js
```

## Available Scripts

| Script                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Build in watch mode (tsup --watch)            |
| `npm run build`         | Build the project for production              |
| `npm run start`         | Start the application via Bun                 |
| `npm run lint`          | Run ESLint to check code quality              |
| `npm run lint:fix`      | Fix ESLint issues automatically               |
| `npm run format`        | Format code with Prettier                     |
| `npm run format:check`  | Check code formatting                         |
| `npm run typecheck`     | Run TypeScript type checking (`tsc --noEmit`) |
| `npm test`              | Run all tests (Vitest)                        |
| `npm run test:watch`    | Run tests in watch mode                       |
| `npm run test:coverage` | Run tests with coverage report                |
| `npm run clean`         | Clean build artifacts (`dist/`)               |

## Pre-commit Hooks

We use **Husky** + **lint-staged** to enforce quality on every commit:

1. **ESLint** `--fix` runs on all staged `*.ts` / `*.tsx` files
2. **Prettier** `--write` formats staged files

This means your code is auto-formatted on commit. If ESLint finds unfixable errors, the commit is rejected — fix the errors and try again.

## Code Style

We use ESLint with `strictTypeChecked` mode and Prettier.

- ESM only, no CommonJS
- Strict TypeScript (`strict: true`, `noUnusedLocals`, `noUncheckedIndexedAccess`)
- No `as any` type assertions
- No `@ts-ignore` or `@ts-expect-error` comments
- Follow existing code patterns and formatting

### TUI-specific Conventions

The TUI uses **@opentui/solid** (SolidJS-based terminal rendering):

- JSX elements are lowercase: `<box>`, `<text>`, `<textarea>`
- Use `fg={color}` for text color (NOT `color=` or `style={{ color }}`)
- Keyboard events use `evt.name` (NOT `evt.key` or `evt.char`)
- `useKeyboard((evt) => { ... })` for global key handlers
- SolidJS signals for state management (`createSignal`, `createMemo`, `createEffect`)

## Project Structure

```
src/
├── agent/          # Agent orchestration and LLM tool execution
├── cli/            # CLI entry point (Commander.js)
├── config/         # Configuration management (~/.openlander/)
├── channels/       # Multi-channel bots (Slack, Discord, Telegram)
├── db/             # Database layer (Drizzle ORM + SQLite)
├── events/         # Event system
├── git-providers/  # Git provider integrations (GitHub, GitLab, etc.)
├── ipc/            # IPC client for TUI ↔ backend communication
├── lib/            # Shared utilities (logger, helpers)
├── llm/            # LLM provider abstraction (Gemini, Claude, OpenAI, etc.)
├── mcp/            # MCP server (23 tools for Claude Code / Cursor)
├── monitor/        # System stats monitoring (CPU, memory, disk)
├── pipeline/       # Deployment pipeline (Docker build, Traefik routing)
├── tools/          # Agent tools (deploy, logs, env, expose, etc.)
├── tui/            # Terminal user interface (~5,700 lines)
│   ├── components/ # UI components (ChatPanel, Prompt, overlays, etc.)
│   ├── commands/   # Slash command registry
│   ├── state/      # State management (mode, focus)
│   ├── hooks/      # SolidJS hooks (useChat, useProjects, etc.)
│   ├── onboarding/ # Setup wizard screens
│   ├── theme.ts    # OpenCode-style dark theme
│   └── App.tsx     # Main app component
├── web/            # Hono REST API server
└── webhook/        # Git webhook handlers (auto-redeploy)

test/               # Test files (Vitest)
docs/               # Internal documentation
```

## Testing

We use Vitest for testing.

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch

# Run with coverage
npm run test:coverage
```

### Test Infrastructure

Tests run under Node.js/Vitest with a `bun:sqlite` compatibility shim (`test/__mocks__/bun-sqlite.ts`).
This allows all 420 tests across 22 suites to pass without requiring Bun runtime.

Key test files:

- `test/slash-commands.test.ts` — 52 tests (slash command registry, parsing, handlers)
- `test/slash-picker.test.ts` — 21 tests (autocomplete picker)
- `test/dashboard-utils.test.ts` — 68 tests (pure utility functions)
- `test/db.test.ts` — 23 tests (database CRUD operations)
- `test/agent.test.ts` — 12 tests (agent orchestration)

Test files are located in the `test/` directory. Follow existing patterns:

- Mock contexts and LLM interactions
- Keep tests focused and isolated
- Use descriptive test names
- Slash command tests: `test/slash-commands.test.ts` (52 tests)
- Slash picker tests: `test/slash-picker.test.ts` (21 tests)

## Submitting Changes

1. Fork the repository
2. Create a feature branch from main
3. Implement your changes
4. Run `npm run typecheck && npm run lint && npm test` before committing
5. Commit using conventional commit format (see below)
6. Submit a pull request

For major changes, please open an issue first to discuss the proposed changes.

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) with scope:

- `feat(scope):` - New feature
- `fix(scope):` - Bug fix
- `refactor(scope):` - Code refactoring
- `test:` - Test additions or changes
- `docs:` - Documentation changes
- `chore:` - Maintenance tasks

Common scopes: `tui`, `agent`, `pipeline`, `mcp`, `cli`, `db`

Examples:

```
feat(tui): add model selection overlay
fix(tui): use KeyEvent.name for keyboard handlers
refactor(tui): remove Tier 3 agent proxy commands
test: update slash command tests for new Tier 1 commands
```

## Code of Conduct

We follow the Contributor Covenant Code of Conduct. Please be respectful and inclusive in all interactions.
