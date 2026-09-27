// Feature entry — import the editor feature through this barrel from other
// features (STYLEGUIDE.md: no deep imports across feature boundaries).
export type { EditorApi, EditMode } from './api';
export { EditorProvider, useEditor } from './context';
export { default as Editor } from './Editor';
export { useEditorController } from './useEditorController';
export type { EditorController } from './useEditorController';
