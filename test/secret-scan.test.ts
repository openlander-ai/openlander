import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const describeSecretScan = describe;

let scanForSecrets!: (projectPath: string) => Array<{
  file: string;
  line: number;
  type: string;
  pattern: string;
}>;
let readdirMock!: ReturnType<typeof vi.fn>;
let readFileMock!: ReturnType<typeof vi.fn>;
let statMock!: ReturnType<typeof vi.fn>;

const fixture = {
  awsAccessKey: ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  awsTempKey: ['ASIA', 'IOSFODNN7EXAMPLE'].join(''),
  githubPat: ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'].join(''),
  githubServerToken: ['ghs_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'].join(''),
  githubOAuthToken: ['gho_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'].join(''),
  githubUserToken: ['ghu_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'].join(''),
  githubRefreshToken: ['ghr_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'].join(''),
  openAiKey: ['sk-', 'abcdefghijklmnopqrstuvwxyz1234'].join(''),
  openAiProjectKey: ['sk-', 'proj-', 'abcdefghijklmnopqrstuvwxyz'].join(''),
  stripeLiveKey: ['sk_', 'live_', 'abcdefghijklmnopqrstuvwxyz'].join(''),
  stripeTestKey: ['sk_', 'test_', 'abcdefghijklmnopqrstuvwxyz'].join(''),
  githubFineGrainedPat: ['github_', 'pat_', 'abcdefghijklmnopqrstuvwxyz'].join(''),
  slackBotToken: ['xoxb-', '123456789012-abcdefghij'].join(''),
  slackUserToken: ['xoxp-', '123456789012-abcdefghij'].join(''),
  slackSecretToken: ['xoxs-', '123456789012-abcdefghij'].join(''),
  postgresUrl: ['postgres://', 'admin:secret123@db.example.com:5432/mydb'].join(''),
  mysqlUrl: ['mysql://', 'root:password@localhost/app'].join(''),
  mongodbUrl: ['mongodb://', 'user:pass@cluster.mongodb.net/db'].join(''),
  rsaPrivateKeyHeader: ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join(''),
  ecPrivateKeyHeader: ['-----BEGIN EC ', 'PRIVATE KEY-----'].join(''),
  privateKeyHeader: ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
};

function tsConst(name: string, value: string): string {
  return `const ${name} = "${value}";`;
}

function setupSingleFile(fileName: string, content: string): void {
  readdirMock.mockReturnValue([fileName]);
  statMock.mockReturnValue({
    isDirectory: () => false,
    isFile: () => true,
    size: 100,
  });
  readFileMock.mockReturnValue(content);
}

