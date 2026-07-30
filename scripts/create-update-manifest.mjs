#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function readArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || !value) return null;
    values.set(key.slice(2), value);
  }
  return values;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  return (
    manifest.schema_version === 1 &&
    typeof manifest.version === 'string' &&
    SEMVER.test(manifest.version) &&
    typeof manifest.minimum_source_version === 'string' &&
    SEMVER.test(manifest.minimum_source_version) &&
    manifest.image === `ghcr.io/openlander-ai/openlander:${manifest.version}` &&
    typeof manifest.image_digest === 'string' &&
    DIGEST.test(manifest.image_digest) &&
    typeof manifest.compose_sha256 === 'string' &&
    SHA256.test(manifest.compose_sha256) &&
    typeof manifest.rollback_safe === 'boolean'
  );
}

const args = readArguments(process.argv.slice(2));
if (!args) {
  fail('Arguments must be provided as --name value pairs.');
} else if (args.has('verify')) {
  const manifest = JSON.parse(await readFile(args.get('verify'), 'utf8'));
  if (!validateManifest(manifest)) fail('Update manifest validation failed.');
  else console.log(`Verified OpenLander update manifest for ${manifest.version}`);
} else {
  const version = args.get('version');
  const imageDigest = args.get('image-digest');
  const composePath = args.get('compose');
  const policyPath = args.get('policy');
  const outputPath = args.get('output');
  if (!version || !imageDigest || !composePath || !policyPath || !outputPath) {
    fail('Required: --version --image-digest --compose --policy --output');
  } else {
    const policy = JSON.parse(await readFile(policyPath, 'utf8'));
    const composeContent = await readFile(composePath);
    const manifest = {
      schema_version: 1,
      version,
      minimum_source_version: policy.minimum_source_version,
      image: `ghcr.io/openlander-ai/openlander:${version}`,
      image_digest: imageDigest,
      compose_sha256: createHash('sha256').update(composeContent).digest('hex'),
      rollback_safe: policy.rollback_safe,
    };
    if (!validateManifest(manifest)) {
      fail('Generated update manifest did not pass validation.');
    } else {
      await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`Created OpenLander update manifest for ${version}`);
    }
  }
}
