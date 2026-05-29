# `_ai-ops/` — 0.2 AI / Ops cold-storage

The modules in this folder exist but are **never wired in 0.1**. They are kept
as type-checked source so the 0.2 LLM-driven recovery + ops-agent track can be
re-enabled in a single deliberate review, without resurrecting them through a
rebuild or a partial port.

The cold-storage invariant is enforced by
`test/monitor/ai-ops-cold-storage.test.ts`, which fails on purpose if any of
these classes get instantiated or wired in `src/app.ts`. Touching this folder
without updating that test is the wrong shape of change.

## Members

- `agent-pool.ts` — `AgentPool`. Web-agent / LLM concurrency pool. Holds the
  only live `ApprovalGate` producer; relighting it without first backing
  `ApprovalGate` with `actionRuns` (deferred T1 follow-up) is a known unsafe
  combination.
- `ops-agent.ts` — `OpsAgent`. Drives the alerting / digest / cascade / disk
  pressure cleanup pipeline. Constructed in tests only.
- `recovery-coordinator.ts` — `RecoveryCoordinator`. Routes container health
  signals to recovery actions. Constructed in `src/app.ts` for type wiring but
  `coordinator.start()` is intentionally never called.

The leaf-level helpers these classes depend on (`monitor/ops-types.ts`,
`monitor/ops-recovery.ts`, `monitor/recovery-policy.ts`, `llm/agent.ts`,
`llm/prompts.js`, etc.) remain in their original folders because they are also
used by hot 0.1 code paths (config, db, channels, auto-recovery). Splitting
those would not be behavior-neutral and is out of scope here.

## Why a `_` prefix?

The leading underscore mirrors the convention for "intentionally peripheral to
the public module graph" in tools like Next.js's `_app.tsx` — it shows up at
the top of folder listings, sorts above feature folders, and is hard to
mistake for a normal route / domain. The folder is also explicitly opted out
of the agent-orientation index in code reviews.

Re-enabling any of these for 0.2 must go through the agent-operable-spine
roadmap, not a one-off PR.
