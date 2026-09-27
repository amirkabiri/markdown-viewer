// Module: main — entry point: resolves DOM refs, runs the boot sequence, wires routing. Owner of boot/route, the AI-button wiring, #d= boot routing and the initialization order.
import { initDomRefs, state, routeState, updateCounts } from './state.js';
import { applyLang } from './i18n.js';
import { initMarked } from './markdown.js';
import { renderRecent, loadUrl, loadFile, paramsString, hasShareHash, loadShared } from './documents.js';
import { applySplit, setPaneMode, bindEditor, bindScrollSync, initDivider } from './workspace.js';
import { applyTheme, bindUI, bindDrop } from './ui.js';
import { initAi } from './ai.js';

/* ---------------- routing / boot ---------------- */

/* Hash at the last completed load (boot or route). A popstate that only hops
   an in-page #anchor must not reload anything, while a popstate that swaps one
   #d= payload for another must decode the new document. */
let lastRoutedHash: string | null = null;

function route(): void {
  const p = paramsString();
  const hash = location.hash;
  const paramsChanged = p !== routeState.lastParams;
  const shareChanged = hash.startsWith('#d=') && hash !== lastRoutedHash;
  if (!paramsChanged && !shareChanged) return;
  lastRoutedHash = hash;
  const params = new URLSearchParams(p);
  const url = params.get('url');
  const file = params.get('file');
  if (url) loadUrl(url, { push: false });
  else if (file) loadFile(file, { push: false });
  else if (hasShareHash()) loadShared();
  else loadFile('README.md', { push: false });
}

async function boot(): Promise<void> {
  applyLang();
  applyTheme();
  applySplit();
  setPaneMode(state.mode, { save: false });
  renderRecent();
  updateCounts();

  initMarked();

  bindUI();
  initAi();
  bindEditor();
  bindScrollSync();
  initDivider();
  bindDrop();

  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  const file = params.get('file');
  if (url) await loadUrl(url, { push: false });
  else if (file) await loadFile(decodeURIComponent(file), { push: false });
  else if (hasShareHash()) await loadShared();
  else await loadFile('README.md', { push: false });

  lastRoutedHash = location.hash;
  window.addEventListener('popstate', route);
}

initDomRefs();
boot();
