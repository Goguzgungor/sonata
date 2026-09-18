'use client';
import { useRouter } from 'next/navigation';

/** Spec §4: an id the API has never seen (404) — the same panel on the public page and in the workspace shell. */
export default function NotRegistered({ S, id }) {
  const router = useRouter();
  return (
    <div style={{ borderTop: '1px solid var(--sn-ink)', padding: '24px 0' }}>
      <div className="sn-body" style={{ fontWeight: 700 }}>This contract isn&apos;t registered with Sonata.</div>
      <div style={{ marginTop: 16 }}><S.Button arrow onClick={() => router.push(`/register?id=${id}`)}>Register it</S.Button></div>
    </div>
  );
}
