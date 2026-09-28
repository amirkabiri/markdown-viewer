// The `?` cheat sheet: a modal React Aria Dialog listing every global
// shortcut — grouped, localized (EN/FA), with platform-appropriate key
// symbols (⌘ glyphs on macOS, Ctrl/Alt/Shift names elsewhere). Every row
// renders straight from SHORTCUTS — the same table the global dispatcher
// matches against and the README documents (test-enforced) — so the cheat
// sheet cannot drift from actual behavior. Focus trap, typeahead and Esc
// handling come from React Aria; styling stays ours via CSS Modules.
import {
  Button, Dialog, Heading, Modal,
} from 'react-aria-components';
import { useMemo } from 'react';

import { useT } from './i18n';
import {
  GROUPS,
  SHORTCUTS,
  formatCombo,
  platformFor,
} from './shortcuts';

import styles from './ShortcutsDialog.module.css';

export interface ShortcutsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

const CLOSE_BUTTON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function ShortcutsDialog({ isOpen, onOpenChange }: ShortcutsDialogProps) {
  const t = useT();
  // Detected once per mount — the platform cannot change mid-session.
  const platform = useMemo(() => platformFor(window.navigator.platform), []);

  return (
    <Modal isDismissable isOpen={isOpen} onOpenChange={onOpenChange} className={styles.overlay}>
      <Dialog className={styles.dialog}>
        {({ close }) => (
          <>
            <div className={styles.head}>
              <Heading slot="title" className={styles.title}>{t('shortcuts')}</Heading>
              <Button className={styles.closeBtn} aria-label={t('close')} onPress={close}>
                {CLOSE_BUTTON}
              </Button>
            </div>
            {GROUPS.map((group) => (
              <section key={group.id} className={styles.group}>
                <h3 className={styles.groupTitle}>{t(group.labelKey)}</h3>
                <ul className={styles.rows}>
                  {SHORTCUTS.filter((def) => def.group === group.id).map((def) => (
                    <li key={def.id} className={styles.row}>
                      <span className={styles.label}>{t(def.labelKey)}</span>
                      {/* dir=ltr keeps Ctrl/⌘ combos readable inside the FA layout */}
                      <kbd className={styles.keys} dir="ltr">{formatCombo(def.combo, platform)}</kbd>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </Dialog>
    </Modal>
  );
}
