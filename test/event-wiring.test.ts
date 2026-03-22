import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = path.join(ROOT, 'src');
const ROUTES_FILE = path.join(SRC_ROOT, 'web/api/routes.ts');
const EVENTS_FILE = path.join(SRC_ROOT, 'events/index.ts');

const EMIT_REGEX = /\.emit\(\s*['"]([^'"]+)['"]/g;
const ON_REGEX = /\.on\(\s*['"]([^'"]+)['"]/g;

function read(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function extractRegexMatches(content: string, regex: RegExp): string[] {
  const matches: string[] = [];

  for (const match of content.matchAll(regex)) {
    const value = match[1];
    if (value) {
      matches.push(value);
    }
  }

  return matches;
}

function getSrcFiles(): string[] {
  return globSync('**/*.ts', {
    cwd: SRC_ROOT,
    absolute: true,
    nodir: true,
  });
}

function getEmittedEvents(): Set<string> {
  const emitted = new Set<string>();

  for (const filePath of getSrcFiles()) {
    const content = read(filePath);
    for (const eventName of extractRegexMatches(content, EMIT_REGEX)) {
      emitted.add(eventName);
    }
  }

  return emitted;
}

function getSubscribedEvents(): Set<string> {
  const subscribed = new Set<string>();

  for (const filePath of getSrcFiles()) {
    const content = read(filePath);
    for (const eventName of extractRegexMatches(content, ON_REGEX)) {
      subscribed.add(eventName);
    }
  }

  return subscribed;
}

function parseRouteEventTypes(content: string): string[] {
  const blockMatch = content.match(/const\s+eventTypes\s*:[^=]*=\s*\[([\s\S]*?)\];/);
  if (!blockMatch) {
    throw new Error('Could not find eventTypes array in routes.ts');
  }

  return extractRegexMatches(blockMatch[1], /['"]([^'"]+)['"]/g);
}

function parseEventTypeUnion(content: string): string[] {
  const unionMatch = content.match(/export\s+type\s+EventType\s*=([\s\S]*?);/);
  if (!unionMatch) {
    throw new Error('Could not find EventType union in events/index.ts');
  }

  return extractRegexMatches(unionMatch[1], /['"]([^'"]+)['"]/g);
}

describe('Event wiring (static source scan)', () => {
  const routesContent = read(ROUTES_FILE);
  const eventTypesFromRoutes = parseRouteEventTypes(routesContent);
  const emittedEvents = getEmittedEvents();
  const subscribedEvents = new Set<string>([...getSubscribedEvents(), ...eventTypesFromRoutes]);

  const EXPECTED_UNMATCHED = new Set<string>([
    // Planned for future container health watcher signals.
    'container:health',
    // Tunnel lifecycle placeholders (URL event is emitted today).
    'tunnel:start',
    'tunnel:stop',
    // Reserved for explicit env mutation events.
    'env:set',
    'env:delete',
  ]);

  it('every UI-subscribed event has at least one emit source', () => {
    const missingEmitSource = eventTypesFromRoutes.filter(
      (eventName) => !emittedEvents.has(eventName),
    );
    const unexpectedMissing = missingEmitSource.filter(
      (eventName) => !EXPECTED_UNMATCHED.has(eventName),
    );

    expect(unexpectedMissing).toEqual([]);
    expect(new Set(missingEmitSource)).toEqual(EXPECTED_UNMATCHED);
  });

  it('every individual route subscription has an emit source', () => {
    const individualRouteSubscriptions = [
      'build:suggest',
      'build:inform',
      'agent:event',
      'question:pending',
    ];

    const missingEmitSource = individualRouteSubscriptions.filter(
      (eventName) => !emittedEvents.has(eventName),
    );

    expect(missingEmitSource).toEqual([]);
  });

  it('no EventType is completely dead (neither emitted nor subscribed)', () => {
    const eventTypes = parseEventTypeUnion(read(EVENTS_FILE));
    const deadTypes = eventTypes.filter(
      (eventName) => !emittedEvents.has(eventName) && !subscribedEvents.has(eventName),
    );

    const EXPECTED_DEAD_TYPES = new Set<string>([
      // v0.3 placeholders (MCP transport wiring not implemented yet).
      'mcp:connect',
      'mcp:disconnect',
    ]);

    const unexpectedDeadTypes = deadTypes.filter(
      (eventName) => !EXPECTED_DEAD_TYPES.has(eventName),
    );

    expect(unexpectedDeadTypes).toEqual([]);
    expect(new Set(deadTypes)).toEqual(EXPECTED_DEAD_TYPES);
  });
});
