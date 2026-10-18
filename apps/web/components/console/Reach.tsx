import type { ConsoleData } from '@/lib/console/use-console';
import { BlastGraph } from './BlastGraph';
import s from './console.module.css';

export function Reach({ data }: { data: ConsoleData }) {
  const { reach, plan } = data;
  const resources = new Set(plan.reach.map((p) => p.resource)).size;
  const live = reach.paths.length;

  return (
    <div className={s.view}>
      <p className={s.lede}>
        {live === 0 ? (
          <>Nothing left: every path from an infected agent to a sensitive resource is cut.</>
        ) : (
          <>
            The {reach.agents.length} infected agents can still reach{' '}
            <strong>{resources} sensitive resources</strong> through {live} live paths of tool, credential and
            resource. Hover a node to follow its paths.
          </>
        )}
      </p>
      <BlastGraph data={data} showCut={false} />
    </div>
  );
}
