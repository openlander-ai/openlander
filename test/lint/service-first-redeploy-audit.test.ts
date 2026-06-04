import { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

interface SourceFixture {
  relativePath: string;
  sourceFile: ts.SourceFile;
}

function readSource(relativePath: string): SourceFixture {
  const text = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
  return {
    relativePath,
    sourceFile: ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true),
  };
}

function collectCallTexts(source: SourceFixture): string[] {
  const calls: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      calls.push(node.expression.getText(source.sourceFile));
    }
    ts.forEachChild(node, visit);
  }

  visit(source.sourceFile);
  return calls;
}

describe('service-first redeploy audit', () => {
  it('keeps active MCP/web service redeploy callers on service identity', () => {
    const expectations = [
      {
        file: 'src/tools/defs/deployable-service.ts',
        required: 'context.appCtx.pipeline.redeployService',
        forbidden: 'context.appCtx.pipeline.redeploy',
      },
      {
        file: 'src/tools/defs/env.ts',
        required: 'appCtx.pipeline.redeployService',
        forbidden: 'appCtx.pipeline.redeploy',
      },
      {
        file: 'src/web/api/service-runtime-routes.ts',
        required: 'ctx.pipeline.redeployService',
        forbidden: 'ctx.pipeline.redeploy',
      },
    ] as const;

    for (const expectation of expectations) {
      const source = readSource(expectation.file);
      const calls = collectCallTexts(source);
      expect(calls, `${expectation.file} must call redeployService(service.id)`).toContain(
        expectation.required,
      );
      expect(calls, `${expectation.file} must not call project compatibility redeploy`).not.toContain(
        expectation.forbidden,
      );
    }
  });
});
