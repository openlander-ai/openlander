import { describe, expect, it } from 'vitest';

import {
  fingerprintComposeServices,
  validateComposeProfiles,
  type ComposeService,
} from '../../src/pipeline/compose.js';

describe('Compose deployment specification', () => {
  it('validates requested profiles against the selected Compose file', () => {
    const services: ComposeService[] = [{ name: 'api', profiles: ['production'] }, { name: 'db' }];

    expect(() => validateComposeProfiles(services, ['production'])).not.toThrow();
    expect(() => validateComposeProfiles(services, ['development'])).toThrowError(
      expect.objectContaining({ code: 'SERVICE_CONFIG_INVALID' }),
    );
  });

  it('fingerprints normalized service definitions without returning secret values', () => {
    const services: ComposeService[] = [
      {
        name: 'api',
        image: 'acme/api:latest',
        environment: { API_SECRET: 'do-not-store-me' },
      },
    ];

    const fingerprints = fingerprintComposeServices(services);

    expect(fingerprints.api).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(fingerprints)).not.toContain('do-not-store-me');
  });
});
