import { describe, expect, it } from 'vitest';

import APP_CSS from './app.css?raw';

const NARROW = /@media \(max-width: 56rem\) \{([\s\S]*?)\n\}/;

describe('console layout on a narrow screen', () => {
  it('shows one pane at a time: the inbox, or the open case or form', () => {
    const narrow = NARROW.exec(APP_CSS)?.[1] ?? '';
    expect(narrow).toMatch(
      /\.workspace-case \.inbox,\s*\.workspace-new-case \.inbox,\s*\.workspace-inbox \.workspace-detail \{\s*display: none;/,
    );
  });
});

describe('console focus (WCAG 2.4.7)', () => {
  it('draws focus as an offset outline, which a sello-colored button cannot hide and forced colors keep', () => {
    expect(APP_CSS).not.toMatch(/outline:\s*none/);
    expect(APP_CSS).toMatch(
      /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--sello\);[^}]*outline-offset:\s*2px;/,
    );
  });
});
