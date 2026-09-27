// Component tests for the documents controller: boot routing precedence
// (?url= → ?file= → #d= → README), the share-hash no-rewrite contract,
// recents, load failure fallback, paste guards, new-document confirm and
// the upload size cap. fetch is a fake returning real Responses (house
// style); history state is reset around each test.
import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { I18nProvider } from '../../app/i18n';
import { WELCOME_MD } from './welcome';
import { useDocuments } from './useDocuments';
import type { DocumentsController, DocumentsDeps } from './useDocuments';

function makeDeps(overrides: Partial<DocumentsDeps> = {}): DocumentsDeps {
  const fetchImpl = vi.fn(async () => new Response('# Fetched doc\n\nbody', { status: 200 }));
  return {
    setEditorDocument: vi.fn(),
    toast: vi.fn(),
    fetchImpl,
    ...overrides,
  };
}

interface HarnessProps {
  deps: DocumentsDeps;
  capture: (c: DocumentsController) => void;
}

function Harness({ deps, capture }: HarnessProps) {
  const ctl = useDocuments(deps);
  useEffect(() => {
    capture(ctl);
  }, [capture, ctl]);
  return null;
}

function setup(overrides: Partial<DocumentsDeps> = {}) {
  const deps = makeDeps(overrides);
  let ctl: DocumentsController | undefined;
  render(
    <I18nProvider lang="en">
      <Harness
        deps={deps}
        capture={(c) => {
          ctl = c;
        }}
      />
    </I18nProvider>,
  );
  const controller = (): DocumentsController => {
    if (!ctl) throw new Error('controller not captured');
    return ctl;
  };
  return { deps, controller };
}

async function setUrl(url: string): Promise<void> {
  window.history.replaceState(null, '', url);
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window.history, 'pushState');
  return setUrl('/');
});

afterEach(() => {
  vi.restoreAllMocks();
  return setUrl('/');
});

describe('boot routing', () => {
  it('loads README.md when no params or share hash are present', async () => {
    const { deps, controller } = setup();

    await act(() => controller().boot());

    expect(deps.fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('README.md'),
      expect.anything(),
    );
    expect(deps.setEditorDocument).toHaveBeenCalledWith('# Fetched doc\n\nbody');
    expect(controller().doc?.name).toBe('README');
    expect(controller().doc?.url).toContain('README.md');
  });

  it('prefers ?file= and resolves it site-relative', async () => {
    await setUrl('/?file=samples%2Fsample-fa.md');
    const { deps, controller } = setup();

    await act(() => controller().boot());

    expect(deps.fetchImpl).toHaveBeenCalledWith(
      'http://localhost:3000/samples/sample-fa.md',
      expect.anything(),
    );
    expect(controller().doc?.name).toBe('sample-fa');
  });

  it('prefers ?url= over the share hash and records a recent entry', async () => {
    const { shareEncode } = await import('../../lib/share');
    const payload = await shareEncode('hello share');
    await setUrl(`/?url=https://example.com/notes.md${payload.ok ? payload.url.slice(payload.url.indexOf('#')) : ''}`);
    const { controller } = setup();

    await act(() => controller().boot());

    expect(controller().doc?.name).toBe('notes');
    expect(controller().doc?.url).toBe('https://example.com/notes.md');
    expect(controller().recent[0]?.url).toBe('https://example.com/notes.md');
    // The address bar was not rewritten on boot.
    expect(window.history.pushState).not.toHaveBeenCalled();
  });

  it('decodes a #d= share payload and never rewrites the URL', async () => {
    const { shareEncode } = await import('../../lib/share');
    const encoded = await shareEncode('hello share');
    if (!encoded.ok) throw new Error('encode failed');
    await setUrl(encoded.url.replace('http://localhost:3000', ''));
    const { controller } = setup();

    await act(() => controller().boot());

    expect(controller().doc?.text).toBe('hello share');
    expect(controller().doc?.name).toBe('Shared document');
    expect(window.history.pushState).not.toHaveBeenCalled();
    // The fragment survived — a refresh would re-decode the same document.
    expect(window.location.hash).toBe(encoded.url.slice(encoded.url.indexOf('#')));
  });

  it('falls back to the embedded welcome doc on a corrupt share payload', async () => {
    await setUrl('/#d=D.garbage');
    const { deps, controller } = setup();

    await act(() => controller().boot());

    expect(controller().doc?.name).toBe('Welcome');
    expect(deps.setEditorDocument).toHaveBeenCalledWith(WELCOME_MD);
  });
});

