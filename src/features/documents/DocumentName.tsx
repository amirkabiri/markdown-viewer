// Module: features/documents/DocumentName — the inline document-name editor.
// Renders the name as a quiet button (single click = onActivate, double-click
// = edit) that swaps to a text input; Enter/blur commits a non-empty trimmed
// name through onCommit, Escape cancels. Editing is controlled (`editing` /
// `onEditingChange`) so a parent — the sidebar row menu's Rename action, or
// the workspace pane head — can open the editor from outside. Used everywhere
// the vanilla app showed a static document name.
import { useCallback, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';

export interface DocumentNameProps {
  name: string;
  /** Accessible label for the trigger and the input (localized "Rename"). */
  label: string;
  /** Controlled: whether the inline input is open. */
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** Called with the committed, trimmed name (only when it actually changed). */
  onCommit: (name: string) => void;
  /** Single-click activation (e.g. selecting the row). */
  onActivate: () => void;
  className: string;
  inputClassName: string;
}

export default function DocumentName({
  name,
  label,
  editing,
  onEditingChange,
  onCommit,
  onActivate,
  className,
  inputClassName,
}: DocumentNameProps) {
  const [draft, setDraft] = useState(name);

  const startEditing = useCallback((event: MouseEvent) => {
    event.stopPropagation();
    setDraft(name);
    onEditingChange(true);
  }, [name, onEditingChange]);

  const commit = useCallback(() => {
    onEditingChange(false);
    const next = draft.trim();
    if (next !== '' && next !== name) onCommit(next);
  }, [draft, name, onCommit, onEditingChange]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      onEditingChange(false);
    }
  }, [commit, onEditingChange]);

  // Stable mount callback (jsx-a11y/no-autofocus bans the attribute): focus
  // + select on mount only — an inline arrow would re-run every keystroke
  // and re-select, swallowing typed characters.
  const focusInput = useCallback((el: HTMLInputElement | null) => {
    el?.focus();
    el?.select();
  }, []);

  if (editing) {
    return (
      <input
        ref={focusInput}
        className={inputClassName}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={label}
      onClick={onActivate}
      onDoubleClick={startEditing}
    >
      {name}
    </button>
  );
}
