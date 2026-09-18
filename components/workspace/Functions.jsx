'use client';
import { useEffect, useMemo, useState } from 'react';
import { download } from '@/lib/sonata';
import * as wallet from '@/lib/wallet';
import { contracts, isAccountId, PASSPHRASES } from '@/lib/api';
import { useSession } from '@/components/SessionProvider';
import { inputsOf, fieldKind, placeholderFor, coerceArgs } from '@/lib/args';
import { Label, CodeBox, CopyButton, ResponsiveTable } from '@/components/ui';
import { expertUrl } from '@/lib/expert';

const COLS = [
  { key: 'num', header: '', width: '56px' },
  { key: 'fn', header: 'Function', width: '170px', strong: true },
  { key: 'sig', header: 'Signature', mono: true },
  { key: 'kind', header: 'Kind', width: '110px', align: 'right' }
];
const MODES = [{ value: 'sim', label: 'Simulate' }, { value: 'build', label: 'Build transaction' }];
const sig = (f) => `${f.name}(${f.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')}) → ${f.output}`;
const kindChip = (S, k) => k === 'write' ? <S.Chip tone="inverse">Write</S.Chip> : k === 'read' ? <S.Chip tone="neutral">Read</S.Chip> : <S.Chip tone="neutral">Unknown</S.Chip>;

