# GUIDE-05: Error Taxonomy

## 1. Purpose

Error UI should help an operator decide what to do next. Prefer concrete backend
error codes and original messages over generic failure text.

## 2. Error Class IDs

Failure summaries may reference stable class IDs such as:

- `BUILD_CONTEXT_MISMATCH`
- `DOCKERFILE_MISSING`
- `ENV_REQUIRED`
- `PORT_CONFLICT`
- `HEALTHCHECK_FAILED`
- `DEPLOY_LOCKED`
- `PROJECT_HAS_ACTIVE_SERVICES`

When a backend error code is available, preserve it in the UI payload and render a
human explanation around it.

## 3. Surfaces

- Inline field errors for invalid input.
- Banners for blocking operational state.
- Failure summaries for deploy/runtime diagnosis.
- Activity rows for durable audit history.
