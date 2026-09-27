// Module: main — entry point: resolves DOM refs, runs the boot sequence, wires routing. Owner of boot/route and the initialization order.
import { initDomRefs, state, routeState, updateCounts } from './state.js';
import { applyLang } from './i18n.js';
import { initMarked } from './markdown.js';
import { renderRecent, loadUrl, loadFile, paramsString } from './documents.js';
import { applySplit, setPaneMode, bindEditor, bindScrollSync, initDivider } from './workspace.js';
import { applyTheme, bindUI, bindDrop } from './ui.js';

/* ---------------- routing / boot ---------------- */

function route() {
  const p = paramsString();
  if (p === routeState.lastParams) return;
  const params = new URLSearchParams(p);
  const url = params.get('url');
  const file = params.get('file');
  if (url) loadUrl(url, { push: false });
  else if (file) loadFile(file, { push: false });
  else loadFile('README.md', { push: false });
}

async function boot() {
  applyLang();
  applyTheme();
  applySplit();
  setPaneMode(state.mode, { save: false });
  renderRecent();
  updateCounts();

  initMarked();

  bindUI();
  bindEditor();
  bindScrollSync();
  initDivider();
  bindDrop();

  const params = new URLSearchParams(location.search);
  const url = params.get('url');
  const file = params.get('file');
  if (url) await loadUrl(url, { push: false });
  else if (file) await loadFile(decodeURIComponent(file), { push: false });
  else await loadFile('README.md', { push: false });

  window.addEventListener('popstate', route);
}

initDomRefs();
boot();
