'use client';
import { API_URL } from '@/lib/api';

/** Standard loading/error wrapper for live screens. `skeleton` renders while loading; errors render inline with the machine code and a Retry. */
export default function Async({ S, loading, error, onRetry, skeleton = null, children }) {
  if (loading) return skeleton ?? <Skeleton />;
  if (error) {
    const network = error.status === 0;
    return (
      <div className="async-error" role="alert" style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="sn-body" style={{ fontWeight: 700 }}>{network ? `Can't reach the API at ${API_URL}` : error.message || 'Something went wrong'}</div>
        {error.error && <div className="sn-mono sn-muted">{error.error}{error.code !== undefined ? ` · code ${error.code}` : ''}</div>}
        {onRetry && S && <div><S.Button variant="secondary" onClick={onRetry}>Retry</S.Button></div>}
      </div>
    );
  }
  return children;
}

export function Skeleton({ rows = 3 }) {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => <div key={i} style={{ height: 18, width: `${70 - i * 12}%`, background: 'var(--sn-hairline)', borderRadius: 2 }} />)}
    </div>
  );
}
