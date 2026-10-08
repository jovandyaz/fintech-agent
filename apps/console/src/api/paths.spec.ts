import { describe, expect, it } from 'vitest';

import { API_PATH } from './paths.js';

const ODD_ID = 'a/b?c#d';

describe('api paths', () => {
  it('keeps every id one path segment, whatever it holds', () => {
    expect(API_PATH.case(ODD_ID)).toBe('/cases/a%2Fb%3Fc%23d');
    expect(API_PATH.rerun(ODD_ID)).toBe('/cases/a%2Fb%3Fc%23d/rerun');
    expect(API_PATH.decision(ODD_ID)).toBe('/actions/a%2Fb%3Fc%23d/decision');
  });
});
