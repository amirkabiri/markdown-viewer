// The Open dialog (legacy #open-dialog) on React Aria primitives: a modal
// Dialog with Tabs for From URL / Upload file / Paste text. Keyboard focus,
// typeahead and Esc handling come from React Aria; styling stays ours via
// CSS Modules. The dialog is presentation-only: it reports intents upward
// (onOpenUrl / onOpenFile / onPaste) and the shell orchestrates.
import {
  Button, Dialog, Heading, Modal, Tab, TabList, TabPanel, Tabs,
} from 'react-aria-components';
import { useState, type FormEvent } from 'react';

import { useT } from '../../app/i18n';

import styles from './OpenDialog.module.css';

export interface OpenDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** URL tab submitted (raw input — normalization happens downstream). */
  onOpenUrl: (url: string) => void;
  /** Upload tab: a picked (or dropped) file. */
  onOpenFile: (file: File) => void;
  /** Paste tab: the pasted markdown text. */
  onPaste: (text: string) => boolean;
}

const CLOSE_BUTTON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function OpenDialog({
  isOpen, onOpenChange, onOpenUrl, onOpenFile, onPaste,
}: OpenDialogProps) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [pasteText, setPasteText] = useState('');

  const close = () => onOpenChange(false);

  const handleUrlSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = url.trim();
    if (!value) return;
    setUrl('');
    close();
    onOpenUrl(value);
  };

  const handlePaste = () => {
    if (!onPaste(pasteText)) return; // rejected (empty/too large) — dialog stays
    setPasteText('');
    close();
  };

  return (
    <Modal isDismissable isOpen={isOpen} onOpenChange={onOpenChange} className={styles.overlay}>
      <Dialog className={styles.dialog}>
        {({ close: closeDialog }) => (
          <>
            <div className={styles.head}>
              <Heading slot="title" className={styles.title}>{t('openTitle')}</Heading>
              <Button
                className={styles.closeBtn}
                onPress={() => {
                  closeDialog();
                }}
                aria-label={t('close')}
              >
                {CLOSE_BUTTON}
              </Button>
            </div>

            <Tabs className={styles.tabs}>
              <TabList aria-label={t('openTitle')} className={styles.tabList}>
                <Tab id="url" className={({ isSelected }) => `${styles.tab}${isSelected ? ` ${styles.tabActive}` : ''}`}>
                  {t('tabUrl')}
                </Tab>
                <Tab id="upload" className={({ isSelected }) => `${styles.tab}${isSelected ? ` ${styles.tabActive}` : ''}`}>
                  {t('tabUpload')}
                </Tab>
                <Tab id="paste" className={({ isSelected }) => `${styles.tab}${isSelected ? ` ${styles.tabActive}` : ''}`}>
                  {t('tabPaste')}
                </Tab>
              </TabList>

              <TabPanel id="url" className={styles.tabPanel}>
                <form onSubmit={handleUrlSubmit} className={styles.urlForm}>
                  <input
                    className={styles.urlInput}
                    type="url"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('urlPlaceholder')}
                    aria-label={t('tabUrl')}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <Button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
                    {t('load')}
                  </Button>
                </form>
                <p className={styles.hint}>{t('urlHint')}</p>
              </TabPanel>

              <TabPanel id="upload" className={styles.tabPanel}>
                <label className={styles.fileDrop} htmlFor="open-dialog-file-input">
                  <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="m17 8-5-5-5 5" />
                    <path d="M12 3v12" />
                  </svg>
                  <span>{t('chooseFile')}</span>
                  <input
                    id="open-dialog-file-input"
                    type="file"
                    accept=".md,.markdown,.mdx,.txt,text/markdown,text/plain"
                    className={styles.fileInput}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        onOpenFile(file);
                        closeDialog();
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </TabPanel>

              <TabPanel id="paste" className={styles.tabPanel}>
                <textarea
                  className={styles.pasteInput}
                  rows={8}
                  placeholder={t('pastePlaceholder')}
                  aria-label={t('tabPaste')}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                />
                <Button
                  onPress={handlePaste}
                  className={`${styles.btn} ${styles.btnPrimary} ${styles.pasteLoadBtn}`}
                >
                  {t('render')}
                </Button>
              </TabPanel>
            </Tabs>
          </>
        )}
      </Dialog>
    </Modal>
  );
}
