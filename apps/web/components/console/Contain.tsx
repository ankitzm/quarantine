'use client';

import { useEffect, useRef, useState } from 'react';
import { clock, credentialLabel } from '@/lib/console/derive';
import type { ConsoleData } from '@/lib/console/use-console';
import { BlastGraph } from './BlastGraph';
import s from './console.module.css';

export function Contain({ data, onApply }: { data: ConsoleData; onApply: () => Promise<unknown> }) {
  const { plan } = data;
  const applied = plan.appliedAt !== null;
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paths = useCountdown(applied ? data.reach.paths.length : plan.reach.length);
  const cut = [...plan.cut].sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label));
  const memoryCount = plan.items.length + 1;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply();
      dialog.current?.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Applying failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.view}>
      <p className={s.lede} aria-live="polite">
        {applied ? (
          <>
            Applied at <span className="mono">{clock(plan.appliedAt ?? 0)}</span>. Live paths to sensitive
            resources: <strong className="mono">{paths}</strong>.
          </>
        ) : (
          <>
            Cutting <strong>{cut.length} permissions</strong> stops all {plan.reach.length} paths. The cut
            costs <strong className="mono">{plan.totalCost}</strong>, equal to the max flow, so no cheaper cut
            exists.
          </>
        )}
      </p>

      <div className={s.containGrid}>
        <BlastGraph data={data} showCut />
        <div className={s.planCol}>
          <h2 className={s.h2}>Revocations</h2>
          <ol className={s.planList}>
            {cut.map((c) => (
              <li key={`${c.from}>${c.to}`} className={s.planRow}>
                <span className={s.planLabel}>
                  {applied && (
                    <span className={s.done} aria-label="done">
                      ✓{' '}
                    </span>
                  )}
                  {c.credential
                    ? `Rotate ${credentialLabel(c.credential)}`
                    : c.label.replace(/^Revoke /, 'Remove ')}
                </span>
                <span className={`${s.planCost} mono`}>{c.cost}</span>
                {c.source && <span className={s.planSource}>{sourceFile(c.source)}</span>}
              </li>
            ))}
          </ol>
          <p className={s.planTotal}>
            <span>Total cost</span>
            <span className="mono">{plan.totalCost}</span>
          </p>
          {!applied && (
            <button type="button" className={s.primary} onClick={() => dialog.current?.showModal()}>
              Review and apply
            </button>
          )}
        </div>
      </div>

      <MemoryDiff data={data} />

      <dialog ref={dialog} className={s.dialog} aria-labelledby="apply-title" onClose={() => setError(null)}>
        <h2 id="apply-title" className={s.h2}>
          Apply this containment?
        </h2>
        <ul className={s.effects}>
          <li>
            Revoke or rotate {cut.length} permissions (cost {plan.totalCost}). Nothing is deleted; each edge
            keeps its history.
          </li>
          <li>
            Mark {memoryCount} poisoned memory version{memoryCount === 1 ? '' : 's'} invalid so agents stop
            reading them.
          </li>
          <li>Restore the version the poison replaced, as a new version.</li>
        </ul>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={s.dialogActions}>
          <button
            type="button"
            className={s.secondary}
            onClick={() => dialog.current?.close()}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="button" className={s.primary} onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Applying…' : 'Apply containment'}
          </button>
        </div>
      </dialog>
    </div>
  );
}

/** The clean version next to the poisoned one. The attacker's payload is the outbound URL, so mark it. */
function MemoryDiff({ data }: { data: ConsoleData }) {
  const { trace } = data.incident;
  const seed = trace.items.find((m) => m.id === trace.seed.item);
  const key = data.memory.keys.find((k) => seed && k.ns === seed.ns && k.key === seed.key);
  const poison = key?.versions.find((v) => v.id === trace.seed.item);
  const clean = key?.versions.find((v) => v.id === poison?.supersedes);
  if (!seed || !poison || !clean) return null;
  const restored = key?.versions.find((v) => v.supersedes === poison.id);

  return (
    <section className={s.diff} aria-labelledby="diff-title">
      <h2 id="diff-title" className={s.h2}>
        {seed.ns}/{seed.key}, before and after the poisoning
      </h2>
      <div className={s.versions}>
        <figure>
          <figcaption>
            Clean · <span className="mono">{clock(clean.validFrom)}</span>
            {restored && <span className={s.done}> · restored at {clock(restored.validFrom)}</span>}
          </figcaption>
          <blockquote>{clean.text}</blockquote>
        </figure>
        <figure>
          <figcaption>
            Poisoned · <span className="mono">{clock(poison.validFrom)}</span>
            {poison.isInvalidated && ' · marked invalid'}
          </figcaption>
          <blockquote className={poison.isInvalidated ? s.invalid : undefined}>
            {poison.text.split(URL_RE).map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
          </blockquote>
        </figure>
      </div>
    </section>
  );
}

const URL_RE = /(https?:\/\/[^\s)]+[^\s).,])/;

const sourceFile = (source: string) =>
  source.replace(/\s*\(.*\)$/, '').replace(/^fixtures\/configs\/[^/]+\//, '');

/** Animates a number to its new value when it changes (not on mount), unless motion is reduced. */
function useCountdown(to: number): number {
  const [value, setValue] = useState(to);
  const prev = useRef(to);
  useEffect(() => {
    const start = prev.current;
    prev.current = to;
    if (start === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setValue(to);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setValue(Math.round(start + (to - start) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return value;
}
