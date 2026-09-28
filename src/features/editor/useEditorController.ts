// Module: features/editor/useEditorController — the React half of the legacy
// editor bindings (legacy/src/workspace.ts bindEditor + legacy/src/ai/edits.ts
// applyEdit): the textarea element is the single source of truth, this
// controller mirrors its value into React state (preview, counts and direction
// detection subscribe to the mirror) and implements the frozen EditorApi.
// applyEdit replicates the legacy mechanism exactly: execCommand insertText
// first (preserves the native undo stack), setRangeText fallback, and a
// window.confirm only for replace-document (aiReplaceDocConfirm).
//
// Autosave wiring (additive, R8): an optional onDocChange callback is fired
// on every USER- or AGENT-driven text change (input, tab-insert, applyEdit) —
// deliberately NOT on loadDocument (loading a document is not an edit). The
// app forwards it to the document repository's debounced saveContent; the
// EditorApi/EditorController shapes are unchanged.
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import type { KeyboardEvent } from 'react';

import { useT } from '../../app/i18n';
import type { EditMode } from '../../lib/ai/edits';

import type { EditorApi } from './api';

export interface EditorControllerOptions {
  /**
   * Fired on every document text change (typing, tab-insert, AI edit) with
   * the new full text — not on loadDocument. Read through a ref at call
   * time, so callback identity is irrelevant.
   */
  onDocChange?: (text: string) => void;
}

export interface EditorController {
  /** The frozen api — stable identity across renders (the EditorProvider value). */
  api: EditorApi;
  /** Mirror of the textarea value (preview, counts, dir detection read it). */
  text: string;
  /** Ref callback that attaches the textarea (Editor passes it to ref=). */
  attachTextarea: (el: HTMLTextAreaElement | null) => void;
  /** Input sync — called on user input and after any programmatic change. */
  syncFromTextarea: () => void;
  /** Replace the whole document (the editor half of legacy setDoc). */
  loadDocument: (text: string) => void;
  /** Tab inserts two spaces instead of moving focus (legacy bindEditor). */
  handleKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Focuses the textarea (new-document flow). */
  focus: () => void;
}

/** Ordered, clamped [start, end) for a range against a document of `len` chars. */
function clampRange(start: number, end: number, len: number): [number, number] {
  const lo = Math.max(0, Math.min(start, end, len));
  const hi = Math.max(lo, Math.min(Math.max(start, end), len));
  return [lo, hi];
}

/** Source range the edit targets — exactly the range computeEdit rewrites
 *  for this mode (insert-only ranges for cursor/append; the whole document
 *  for replace-document). Identical to the legacy applyEdit mapping. */
function targetRange(mode: EditMode, a: number, b: number, len: number): [number, number] {
  if (mode === 'replace-selection') return [a, b];
  if (mode === 'replace-document') return [0, len];
  if (mode === 'append') return [len, len];
  return [a, a]; // cursor
}

export function useEditorController(opts: EditorControllerOptions = {}): EditorController {
  const t = useT();
  const elRef = useRef<HTMLTextAreaElement | null>(null);
  const textRef = useRef('');
  const [text, setText] = useState('');

  // The confirm message must be read at call time (applyEdit is a stable
  // closure), so the translator lives behind a ref that tracks the language.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // Same call-time pattern for the autosave listener: options are read at
  // change time, so callers may pass an unstable closure.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const notifyDocChange = useCallback((value: string) => {
    optsRef.current.onDocChange?.(value);
  }, []);

  const attachTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    elRef.current = el;
  }, []);

  const syncFromTextarea = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    textRef.current = el.value;
    setText(el.value);
    notifyDocChange(el.value);
  }, [notifyDocChange]);

  const loadDocument = useCallback((next: string) => {
    const el = elRef.current;
    if (el) {
      el.value = next;
      el.setSelectionRange(0, 0);
    }
    textRef.current = next;
    setText(next);
  }, []);

  const getText = useCallback((): string => elRef.current?.value ?? textRef.current, []);

  const getSelection = useCallback((): { start: number; end: number } => {
    const el = elRef.current;
    if (!el || el.selectionStart === null || el.selectionEnd === null) {
      return { start: 0, end: 0 };
    }
    return { start: el.selectionStart, end: el.selectionEnd };
  }, []);

  const hasSelection = useCallback(
    (): boolean => getSelection().start !== getSelection().end,
    [getSelection],
  );

  const applyEdit = useCallback<EditorApi['applyEdit']>((mode, inserted, pinnedRange) => {
    const el = elRef.current;
    if (!el) return false;
    // Legacy parity: replace-document is the only mode that asks (the AI
    // panel must never silently wipe the document) — window.confirm on
    // purpose, exactly like legacy/src/ai/edits.ts.
    // eslint-disable-next-line no-alert
    if (mode === 'replace-document' && !window.confirm(tRef.current('aiReplaceDocConfirm'))) {
      return false;
    }

    const len = el.value.length;
    const [a, b] = pinnedRange
      ? clampRange(pinnedRange[0], pinnedRange[1], len)
      : clampRange(el.selectionStart ?? 0, el.selectionEnd ?? 0, len);
    const [insStart, insEnd] = targetRange(mode, a, b, len);

    el.focus();
    let done = false;
    if ((mode === 'cursor' || mode === 'replace-selection') && inserted !== '') {
      try {
        el.setSelectionRange(insStart, insEnd);
        done = document.execCommand('insertText', false, inserted);
      } catch {
        done = false; // execCommand may be undefined / throw — fall back
      }
    }
    if (!done) el.setRangeText(inserted, insStart, insEnd, 'end');
    textRef.current = el.value;
    setText(el.value); // input-equivalent state update: preview/counts stay live
    notifyDocChange(el.value);
    return true;
  }, [notifyDocChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: en } = el;
      if (s === null || en === null) return;
      el.setRangeText('  ', s, en, 'end');
      textRef.current = el.value;
      setText(el.value);
      notifyDocChange(el.value);
    }
  }, [notifyDocChange]);

  const focus = useCallback(() => {
    elRef.current?.focus();
  }, []);

  const api = useMemo<EditorApi>(
    () => ({
      getText, getSelection, hasSelection, applyEdit,
    }),
    [getText, getSelection, hasSelection, applyEdit],
  );

  return {
    api,
    text,
    attachTextarea,
    syncFromTextarea,
    loadDocument,
    handleKeyDown,
    focus,
  };
}
