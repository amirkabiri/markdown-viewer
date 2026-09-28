// Vite config — React app (react-rewrite).
// Site is deployed under /markdown-viewer/ on GitHub Pages, so all asset URLs
// must stay relative (base: './').
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * The viewer fetches its own README.md (default boot document,
 * `?file=README.md`) and the sample documents (`?file=samples/*.md`, linked
 * from the side panel) at runtime. Those live at the repo root as the single
 * source of truth, but only dist/ is deployed — so copy them into dist/ at
 * build time to keep the behavior identical to the old
 * deploy-from-branch-root setup.
 *
 * The README's own body references repo-relative assets
 * (`<img src="public/logo.svg">`); the preview resolves that against the
 * page URL, so the file is mirrored to dist/public/logo.svg too (Vite's
 * public/ copy at the dist root stays for anything addressing it there).
 */
function copySiteDocuments(): Plugin {
  return {
    name: 'copy-site-documents',
    apply: 'build',
    closeBundle() {
      const out = `${rootDir}dist`;
      if (existsSync(`${rootDir}README.md`)) cpSync(`${rootDir}README.md`, `${out}/README.md`);
      if (existsSync(`${rootDir}samples`)) cpSync(`${rootDir}samples`, `${out}/samples`, { recursive: true });
      const logo = `${rootDir}public/logo.svg`;
      if (existsSync(logo)) {
        mkdirSync(`${out}/public`, { recursive: true });
        cpSync(logo, `${out}/public/logo.svg`);
      }
    },
  };
}

/**
 * React Fast Refresh's preamble is an *inline* module script that
 * @vitejs/plugin-react injects into index.html — dev server only. The
 * production CSP keeps `script-src 'self'`; relax it for `pnpm dev` alone so
 * HMR works without weakening the shipped policy (verified by the e2e boot
 * spec against the production build).
 */
function relaxCspForDevServer(): Plugin {
  return {
    name: 'qalam:relax-csp-for-dev-server',
    apply: 'serve',
    transformIndexHtml(html) {
      // Anchor to the directive boundary so the explanatory comment above
      // the CSP meta can never be the replacement target.
      return html.replace(
        '; script-src \'self\';',
        '; script-src \'self\' \'unsafe-inline\';',
      );
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    // mermaid stays a dependency: the preview imports it lazily
    // (dynamic import) and Rollup code-splits it into its own chunk.
  },
  plugins: [react(), copySiteDocuments(), relaxCspForDevServer()],
});
