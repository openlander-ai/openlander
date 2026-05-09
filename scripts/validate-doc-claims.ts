import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function countFiles(dir: string, ext: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(ext)).length;
}

function countEventTypes(): number {
  const content = readFileSync('src/events/index.ts', 'utf8');
  return (content.match(/^ {2}'[a-z]/gm) || []).length;
}

function countToolDefs(): number {
  const defsDir = 'src/tools/defs';
  let total = 0;
  for (const file of readdirSync(defsDir).filter((f) => f.endsWith('.ts'))) {
    if (file === 'types.ts' || file === 'index.ts') continue;
    const content = readFileSync(join(defsDir, file), 'utf8');
    total += (content.match(/name: '/g) || []).length;
  }
  return total;
}

interface Claim {
  file: string;
  label: string;
  extract: (content: string) => number | null;
  actual: () => number;
}

const claims: Claim[] = [
  {
    file: 'AGENTS.md',
    label: 'ToolDefs count in architecture diagram',
    extract: (c) => {
      const m = c.match(/\((\d+) ToolDefs,/);
      return m ? parseInt(m[1], 10) : null;
    },
    actual: countToolDefs,
  },
  {
    file: 'AGENTS.md',
    label: 'tool definition files count',
    extract: (c) => {
      const m = c.match(/(\d+) tool definition files/);
      return m ? parseInt(m[1], 10) : null;
    },
    actual: () => countFiles('src/tools/defs', '.ts'),
  },
  {
    file: 'AGENTS.md',
    label: 'event types count',
    extract: (c) => {
      const m = c.match(/(\d+) event types/);
      return m ? parseInt(m[1], 10) : null;
    },
    actual: countEventTypes,
  },
];

let failures = 0;

for (const claim of claims) {
  const content = readFileSync(claim.file, 'utf8');
  const docValue = claim.extract(content);
  const actualValue = claim.actual();

  if (docValue === null) {
    console.error(`❌ ${claim.file}: ${claim.label} — pattern not found in doc`);
    failures++;
  } else if (docValue !== actualValue) {
    console.error(
      `❌ ${claim.file}: ${claim.label} — doc says ${docValue}, code has ${actualValue}`,
    );
    failures++;
  } else {
    console.log(`✅ ${claim.file}: ${claim.label} — ${actualValue}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} doc claim(s) out of sync. Update docs to match code.`);
  process.exit(1);
} else {
  console.log(`\n✅ All doc claims verified.`);
}
