// Module: features/ai — entry point. Cross-feature imports of the AI panel go
// through this barrel, not the component file (see STYLEGUIDE.md, Imports).

export { default as AiPanel } from './AiPanel';
export type { AiPanelProps } from './AiPanel';
export { aiToast, aiToastQueue } from './toast-queue';
