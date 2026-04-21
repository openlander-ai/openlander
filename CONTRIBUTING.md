# Contributing to OpenLander

Thanks for your interest in contributing to OpenLander. This guide will help you get started.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- npm (comes with Node.js)
- Docker installed and running

> npm manages packages and scripts. tsup builds with esbuild. Vitest runs tests under Node.js.

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

The dev command runs `tsup --watch` which compiles TypeScript via esbuild.
To run the application after building:

```bash
npm run start
# or directly:
node dist/cli/index.js
```

## Available Scripts

| Script                  | Description                                   |
| ----------------------- | --------------------------------------------- |
| `npm run dev`           | Build in watch mode (tsup --watch)            |
| `npm run build`         | Build the project for production              |
| `npm run start`         | Start the application via Node.js             |
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

## Project Structure

```
src/
├── agent/          # Agent orchestration and LLM tool execution
├── auth/           # Token store and authentication
├── cli/            # CLI entry point (Commander.js)
├── config/         # Configuration management (~/.openlander/)
├── channels/       # Multi-channel bots (Slack, Discord, Telegram)
├── db/             # Database layer (Drizzle ORM + SQLite)
├── events/         # Event system
├── git-providers/  # Git provider integrations (GitHub OAuth)
├── lib/            # Shared utilities (logger, helpers)
├── llm/            # LLM provider abstraction (Gemini, Claude, OpenAI, etc.)
├── mcp/            # MCP server for IDE integration
├── monitor/        # System stats monitoring (CPU, memory, disk)
├── pipeline/       # Deployment pipeline (Docker build, Traefik routing)
├── tools/          # Agent tools (deploy, logs, env, expose, etc.)
├── web/            # Hono REST API server (routes, middleware)
└── webhook/        # Git webhook handlers (auto-redeploy)

web/                # React frontend (Vite + React 19 + Tailwind CSS)
├── src/
│   ├── components/ # Reusable UI components (layout, sidebar, timeline, etc.)
│   ├── hooks/      # Custom React hooks
│   ├── i18n/       # Internationalization (English + Korean)
│   ├── lib/        # API client and utilities
│   └── pages/      # Page components (Projects, Settings, Services, etc.)
└── dist/           # Built frontend assets

test/               # Test files (Vitest, 703 tests)
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

Tests run under Node.js/Vitest with better-sqlite3 as the SQLite driver.
All 703 tests across 43 suites pass under Node.js.

Key test files:

- `test/dashboard-utils.test.ts` — utility functions for the web dashboard
- `test/db.test.ts` — 23 tests (database CRUD operations)
- `test/agent.test.ts` — 12 tests (agent orchestration)
- `test/pipeline.test.ts` — deployment pipeline tests
- `test/web-routes.test.ts` — REST API route tests
- `test/config.test.ts` — configuration management tests

Test files are located in the `test/` directory. Follow existing patterns:

- Mock contexts and LLM interactions
- Keep tests focused and isolated
- Use descriptive test names
- Test files mirror src/ structure

## Error Handling Conventions

OpenLander has a typed error hierarchy (`src/errors.ts`) and a layered policy for where checks live. Before adding error handling code, read AGENTS.md → "Error Handling" — it's the source of truth.

The short version:

- **Throw a named class.** `throw new Error('…')` is rejected at review. Use `ProjectNotFoundError`, `DeployLockedError`, `RepoPersistenceError`, etc., or add a new typed error to `src/errors.ts`.
- **Don't swallow.** A `catch` that only logs and then keeps running is the pattern that produced the GA-blocking partial-failure bug. Use `withRecoveryStage` (recovery code) or rethrow.
- **Mutate through the pipeline boundary.** Do not call Docker / DB writes directly from a route or tool. Add or extend an entry on `pipeline.*` so `assertProjectMutable` and `withDeployLock` apply automatically.
- **Reuse cross-cutting helpers.** `checkRecoveryEligibility`, `assertProjectMutable`, `withDeployLock`, `tryRejectIfNotMutable` — import them. Reimplementing is how invariants drift.
- **Make rejections visible.** Fire-and-forget tools (`redeploy_project`, `restart_project`, etc.) must do a synchronous policy check via `tryRejectIfNotMutable` before returning success — otherwise the user sees fake "redeploying" while the policy is rejecting.

If you find yourself wrapping the same `try/catch` in two places, you've found a missing helper. Pull it up before merging.

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

Common scopes: `web`, `agent`, `pipeline`, `mcp`, `cli`, `db`

Examples:

```
feat(web): add Cloudflare Settings form
fix(web): sidebar breakpoint adjustment
refactor(pipeline): split routes.ts into domain modules
test: add coverage for ServiceManager
```

## Code of Conduct

We follow the Contributor Covenant Code of Conduct. Please be respectful and inclusive in all interactions.
