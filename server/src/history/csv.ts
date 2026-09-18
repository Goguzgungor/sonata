import type { DecodedEvent } from './decode.js';
const cell = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const CSV_HEADER = 'id,ledger,closed_at,tx_hash,successful,event,topics,data';
export const toCsv = (events: DecodedEvent[]) => [CSV_HEADER, ...events.map((e) => [e.id, e.ledger, e.closed_at, e.tx_hash, e.successful, e.event ?? '', JSON.stringify(e.topics), JSON.stringify(e.data)].map(cell).join(','))].join('\n');
