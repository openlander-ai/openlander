import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildToolInputContract } from '../../src/mcp/schema-guidance.js';

describe('MCP schema guidance', () => {
  it('describes caller input so defaulted fields remain optional', () => {
    const contract = buildToolInputContract({
      name: 'example_action',
      description: 'Example action',
      inputSchema: z
        .object({
          project_id: z.string().min(1),
          limit: z.number().int().min(1).max(50).default(50),
          cursor: z.string().optional(),
        })
        .strict(),
    });

    expect(contract.required_params).toEqual(['project_id']);
    expect(contract.optional_params).toEqual(['cursor', 'limit']);
    expect(contract.input_schema).toMatchObject({
      additionalProperties: false,
      required: ['project_id'],
      properties: {
        limit: { default: 50, type: 'integer' },
      },
    });
  });
});