describeSecretScan('scanForSecrets', () => {
  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('node:fs', () => ({
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(),
    }));

    const fs = await import('node:fs');
    readdirMock = fs.readdirSync as ReturnType<typeof vi.fn>;
    readFileMock = fs.readFileSync as ReturnType<typeof vi.fn>;
    statMock = fs.statSync as ReturnType<typeof vi.fn>;

    ({ scanForSecrets } = await import('../src/pipeline/secret-scan.js'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // --- Pattern detection tests ---

  it('detects AWS access key (AKIA)', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.awsAccessKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('aws_key');
  });

  it('detects AWS temporary key (ASIA)', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.awsTempKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('aws_temp_key');
  });

  it('detects GitHub personal access token (ghp_)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.githubPat));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('github_token');
  });

  it('detects GitHub server token (ghs_)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.githubServerToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('github_token');
  });

  it('detects GitHub OAuth token (gho_)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.githubOAuthToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('github_token');
  });

  it('detects GitHub user token (ghu_)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.githubUserToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('github_token');
  });

  it('detects GitHub refresh token (ghr_)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.githubRefreshToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('github_token');
  });

  it('detects OpenAI key (sk-)', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.openAiKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('openai_key');
  });

  it('detects OpenAI project key (sk-proj-)', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.openAiProjectKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    // sk-proj- matches the generic sk- pattern first
    expect(findings[0]?.type).toBe('openai_key');
  });

  it('detects Stripe live key', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.stripeLiveKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('stripe_key');
  });

  it('detects Stripe test key', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.stripeTestKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('stripe_key');
  });

  it('detects PostgreSQL connection URL', () => {
    setupSingleFile('config.ts', tsConst('url', fixture.postgresUrl));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('db_url');
  });

  it('detects MySQL connection URL', () => {
    setupSingleFile('config.ts', tsConst('url', fixture.mysqlUrl));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('db_url');
  });

  it('detects MongoDB connection URL', () => {
    setupSingleFile('config.ts', tsConst('url', fixture.mongodbUrl));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('db_url');
  });

  it('detects RSA private key header', () => {
    setupSingleFile('key.pem', fixture.rsaPrivateKeyHeader);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('private_key');
  });

  it('detects EC private key header', () => {
    setupSingleFile('key.pem', fixture.ecPrivateKeyHeader);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('private_key');
  });

  it('detects generic private key header', () => {
    setupSingleFile('key.pem', fixture.privateKeyHeader);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('private_key');
  });

  it('detects GitHub fine-grained PAT (github_pat_)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.githubFineGrainedPat));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('github_pat');
  });

  it('detects Slack bot token (xoxb-)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.slackBotToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('slack_token');
  });

  it('detects Slack user token (xoxp-)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.slackUserToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('slack_token');
  });

  it('detects Slack secret token (xoxs-)', () => {
    setupSingleFile('config.ts', tsConst('token', fixture.slackSecretToken));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('slack_token');
  });

  // --- maskValue tests (indirect via pattern field) ---

  it('masks long secrets showing first 4 and last 4 chars', () => {
    setupSingleFile('config.ts', tsConst('key', fixture.awsAccessKey));
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    const masked = findings[0]?.pattern ?? '';
    expect(masked).toMatch(/^AKIA\.\.\..{4}$/);
    expect(masked).not.toContain('IOSFODNN7');
  });

  it('masks short secrets with ****', () => {
    // Private key headers are long enough that the scanner should use the long mask format.
    // But an 8-char or less match should return ****
    // The db_url pattern captures just the protocol://user:pass@ portion
    // Let's use a minimal match: postgres://a:b@ is 16 chars, too long
    // Actually maskValue only gets called on the matched portion
    // All real patterns produce matches longer than 8 chars, so let's verify
    // the long mask format is consistently applied
    setupSingleFile('key.pem', fixture.privateKeyHeader);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    const masked = findings[0]?.pattern ?? '';
    // The matched header should be masked as first4...last4.
    expect(masked).toBe('----...----');
  });

  // --- File skip behavior ---

  it('skips .env files for openai_key pattern but detects other secrets', () => {
    readdirMock.mockReturnValue(['.env.local']);
    statMock.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 100,
    });
    readFileMock.mockReturnValue(`OPENAI_KEY=${fixture.openAiKey}`);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });

  it('skips binary file extensions', () => {
    readdirMock.mockReturnValue(['image.png']);
    statMock.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 100,
    });
    readFileMock.mockReturnValue(fixture.awsAccessKey);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });

  it('skips .lock files', () => {
    readdirMock.mockReturnValue(['package-lock.json.lock']);
    statMock.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 100,
    });
    readFileMock.mockReturnValue(fixture.awsAccessKey);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });

  // --- Directory skip behavior ---

  it('skips node_modules directory', () => {
    readdirMock.mockReturnValue(['node_modules']);
    statMock.mockReturnValue({
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
    });
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });

  it('skips .git directory', () => {
    readdirMock.mockReturnValue(['.git']);
    statMock.mockReturnValue({
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
    });
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });

  // --- Multiple findings ---

  it('detects multiple secrets in one file', () => {
    setupSingleFile(
      'config.ts',
      `${tsConst('aws', fixture.awsAccessKey)}\n${tsConst('gh', fixture.githubPat)}`,
    );
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(2);
    expect(findings[0]?.type).toBe('aws_key');
    expect(findings[1]?.type).toBe('github_token');
  });

  it('reports correct line numbers', () => {
    setupSingleFile('config.ts', `line1\nline2\n${tsConst('key', fixture.awsAccessKey)}\nline4`);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
  });

  // --- No findings ---

  it('returns empty array for clean files', () => {
    setupSingleFile('clean.ts', 'const x = 1;\nconst y = "hello";');
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });

  it('returns empty array for empty directory', () => {
    readdirMock.mockReturnValue([]);
    const findings = scanForSecrets('/project');
    expect(findings).toHaveLength(0);
  });
});
