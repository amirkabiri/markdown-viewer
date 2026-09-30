// Module: features/preview/Preview — injects the sanitized render HTML and
// re-imagines the legacy DOM halves as effects: copy buttons on code blocks,
// in-app *.md link interception, per-paragraph direction (auto mode marks
// every block dir=auto like legacy applyDir), mermaid rendering over the
// .mermaid-block shells (dynamic import, mermaidConfig(theme), .mermaid-failed
// + error-note on failure), the document-switch scroll gating (reset on a
// real switch only — typing keeps the position — plus the scroll-to-hash
// after a document load) and the TOC scroll spy.
import { useEffect, useRef, type RefObject } from 'react';

import { useT } from '../../app/i18n';
import { mermaidConfig } from '../../lib/markdown';
import type { ContentDir, Theme } from '../../lib/store';
import { detectDir } from '../../lib/store';

import { currentHeadingIndex } from './scrollSpy';
import type { MarkdownPreviewState } from './useMarkdownPreview';

import styles from './Preview.module.css';

/** Legacy BLOCK_SEL — the blocks that auto-direction applies to. */
const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,dd,dt,summary,blockquote';

/** Deep-link re-anchor window cadence and hard stop: late in-article assets
 *  (logo image, CDN font) reflow the article just after the jump lands; the
 *  window re-aligns while the target moves and never outlives the cap. */
const REANCHOR_TICK_MS = 100;
const REANCHOR_MAX_MS = 3_000;
/** Sub-pixel slack for "the target has not moved" reads. */
const REANCHOR_EPSILON_PX = 1;

export interface PreviewProps {
  state: MarkdownPreviewState;
  /** Resolved content direction for the article (shell detects in auto mode). */
  dir: 'ltr' | 'rtl';
  /** The raw mode — auto marks every block dir=auto (legacy applyDir). */
  dirMode: ContentDir;
  /** Article remount key: a theme switch rebuilds the mermaid SVGs. */
  theme: Theme;
  /** Document identity (url ?? name) — drives scroll reset + scroll-to-hash. */
  docIdentity: string;
  /** The scroll container — shared with the shell for scroll sync. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** TOC scroll-spy callback (the sidebar highlights the active heading). */
  onSpyChange: (activeId: string | null) => void;
  /** In-app navigation: called when a data-md-link is clicked. */
  onOpenDocLink: (href: string) => void;
}

