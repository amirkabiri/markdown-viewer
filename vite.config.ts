// Vite config — site is deployed under /markdown-viewer/ on GitHub Pages,
// so all asset URLs must stay relative (base: './').
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The viewer fetches its own README.md (default boot document, `?file=README.md`)
 * and the sample documents (`?file=samples/*.md`, linked from the side panel) at
 * runtime. Those live at the repo root as the single source of truth, but only
 * dist/ is deployed — so copy them into dist/ at build time to keep the
 * behavior identical to the old deploy-from-branch-root setup.
 */
function copySiteDocuments(): Plugin {
  return {
    name: 'copy-site-documents',
    apply: 'build',
    closeBundle() {
      const out = `${rootDir}dist`;
      if (existsSync(`${rootDir}README.md`)) cpSync(`${rootDir}README.md`, `${out}/README.md`);
      if (existsSync(`${rootDir}samples`)) cpSync(`${rootDir}samples`, `${out}/samples`, { recursive: true });
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
  },
  plugins: [copySiteDocuments()],
});
