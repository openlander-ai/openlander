import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.drizzle.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
  },
});
