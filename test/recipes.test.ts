import { describe, it, expect } from 'vitest';

import { matchRecipe, matchAllRecipes, BUILD_RECIPES } from '../src/agent/recipes.js';

describe('matchRecipe', () => {
  it('returns null for a clean build log', () => {
    const log = 'Step 1/5: FROM node:22-bookworm-slim\nStep 5/5: Successfully built abc123';
    expect(matchRecipe(log)).toBeNull();
  });

  it('matches node-gyp errors', () => {
    const log = 'npm ERR! gyp ERR! build error\nnpm ERR! node-gyp rebuild failed';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('node-gyp');
  });

  it('matches sharp/libvips errors', () => {
    const log = 'Error: Cannot find module sharp/build/Release/sharp.node\nlibvips error';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Sharp');
  });

  it('matches prisma generate errors', () => {
    const log = 'Error: prisma generate failed: binary not found\nPRISMA_BINARY_TARGETS';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Prisma');
  });

  it('matches network errors', () => {
    const log = 'npm ERR! code ECONNREFUSED\nnpm ERR! network request failed';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Network');
  });

  it('matches OOM errors', () => {
    const log =
      'FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('memory');
  });

  it('matches COPY not found errors', () => {
    const log = 'COPY failed: stat /var/lib/docker/tmp/abc: no such file or directory';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('COPY');
  });

  it('matches missing module errors', () => {
    const log = "Error: Cannot find module '@nestjs/core'\nERR_MODULE_NOT_FOUND";
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Missing module');
  });

  it('matches permission errors', () => {
    const log = 'npm ERR! EACCES: permission denied, mkdir /app/node_modules';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('permission');
  });

  it('matches Python dependency errors', () => {
    const log = 'ERROR: pip install error: No matching distribution found for numpy==2.0';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Python');
  });

  it('matches port conflict errors', () => {
    const log = 'Error: listen EADDRINUSE: address already in use :::3000';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Port');
  });

  it('returns the first matching recipe when multiple match', () => {
    // node-gyp comes before OOM in BUILD_RECIPES, so node-gyp wins
    const log = 'gyp ERR! build error\nJavaScript heap out of memory';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('node-gyp');
  });
});

describe('matchAllRecipes', () => {
  it('returns empty array for a clean build log', () => {
    const log = 'Successfully built image abc123';
    expect(matchAllRecipes(log)).toEqual([]);
  });

  it('returns multiple recipes when multiple patterns match', () => {
    const log = 'gyp ERR! build error\nJavaScript heap out of memory\nENOSPC';
    const recipes = matchAllRecipes(log);
    expect(recipes.length).toBeGreaterThanOrEqual(2);
    const titles = recipes.map((r) => r.title);
    expect(titles).toContain('Native module compilation failure (node-gyp)');
    expect(titles).toContain('Out of memory during build');
  });

  it('returns single recipe when only one matches', () => {
    const log = 'COPY failed: stat /some/path: no such file or directory';
    const recipes = matchAllRecipes(log);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]!.title).toContain('COPY');
  });
});

describe('BUILD_RECIPES', () => {
  it('has 10 recipes', () => {
    expect(BUILD_RECIPES).toHaveLength(10);
  });

  it('all recipes have required fields', () => {
    for (const recipe of BUILD_RECIPES) {
      expect(recipe.pattern).toBeInstanceOf(RegExp);
      expect(typeof recipe.title).toBe('string');
      expect(recipe.title.length).toBeGreaterThan(0);
      expect(typeof recipe.diagnosis).toBe('string');
      expect(typeof recipe.fix).toBe('string');
    }
  });
});
