'use client';
import { useState } from 'react';
import { copyText } from '@/lib/sonata';

export function CopyButton({ S, text, variant = 'text', arrow, size, children }) {
  const [ok, setOk] = useState(false);
  return (
    <S.Button variant={variant} arrow={arrow} size={size}
      onClick={() => { copyText(text); setOk(true); setTimeout(() => setOk(false), 1400); }}>
      {ok ? 'Copied ✓' : children}
    </S.Button>
  );
}

export function Label({ style, className, children }) {
  return <div className={'sn-label' + (className ? ' ' + className : '')} style={style}>{children}</div>;
}

export function CodeBox({ children, right }) {
  return (
    <div className="code-box">
      {children}
      {right ? <div className="code-box__right">{right}</div> : null}
    </div>
  );
}

/**
 * Design-system DataTable on wide screens; stacked label/value cards on phones.
 * `minWidth` is the table's natural width, used for horizontal scroll on tablets.
 */
export function ResponsiveTable({ S, columns, rows, minWidth = 860 }) {
  return (
    <>
      <div className="rt-desktop scroll-x">
        <div style={{ minWidth }}>
          <S.DataTable columns={columns} rows={rows} />
        </div>
      </div>
      <div className="rt-mobile">
        {rows.map((row, i) => (
          <div key={i} className="rt-card">
            {columns.map((c) => {
              const v = row[c.key];
              if (v === undefined || v === null || v === '') return null;
              if (!c.header) {
                return <div key={c.key} className={'rt-card__bare' + (c.strong ? ' rt-card__bare--strong' : '')}>{v}</div>;
              }
              const cls = ['rt-card__value', c.mono ? 'rt-card__value--mono' : '', c.strong ? 'rt-card__value--strong' : ''].filter(Boolean).join(' ');
              return (
                <div key={c.key} className="rt-card__line">
                  <span className="rt-card__label">{c.header}</span>
                  <span className={cls}>{v}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

export const evRow = (S) => (e) => ({
  time: e[0], event: e[1], call: e[2], ledger: e[3],
  status: <S.Chip tone={e[4] ? 'good' : 'failed'}>{e[4] ? 'Success' : 'Reverted'}</S.Chip>
});
