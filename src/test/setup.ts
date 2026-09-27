// Shared jsdom-project setup: jest-dom matchers on expect, and RTL cleanup
// after every test (RTL's auto-cleanup only registers itself when a global
// afterEach exists, which vitest's `globals: false` mode does not provide).
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(cleanup);
