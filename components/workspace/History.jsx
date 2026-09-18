'use client';
import Link from 'next/link';

/** M4 brings a history provider; until then this tab says so instead of showing invented rows. */
export default function History() {
  return (
    <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '32px 0', maxWidth: 640 }}>
      <div className="sn-body" style={{ fontWeight: 700 }}>History isn&apos;t live yet.</div>
      <div className="sn-small sn-muted" style={{ marginTop: 8 }}>Decoded events and calls arrive with a history provider in a later release. Reads, simulation, transaction building and MCP tools already work — see the <Link className="crumb" href="/docs/api">REST API docs</Link>.</div>
    </div>
  );
}
