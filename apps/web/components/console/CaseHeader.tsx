import { clock, day } from '@/lib/console/derive';
import type { ConsoleData } from '@/lib/console/use-console';
import s from './console.module.css';

/** The case in one sentence. Numbers live in the sentence, not in stat cards. */
export function CaseHeader({ data, hops }: { data: ConsoleData; hops: number }) {
  const { trace } = data.incident;
  const seed = trace.items.find((m) => m.id === trace.seed.item);
  const key = seed ? `${seed.ns}/${seed.key}` : trace.seed.item;
  const agents = trace.agents.length;
  const contained = data.plan.appliedAt !== null;

  return (
    <div className={s.case}>
      {contained ? (
        <h1 className={s.sentence}>
          Contained at <span className="mono">{clock(data.plan.appliedAt ?? 0)}</span>. No infected agent can
          reach a sensitive resource, and <span className={s.key}>{key}</span> is restored.
        </h1>
      ) : (
        <h1 className={s.sentence}>
          {cap(trace.seed.agent)} wrote a poisoned <span className={s.key}>{key}</span> at{' '}
          <span className="mono">{clock(trace.seed.at)}</span>. It reached{' '}
          <em className={s.stain}>
            {agents} agent{agents === 1 ? '' : 's'}
          </em>{' '}
          in {hops} hop{hops === 1 ? '' : 's'}.
        </h1>
      )}
      <p className={s.caseMeta}>
        Tenant {data.incident.tenant} · seed <span className="mono">{trace.seed.item}</span> ·{' '}
        {day(trace.seed.at)}, times in UTC
      </p>
    </div>
  );
}

const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
