import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Deploy Kill build button → backend cancel route (PR #259 wire-up)', () => {
  // PR #259 added the backend cancel contract:
  //   POST /api/deployments/:id/cancel
  // Frontend wires the existing LogViewer Kill button to that endpoint
  // when the deploy stream is real (deploymentId set, !mockMode); the
  // mock path keeps the in-component `stream.kill()` simulator so
  // storybook / tests stay self-contained.

  const apiSource = readRepoFile('web/src/lib/api/projects.ts');
  const logViewerSource = readRepoFile('web/src/components/Shell/LogViewer.tsx');
  const deploymentDetailSource = readRepoFile('web/src/pages/DeploymentDetail.tsx');

  it('exposes a typed cancelDeployment client wrapping POST /api/deployments/:id/cancel', () => {
    expect(apiSource).toMatch(/export interface CancelDeploymentResponse/);
    expect(apiSource).toMatch(/cancelled: true/);
    expect(apiSource).toMatch(/outcome: 'cancelled'/);
    expect(apiSource).toMatch(/export async function cancelDeployment\(/);
    expect(apiSource).toMatch(/`\/api\/deployments\/\$\{deployId\}\/cancel`/);
    expect(apiSource).toMatch(/method: 'POST'/);
  });

  it('routes cancelDeployment through the shared fetchWithAuth client (Codex P3 round 1)', () => {
    // Round 1 review found cancelDeployment was using raw `fetch`, which
    // bypasses the project's auth/error handling. Pin the shared client
    // path so a future revert is caught at test time.
    expect(apiSource).toMatch(/await fetchWithAuth\(`\/api\/deployments\/\$\{deployId\}\/cancel`/);
  });

  it('mounts the Shell/LogViewer (with the Kill button) inside DeploymentDetail (production wire-up)', () => {
    // Codex P0 round 1: the Kill button only reaches users when the
    // production page actually mounts Shell/LogViewer. PR #258 removed
    // the in-modal mount in ServiceDetailV2; the canonical surface is
    // now `/projects/:id/deployments/:deployId` → DeploymentDetail.
    expect(deploymentDetailSource).toMatch(
      /import \{ LogViewer \} from '@\/components\/Shell\/LogViewer'/,
    );
    expect(deploymentDetailSource).toMatch(/<LogViewer\b[\s\S]*?deploymentId=\{deployId\}/);
    // Download wire-up: per PR #259 "Download은 기존 deployment detail
    // buildLog 사용". Pin the onDownload prop so the button reaches
    // a real handler instead of being a no-op.
    expect(deploymentDetailSource).toMatch(/onDownload=\{deployment\.buildLog \? handleDownload/);
  });

  it('renders the LogViewer for in-flight deploys when getDeploymentDetail 404s (Codex round 2 P0)', () => {
    // Codex round-2 P0: `getDeploymentDetail` 404s while the build is
    // still running because the `deploy_logs` row only materializes at
    // completion. The page must render the LogViewer on `deployId`
    // alone in that case — the SSE/cancel route resolves
    // service/project ids that the metadata route can't, so the Kill
    // button stays reachable for the case operators actually need it.
    expect(deploymentDetailSource).toMatch(/if \(!deployment\)/);
    expect(deploymentDetailSource).toMatch(
      /In-flight deploy fast-path[\s\S]*?<LogViewer\b[\s\S]*?deploymentId=\{deployId\}/,
    );
  });

  it('keeps the Kill button in Cancelling… until SSE terminal (Codex round 2 P2)', () => {
    // Codex round-2 P2 carryover: resetting `isCancelling` in the
    // success-path `finally` re-enables the Kill button between the
    // POST 200 and the SSE end frame — a small re-clickable window.
    // The fix only resets `isCancelling` on error; the success path
    // leans on connState → CANCELLED to hide the button via the
    // existing visibility guard.
    expect(logViewerSource).not.toMatch(/} finally \{\s*setIsCancelling\(false\);\s*\}/);
    expect(logViewerSource).toMatch(/setIsCancelling\(false\);\s*console\.warn/);
  });

  it('confirms with the operator before firing the cancel POST (Gemini round 2 P1)', () => {
    // Gemini round-2 P1: a one-click Kill on a 10-minute build is a
    // foot-gun. Pin the `window.confirm` guard so a future refactor
    // can't silently strip it.
    expect(logViewerSource).toMatch(/window\.confirm\(/);
  });

  it('routes the confirm copy through i18n (Codex round 3 P3)', () => {
    // Codex round-3 P3: the destructive-action prompt was hard-coded
    // English. Round-4 threads it via a `confirmKillMessage` prop and
    // the production caller wires `t('deploy.killConfirm')`. Both
    // language bundles must define the key per the project's
    // both-files-in-one-PR i18n rule.
    expect(logViewerSource).toMatch(/confirmKillMessage/);
    expect(deploymentDetailSource).toMatch(
      /confirmKillMessage=\{t\('deploy\.killConfirm'\)\}/,
    );
    const enSource = readRepoFile('web/src/i18n/en.ts');
    const koSource = readRepoFile('web/src/i18n/ko.ts');
    expect(enSource).toMatch(/killConfirm:\s*'Stop this deploy\?'/);
    expect(koSource).toMatch(/killConfirm:\s*'이 배포를 중지하시겠습니까\?'/);
  });

  it('narrows in-flight fallback to 404 only (Codex round 3 P3)', () => {
    // Codex round-3 P3: the previous `try { ... } catch` swallowed
    // every getDeploymentDetail failure, so a real 500/network error
    // would silently render the in-flight log surface. Round-4
    // changes the API client to return null on 404 and re-throw on
    // other failures, then the page checks `data === null` to enter
    // the in-flight fast-path.
    expect(apiSource).toMatch(/Promise<DeployLogDetail \| null>/);
    expect(apiSource).toMatch(/if \(res\.status === 404\) return null;/);
  });

  it('LogViewer Kill button calls cancelDeployment when streaming a real deployment', () => {
    expect(logViewerSource).toMatch(/import \{ cancelDeployment \} from '@\/lib\/api'/);
    expect(logViewerSource).toMatch(/await cancelDeployment\(String\(deploymentId\)\)/);
    // The kill button stays bound to onKill regardless of path; the
    // dispatch decision lives inside onKill.
    expect(logViewerSource).toMatch(/onClick=\{onKill\}/);
  });

  it('falls back to in-component stream.kill() when the source is the mock simulator', () => {
    // The mock path is exercised whenever `useReal === false` (i.e.
    // `mockMode === true` OR `deploymentId == null`). Pin the dispatch
    // so a future refactor doesn't accidentally make the kill button
    // a no-op for storybook / tests.
    expect(logViewerSource).toMatch(/if \(!useReal \|\| deploymentId == null\)/);
    expect(logViewerSource).toMatch(/stream\.kill\(\);/);
  });

  it('disables the Kill button + shows a transient state during the network call', () => {
    expect(logViewerSource).toMatch(/const \[isCancelling, setIsCancelling\] = useState\(false\)/);
    expect(logViewerSource).toMatch(/disabled=\{isCancelling\}/);
    expect(logViewerSource).toMatch(/isCancelling \? 'Cancelling…' : 'Kill build'/);
  });

  it('captures cancel errors so the operator sees a useful tooltip instead of a silent no-op', () => {
    // PR #259 spec returns 409 DEPLOYMENT_NOT_ACTIVE for terminal /
    // dead docker builds; the button surfaces the message via title.
    expect(logViewerSource).toMatch(/const \[cancelError, setCancelError\] = useState<string \| null>\(null\)/);
    expect(logViewerSource).toMatch(/title=\{cancelError \?\? undefined\}/);
  });
});
