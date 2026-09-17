import { pgTable, text, bigint, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';

export const contracts = pgTable('contracts', {
  id: text('id').primaryKey(),
  network: text('network').notNull(),
  name: text('name'),
  wasmHash: text('wasm_hash'),
  specLedger: bigint('spec_ledger', { mode: 'number' }),
  specXdr: text('spec_xdr').array(),
  model: jsonb('model'),
  llmsTxt: text('llms_txt'),
  openapi: jsonb('openapi'),
  mcpScope: text('mcp_scope').notNull().default('ro'),
  status: text('status').notNull().default('queued'),
  steps: jsonb('steps').notNull().default([]),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const fnHints = pgTable('fn_hints', {
  contractId: text('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  fn: text('fn').notNull(),
  kind: text('kind').notNull(),
  observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow()
}, (t) => [primaryKey({ columns: [t.contractId, t.fn] })]);