export default function Functions({ S, contract: c, id }) {
  const { address } = useSession();
  const functions = c?.functions || [];
  const [sel, setSel] = useState(functions[0]?.name || null);
  const fn = functions.find((f) => f.name === sel) || null;
  const inputs = useMemo(() => (fn ? inputsOf(fn) : []), [fn]);
  const [values, setValues] = useState({});
  const [source, setSource] = useState('');
  const [mode, setMode] = useState('sim');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [out, setOut] = useState(null);         // { kind: 'sim'|'build'|'submitted'|'error', body }
  const [signErr, setSignErr] = useState(null); // wallet rejection note, kept separate so a failed signature doesn't discard the built XDR in `out`
  const pick = (name) => { setSel(name); setValues({}); setErrors({}); setOut(null); setSignErr(null); };
  useEffect(() => { setSel(c?.functions?.[0]?.name || null); setValues({}); setErrors({}); setOut(null); setSignErr(null); setSource(''); }, [c?.id]);
  useEffect(() => { if (mode === 'build' && address && !source) setSource(address); }, [mode, address]);

  const run = async () => {
    const { args, errors: e } = coerceArgs(inputs, values);
    if (mode === 'build' && !isAccountId(source.trim())) e.source = 'A G… account address is required to build a transaction';
    if (mode === 'sim' && source.trim() && !isAccountId(source.trim())) e.source = 'Must be a G… account address';
    setErrors(e); setOut(null); setSignErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = mode === 'sim' ? await contracts.call(id, fn.name, args, source.trim() || undefined) : await contracts.tx(id, fn.name, args, source.trim());
      setOut({ kind: mode, body });
    } catch (err) {
      // details.path can point inside a value ("orders[0].qty"); the form is keyed by the top-level argument name.
      if (err.error === 'invalid_args' && err.details?.path) setErrors({ [String(err.details.path).split(/[.[]/)[0]]: err.message });
      setOut({ kind: 'error', body: err });
    } finally { setBusy(false); }
  };

  const signAndSubmit = async () => {
    const { args, errors: e } = coerceArgs(inputs, values);
    if (!isAccountId(source.trim())) e.source = 'A G… account address is required to build a transaction';
    setErrors(e); setOut(null); setSignErr(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const built = await contracts.tx(id, fn.name, args, source.trim());
      setOut({ kind: 'build', body: built });
      const signed = await wallet.signTransaction(built.xdr, PASSPHRASES[c.network], source.trim());
      setOut({ kind: 'submitted', body: { ...(await contracts.submit(id, signed)), xdr: built.xdr } });
    } catch (err) {
      // A rejected/failed wallet signature must not discard the built XDR already shown in `out` — surface it
      // as a note instead of replacing the Unsigned XDR panel with an error panel.
      if (err?.name === 'WalletError') setSignErr(err.code === 'network' ? `Switch your wallet to ${c.network} and try again.` : err.message);
      else { if (err.error === 'invalid_args' && err.details?.path) setErrors({ [String(err.details.path).split(/[.[]/)[0]]: err.message }); setOut({ kind: 'error', body: err }); }
    } finally { setBusy(false); }
  };

  if (!c?.functions) return null;

  const rows = c.functions.map((f, i) => ({
    num: <S.Numeral index={i + 1} />,
    fn: <button type="button" className="crumb" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: f.name === sel ? 700 : 400, cursor: 'pointer' }} onClick={() => pick(f.name)}>{f.name}</button>,
    sig: sig(f), kind: kindChip(S, f.kind)
  }));

  return (
    <>
      <ResponsiveTable S={S} columns={COLS} rows={rows} minWidth={760} />
      {fn && (
        <div className="two-col" style={{ marginTop: 24 }}>
          <div>
            <div className="sn-label sn-muted">Function detail · {fn.kind === 'unknown' ? 'unknown (classified on first simulation)' : fn.kind}</div>
            <h2 className="sn-h2" style={{ margin: '14px 0 0' }}>{fn.name}</h2>
            {fn.doc && <p className="sn-body sn-muted" style={{ marginTop: 8 }}>{fn.doc}</p>}
            <div className="sn-mono" style={{ marginTop: 10, overflowWrap: 'anywhere' }}>POST {contracts.urls(id).base}/{mode === 'sim' ? 'call' : 'tx'}/{fn.name}</div>
            <Label style={{ marginTop: 32 }}>Parameters</Label>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {inputs.length === 0 && <div className="sn-small sn-muted">No parameters.</div>}
              {inputs.map((i) => {
                const kind = fieldKind(i.schema);
                if (kind === 'boolean') return (
                  <div key={i.name}>
                    <label className="sn-small" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input type="checkbox" checked={!!values[i.name]} onChange={(e) => setValues({ ...values, [i.name]: e.target.checked })} /> {i.name} <span className="sn-muted">bool</span>
                    </label>
                    {errors[i.name] && <div className="sn-small" style={{ color: 'var(--sn-bad, #b00)', marginTop: 4 }}>{errors[i.name]}</div>}
                  </div>
                );
                if (kind === 'json') return (
                  <div key={i.name}>
                    <div className="sn-small" style={{ fontWeight: 700 }}>{i.name} <span className="sn-muted" style={{ fontWeight: 400 }}>{i.type} · JSON{i.required ? '' : ' · optional'}</span></div>
                    <textarea className="sn-mono" rows={3} style={{ width: '100%', marginTop: 6, font: 'inherit', fontFamily: 'var(--sn-font-mono)', border: '1px solid var(--sn-ink)', padding: 8, borderColor: errors[i.name] ? 'var(--sn-bad, #b00)' : undefined }}
                      placeholder={placeholderFor(i.schema)} value={values[i.name] || ''} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />
                    {errors[i.name] && <div className="sn-small" style={{ color: 'var(--sn-bad, #b00)', marginTop: 4 }}>{errors[i.name]}</div>}
                  </div>
                );
                return (
                  <S.Field key={i.name} label={i.name} mono hint={errors[i.name] || i.type + (i.required ? '' : ' · optional')} invalid={!!errors[i.name]}
                    type={kind === 'integer' ? 'number' : 'text'} placeholder={placeholderFor(i.schema)}
                    value={values[i.name] || ''} onChange={(e) => setValues({ ...values, [i.name]: e.target.value })} />
                );
              })}
              <S.Field label="source" mono hint={errors.source || (mode === 'build' ? 'G… account that will sign (required)' : 'G… account for the simulation (optional)')} invalid={!!errors.source}
                placeholder="G…" value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div style={{ marginTop: 24, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <S.Segmented ariaLabel="Mode" options={MODES} value={mode} onChange={(v) => { setMode(v); setOut(null); setErrors({}); setSignErr(null); }} />
              <S.Button disabled={busy} onClick={run}>{busy ? 'Working…' : mode === 'sim' ? 'Simulate' : 'Build unsigned XDR'}</S.Button>
              {mode === 'build' && address && <S.Button variant="secondary" disabled={busy} onClick={signAndSubmit}>Sign &amp; submit</S.Button>}
            </div>
            {signErr && <div className="sn-small" style={{ color: 'var(--sn-bad, #b00)', marginTop: 12 }}>{signErr}</div>}
          </div>
          <div>
            {out?.kind === 'sim' && (
              <>
                <Label>Result</Label>
                <div style={{ marginTop: 14 }}>
                  <CodeBox right={<CopyButton S={S} text={JSON.stringify(out.body.result, null, 2)}>Copy</CopyButton>}>
                    <div>
                      <pre className="sn-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(out.body.result, null, 2)}</pre>
                      <div className="sn-mono" style={{ color: 'var(--sn-ink-2)', marginTop: 10 }}>Simulated · {out.body.latency_ms} ms · ledger {out.body.ledger}</div>
                      {out.body.auth?.length > 0 && <div className="sn-mono" style={{ marginTop: 6 }}>Must sign: {out.body.auth.join(', ')}</div>}
                    </div>
                  </CodeBox>
                </div>
              </>
            )}
            {out?.kind === 'build' && (
              <>
                <Label>Unsigned XDR</Label>
                <div style={{ marginTop: 14 }}>
                  <CodeBox right={<CopyButton S={S} text={out.body.xdr}>Copy</CopyButton>}>
                    <div className="sn-mono" style={{ fontSize: 12, lineHeight: 1.7, overflowWrap: 'anywhere' }}>{out.body.xdr}</div>
                  </CodeBox>
                </div>
                <div style={{ marginTop: 16 }}>
                  <S.KeyValueList rows={[
                    { key: 'Fee', value: `${out.body.fee} stroops` },
                    { key: 'Signers', value: (out.body.auth || []).join(', ') || '—' },
                    { key: 'Expires', value: new Date(out.body.expires_at).toLocaleTimeString(), mono: false }
                  ]} />
                </div>
                <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <S.Button variant="secondary" onClick={() => download(`${fn.name}-unsigned.xdr`, out.body.xdr)}>Download XDR</S.Button>
                </div>
                <div className="sn-small sn-muted" style={{ marginTop: 12 }}>Sign it here with your connected wallet, or with any Stellar signer and <span className="sn-mono">POST {contracts.urls(id).base}/submit</span>.</div>
              </>
            )}
            {out?.kind === 'submitted' && (
              <>
                <Label>Submitted</Label>
                <div style={{ marginTop: 14 }}>
                  <S.KeyValueList rows={[
                    { key: 'Status', value: out.body.status, mono: false },
                    { key: 'Hash', value: <a className="crumb" href={expertUrl(c.network, 'tx', out.body.hash)} target="_blank" rel="noreferrer">{out.body.hash}</a> },
                    { key: 'Ledger', value: out.body.ledger !== undefined ? String(out.body.ledger) : '—' },
                    ...(out.body.fee_charged ? [{ key: 'Fee charged', value: `${out.body.fee_charged} stroops` }] : [])
                  ]} />
                </div>
              </>
            )}
            {out?.kind === 'error' && (
              <>
                <Label>Error</Label>
                <div style={{ marginTop: 14 }}>
                  <CodeBox>
                    <div>
                      <div className="sn-body" style={{ fontWeight: 700 }}>{out.body.message}</div>
                      <div className="sn-mono sn-muted" style={{ marginTop: 6 }}>{out.body.error}{out.body.code !== undefined ? ` · code ${out.body.code}` : ''}{out.body.status ? ` · HTTP ${out.body.status}` : ''}</div>
                    </div>
                  </CodeBox>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
