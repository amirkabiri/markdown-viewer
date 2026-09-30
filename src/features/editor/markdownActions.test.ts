// Unit tests for the pure markdown formatting actions behind the editor's
// selection toolbar — the toggle matrix (unwrap-in-place → strip-from-
// selection → wrap), per-line prefix actions on multi-line selections, link
// variants, whitespace trimming, code-block fencing and idempotency. No DOM:
// every case is a (text, range, action) → (text, range) triple (node project).
import { describe, expect, it } from 'vitest';

import { applyAction } from './markdownActions';
import type { FormatAction } from './markdownActions';

/** Apply `action` and return just the resulting document text. */
function applyText(text: string, start: number, end: number, action: FormatAction): string {
  return applyAction(text, start, end, action).text;
}

/** Apply `action` twice (feeding the returned selection back in) — the
 *  idempotency contract: the second press toggles the first one off. */
function applyTwice(
  text: string,
  start: number,
  end: number,
  action: FormatAction,
): { text: string; selStart: number; selEnd: number } {
  const first = applyAction(text, start, end, action);
  return applyAction(first.text, first.selStart, first.selEnd, action);
}

describe('wrap actions (bold / italic / strikethrough / inline code)', () => {
  it('bold wraps a plain selection and selects the wrapped core', () => {
    expect(applyAction('hello world', 6, 11, 'bold')).toEqual({
      text: 'hello **world**',
      selStart: 8,
      selEnd: 13,
    });
  });

  it('bold unwraps in place when the markers hug the selection (toggle off)', () => {
    expect(applyAction('hello **world**!', 8, 13, 'bold')).toEqual({
      text: 'hello world!',
      selStart: 6,
      selEnd: 11,
    });
  });

  it('bold strips fully-selected markers from the selection', () => {
    expect(applyAction('plain **bold** plain', 6, 14, 'bold')).toEqual({
      text: 'plain bold plain',
      selStart: 6,
      selEnd: 10,
    });
  });

  it('bold is idempotent: pressing it twice restores the original text', () => {
    expect(applyTwice('hello world', 6, 11, 'bold')).toEqual({
      text: 'hello world',
      selStart: 6,
      selEnd: 11,
    });
  });

  it('italic wraps intraword with * (CommonMark-safe), not _', () => {
    expect(applyAction('shyrawword', 3, 6, 'italic')).toEqual({
      text: 'shy*raw*word',
      selStart: 4,
      selEnd: 7,
    });
  });

  it('italic unwraps an intraword emphasis', () => {
    expect(applyAction('shy*raw*word', 4, 7, 'italic')).toEqual({
      text: 'shyrawword',
      selStart: 3,
      selEnd: 6,
    });
  });

  it('strikethrough toggles with ~~', () => {
    expect(applyText('a gone b', 2, 6, 'strikethrough')).toBe('a ~~gone~~ b');
    expect(applyAction('a ~~gone~~ b', 4, 8, 'strikethrough').text).toBe('a gone b');
  });

  it('inline code toggles with backticks', () => {
    expect(applyText('a raw b', 2, 5, 'inlineCode')).toBe('a `raw` b');
    expect(applyAction('a `raw` b', 3, 6, 'inlineCode').text).toBe('a raw b');
  });

  it('an empty selection inserts an empty pair and parks the caret inside', () => {
    expect(applyAction('abc', 1, 1, 'bold')).toEqual({
      text: 'a****bc',
      selStart: 3,
      selEnd: 3,
    });
  });

  it('wrapping trims edge whitespace outside the markers', () => {
    // Selected "   b   " → the whitespace stays in the document, the markers
    // hug "b".
    expect(applyAction('a   b   c', 1, 8, 'bold')).toEqual({
      text: 'a   **b**   c',
      selStart: 6,
      selEnd: 7,
    });
  });
});

