# Agent Operability Evals

OpenLander is evaluated with coding agents, not only with API smoke tests. These
evals are intentionally scoped. They measure whether an agent can use the
OpenLander control plane to deploy and update an app without hand-assembling
low-level infrastructure or silently promoting an unsafe candidate.

They are not a broad benchmark suite, a universal uptime claim, or proof that
every workload is faster. They are product-direction checks for an agent-native
control plane, not a feature race against mature PaaS products.

## What Is Being Measured

The main question is:

> Can a smaller coding agent operate common deployment workflows through
> OpenLander's structured tools?

Each run is read in two layers.

### Product Gate

The Product Gate is pass/fail. If it fails, the agent behavior is not scored
because a clean-looking agent trace cannot compensate for a bad user-visible
outcome.

For the scenarios below:

- **Initial app deploy with Postgres + Redis** passes only if:
  - `/health` returns 200,
  - the app root returns 200,
  - invoice `POST` returns 201,
  - invoice `GET` returns the row,
  - repeated `GET` increments the Redis hit counter,
  - the advertised URL serves the app,
  - the app, Postgres, and Redis live in the intended OpenLander
    Project/network.
- **Bad-runtime update** passes only if:
  - the bad candidate does not become the public serving version,
  - the previous version stays serving,
  - OpenLander reports the failed candidate honestly.

### Agent Operability

After the Product Gate passes, I read the agent trace separately: did it stay on
the intended path, avoid unsafe overrides, use status/diagnostics, avoid shell
detours, and avoid excessive retry loops?

Not every evidence row has enough trace detail for a precise numeric score, so
the tables use a qualitative operability read instead of inventing a number.

## Fixture