/** Error-note markup (legacy .error-note) with HTML-escaped message text. */
function errorNote(message: string): string {
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<div class="error-note">${escaped}</div>`;
}

/** The HTML to inject: content, or the legacy error-note states. */
function previewHtml(state: MarkdownPreviewState, tooLargeMsg: string): string {
  if (state.tooLarge) return errorNote(tooLargeMsg);
  if (state.error !== null) return `<p></p>${errorNote(state.error)}`;
  return state.html;
}

/** Legacy failShell: mark the shell and add an error-note after it. */
function failShell(shell: HTMLElement, err: unknown, label: string): void {
  shell.classList.add('mermaid-failed');
  const note = document.createElement('div');
  note.className = 'error-note';
  const message = err instanceof Error ? err.message : String(err);
  note.textContent = `${label}: ${message}`;
  shell.after(note);
}

/** Legacy applyDir's block half: auto mode lets every block resolve its own
 *  direction; forced modes remove the attribute so the container rules. */
function applyBlockDir(blocks: NodeListOf<HTMLElement>, dirMode: ContentDir): void {
  blocks.forEach((el) => {
    if (dirMode === 'auto') {
      // no-param-reassign: mutating the live DOM node in place is the point.
      // eslint-disable-next-line no-param-reassign
      el.dir = 'auto';
    } else {
      el.removeAttribute('dir');
    }
  });
}

/** Legacy attachCopyButton: a self-contained copy button per code block. */
function attachCopyButton(pre: HTMLPreElement, copyLabel: string, copiedLabel: string): void {
  if (pre.querySelector('.copy-btn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy-btn';
  btn.textContent = copyLabel;
  btn.addEventListener('click', () => {
    navigator.clipboard
      .writeText(pre.querySelector('code')?.textContent ?? pre.textContent ?? '')
      .then(() => {
        btn.textContent = copiedLabel;
        btn.classList.add('ok');
        setTimeout(() => {
          btn.textContent = copyLabel;
          btn.classList.remove('ok');
        }, 1400);
      })
      .catch(() => {
        /* clipboard blocked — leave the button as-is (parity with legacy) */
      });
  });
  pre.appendChild(btn);
}

/** Legacy data-md-link interception: one click listener per *.md anchor,
 *  marked so effect re-runs never double-bind. */
function bindDocLink(a: HTMLAnchorElement, onOpen: (href: string) => void): void {
  if (a.dataset.appLinkBound) return;
  // no-param-reassign: flagging the live anchor in place is the point.
  // eslint-disable-next-line no-param-reassign
  a.dataset.appLinkBound = '1';
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    const href = a.getAttribute('href');
    if (href) onOpen(href);
  });
}

export default function Preview({
  state, dir, dirMode, theme, docIdentity, scrollRef, onSpyChange, onOpenDocLink,
}: PreviewProps) {
  const t = useT();
  const articleRef = useRef<HTMLElement | null>(null);
  const spyRef = useRef(onSpyChange);
  const linkRef = useRef(onOpenDocLink);
  useEffect(() => {
    spyRef.current = onSpyChange;
    linkRef.current = onOpenDocLink;
  }, [onSpyChange, onOpenDocLink]);

  /* Mermaid: initialize once per theme, render each shell; failures get the
     legacy .mermaid-failed + error-note UI. The article remounts on theme
     change (key), so shells are always fresh sources here. Shells render
     sequentially — mermaid's shared renderer is not re-entrant, and the
     error attribution must match document order (legacy parity). */
  useEffect(() => {
    let cancelled = false;
    const article = articleRef.current;
    const shells = article
      ? [...article.querySelectorAll<HTMLElement>('.mermaid-block')]
      : [];
    if (!shells.length) return undefined;

    (async () => {
      let mermaid: (typeof import('mermaid'))['default'] | null = null;
      try {
        mermaid = (await import('mermaid')).default;
      } catch (err) {
        shells.forEach((shell) => failShell(shell, err, t('mermaidError')));
        return;
      }
      try {
        mermaid.initialize(mermaidConfig(theme));
      } catch {
        /* already initialized */
      }
      for (let i = 0; i < shells.length; i += 1) {
        if (cancelled) return;
        const shell = shells[i];
        try {
          // no-await-in-loop: sequential rendering is deliberate — mermaid's
          // shared renderer is not re-entrant and error attribution must
          // match document order (legacy parity).
          // eslint-disable-next-line no-await-in-loop
          await mermaid.parse(shell.textContent ?? '');
          // eslint-disable-next-line no-await-in-loop
          await mermaid.run({ nodes: [shell] });
        } catch (err) {
          failShell(shell, err, t('mermaidError'));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [state.html, theme, t]);

  /* Content direction: forced modes rule every block; auto lets each block
     resolve its own direction (legacy applyDir). */
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return undefined;
    applyBlockDir(article.querySelectorAll<HTMLElement>(BLOCK_SEL), dirMode);
    return undefined;
  }, [state.html, dirMode]);

  /* Copy buttons on code blocks (legacy attachCopyButton) + in-app *.md link
     interception (legacy renderPreview's data-md-link handler). */
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return undefined;

    article.querySelectorAll<HTMLAnchorElement>('a[data-md-link]').forEach((a) => {
      bindDocLink(a, (href) => linkRef.current(href));
    });

    article.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      attachCopyButton(pre, t('copyCode'), t('copiedCode'));
    });

    /* a11y (axe: scrollable-region-focusable, WCAG 2.1.1): BOTH the pre and
       the hljs code element (github.css gives .hljs overflow-x: auto) can be
       scrollable regions, so keyboard users must be able to reach them to
       scroll them. They get tabindex unconditionally — measuring
       "overflows right now" is a race against font/layout settling and
       differs per engine (this exact flake bit the webkit scan). The lib
       pipeline owns the hljs markup, so the fix lands here, at injection
       time; innerHTML swap on re-render rebuilds the nodes, so nothing
       stales. */
    article.querySelectorAll<HTMLElement>('pre, pre > code').forEach((el) => {
      // no-param-reassign: mutating the live DOM node in place is the point.
      // eslint-disable-next-line no-param-reassign
      el.tabIndex = 0;
    });

    return undefined;
  }, [state.html, t]);

  /* Document-switch scroll gating. The debounced preview re-render fires for
     EVERY typing pause, so the scroll reset must NOT key off state.html —
     that dragged both panes back to the top on each pause (and the
     preview→editor scroll sync mirrored the 0 into the editor). Split into
     two effects:

     A (below) resets the scroll ONLY on a real document switch, tracked
     through the previous identity in a ref (null = first run, which counts
     as a switch — a fresh mount shows a fresh document).

     B (below) handles the deep-link hash jump, html-keyed so content that
     lands AFTER the switch (async ?file= boots) still jumps, but guarded to
     run at most once per document so typing can never re-trigger it. */
  const prevIdentityRef = useRef<string | null>(null);
  const hashJumpDoneRef = useRef(false);
  useEffect(() => {
    if (prevIdentityRef.current === docIdentity) return undefined;
    prevIdentityRef.current = docIdentity;
    // Re-arm the hash jump for the incoming document (B consumed it — or
    // left it pending — for the previous one).
    hashJumpDoneRef.current = false;
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
    return undefined;
  }, [docIdentity, scrollRef]);

  /* Deep-link hash jump: scroll to the location hash target (skipping #d=
     payloads — never a selector) once it exists in the rendered article.
     A missing target is NOT consumed: the next html update retries, which
     is exactly the async-arrival order. Never scrolls to top.

     Two hardening rules, both born from measured webkit flakes:

     - Land on a LIVE node only. The target is re-queried inside the rAF,
       and the once-per-document guard is consumed only when that node is
       still connected. The async ?file= boot can swap the article between
       the query and the frame; scrolling a detached subtree used to lose
       the jump permanently (guard consumed, nothing to retry).

     - Re-anchor while late assets reflow the article. In-article assets
       with no reserved layout box (the README logo image, the CDN
       Vazirmatn face) load right after the jump lands and shift the
       target tens of pixels off the pane top; webkit's own anchoring did
       not reliably compensate. A bounded window re-runs scrollIntoView
       on the live target while its content offset moves, and closes on
       quiescence (fonts loaded, images done, stable reads) or a hard
       cap — scrollIntoView re-aligns from current layout each pass, so
       a browser that already compensated natively is a no-op, never a
       double correction.

     Once-per-document is untouched (the R12 guarantee): the guard is
     consumed at the live landing, and the window is torn down by this
     effect's cleanup on the next html commit — a typing-driven re-render
     closes it and the consumed guard can never re-open it (guarded by
     the scroll specs). */
  const reanchorStopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const { hash } = window.location;
    if (!hash || hash.startsWith('#d=') || hashJumpDoneRef.current) {
      return undefined;
    }

    // Live re-query on every attempt: only a connected node in the CURRENT
    // article is a valid target.
    const findTarget = (): Element | null => {
      const article = articleRef.current;
      if (!article) return null;
      try {
        const el = article.querySelector(decodeURIComponent(hash));
        if (el?.isConnected) return el;
      } catch {
        const el = document.getElementById(hash.slice(1));
        if (el?.isConnected) return el;
      }
      return null;
    };

    if (!findTarget()) return undefined;

    let cancelled = false;
    let raf = 0;

    /* The bounded re-anchor window (see the effect comment above). */
    const startReanchor = (landed: Element) => {
      const container = scrollRef.current;
      if (!container) return;
      let timer = 0;
      let cap = 0;
      let lastOffset = landed.getBoundingClientRect().top + container.scrollTop;
      let stableReads = 0;
      const stop = () => {
        window.clearInterval(timer);
        window.clearTimeout(cap);
        if (reanchorStopRef.current === stop) reanchorStopRef.current = null;
      };
      const onTick = () => {
        const target = findTarget();
        if (!target) {
          stop();
          return;
        }
        const offset = target.getBoundingClientRect().top + container.scrollTop;
        const imgs = articleRef.current?.querySelectorAll('img');
        const assetsDone = document.fonts.status === 'loaded'
          && (!imgs || [...imgs].every((img) => img.complete));
        if (assetsDone && Math.abs(offset - lastOffset) <= REANCHOR_EPSILON_PX) {
          stableReads += 1;
          if (stableReads >= 2) stop();
          return;
        }
        stableReads = 0;
        lastOffset = offset;
        target.scrollIntoView({ block: 'start' });
      };
      timer = window.setInterval(onTick, REANCHOR_TICK_MS);
      cap = window.setTimeout(stop, REANCHOR_MAX_MS);
      reanchorStopRef.current = stop;
    };

    const land = () => {
      raf = 0;
      if (cancelled) return;
      const live = findTarget();
      // Article replaced mid-frame: nothing landed, nothing consumed —
      // the next html commit retries on the live subtree.
      if (!live) return;
      live.scrollIntoView({ block: 'start' });
      hashJumpDoneRef.current = true;
      startReanchor(live);
    };

    raf = requestAnimationFrame(land);
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      reanchorStopRef.current?.();
      reanchorStopRef.current = null;
    };
  }, [state.html, docIdentity, scrollRef]);

  /* TOC scroll spy (legacy updateSpy): rAF-throttled, reports the active
     heading id to the sidebar TOC. */
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return undefined;
    let tick = false;
    const updateSpy = () => {
      tick = false;
      if (!articleRef.current) return;
      const heads = [...articleRef.current.querySelectorAll('h2,h3,h4')];
      if (!heads.length) return;
      const { top } = container.getBoundingClientRect();
      const idx = currentHeadingIndex(
        heads.map((h) => h.getBoundingClientRect().top),
        top,
      );
      spyRef.current(heads[idx].id);
    };
    const onScroll = () => {
      if (tick) return;
      tick = true;
      requestAnimationFrame(updateSpy);
    };
    container.addEventListener('scroll', onScroll);
    return () => container.removeEventListener('scroll', onScroll);
  }, [scrollRef]);

  return (
    <div className={styles.previewScroll} ref={scrollRef}>
      {/* Sanitized upstream by DOMPurify inside the frozen lib/markdown
          pipeline — this is the injection point the design mandates. */}
      <article
        key={theme}
        ref={articleRef}
        className={styles.markdownBody}
        dir={dir}
        aria-live="polite"
        /* eslint-disable-next-line react/no-danger */
        dangerouslySetInnerHTML={{ __html: previewHtml(state, t('tooLarge')) }}
      />
    </div>
  );
}

/** The direction the preview resolves for a document (legacy applyDir's
 *  preview half) — exported for the shell to mirror the editor behavior. */
export function previewDirFor(dirMode: ContentDir, renderedText: string): 'ltr' | 'rtl' {
  return dirMode === 'auto' ? detectDir(renderedText) : dirMode;
}
