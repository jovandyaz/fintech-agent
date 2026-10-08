import { describe, expect, it } from 'vitest';

import APP_CSS from './app.css?raw';

describe('console focus (WCAG 2.4.7)', () => {
  it('draws focus as an offset outline, which a sello-colored button cannot hide and forced colors keep', () => {
    expect(APP_CSS).not.toMatch(/outline:\s*none/);
    expect(APP_CSS).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--sello\);[^}]*outline-offset:\s*2px;/,
    );
  });
});
