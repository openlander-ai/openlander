import { describe, it, expect } from 'vitest';

import { matchRecipe, matchAllRecipes, BUILD_RECIPES } from '../src/pipeline/recipes.js';

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

  it('matches .NET SDK/framework mismatch errors', () => {
    const log =
      'error NETSDK1045: The current .NET SDK does not support targeting .NET 9.0. Target framework: net9.0';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('.NET SDK');
  });

  it('matches .NET restore/dependency resolution errors', () => {
    const log =
      'error NU1301: Unable to load the service index for source https://api.nuget.org/v3/index.json\ndotnet restore failed';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('.NET restore');
  });

  it('matches Maven dependency resolution errors', () => {
    const log =
      '[ERROR] Failed to execute goal on project demo: Could not resolve dependencies for project com.example:demo';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Maven');
  });

  it('matches Gradle/JDK mismatch errors', () => {
    const log = 'Execution failed for task :compileJava. Unsupported class file major version 65';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Gradle/JDK');
  });

  it('matches Bundler dependency resolution errors', () => {
    const log =
      'Bundler::GemNotFound: Could not find gem pg in any of the gem sources listed in your Gemfile.';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Bundler');
  });

  it('matches Ruby native extension build errors', () => {
    const log =
      'Gem::Ext::BuildError: ERROR: Failed to build gem native extension. extconf.rb failed';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('native extension');
  });

  it('matches Rails asset precompile errors', () => {
    const log = 'bundle exec rails assets:precompile\nSprockets::Rails::Helper::AssetNotFound';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('asset precompile');
  });

  it('matches Composer dependency resolution errors', () => {
    const log =
      'Your requirements could not be resolved to an installable set of packages. Problem 1 - Root composer.json requires laravel/framework ^11.0';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Composer dependency');
  });

  it('matches PHP extension/platform requirement errors', () => {
    const log =
      'composer detected issues in your platform: Your Composer dependencies require a PHP extension ext-intl * but it is missing from your system.';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('PHP extension/platform');
  });

  it('matches port conflict errors', () => {
    const log = 'Error: listen EADDRINUSE: address already in use :::3000';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Port');
  });

  it('matches compose env_file missing errors', () => {
    const log = "docker-compose.yml: env_file './backend/.env' not found";
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('env_file');
    expect(recipe!.fix).toContain('Root .env');
    expect(recipe!.fix).toContain('Selective injection');
    expect(recipe!.fix).toContain('Per-service');
  });

  it('matches compose depends_on service not found errors', () => {
    const log = 'ERROR: Service "postgres" not found in docker-compose.yml\nno such service';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('service dependency');
  });

  it('matches compose port conflict errors', () => {
    const log =
      'docker compose up\nError: port 5432 already allocated\nBind for 0.0.0.0:5432 failed';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('Compose port conflict');
  });

  it('matches compose version obsolete errors', () => {
    const log =
      "docker-compose.yml: version '2.0' is not supported\nCompose file version 2.0 is deprecated";
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('version');
  });

  it('matches compose build context not found errors', () => {
    const log = 'ERROR: build context ./nonexistent does not exist\nunable to prepare context';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('build context');
  });

  it('returns the first matching recipe when multiple match', () => {
    // node-gyp comes before OOM in BUILD_RECIPES, so node-gyp wins
    const log = 'gyp ERR! build error\nJavaScript heap out of memory';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('node-gyp');
  });

  it('matches container name conflict errors', () => {
    const log =
      'Error response from daemon: Conflict. The container name "/sumgod-backend" is already in use by container "9da0abbf..."';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('container name conflict');
  });

  it('matches container name conflict over version warning when both present', () => {
    const log =
      'Error response from daemon: Conflict. The container name "/app" is already in use\nCompose file version 2.0 is deprecated';
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('container name conflict');
  });

  it('matches version obsolete when it is the only error', () => {
    const log =
      "docker-compose.yml: version '2.0' is not supported\nCompose file version 2.0 is deprecated";
    const recipe = matchRecipe(log);
    expect(recipe).not.toBeNull();
    expect(recipe!.title).toContain('version');
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
  it('has 26 recipes', () => {
    expect(BUILD_RECIPES).toHaveLength(26);
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

  it('adds executable action to node-gyp recipe', () => {
    const recipe = BUILD_RECIPES.find((entry) => entry.title.includes('node-gyp'));
    expect(recipe?.action).toEqual({
      type: 'dockerfile_replace_pattern',
      pattern: 'FROM (node:[^-\\s]+)-alpine',
      replacement: 'FROM $1-bookworm-slim',
    });
  });

  it('adds executable action to OOM recipe', () => {
    const recipe = BUILD_RECIPES.find((entry) => entry.title.includes('Out of memory'));
    expect(recipe?.action).toEqual({
      type: 'dockerfile_add_line',
      line: 'ENV NODE_OPTIONS="--max-old-space-size=4096"',
      anchor: '^CMD\\b|^ENTRYPOINT\\b',
      position: 'before',
    });
  });
});
