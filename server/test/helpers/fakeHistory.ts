import type { EventPage, EventQuery, HistorySource, Retention } from '../../src/history/types.js';

const RETENTION: Retention = { oldestLedger: 1000, latestLedger: 200_000, latestLedgerCloseTime: '2026-09-19T00:00:00.000Z' };

/** Scripted HistorySource: `pages` are consumed in order by events(); once exhausted, an empty page (fixed retention) is returned. `calls` records every events() argument. `fail`, when set, makes events() reject with it. */
export class FakeHistorySource implements HistorySource {
  readonly name = 'fake';
  pages: EventPage[] = [];
  calls: EventQuery[] = [];
  fail?: Error;

  async retention(): Promise<Retention> { return RETENTION; }

  async events(q: EventQuery): Promise<EventPage> {
    this.calls.push(q);
    if (this.fail) throw this.fail;
    const page = this.pages.shift();
    return page ?? { events: [], cursor: null, ...RETENTION };
  }
}
