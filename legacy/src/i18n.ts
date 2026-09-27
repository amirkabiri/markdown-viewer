// Module: i18n — EN/FA dictionaries and language application. Owner of t/applyLang/setLang/registerI18n.
// Imports ONLY state.ts: other modules call registerI18n() at module top level, so this
// module must fully evaluate before any of them (keeps top-level registration TDZ-safe).
import { $, $$, state, store, updateCounts } from './state.js';
import type { Lang } from './state.js';

type Dict = Record<string, string>;

const I18N: Record<Lang, Dict> = {
  en: {
    appTitle: 'Qalam',
    togglePanel: 'Toggle panel',
    open: 'Open',
    paneEditor: 'Editor only',
    paneSplit: 'Split view',
    panePreview: 'Preview only',
    copyLink: 'Copy link to this document',
    toggleDir: 'Text direction (Auto / LTR / RTL)',
    toggleLang: 'تغییر زبان به فارسی',
    toggleTheme: 'Toggle light / dark theme',
    editor: 'Editor',
    preview: 'Preview',
    editorAria: 'Markdown source',
    words: 'words',
    chars: 'chars',
    contents: 'On this page',
    documents: 'Documents',
    docReadme: 'About this viewer',
    docSampleEn: 'Feature tour (EN)',
    docSampleFa: 'Feature tour (فارسی)',
    newDoc: 'New document',
    recent: 'Recent',
    footer: 'Free & open source',
    openTitle: 'Open a document',
    close: 'Close',
    tabUrl: 'From URL',
    tabUpload: 'Upload file',
    tabPaste: 'Paste text',
    urlPlaceholder: 'https://… or a github.com blob link',
    load: 'Load',
    urlHint: 'Tip: a GitHub blob link is converted to a raw URL automatically.',
    chooseFile: 'Choose a .md file or drop it here',
    pastePlaceholder: '# Paste Markdown here…',
    render: 'Insert & render',
    dropHere: 'Drop your .md file to load it',
    copied: 'Link copied to clipboard',
    newDocConfirm: 'Clear the editor and start a new document?',
    libError: 'A library failed to load — check your connection.',
  },
  fa: {
    appTitle: 'قلم',
    togglePanel: 'نمایش/بستن پنل',
    open: 'باز کردن',
    paneEditor: 'فقط ویرایشگر',
    paneSplit: 'نمای دو بخشی',
    panePreview: 'فقط پیش‌نمایش',
    copyLink: 'کپی نشانی این سند',
    toggleDir: 'جهت متن (خودکار / چپ‌به‌راست / راست‌به‌چپ)',
    toggleLang: 'Switch to English',
    toggleTheme: 'تغییر پوسته روشن / تاریک',
    editor: 'ویرایشگر',
    preview: 'پیش‌نمایش',
    editorAria: 'متن مارک‌داون',
    words: 'واژه',
    chars: 'نویسه',
    contents: 'در این صفحه',
    documents: 'اسناد',
    docReadme: 'درباره این نمایشگر',
    docSampleEn: 'آشنایی با امکانات (EN)',
    docSampleFa: 'آشنایی با امکانات (فارسی)',
    newDoc: 'سند جدید',
    recent: 'اخیراً دیده‌شده',
    footer: 'متن‌باز و رایگان',
    openTitle: 'باز کردن سند',
    close: 'بستن',
    tabUrl: 'از نشانی',
    tabUpload: 'بارگذاری فایل',
    tabPaste: 'چسباندن متن',
    urlPlaceholder: 'نشانی اینترنتی یا لینک گیت‌هاب…',
    load: 'بارگیری',
    urlHint: 'نکته: لینک‌های blob گیت‌هاب خودکار به نشانی خام تبدیل می‌شوند.',
    chooseFile: 'یک فایل .md انتخاب کنید یا اینجا رها کنید',
    pastePlaceholder: '# متن مارک‌داون را اینجا بچسبانید…',
    render: 'درج و نمایش',
    dropHere: 'فایل مارک‌داون را برای بارگذاری رها کنید',
    copied: 'نشانی در کلیپ‌بورد کپی شد',
    newDocConfirm: 'ویرایشگر خالی و سند جدیدی آغاز شود؟',
    libError: 'بارگیری یکی از کتابخانه‌ها ناموفق بود — اتصال اینترنت را بررسی کنید.',
  },
};

export const t = (key: string): string => (I18N[state.lang] && I18N[state.lang][key]) || I18N.en[key] || key;

/** Merge {key: {en, fa}} entries so any module can add translations inside its own file. */
export function registerI18n(keys: Record<string, { en: string; fa: string }>): void {
  for (const key of Object.keys(keys)) {
    I18N.en[key] = keys[key].en;
    I18N.fa[key] = keys[key].fa;
  }
}

export function applyLang(): void {
  const root = document.documentElement;
  root.lang = state.lang;
  root.dir = state.lang === 'fa' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  $$('[data-i18n-ph]').forEach((el) => { (el as HTMLInputElement | HTMLTextAreaElement).placeholder = t(el.dataset.i18nPh!); });
  $$('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
    el.setAttribute('aria-label', t(el.dataset.i18nTitle!));
  });
  $$('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria!)));
  $('#lang-btn')!.textContent = state.lang === 'fa' ? 'EN' : 'فا';
  document.title = t('appTitle');
  if (state.doc) $('#doc-name')!.textContent = state.doc.name;
  updateCounts();
}

/** Switch UI language, persist it, and re-apply every translation. */
export function setLang(lang: Lang): void {
  state.lang = lang;
  store.set('lang', lang);
  applyLang();
}
