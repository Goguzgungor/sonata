import { createHash } from 'node:crypto';
import { contract } from '@stellar/stellar-sdk';
import type { ContractModel, FnKind, Network } from '../types.js';
import { renderInputs, renderOutput, renderType } from './render.js';
import { classifyByName } from './hints.js';
import { fnInputSchema, udtSchema } from './schema.js';

export type ModelMeta = { id: string; network: Network; name: string | null; wasmHash: string; specLedger: number; sac?: boolean };

export const wasmHashOf = (wasm: Buffer): string => createHash('sha256').update(wasm).digest('hex');

export function parseWasm(wasm: Buffer): contract.Spec {
  try {
    return contract.Spec.fromWasm(wasm);
  } catch (e) {
    throw new Error(`No contract spec found in WASM — was it built with soroban-sdk ≥ 20 and a release profile? (${(e as Error).message})`);
  }
}

const str = (v: unknown) => (v == null ? '' : String(v));

export function buildModel(spec: contract.Spec, meta: ModelMeta, hints: Record<string, FnKind> = {}): ContractModel {
  const functions = spec.funcs().map((fn) => {
    const name = str(fn.name);
    const inputs = renderInputs(fn);
    return {
      name,
      doc: str(fn.doc),
      inputs,
      output: renderOutput(fn),
      kind: hints[name] ?? classifyByName(name, inputs),
      jsonSchema: fnInputSchema(spec, name)
    };
  });

  const types: ContractModel['types'] = [];
  const errors: ContractModel['errors'] = [];
  const events: ContractModel['events'] = [];
  for (const entry of spec.entries as unknown as Array<{ type: string; value: any }>) {
    const v = entry.value;
    switch (entry.type) {
      case 'scSpecEntryUdtStructV0': types.push({ name: str(v.name), kind: 'struct', doc: str(v.doc), jsonSchema: udtSchema(spec, str(v.name)) }); break;
      case 'scSpecEntryUdtUnionV0': types.push({ name: str(v.name), kind: 'union', doc: str(v.doc), jsonSchema: udtSchema(spec, str(v.name)) }); break;
      case 'scSpecEntryUdtEnumV0': types.push({ name: str(v.name), kind: 'enum', doc: str(v.doc), jsonSchema: udtSchema(spec, str(v.name)) }); break;
      case 'scSpecEntryUdtErrorEnumV0':
        for (const c of v.cases as any[]) errors.push({ code: Number(c.value), name: str(c.name), doc: str(c.doc) });
        break;
      case 'scSpecEntryEventV0':
        events.push({ name: str(v.name), doc: str(v.doc), params: (v.params as any[]).map((p) => ({ name: str(p.name), type: renderType(p.type) })) });
        break;
    }
  }
  errors.sort((a, b) => a.code - b.code);
  return { ...meta, functions, types, errors, events };
}
