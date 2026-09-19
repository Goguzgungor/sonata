import type { Network } from '../types.js';

export type Retention = { oldestLedger: number; latestLedger: number; latestLedgerCloseTime: string };
export type EventQuery = { contractId: string; network: Network; startLedger: number; endLedger?: number; topics?: string[][]; cursor?: string; limit: number };
export type RawEvent = { id: string; ledger: number; closedAt: string; txHash: string; inSuccessfulContractCall: boolean; topic: string[]; value: string };
export type EventPage = { events: RawEvent[]; cursor: string | null } & Retention;

export interface HistorySource {
  readonly name: string;
  retention(network: Network): Promise<Retention>;
  events(q: EventQuery): Promise<EventPage>;
}
