import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backendSource = readFileSync('src/web/api/deploy-log-stream-routes.ts', 'utf8');
const hookSource = readFileSync('web/src/hooks/use-deploy-log-stream.ts', 'utf8');

describe('deploy log SSE contract', () => {
  it('frontend consumes the backend named line/end SSE events', () => {
    expect(backendSource).toContain("formatSseFrame('line'");
    expect(backendSource).toContain("formatSseFrame('end'");
    expect(backendSource).toContain("api.post('/deployments/:id/cancel'");
    expect(backendSource).toContain("payload.cancelled === true ? 'cancelled' : 'fail'");
    expect(
      readFileSync('src/web/api/deploy-failure-handler.ts', 'utf8'),
    ).toContain("payload.cancelled === true ? 'Cancelled' : 'Failed'");

    expect(hookSource).toContain("addEventListener('line'");
    expect(hookSource).toContain("addEventListener('end'");
    expect(hookSource).toContain('onmessage');
  });
});
