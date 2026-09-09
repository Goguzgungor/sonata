import { ImageResponse } from 'next/og';

export const alt = 'Sonata — API and MCP layer for Stellar contracts';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GROUND = '#F5F3EE';
const INK = '#121212';
const INK2 = '#5B5852';
const HAIRLINE = '#DAD6CC';
const ACCENT = '#E4501F';

/* Schibsted Grotesk 800 for the headline; falls back to the built-in sans if the fetch fails. */
async function loadFont() {
  try {
    // No browser User-Agent: Google Fonts then serves TrueType, which Satori can read (it cannot read woff2).
    const css = await fetch('https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@800&display=swap', { headers: { 'User-Agent': 'curl/8' } }).then((r) => r.text());
    const m = css.match(/src: url\(([^)]+)\) format\('(truetype|opentype)'\)/);
    if (!m) return null;
    const data = await fetch(m[1]).then((r) => r.arrayBuffer());
    return [{ name: 'Schibsted Grotesk', data, weight: 800, style: 'normal' }];
  } catch (e) {
    return null;
  }
}

/* Staff lines motif, same geometry as the brand SVG. */
function Staff({ width, height }) {
  const step = height / 5;
  const ys = [0, 1, 2, 3, 4].map((i) => Math.round(step * (i + 0.5)) + 0.5);
  const r = Math.min(step * 2, width / 6);
  const x = (f) => Math.round(width * f);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none">
      {ys.map((y) => <line key={y} x1={0} y1={y} x2={width} y2={y} stroke={HAIRLINE} strokeWidth={1.5} />)}
      <path d={`M${x(0.08)} ${ys[4]} A${r} ${r} 0 0 1 ${x(0.08) + 2 * r} ${ys[4]}`} stroke={ACCENT} strokeWidth={2.5} />
      <path d={`M${x(0.42)} ${ys[0]} A${r} ${r} 0 0 0 ${x(0.42) + 2 * r} ${ys[0]}`} stroke={ACCENT} strokeWidth={2.5} />
      <path d={`M${x(0.72)} ${ys[4]} A${r} ${r} 0 0 1 ${x(0.72) + 2 * r} ${ys[4]}`} stroke={ACCENT} strokeWidth={2.5} />
      <circle cx={x(0.24)} cy={ys[2]} r={9} fill={ACCENT} />
      <line x1={x(0.24) + 9} y1={ys[2]} x2={x(0.24) + 9} y2={ys[0]} stroke={INK} strokeWidth={2.5} />
      <circle cx={x(0.55)} cy={ys[1]} r={9} fill={INK} />
      <line x1={x(0.55) + 9} y1={ys[1]} x2={x(0.55) + 9} y2={Math.max(2, ys[1] - step * 1.6)} stroke={INK} strokeWidth={2.5} />
      <circle cx={x(0.86)} cy={ys[3]} r={9} fill={ACCENT} />
      <line x1={x(0.86) + 9} y1={ys[3]} x2={x(0.86) + 9} y2={ys[1]} stroke={INK} strokeWidth={2.5} />
    </svg>
  );
}

export default async function Image() {
  const fonts = await loadFont();
  const family = fonts ? 'Schibsted Grotesk' : 'sans-serif';
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: GROUND, color: INK, padding: '56px 72px 52px', fontFamily: family }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>Sonata</div>
          <div style={{ display: 'flex', alignItems: 'center', border: `2px solid ${INK}`, padding: '10px 18px', fontSize: 20, letterSpacing: 3, fontWeight: 800 }}>TESTNET · MAINNET</div>
        </div>
        <div style={{ display: 'flex', marginTop: 40 }}>
          <Staff width={1056} height={150} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44, flexGrow: 1 }}>
          <div style={{ fontSize: 76, lineHeight: 1, fontWeight: 800, letterSpacing: -3 }}>API and MCP layer</div>
          <div style={{ fontSize: 76, lineHeight: 1, fontWeight: 800, letterSpacing: -3, marginTop: 6 }}>for Stellar contracts.</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: `2px solid ${INK}`, paddingTop: 20 }}>
          <div style={{ fontSize: 24, color: INK2 }}>REST API · MCP server · AI-ready docs · Indexed history</div>
          <div style={{ fontSize: 22, color: INK2, letterSpacing: 2 }}>sonata.brages.uk</div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts || undefined }
  );
}
