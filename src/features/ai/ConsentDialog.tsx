// Module: features/ai/ConsentDialog — the one-time ~4 GB model-download
// consent dialog, shown when the user tries to USE the builtin model while its
// availability is 'downloadable'. RAC's alertdialog variant: a non-dismissable
// ModalOverlay + <Dialog role="alertdialog"> (React Aria Components has no
// dedicated AlertDialog export in 1.21; role + non-dismissable overlay give
// the same attention-gated semantics — outside click does nothing, an explicit
// button answer is required). ONLY the Download press continues into the
// download (user activation); "Not now" keeps the draft and shows the honest
// unavailable explainer. Legacy twin: legacy/src/ai/index.ts downloadable
// state + docs/uikit-research.md consent gate.

import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from 'react-aria-components';
import styles from './AiPanel.module.css';

interface ConsentDialogProps {
  isOpen: boolean;
  tt: (key: string) => string;
  onAccept: () => void;
  onDecline: () => void;
}

/** Attention-gated download-consent dialog (never auto-downloads). */
export default function ConsentDialog({
  isOpen,
  tt,
  onAccept,
  onDecline,
}: ConsentDialogProps) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      isDismissable={false}
      className={styles.consentOverlay}
    >
      <Modal className={styles.consentModal}>
        <Dialog role="alertdialog" aria-label={tt('aiConsentTitle')} className={styles.consentDialog}>
          <Heading slot="title" className={styles.consentTitle}>
            {tt('aiConsentTitle')}
          </Heading>
          <p className={styles.consentBody}>{tt('aiConsentBody')}</p>
          <div className={styles.consentActions}>
            <Button onPress={onAccept} className={styles.consentDownload}>
              {tt('aiDownloadAction')}
            </Button>
            <Button onPress={onDecline} className={styles.consentNotNow}>
              {tt('aiNotNow')}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
