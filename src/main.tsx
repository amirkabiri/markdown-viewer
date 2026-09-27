// React entry point. tokens.css is imported first so design tokens exist
// before any component CSS; the pre-paint boot script (public/boot.js, loaded
// from index.html) has already set data-theme/lang/dir to avoid flashing.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';

import './styles/tokens.css';

const container = document.querySelector<HTMLElement>('#root');

if (!container) {
  throw new Error('Qalam: #root element is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
