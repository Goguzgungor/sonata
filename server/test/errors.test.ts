import { describe, it, expect } from 'vitest';
import { ApiError } from '../src/errors.js';

describe('ApiError', () => {
  it('serialises to the envelope', () => {
    const e = new ApiError(422, 'SlippageExceeded', 'contract error 2', { code: 2, details: { fn: 'swap' } });
    expect(e.status).toBe(422);
    expect(e.toJSON()).toEqual({ error: 'SlippageExceeded', message: 'contract error 2', code: 2, details: { fn: 'swap' } });
  });
  it('omits code and details when absent', () => {
    expect(new ApiError(404, 'contract_not_found', 'nope').toJSON()).toEqual({ error: 'contract_not_found', message: 'nope' });
  });
});
