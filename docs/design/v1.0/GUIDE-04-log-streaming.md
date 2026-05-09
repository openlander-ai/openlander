# GUIDE-04: Log Streaming

## 1. Goals

The log viewer must support both active streams and replayed deployment logs. It
should make progress legible without inventing state the backend did not verify.

## 2. Two-Axis FSM

The viewer tracks two independent axes:

- **Connection**: connecting, following, paused, disconnected.
- **Job outcome**: running, succeeded, failed, cancelled, unknown.

Connection state describes the stream. Job outcome describes the deployment.
Do not collapse these into one boolean.

## 3. Phases

Deployment log lines may include phase IDs such as clone, image_pull, build,
container_create, container_start, and healthcheck_wait. The phase rail should
use backend-provided phase IDs when available.

## 4. Actions

Copy and Download operate on visible/replayed log text. Kill build calls the
backend cancellation endpoint only while a build is active.
