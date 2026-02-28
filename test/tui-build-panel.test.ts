import { describe, expect, it } from 'vitest';

import { parseDockerStep } from '../src/tui/components/build-panel-utils.js';

describe('parseDockerStep', () => {
  it('parses Docker step with npm install command', () => {
    expect(parseDockerStep('Step 8/12 : RUN npm install')).toEqual({
      current: 8,
      total: 12,
      description: 'RUN npm install',
    });
  });

  it('parses first step with image from line', () => {
    expect(parseDockerStep('Step 1/3 : FROM node:20')).toEqual({
      current: 1,
      total: 3,
      description: 'FROM node:20',
    });
  });

  it('returns null for non-step log line', () => {
    expect(parseDockerStep('Some random log line')).toBeNull();
  });

  it('matches step pattern case-insensitively', () => {
    expect(parseDockerStep('STEP 5/10 : COPY . .')).toEqual({
      current: 5,
      total: 10,
      description: 'COPY . .',
    });
  });

  it('returns null for empty input', () => {
    expect(parseDockerStep('')).toBeNull();
  });
});
