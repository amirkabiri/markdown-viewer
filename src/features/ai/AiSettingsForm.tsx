// Module: features/ai/AiSettingsForm — the provider settings disclosure:
// provider Select (builtin / OpenAI-compatible / Anthropic-compatible), the
// external fields (base URL, API token, model), the direct-edit toggle (the
// agent's WRITE permission — persists immediately), and Save (validate +
// persist + activate — the parent owns the draft state and normalization, so
// this form is fully controlled and needs no prop-sync effects). Legacy twin:
// legacy/src/ai/index.ts buildSettingsSection().

import {
  Button,
  Checkbox,
  Disclosure,
  DisclosurePanel,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  TextField,
} from 'react-aria-components';
import type { ProviderId } from '../../lib/ai/types';
import styles from './AiPanel.module.css';

/** The form's draft (directEdit is NOT a draft field — it saves immediately). */
export interface ProviderDraft {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface AiSettingsFormProps {
  tt: (key: string) => string;
  /** The lifted draft — edited per keystroke, applied on Save. */
  draft: ProviderDraft;
  onDraftChange: (next: ProviderDraft) => void;
  /** Save press: the parent validates + persists + activates the draft. */
  onApply: () => void;
  directEdit: boolean;
  onDirectEditChange: (on: boolean) => void;
}

const PROVIDER_OPTIONS: readonly { id: ProviderId; labelKey: string }[] = [
  { id: 'builtin', labelKey: 'aiProviderBuiltin' },
  { id: 'openai', labelKey: 'aiProviderOpenai' },
  { id: 'anthropic', labelKey: 'aiProviderAnthropic' },
];

/** Provider settings disclosure (collapsed by default, like legacy). */
export default function AiSettingsForm({
  tt,
  draft,
  onDraftChange,
  onApply,
  directEdit,
  onDirectEditChange,
}: AiSettingsFormProps) {
  const external = draft.provider !== 'builtin';
  const patch = (part: Partial<ProviderDraft>): void => {
    onDraftChange({ ...draft, ...part });
  };

  return (
    <Disclosure className={styles.settings} defaultExpanded={false}>
      <Button slot="trigger" className={styles.settingsTrigger}>
        <span className={styles.caret} aria-hidden="true">▸</span>
        {tt('aiSettings')}
      </Button>
      <DisclosurePanel className={styles.settingsBody}>
        <div className={styles.field}>
          <Label className={styles.fieldLabel}>{tt('aiProvider')}</Label>
          <Select
            selectedKey={draft.provider}
            onSelectionChange={(key) => patch({ provider: key as ProviderId })}
            aria-label={tt('aiProvider')}
            className={styles.select}
          >
            <Button className={styles.selectButton}>
              <SelectValue />
            </Button>
            <Popover className={styles.popover}>
              <ListBox className={styles.listBox}>
                {PROVIDER_OPTIONS.map((option) => (
                  <ListBoxItem key={option.id} id={option.id} className={styles.listBoxItem}>
                    {tt(option.labelKey)}
                  </ListBoxItem>
                ))}
              </ListBox>
            </Popover>
          </Select>
        </div>

        <Checkbox
          isSelected={directEdit}
          onChange={onDirectEditChange}
          aria-label={tt('aiDirectEdit')}
          className={styles.directEdit}
        >
          <span className={styles.checkboxMark} aria-hidden="true" />
          {tt('aiDirectEdit')}
        </Checkbox>

        {external && (
          <TextField
            value={draft.baseUrl}
            onChange={(value) => patch({ baseUrl: value })}
            type="url"
            autoComplete="off"
            className={styles.field}
          >
            <Label className={styles.fieldLabel}>{tt('aiSettingsBaseUrl')}</Label>
            <Input placeholder="https://api.example.com/v1" className={styles.textField} />
          </TextField>
        )}
        {external && (
          <TextField
            value={draft.apiKey}
            onChange={(value) => patch({ apiKey: value })}
            type="password"
            autoComplete="off"
            className={styles.field}
          >
            <Label className={styles.fieldLabel}>{tt('aiSettingsApiKey')}</Label>
            <Input placeholder="sk-… (optional)" className={styles.textField} />
          </TextField>
        )}
        {external && (
          <TextField
            value={draft.model}
            onChange={(value) => patch({ model: value })}
            type="text"
            autoComplete="off"
            className={styles.field}
          >
            <Label className={styles.fieldLabel}>{tt('aiSettingsModel')}</Label>
            <Input placeholder="gpt-4o-mini / claude-sonnet-4-5" className={styles.textField} />
          </TextField>
        )}

        <Button onPress={onApply} className={styles.saveButton}>
          {tt('aiSave')}
        </Button>
      </DisclosurePanel>
    </Disclosure>
  );
}
