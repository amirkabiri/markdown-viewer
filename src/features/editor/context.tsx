// Module: features/editor/context — publishes the live EditorApi app-wide.
// App provides the controller's api object (stable identity across renders);
// the AI panel consumes it with useEditor() wherever it mounts in the tree.
import { createContext, useContext, type ReactNode } from 'react';

import type { EditorApi } from './api';

const EditorContext = createContext<EditorApi | null>(null);

export interface EditorProviderProps {
  api: EditorApi;
  children: ReactNode;
}

export function EditorProvider({ api, children }: EditorProviderProps) {
  return <EditorContext.Provider value={api}>{children}</EditorContext.Provider>;
}

/** The live editor api. Throws outside a provider — the app always mounts one. */
export function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error('useEditor must be used inside <EditorProvider>');
  return api;
}
