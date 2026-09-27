// Unit tests for src/i18n — the pure t(lang, key) lookup and the structural
// integrity of the merged dictionaries. Legacy had no i18n tests; the
// completeness checks guard the merge of the module-registered keys
// (share/ai/edits/markdown/documents) that used to be spread across files.

import { describe, expect, it } from 'vitest';
import { t } from '.';
import { dictionaries } from './dictionaries';

describe('t', () => {
  it('returns the English string for the en language', () => {
    expect(t('en', 'appTitle')).toBe('Qalam');
    expect(t('en', 'aiSend')).toBe('Send');
  });

  it('returns the Persian string for the fa language', () => {
    expect(t('fa', 'appTitle')).toBe('قلم');
    expect(t('fa', 'welcome')).toBe('خوش آمدید');
  });

  it('returns the key itself for an unknown key (last fallback)', () => {
    expect(t('en', 'noSuchKey')).toBe('noSuchKey');
    expect(t('fa', 'noSuchKey')).toBe('noSuchKey');
  });

  it('is pure: repeated calls with the same arguments agree', () => {
    expect(t('fa', 'sharedDoc')).toBe(t('fa', 'sharedDoc'));
  });
});

describe('dictionaries', () => {
  it('carry identical key sets in English and Persian', () => {
    expect(Object.keys(dictionaries.fa).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it('have non-empty translations for every key in both languages', () => {
    Object.keys(dictionaries.en).forEach((key) => {
      expect(dictionaries.en[key], `en[${key}]`).toBeTruthy();
      expect(dictionaries.fa[key], `fa[${key}]`).toBeTruthy();
    });
  });

  it('include the keys legacy registered inside feature modules', () => {
    // share.ts
    expect(t('en', 'linkWarn')).toContain('30,000');
    expect(t('en', 'linkTooLarge')).toContain('300,000');
    expect(t('en', 'sharedDoc')).toBe('Shared document');
    // ai/index.ts
    expect(t('en', 'aiButton')).toBe('AI assistant');
    expect(t('en', 'aiToolRead')).toBe('Reading document…');
    expect(t('en', 'aiSelectionChip')).toBe('Editing selection');
    // ai/edits.ts
    expect(t('en', 'aiReplaceDocConfirm')).toContain('Replace the whole document');
    // markdown.ts
    expect(t('en', 'copyCode')).toBe('Copy');
    // documents.ts
    expect(t('en', 'loadError')).toBe('Could not load document');
  });
});
