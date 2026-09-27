// Component tests for <App /> — RTL with by-role queries as the primary way
// to find elements (they query the accessibility tree, so they double as an
// a11y smoke check). One behavior per test; see TESTING.md.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import App from './App';

describe('<App />', () => {
  it('renders the topbar with the Qalam brand', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toHaveTextContent('Qalam');
    expect(screen.getByRole('link', { name: 'Qalam home' })).toBeVisible();
  });

  it('renders a main region for the workspace', () => {
    render(<App />);

    expect(screen.getByRole('main')).toBeVisible();
  });

  it('renders a footer crediting the project', () => {
    render(<App />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent('Qalam');
    expect(
      screen.getByRole('link', { name: 'GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/amirkabiri/qalam');
  });
});
