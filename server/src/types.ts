export type Network = 'testnet' | 'mainnet';
export type JsonSchema = Record<string, unknown>;
export type FnKind = 'read' | 'write' | 'unknown';

export type FnModel = {
  name: string;
  doc: string;
  inputs: Array<{ name: string; type: string }>;
  output: string;
  kind: FnKind;
  jsonSchema: JsonSchema;      // { type:'object', properties, required, additionalProperties:false } — self-contained
};

export type ContractModel = {
  id: string;
  network: Network;
  name: string | null;
  wasmHash: string;
  specLedger: number;
  sac?: boolean;
  functions: FnModel[];
  types: Array<{ name: string; kind: 'struct' | 'union' | 'enum'; doc: string; jsonSchema: JsonSchema }>;
  errors: Array<{ code: number; name: string; doc: string }>;
  events: Array<{ name: string; doc: string; params: Array<{ name: string; type: string }> }>;
};

export type McpScope = 'ro' | 'rw';
export type StepStatus = 'queued' | 'running' | 'done' | 'skipped' | 'failed';
export type Step = { name: 'fetch' | 'parse' | 'generate' | 'index'; status: StepStatus; detail: string; error?: string };
export type ContractStatus = 'queued' | 'running' | 'ready' | 'failed';
