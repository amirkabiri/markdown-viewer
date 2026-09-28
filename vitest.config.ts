// Vitest runs two projects:
//   - "node":  pure library tests (*.test.ts) — fast, no DOM.
//   - "jsdom": component tests (*.test.tsx) — RTL + jest-dom, see
//              src/test/setup.ts.
// Test files are colocated with the code they cover (include patterns only
// reach src/).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
    ],
  },
});
