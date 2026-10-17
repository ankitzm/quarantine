'use client';

import { useEffect, useState } from 'react';

type Entry = {
  seq: number;
  name: string;
  mode: string;
  ms: number;
  rows: number;
  error?: string;
  cypher: string;
};

const SEED = 'acme-mem-sop-v4';

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, init);
  return { status: res.status, body: await res.json() };
}

/** Plain operator console: drive every endpoint and watch the Cypher it runs. */
export default function Debug() {
  const [tenant, setTenant] = useState('acme');
  const [seed, setSeed] = useState(SEED);
  const [planId, setPlanId] = useState('');
  const [output, setOutput] = useState<unknown>(null);
  const [log, setLog] = useState<Entry[]>([]);

  useEffect(() => {
    const tick = () =>
      fetch('/api/queries?limit=30')
        .then((r) => r.json())
        .then((d: { entries: Entry[] }) => setLog(d.entries.toReversed()))
        .catch(() => undefined);
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  const q = `tenant=${encodeURIComponent(tenant)}`;
  const s = encodeURIComponent(seed);
  const run = async (path: string, init?: RequestInit) => {
    const result = await call(path, init);
    setOutput(result);
    return result as { status: number; body: Record<string, unknown> };
  };
  const actions: [string, () => Promise<unknown>][] = [
    ['Health', () => run('/api/health')],
    ['Temporal trace', () => run(`/api/incidents/${s}?mode=temporal&${q}`)],
    ['Naive trace', () => run(`/api/incidents/${s}?mode=naive&${q}`)],
    ['Timeline', () => run(`/api/incidents/${s}/timeline?${q}`)],
    ['Reach', () => run(`/api/incidents/${s}/reach?${q}`)],
    [
      'Plan',
      async () => {
        const { body } = await run(`/api/incidents/${s}/plans?${q}`, { method: 'POST' });
        if (typeof body.id === 'string') setPlanId(body.id);
      },
    ],
    [
      'Apply plan',
      () =>
        run(`/api/plans/${encodeURIComponent(planId)}/apply?${q}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        }),
    ],
    ['Memory', () => run(`/api/memory?${q}`)],
  ];

  return (
    <main
      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, padding: 16, display: 'grid', gap: 12 }}
    >
      <h1 style={{ fontSize: 16, margin: 0 }}>Quarantine debug</h1>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          tenant <input value={tenant} onChange={(e) => setTenant(e.target.value)} size={8} />
        </label>
        <label>
          seed <input value={seed} onChange={(e) => setSeed(e.target.value)} size={20} />
        </label>
        <label>
          plan <input value={planId} onChange={(e) => setPlanId(e.target.value)} size={24} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {actions.map(([label, fn]) => (
          <button key={label} type="button" onClick={() => void fn()}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 12 }}>
        <pre
          aria-live="polite"
          style={{ margin: 0, padding: 8, background: '#f4f4f4', overflow: 'auto', maxHeight: '75vh' }}
        >
          {output === null ? 'Pick an action.' : JSON.stringify(output, null, 2)}
        </pre>
        <section aria-label="Cypher log" style={{ overflow: 'auto', maxHeight: '75vh' }}>
          {log.map((e) => (
            <details key={e.seq} style={{ borderBottom: '1px solid #ddd', padding: '4px 0' }}>
              <summary style={{ color: e.error ? '#b00020' : undefined }}>
                #{e.seq} {e.mode === 'write' ? 'W' : 'R'} {e.name} {e.ms}ms {e.rows} rows
              </summary>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{e.error ?? e.cypher}</pre>
            </details>
          ))}
        </section>
      </div>
    </main>
  );
}
