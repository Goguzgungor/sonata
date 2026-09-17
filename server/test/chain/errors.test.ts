import { describe, it, expect } from 'vitest';
import { parseSimulationError } from '../../src/chain/errors.js';

describe('parseSimulationError', () => {
  it('extracts contract error codes', () => {
    expect(parseSimulationError('HostError: Error(Contract, #2)\n\nEvent log (newest first): ...')).toEqual({ kind: 'contract', code: 2 });
  });
  it('treats everything else as host errors', () => {
    expect(parseSimulationError('HostError: Error(WasmVm, InvalidAction)')).toEqual({ kind: 'host', message: 'HostError: Error(WasmVm, InvalidAction)' });
  });
});