describe('link', () => {
  it('wraps plain text as [text](url) with the url placeholder selected', () => {
    expect(applyAction('see here now', 4, 8, 'link')).toEqual({
      text: 'see [here](url) now',
      selStart: 11,
      selEnd: 14,
    });
  });

  it('moves a selected URL into the parens with the cursor on the empty label', () => {
    expect(applyAction('open https://example.com today', 5, 24, 'link')).toEqual({
      text: 'open [](https://example.com) today',
      selStart: 6,
      selEnd: 6,
    });
  });

  it('inserts [](url) on an empty selection with the placeholder selected', () => {
    expect(applyAction('abc', 1, 1, 'link')).toEqual({
      text: 'a[](url)bc',
      selStart: 3,
      selEnd: 6,
    });
  });

  it('unwraps when the selection sits inside an existing link label', () => {
    expect(applyAction('go to [docs](https://x.io) now', 8, 10, 'link')).toEqual({
      text: 'go to docs now',
      selStart: 6,
      selEnd: 10,
    });
  });

  it('unwraps when the whole link is selected', () => {
    expect(applyAction('go to [docs](https://x.io) now', 6, 25, 'link')).toEqual({
      text: 'go to docs now',
      selStart: 6,
      selEnd: 10,
    });
  });

  it('leaves text that merely looks at links alone (no surrounding syntax)', () => {
    // A bare URL with no [..](..) around it: the URL branch applies (label-first).
    expect(applyAction('x https://y.io z', 2, 14, 'link').text).toBe('x [](https://y.io) z');
  });
});

describe('headings (per-line, multiline-aware)', () => {
  it('H2 prefixes every selected line', () => {
    expect(applyAction('alpha\nbeta', 1, 7, 'heading2')).toEqual({
      text: '## alpha\n## beta',
      selStart: 0,
      selEnd: 16,
    });
  });

  it('H2 toggles off when every line already carries exactly ##', () => {
    expect(applyTwice('alpha\nbeta', 0, 10, 'heading2')).toEqual({
      text: 'alpha\nbeta',
      selStart: 0,
      selEnd: 10,
    });
  });

  it('H2 replaces another ATX level instead of stacking', () => {
    expect(applyText('# title', 0, 7, 'heading2')).toBe('## title');
    expect(applyText('### deep', 0, 8, 'heading2')).toBe('## deep');
    expect(applyText('###### max', 0, 10, 'heading3')).toBe('### max');
  });

  it('H3 on H2 text upgrades to ###, and toggles back off', () => {
    expect(applyText('## x', 0, 4, 'heading3')).toBe('### x');
    expect(applyAction('### x', 0, 5, 'heading3').text).toBe('x');
  });

  it('mixed selections settle every line on the target level', () => {
    expect(applyText('## a\nb', 0, 6, 'heading2')).toBe('## a\n## b');
  });

  it('keeps existing leading indentation', () => {
    expect(applyText('  indented', 0, 10, 'heading2')).toBe('  ## indented');
  });

  it('skips blank lines when adding', () => {
    expect(applyText('a\n\nb', 0, 4, 'heading2')).toBe('## a\n\n## b');
  });
});

describe('bullet list (per-line toggle)', () => {
  it('adds "- " to every line and selects the whole range', () => {
    expect(applyAction('a\nb', 0, 3, 'bulletList')).toEqual({
      text: '- a\n- b',
      selStart: 0,
      selEnd: 7,
    });
  });

  it('toggles off when every non-empty line is already bulleted', () => {
    expect(applyTwice('a\nb', 0, 3, 'bulletList')).toEqual({
      text: 'a\nb',
      selStart: 0,
      selEnd: 3,
    });
  });

  it('skips blank lines when adding but still toggles off', () => {
    expect(applyText('a\n\nb', 0, 4, 'bulletList')).toBe('- a\n\n- b');
    expect(applyAction('- a\n\n- b', 0, 7, 'bulletList').text).toBe('a\n\nb');
  });

  it('strips one nesting level per toggle-off', () => {
    expect(applyText('  - a\n- b', 0, 9, 'bulletList')).toBe('  a\nb');
  });
});

