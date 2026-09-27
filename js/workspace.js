// Module: workspace — editor bindings, scroll sync, divider drag, pane modes, content direction. Owner of setPaneMode/applySplit/applyDir/bindEditor/bindScrollSync/initDivider.
import { $$, state, store, editor, preview, previewScroll, workspace, divider, BLOCK_SEL, detectDir, updateCounts } from './state.js';
import { scheduleRender } from './markdown.js';
import { updateSpy } from './ui.js';

let lockUntil = 0;       // scroll-sync lock
let spyTick = false;

/* ---------------- pane modes + divider ---------------- */

export function setPaneMode(mode, { save = true } = {}) {
  state.mode = mode;
  workspace.classList.remove('mode-editor', 'mode-split', 'mode-preview');
  workspace.classList.add('mode-' + mode);
  $$('#pane-modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (save) store.set('mode', mode);
}

export function applySplit() {
  const saved = store.get('split', null);
  if (saved) workspace.style.setProperty('--split', saved);
}

export function isSplit() { return state.mode === 'split'; }

export function initDivider() {
  divider.addEventListener('pointerdown', (e) => {
    if (!isSplit()) return;
    divider.setPointerCapture(e.pointerId);
    divider.classList.add('dragging');
    const rect = workspace.getBoundingClientRect();
    const move = (ev) => {
      let frac = (ev.clientX - rect.left) / rect.width;
      if (document.documentElement.dir === 'rtl') frac = 1 - frac;
      frac = Math.min(0.8, Math.max(0.2, frac));
      workspace.style.setProperty('--split', (frac * 100).toFixed(2) + '%');
    };
    const up = () => {
      divider.classList.remove('dragging');
      store.set('split', workspace.style.getPropertyValue('--split'));
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', up);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up);
  });
  divider.addEventListener('dblclick', () => {
    workspace.style.removeProperty('--split');
    store.set('split', null);
  });
}

/* ---------------- editor <-> preview scroll sync ---------------- */

export function bindScrollSync() {
  editor.addEventListener('scroll', () => {
    if (!isSplit() || Date.now() < lockUntil) return;
    lockUntil = Date.now() + 60;
    const p = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
    previewScroll.scrollTop = p * Math.max(0, previewScroll.scrollHeight - previewScroll.clientHeight);
  });
  previewScroll.addEventListener('scroll', () => {
    if (spyTick) return;
    spyTick = true;
    requestAnimationFrame(() => { spyTick = false; updateSpy(); });
    if (!isSplit() || Date.now() < lockUntil) return;
    lockUntil = Date.now() + 60;
    const p = previewScroll.scrollTop / Math.max(1, previewScroll.scrollHeight - previewScroll.clientHeight);
    editor.scrollTop = p * Math.max(0, editor.scrollHeight - editor.clientHeight);
  });
}

/* ---------------- editor events ---------------- */


export function bindEditor() {
  editor.addEventListener('input', () => {
    updateCounts();
    if (state.dir === 'auto') editor.dir = detectDir(editor.value);
    scheduleRender();
  });
  /* Tab inserts spaces instead of moving focus */
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = editor;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 2;
      editor.dispatchEvent(new Event('input'));
    }
  });
}

/* ---------------- content direction ---------------- */

export function applyDir() {
  const mode = state.dir;
  editor.dir = mode === 'auto' ? detectDir(editor.value) : mode;
  if (mode === 'auto') {
    preview.dir = detectDir(preview.textContent);
    $$(BLOCK_SEL, preview).forEach((el) => { el.dir = 'auto'; });
  } else {
    preview.dir = mode;
    $$(BLOCK_SEL, preview).forEach((el) => el.removeAttribute('dir'));
  }
}
