// Unit tests for src/lib/ai/settings.ts — the validated mv:ai persistence
// (7 tests ported from legacy/test/ai-providers.test.ts) plus the additive
// directEdit field tests (2 ported from legacy/test/ai-edits.test.ts, which
// shared the settings boundary). Storage is the in-memory fake, stubbed as
// the global localStorage the default MvStore reads at call time.

import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  DEFAULT_SETTINGS,
  isExternalReady,
  loadSettings,
  normalizeSettings,
  saveSettings,
} from './settings';
import type { ProviderSettings } from './types';
import makeStorage from '../../test/fakes';

describe('settings (mv:ai)', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({
      provider: 'builtin',
      baseUrl: '',
      apiKey: '',
      model: '',
    });
  });

  it('roundtrips a valid configuration under the mv:ai key', () => {
    const next: ProviderSettings = {
      provider: 'anthropic',
      baseUrl: 'https://gateway.internal/anthropic',
      apiKey: 'tok-۱۲۳',
      model: 'claude-test',
    };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
    expect(storage.getItem('mv:ai')).toBeTruthy();
    expect(JSON.parse(storage.getItem('mv:ai') as string)).toEqual(next);
  });

  it('repairs invalid stored values field by field', () => {
    storage.setItem('mv:ai', JSON.stringify({
      provider: 'not-a-provider',
      baseUrl: 42,
      apiKey: null,
      model: true,
      extra: 'dropped',
    }));
    expect(loadSettings()).toEqual({
      provider: 'builtin',
      baseUrl: '',
      apiKey: '',
      model: '',
    });
  });

  it('repairs broken JSON and non-object payloads to defaults', () => {
    storage.setItem('mv:ai', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem('mv:ai', '[1,2,3]');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    storage.setItem('mv:ai', '"openai"');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('trims baseUrl/model but preserves the apiKey verbatim', () => {
    const next: ProviderSettings = {
      provider: 'openai',
      baseUrl: '  https://api.example.com/v1/  ',
      apiKey: '  keep my spaces  ',
      model: ' gpt-test ',
    };
    saveSettings(next);
    expect(loadSettings()).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.example.com/v1/', // whitespace-trimmed; slash handling is the provider's job
      apiKey: '  keep my spaces  ',
      model: 'gpt-test',
    });
  });

  it('normalizes any raw value through normalizeSettings', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ provider: 'openai' })).toEqual({
      provider: 'openai', baseUrl: '', apiKey: '', model: '',
    });
  });

  it('isExternalReady requires baseUrl + model for external providers only', () => {
    const settings = (provider: 'builtin' | 'openai' | 'anthropic', baseUrl: string, model: string): ProviderSettings => ({
      provider,
      baseUrl,
      apiKey: '',
      model,
    });
    expect(isExternalReady(settings('builtin', '', ''))).toBe(false);
    expect(isExternalReady(settings('openai', 'https://x/v1', 'm'))).toBe(true);
    expect(isExternalReady(settings('openai', 'https://x/v1', ''))).toBe(false);
    expect(isExternalReady(settings('anthropic', '', 'm'))).toBe(false);
  });
});

/* ---------------- directEdit settings field (additive) ---------------- */

describe('directEdit settings field', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to off (key absent) and repairs wrong types to absent/off', () => {
    expect(normalizeSettings({}).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: false }).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: 'yes' }).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: 1 }).directEdit).toBeUndefined();
    expect(normalizeSettings({ directEdit: null }).directEdit).toBeUndefined();
  });

  it('keeps an explicit true and roundtrips it through mv:ai', () => {
    saveSettings({
      provider: 'openai',
      baseUrl: 'https://x/v1',
      apiKey: '',
      model: 'm',
      directEdit: true,
    });
    expect(loadSettings().directEdit).toBe(true);

    saveSettings({
      provider: 'openai',
      baseUrl: 'https://x/v1',
      apiKey: '',
      model: 'm',
    });
    expect(loadSettings().directEdit).toBeUndefined(); // toggled back off → absent = false
  });
});