describe('numbered list (renumbering toggle)', () => {
  it('numbers lines sequentially on add', () => {
    expect(applyText('a\nb\nc', 0, 5, 'numberedList')).toBe('1. a\n2. b\n3. c');
  });

  it('toggles off by stripping any \\d+[.)] marker', () => {
    expect(applyAction('1. a\n2. b', 0, 8, 'numberedList').text).toBe('a\nb');
    expect(applyAction('2) a\n10) b', 0, 8, 'numberedList').text).toBe('a\nb');
  });

  it('renumbers rather than preserving stale markers', () => {
    // Only one of the lines is numbered → not a toggle-off; both get fresh numbers.
    expect(applyText('1. a\nb', 0, 6, 'numberedList')).toBe('1. 1. a\n2. b');
  });
});

describe('task list (per-line toggle)', () => {
  it('adds "- [ ] " to every line', () => {
    expect(applyText('a\nb', 0, 3, 'taskList')).toBe('- [ ] a\n- [ ] b');
  });

  it('turns an existing bullet into a task instead of stacking markers', () => {
    expect(applyText('- a\n- b', 0, 6, 'taskList')).toBe('- [ ] a\n- [ ] b');
  });

  it('toggles off stripping checked and unchecked boxes alike', () => {
    expect(applyAction('- [ ] a\n- [x] b', 0, 14, 'taskList').text).toBe('a\nb');
  });

  it('is idempotent', () => {
    expect(applyTwice('a\nb', 0, 3, 'taskList')).toEqual({
      text: 'a\nb',
      selStart: 0,
      selEnd: 3,
    });
  });
});

describe('blockquote (one-level toggle)', () => {
  it('adds "> " to every line', () => {
    expect(applyText('a\nb', 0, 3, 'blockquote')).toBe('> a\n> b');
  });

  it('toggles off one level', () => {
    expect(applyTwice('a\nb', 0, 3, 'blockquote')).toEqual({
      text: 'a\nb',
      selStart: 0,
      selEnd: 3,
    });
  });

  it('strips only one level of nested quotes per press', () => {
    expect(applyText('> > deep', 0, 8, 'blockquote')).toBe('> deep');
  });
});

describe('code block (fencing)', () => {
  it('fences the selection with blank-line padding and selects the block', () => {
    expect(applyAction('x\nfoo\nbar\ny', 2, 7, 'codeBlock')).toEqual({
      text: 'x\n\n```\nfoo\nbar\n```\n\ny',
      selStart: 3,
      selEnd: 19,
    });
  });

  it('adds no leading padding at the document start', () => {
    expect(applyAction('abc', 0, 3, 'codeBlock')).toEqual({
      text: '```\nabc\n```',
      selStart: 0,
      selEnd: 11,
    });
  });

  it('toggles off when the fenced block is selected (idempotent at doc start)', () => {
    expect(applyTwice('abc', 0, 3, 'codeBlock')).toEqual({
      text: 'abc',
      selStart: 0,
      selEnd: 3,
    });
  });

  it('unwraps a selected fenced block in the middle of the document', () => {
    // Toggle on, then feed the block selection back in: the fences go away
    // (the introduced blank lines stay — their origin is unknowable).
    const once = applyAction('x\nfoo\nbar\ny', 2, 7, 'codeBlock');
    expect(applyAction(once.text, once.selStart, once.selEnd, 'codeBlock').text).toBe(
      'x\n\nfoo\nbar\n\ny',
    );
  });

  it('inline code on a multi-line selection fences instead of backticking', () => {
    expect(applyText('x\nfoo\nbar\ny', 2, 7, 'inlineCode')).toBe('x\n\n```\nfoo\nbar\n```\n\ny');
  });
});

describe('prefix actions on an empty (caret-only) selection', () => {
  it('operates on the whole line under the caret', () => {
    expect(applyAction('abc', 1, 1, 'bulletList')).toEqual({
      text: '- abc',
      selStart: 0,
      selEnd: 5,
    });
  });
});
