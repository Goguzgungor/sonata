import { contract } from '@stellar/stellar-sdk';
import type { Chain } from '../chain/types.js';
import type { ContractModel, JsonSchema, Network, Step } from '../types.js';
import { buildModel, parseWasm, wasmHashOf } from '../spec/model.js';
import type { Store } from './store.js';

export type Generators = { llmsTxt: (m: ContractModel) => string; openapi: (m: ContractModel) => JsonSchema };
const STEP_NAMES: Step['name'][] = ['fetch', 'parse', 'generate', 'index'];

/** Runs the four pipeline steps for one contract, persisting after each. Returns the final row status. */
export async function runPipeline(deps: { store: Store; chain: Chain; gen: Generators }, id: string, network: Network): Promise<void> {
  const { store, chain, gen } = deps;
  const steps: Step[] = STEP_NAMES.map((name) => ({ name, status: 'queued', detail: '' }));
  const save = (patch: Parameters<Store['update']>[1] = {}) => store.update(id, { steps: structuredClone(steps), ...patch });
  const run = async <T>(i: number, f: () => Promise<{ value: T; detail: string }>): Promise<T> => {
    steps[i].status = 'running'; await save({ status: 'running' });
    try { const { value, detail } = await f(); steps[i].status = 'done'; steps[i].detail = detail; await save(); return value; }
    catch (e) { const msg = (e as Error).message; steps[i].status = 'failed'; steps[i].error = msg; await save({ status: 'failed', error: msg }); throw e; }
  };
  try {
    const existing = await store.get(id);
    const wasm = await run(0, async () => { const w = await chain.getContractWasm(network, id); return { value: w, detail: `${(w.length / 1024).toFixed(1)} KB` }; });
    const wasmHash = wasmHashOf(wasm);
    if (existing?.wasmHash === wasmHash && existing.model && existing.specXdr) {   // unchanged upgrade → nothing to regenerate
      for (const s of steps) { s.status = 'done'; s.detail = 'unchanged'; } steps[3].status = 'skipped';
      await save({ status: 'ready', error: null }); return;
    }
    const spec = await run(1, async () => {
      const s = parseWasm(wasm);
      const n = (t: string) => (s.entries as unknown as Array<{ type: string }>).filter((e) => e.type.startsWith(t)).length;
      const types = n('scSpecEntryUdtStructV0') + n('scSpecEntryUdtUnionV0') + n('scSpecEntryUdtEnumV0');
      return { value: s, detail: `${s.funcs().length} functions · ${types} types · ${s.errorCases().length} errors` };
    });
    const hints = await store.getHints(id);
    const model = buildModel(spec, { id, network, name: existing?.name ?? null, wasmHash, specLedger: 0 }, hints);
    await run(2, async () => {
      const llms = gen.llmsTxt(model); const oa = gen.openapi(model);
      const tools = model.functions.length * 2 + 3;
      await store.update(id, { wasmHash, specLedger: model.specLedger, specXdr: (spec.entries as any[]).map((e) => e.toXDR('base64')), model, llmsTxt: llms, openapi: oa });
      return { value: null, detail: `OpenAPI 3.1 · ${tools} MCP tools` };
    });
    steps[3].status = 'skipped'; steps[3].detail = 'history indexing arrives in a later milestone';
    await save({ status: 'ready', error: null });
  } catch { /* already persisted as failed */ }
}
