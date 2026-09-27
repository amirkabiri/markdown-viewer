// Vitest config — unit tests only cover pure modules, so the plain node
// environment is enough (DOM-touching modules are exercised manually / e2e).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
