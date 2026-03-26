import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    // vitest auto-loads .env from process.cwd() (server/ directory when running from there)
    // Ensure DATABASE_URL is set in server/.env before running tests
  },
});