The public fixture is
[`openlander-ai/ledgerly`](https://github.com/openlander-ai/ledgerly).

The initial-deploy table uses
[`ledgerly@qa/managed-deps-only`](https://github.com/openlander-ai/ledgerly/tree/qa/managed-deps-only):
a small Node app with managed Postgres and Redis dependencies. This branch is
scoped to platform-managed dependencies. User-owned external SaaS values such as
Stripe, SMTP, S3, or exchange API secrets are tested separately; OpenLander
should block when those values are missing rather than inventing plausible
secrets.

The bad-runtime update scenario uses a fixture branch that builds successfully
but starts crash-looping after boot. It is used to test whether an update path
keeps the previous version serving and reports the failed candidate honestly.

## Results

The tables below are anchored to the `v0.1.16` release line, with three runs per
row. The product-behavior evidence was collected on the accepted final RC for
that line
(`ghcr.io/openlander-ai/openlander:0.1.16-rc.10@sha256:20b71b46cc63d13b641ef7b82c1a0e84cf80d72988713a11cb38d3b215fccd52`);
the final release image is
`ghcr.io/openlander-ai/openlander:0.1.16@sha256:e79210865d49c6afc9e8a356996214935b942c8561fe64bb3c1b1895912bf117`,
and the final tag differs from that accepted RC only by release metadata.

Codex/GPT and Claude results are shown separately so release lines and model
families are not mixed. Earlier broader internal runs are kept out of these
public tables so the release line and run count stay consistent.

### Initial Deploy: App + Managed Postgres + Redis

- fixture commit: `0f912f76edf1f1e0c04b7ac5f79ee79b6751285e`

**Codex/GPT models**

| Model | Product Gate | Agent Operability read                              | MCP calls   | Failed MCP calls | Wall time         | Notes                                                                                                                                                                     |
| ----- | -----------: | --------------------------------------------------- | ----------- | ---------------: | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spark |     3/3 PASS | Two clean runs; one read-only tool-discovery detour | 9 / 10 / 12 |        3 / 0 / 0 | 86s / 48s / 57s   | One attempt tried MCP resource discovery and a local `openlander` CLI discovery command before using OpenLander MCP; no out-of-band infrastructure mutation was observed. |
| Mini  |     3/3 PASS | Near-clean across all three runs                    | 9 / 11 / 10 |        0 / 0 / 0 | 77s / 104s / 118s | Clean platform path; app/DB/cache topology correct.                                                                                                                       |

**Claude models**

| Model | Product Gate | Agent Operability read                                                                             | MCP calls    | Failed MCP calls | Wall time          | Notes                                                                                                                                                                            |
| ----- | -----------: | -------------------------------------------------------------------------------------------------- | ------------ | ---------------: | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haiku |     3/3 PASS | Gate pass with tool-discipline and path detours (manual assembly); not given a clean numeric score | 17 / 15 / 18 |        0 / 0 / 2 | 284s / 228s / 277s | Heavy inert shell narration (`echo`/`cat`/`true` scratch notes) plus read-only local probes; no out-of-band infrastructure mutation. App/DB/cache topology correct on every run. |

Read: all runs reached the correct OpenLander-managed app/Postgres/Redis
topology. Codex/GPT stayed closer to the composite deploy path; Claude Haiku
passed through a more manual, detour-heavy path. Those detours are counted as
operability issues, not Product Gate failures, because they did not mutate
infrastructure outside OpenLander.

### Bad-runtime Update

Current repeat evidence.

**Codex/GPT models**

| Model | Product Gate | Agent Operability read                            | MCP calls   | Failed calls | Public outcome                                           |
| ----- | -----------: | ------------------------------------------------- | ----------- | -----------: | -------------------------------------------------------- |
| Spark |     3/3 PASS | Two clean runs; one unclassified shell-detour run | 8 / 10 / 12 |    0 / 0 / 0 | Previous version kept serving; bad candidate not public. |
| Mini  |     3/3 PASS | Clean across all three runs                       | 8 / 10 / 9  |    0 / 0 / 0 | Previous version kept serving; bad candidate not public. |

**Claude models**

| Model | Product Gate | Agent Operability read                                           | MCP calls   | Failed calls | Public outcome                                           |
| ----- | -----------: | ---------------------------------------------------------------- | ----------- | -----------: | -------------------------------------------------------- |
| Haiku |     3/3 PASS | Clean safe-default path; light inert-shell narration on two runs | 13 / 12 / 7 |    1 / 0 / 0 | Previous version kept serving; bad candidate not public. |

Across both model families, the public route stayed on the previous marker, the
late-crash candidate appeared zero times in public samples, and the agent's
final report matched the failed-candidate outcome. Claude Haiku chose the
no-strategy update path (blue-green), never escalated to a forced replacement,
and reported the failed candidate honestly.

Spark's first run had non-failing shell use recorded by the harness. The exact
command detail was not snapshotted in the public evidence, so this document does
not assign that row a numeric operability score. It is tracked as an Agent
Operability detour, not a Product Gate failure.

## What These Results Do Not Claim

These evals do not claim:

- every workload deploys faster,
- every failure mode is solved,
- universal zero downtime,
- production-grade multi-tenant isolation,
- safe execution of arbitrary untrusted code,
- full CI/CD coverage.

They show that, on these scoped scenarios, OpenLander's deploy and safe default
update surfaces are usable by smaller agents while preserving product
correctness. The agent traces still vary in how cleanly they use the platform.

## Scope Of The Claim

These evals are about OpenLander's own agent-native surface: whether smaller
agents can deploy, inspect, and update safely on a trusted self-hosted server
using the structured MCP tools. Internal runs against other MCP-exposed
platforms inform our model-sensitivity work, but they are not reproduced here,
and this document makes no cross-platform ranking claim.

## Reproducing The Eval Shape

The public harness is not packaged yet, but the scenario shape is reproducible:

1. Install OpenLander on a clean Linux host.
2. Connect a fresh coding-agent session to the OpenLander MCP endpoint.
3. Ask it to deploy
   `https://github.com/openlander-ai/ledgerly/tree/qa/managed-deps-only`.
4. Verify the Product Gate:
   - `/health` 200,
   - app root 200,
   - invoice `POST` 201,
   - invoice `GET` returns the row,
   - repeated `GET` increments Redis hits,
   - app, Postgres, and Redis share the intended OpenLander Project/network.
5. For the bad-runtime scenario, start from a healthy Ledgerly app with a
   health check, switch to the late-crash fixture branch, and verify that the
   bad candidate is not promoted to the public route while the previous version
   stays serving.

Published numbers should be read as scenario evidence, not as a statistical
benchmark. Multi-run variance, model family differences, and harness behavior
are tracked separately as the eval suite matures.
