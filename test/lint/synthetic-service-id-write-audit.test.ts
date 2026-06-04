import { readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

interface SourceFixture {
  relativePath: string;
  text: string;
  sourceFile: ts.SourceFile;
}

function readSource(relativePath: string): SourceFixture {
  const text = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
  return {
    relativePath,
    text,
    sourceFile: ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true),
  };
}

function methodName(node: ts.MethodDeclaration): string | undefined {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
    return node.name.text;
  }
  return undefined;
}

function findMethod(source: SourceFixture, name: string): ts.MethodDeclaration {
  const matches: ts.MethodDeclaration[] = [];

  function visit(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && methodName(node) === name) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(source.sourceFile);
  expect(
    matches,
    `Expected ${source.relativePath} to contain exactly one method ${name}`,
  ).toHaveLength(1);
  return matches[0]!;
}

function methodText(source: SourceFixture, name: string): string {
  return findMethod(source, name).getText(source.sourceFile);
}

function callExpressionLeafName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function collectCallStarts(source: SourceFixture, node: ts.Node, calleeText: string): number[] {
  const starts: number[] = [];

  function visit(child: ts.Node): void {
    if (ts.isCallExpression(child) && child.expression.getText(source.sourceFile) === calleeText) {
      starts.push(child.getStart(source.sourceFile));
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return starts;
}

function collectCallsByLeafName(
  source: SourceFixture,
  node: ts.Node,
  leafName: string,
): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];

  function visit(child: ts.Node): void {
    if (ts.isCallExpression(child) && callExpressionLeafName(child.expression) === leafName) {
      calls.push(child);
    }
    ts.forEachChild(child, visit);
  }

  visit(node);
  return calls;
}

describe('synthetic service id write audit', () => {
  it('keeps first-Application deploy ordering ahead of service-scoped writes', () => {
    const source = readSource('src/pipeline/deploy-core.ts');
    const deployInner = findMethod(source, 'deployInner');

    const ensureStarts = collectCallStarts(
      source,
      deployInner,
      'this.ensureFirstApplicationService',
    );
    expect(ensureStarts, 'Expected deployInner to call ensureFirstApplicationService').toHaveLength(
      1,
    );
    const ensureStart = ensureStarts[0]!;

    for (const writeCall of ['this.db.createEnvironment', 'this.deployEnvironment']) {
      const writeStarts = collectCallStarts(source, deployInner, writeCall);
      expect(writeStarts.length, `Expected deployInner to call ${writeCall}`).toBeGreaterThan(0);
      const firstWriteStart = Math.min(...writeStarts);
      expect(
        ensureStart,
        `${writeCall} must happen after ensureFirstApplicationService`,
      ).toBeLessThan(firstWriteStart);
    }

    expect(
      collectCallsByLeafName(source, source.sourceFile, 'projectIdToDeployableServiceId'),
    ).toEqual([]);
  });

  it('requires service-FK repositories to resolve an existing service before inserts', () => {
    const environmentRepo = readSource('src/db/repos/environment.repo.ts');
    expect(methodText(environmentRepo, 'createEnvironment')).toContain(
      'await this.resolveExistingCanonicalServiceId(environment.projectId)',
    );
    expect(
      collectCallsByLeafName(
        environmentRepo,
        findMethod(environmentRepo, 'createEnvironment'),
        'projectIdToDeployableServiceId',
      ),
    ).toEqual([]);

    const deployLogRepo = readSource('src/db/repos/deploy-log.repo.ts');
    expect(methodText(deployLogRepo, 'createDeployLog')).toContain(
      'await this.resolveExistingCanonicalServiceId(log.projectId)',
    );
    expect(
      collectCallsByLeafName(
        deployLogRepo,
        findMethod(deployLogRepo, 'createDeployLog'),
        'projectIdToDeployableServiceId',
      ),
    ).toEqual([]);

    const deployConfigRepo = readSource('src/db/repos/deploy-config.repo.ts');
    expect(methodText(deployConfigRepo, 'save')).toContain(
      'await this.resolveExistingCanonicalServiceId(projectId)',
    );
    expect(
      collectCallsByLeafName(
        deployConfigRepo,
        findMethod(deployConfigRepo, 'save'),
        'projectIdToServiceId',
      ),
    ).toEqual([]);

    const incidentRepo = readSource('src/db/repos/runtime-incident.repo.ts');
    expect(methodText(incidentRepo, 'createIncident')).toContain(
      'await this.resolveExistingCanonicalServiceId(opts.projectId)',
    );
    expect(
      collectCallsByLeafName(
        incidentRepo,
        findMethod(incidentRepo, 'createIncident'),
        'projectIdToServiceId',
      ),
    ).toEqual([]);

    const connectionRepo = readSource('src/db/repos/service-connection.repo.ts');
    expect(methodText(connectionRepo, 'createConnection')).toContain(
      'await this.resolveExistingCanonicalConsumerId(opts.projectId)',
    );
    expect(methodText(connectionRepo, 'upsertConnection')).toContain(
      'opts.consumerServiceId ?? (await this.resolveExistingCanonicalConsumerId(opts.projectId))',
    );
    expect(
      collectCallsByLeafName(
        connectionRepo,
        findMethod(connectionRepo, 'createConnection'),
        'projectIdToDeployableServiceId',
      ),
    ).toEqual([]);
    expect(
      collectCallsByLeafName(
        connectionRepo,
        findMethod(connectionRepo, 'upsertConnection'),
        'projectIdToDeployableServiceId',
      ),
    ).toEqual([]);
  });

  it('keeps ManagedServiceLinker on concrete consumer service ids', () => {
    const source = readSource('src/pipeline/managed-service-linker.ts');
    expect(source.text).toContain('consumerServiceId: consumer.id');
    expect(source.text).toContain('source_service_id: consumer.id');
    expect(
      collectCallsByLeafName(source, source.sourceFile, 'projectIdToDeployableServiceId'),
    ).toEqual([]);
  });
});
