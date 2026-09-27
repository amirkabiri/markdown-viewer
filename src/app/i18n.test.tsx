// Component tests for the frozen i18n contract: t is bound to the provider
// language (legacy fallback chain), the React Aria locale follows the
// language, and the t identity is stable per language.
import { render, screen } from '@testing-library/react';
import { useLocale } from 'react-aria-components';
import {
  describe, expect, it, vi,
} from 'vitest';

import { I18nProvider, useT } from './i18n';

function Probe() {
  const t = useT();
  return (
    <dl>
      <dt data-testid="open">{t('open')}</dt>
      <dt data-testid="fallback">{t('no-such-key')}</dt>
    </dl>
  );
}

function LocaleProbe() {
  const { locale } = useLocale();
  return <span data-testid="locale">{locale}</span>;
}

describe('<I18nProvider /> + useT()', () => {
  it('binds t to the provided language', () => {
    render(
      <I18nProvider lang="en">
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('open')).toHaveTextContent('Open');
    expect(screen.getByTestId('fallback')).toHaveTextContent('no-such-key');
  });

  it('translates Persian through the same contract', () => {
    render(
      <I18nProvider lang="fa">
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('open')).toHaveTextContent('باز کردن');
  });

  it('keeps a stable t identity while the language is unchanged', () => {
    const seen: ((key: string) => string)[] = [];

    function IdentityProbe() {
      seen.push(useT());
      return null;
    }

    const { rerender } = render(
      <I18nProvider lang="en">
        <IdentityProbe />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider lang="en">
        <IdentityProbe />
      </I18nProvider>,
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('points React Aria at the locale derived from the language', () => {
    render(
      <I18nProvider lang="fa">
        <LocaleProbe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('locale')).toHaveTextContent('fa-IR');
  });

  it('throws when useT is used outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<Probe />)).toThrow('useT must be used inside <I18nProvider>');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('frozen export shape', () => {
  it('exposes exactly I18nProvider and useT', async () => {
    const mod = await import('./i18n');
    expect(Object.keys(mod).sort()).toEqual(['I18nProvider', 'useT']);
  });
});