describe('loadUrl', () => {
  it('pushes the ?url= route into history on a pushed load', async () => {
    const { controller } = setup();

    await act(() => controller().loadUrl('https://example.com/pushed.md'));

    expect(window.location.search).toBe('?url=https%3A%2F%2Fexample.com%2Fpushed.md');
  });

  it('converts github blob links to raw URLs', async () => {
    const { deps, controller } = setup();

    await act(() => controller().loadUrl('https://github.com/user/repo/blob/main/notes.md'));

    expect(deps.fetchImpl).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/user/repo/main/notes.md',
      expect.anything(),
    );
  });

  it('toasts load errors and falls back to the welcome doc', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const { deps, controller } = setup({ fetchImpl });

    const ok = await act(() => controller().loadUrl('https://example.com/missing.md'));

    expect(ok).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Could not load document: HTTP 404', 'error');
    expect(controller().doc?.name).toBe('Welcome');
  });
});

describe('paste / upload / new document', () => {
  it('rejects empty paste with the load-error toast', () => {
    const { deps, controller } = setup();

    expect(controller().loadPasted('   ')).toBe(false);
    expect(deps.toast).toHaveBeenCalledWith('Could not load document', 'error');
  });

  it('adopts a pasted document and clears the query params', async () => {
    await setUrl('/?file=old.md');
    const { controller } = setup();

    await act(async () => {
      expect(controller().loadPasted('# Pasted body')).toBe(true);
    });
    expect(controller().doc?.name).toBe('Pasted document');
    expect(window.location.search).toBe('');
  });

  it('confirms before clearing a non-empty document', async () => {
    const { controller } = setup();
    await act(() => controller().loadPasted('# Existing'));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      expect(controller().newDocument(true)).toBe(false);
    });
    expect(controller().doc?.text).toBe('# Existing');

    confirm.mockReturnValue(true);
    await act(async () => {
      expect(controller().newDocument(true)).toBe(true);
    });
    expect(controller().doc?.name).toBe('Untitled');
    expect(controller().doc?.text).toBe('');
  });

  it('starts a new document without confirmation when the editor is empty', async () => {
    const { controller } = setup();
    const confirm = vi.spyOn(window, 'confirm');

    await act(async () => {
      expect(controller().newDocument(false)).toBe(true);
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(controller().doc?.name).toBe('Untitled');
  });

  it('rejects oversized uploads with the too-large toast', async () => {
    const { deps, controller } = setup();
    const file = new File(['x'], 'big.md');
    Object.defineProperty(file, 'size', { value: 10 * 1024 * 1024 + 1 });

    await act(() => controller().readAndLoad(file));

    expect(deps.toast).toHaveBeenCalledWith('Document is too large (limit 10 MB)', 'error');
    expect(controller().doc).toBeNull();
  });

  it('adopts an uploaded file, dropping the extension', async () => {
    const { deps, controller } = setup();
    const file = new File(['# Uploaded'], 'notes.md');

    await act(() => controller().readAndLoad(file));

    expect(controller().doc?.name).toBe('notes');
    expect(controller().doc?.text).toBe('# Uploaded');
    expect(deps.toast).toHaveBeenCalledWith('notes.md', 'ok');
    expect(window.location.search).toBe('');
  });
});
