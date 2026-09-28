// Module: ai — compatibility shim. The implementation lives in src/ai/; this
// file keeps the frozen import paths resolving: `./ai` (app wiring) and
// `../src/ai.js` (test/ai-chunk.test.ts), which TypeScript's bundler
// resolution does NOT map to src/ai/index.ts on its own.
export { initAi, normalizeStreamChunk } from './ai/index.js';
