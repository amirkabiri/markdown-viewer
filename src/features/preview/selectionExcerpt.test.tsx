// Component-level (jsdom) tests for features/preview/selectionExcerpt — the
// DOM half of the selection→{excerpt, sourceRange, headingPath} mapping:
// real jsdom Ranges over a REAL renderMarkdown article, so the pipeline
// contract (html shape, heading anchors, table wrapping) is exercised as
// shipped. Pure span/alignment logic is covered in sourceAnchor.test.ts.
import {
  beforeEach, describe, expect, it,
} from 'vitest';

import { renderMarkdown } from '../../lib/markdown';
import { readPreviewSelection } from './selectionExcerpt';

const SOURCE = [
  '# Guide',
  '',
  'Opening paragraph.',
  '',
  '## Details',
  '',
  'Body **with emphasis**.',
  '',
  '- first item',
  '- second item',
  '',
  '| a | b |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  'Closing paragraph.',
  '',
].join('\n');

let article: HTMLElement;

/** Selects between character offsets inside two elements' text. */
function selectRange(
  startEl: Node,
  startOffset: number,
  endEl: Node,
  endOffset: number,
): Range {
  const range = document.createRange();
  range.setStart(startEl, startOffset);
  range.setEnd(endEl, endOffset);
  return range;
}

function firstBlock(selector: string): Element {
  const el = article.querySelector(selector);
  if (!el) throw new Error(`missing ${selector} in fixture`);
  return el;
}

beforeEach(() => {
  article = document.createElement('article');
  article.innerHTML = renderMarkdown(SOURCE).html;
  document.body.replaceChildren(article);
});

describe('readPreviewSelection', () => {
  it('maps a partial single-paragraph selection to exact excerpt + source lines', () => {
    const p = firstBlock('p'); // "Opening paragraph."
    const range = selectRange(p.firstChild as Node, 0, p.firstChild as Node, 7);

    const result = readPreviewSelection(article, range, SOURCE);

    expect(result).not.toBeNull();
    expect(result?.excerpt).toBe('Opening');
    expect(result?.sourceRange).toEqual({
      startOffset: SOURCE.indexOf('Opening paragraph.'),
      endOffset: SOURCE.indexOf('Opening paragraph.') + 'Opening paragraph.'.length,
      startLine: 3,
      endLine: 3,
    });
    expect(result?.headingPath).toEqual(['Guide']);
  });

  it('joins multi-block selections with newlines and unions their source lines', () => {
    // From the middle of "Body with emphasis." into the second list item.
    const body = firstBlock('article > p:nth-of-type(2)');
    const items = article.querySelectorAll('li');
    const range = selectRange(
      body.firstChild as Node,
      0,
      items[1].firstChild as Node,
      'second item'.length,
    );

    const result = readPreviewSelection(article, range, SOURCE);

    expect(result?.excerpt).toBe('Body with emphasis.\nfirst item\nsecond item');
    expect(result?.sourceRange?.startLine).toBe(7);
    expect(result?.sourceRange?.endLine).toBe(10);
    expect(result?.headingPath).toEqual(['Guide', 'Details']);
  });

  it('handles selections inside nested elements (list items, table cells)', () => {
    const cell = firstBlock('td');
    const range = selectRange(cell.firstChild as Node, 0, cell.firstChild as Node, 1);

    const result = readPreviewSelection(article, range, SOURCE);

    expect(result?.excerpt).toBe('1');
    // Anchoring is block-level: a cell selection anchors to the whole table
    // block (the strongest the marked pipeline supports without a swap).
    expect(result?.sourceRange).toMatchObject({ startLine: 12, endLine: 14 });
    expect(result?.headingPath).toEqual(['Guide', 'Details']);
  });

  it('suppresses whitespace-only selections', () => {
    article.innerHTML = '<p>   </p><p>real content</p>';
    const blank = article.querySelector('p');
    if (!blank) throw new Error('missing fixture paragraph');
    const range = document.createRange();
    range.selectNodeContents(blank);

    expect(readPreviewSelection(article, range, SOURCE)).toBeNull();
  });

  it('keeps the excerpt working (heading-path fallback) when the source cannot be mapped', () => {
    const p = firstBlock('p');
    const range = selectRange(p.firstChild as Node, 0, p.firstChild as Node, 7);

    // Source does not correspond to the rendered article at all.
    const result = readPreviewSelection(article, range, 'completely other text');

    expect(result?.excerpt).toBe('Opening');
    expect(result?.sourceRange).toBeNull();
    expect(result?.headingPath).toEqual(['Guide']);
  });

  it('strips app-injected decoration (heading anchors) from unit text', () => {
    const h2 = firstBlock('h2');
    const range = document.createRange();
    range.selectNodeContents(h2);

    const result = readPreviewSelection(article, range, SOURCE);

    expect(result?.excerpt).toBe('Details');
    expect(result?.headingPath).toEqual(['Guide', 'Details']);
  });
});
