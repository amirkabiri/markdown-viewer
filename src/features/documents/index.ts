// Feature entry — import the documents feature through this barrel.
export { useDocuments, ACTIVE_DOC_KEY } from './useDocuments';
export type {
  DocumentsController, DocumentsDeps, LoadOptions, ToastKind,
} from './useDocuments';
export { default as OpenDialog } from './OpenDialog';
export { default as DocumentList } from './DocumentList';
export type { DocumentListProps } from './DocumentList';
export { default as DocumentName } from './DocumentName';
export type { DocumentNameProps } from './DocumentName';
export { default as WELCOME_MD } from './welcome';
