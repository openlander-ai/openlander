#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/sync-release-version.mjs <version>');
  process.exit(1);
}

const files = ['package.json', 'web/package.json', 'package-lock.json', 'web/package-lock.json'];

for (const file of files) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  json.version = version;
  if (json.packages?.['']) {
    json.packages[''].version = version;
  }
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}
