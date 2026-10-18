'use client';

import { useCallback, useMemo, useState } from 'react';
import { hops } from '@/lib/console/derive';
import { useConsole, type ConsoleData } from '@/lib/console/use-console';
import { CaseHeader } from './CaseHeader';
import { Contain } from './Contain';
import { QueryLog } from './QueryLog';
import { Reach } from './Reach';
import { Spread } from './Spread';
import s from './console.module.css';

const STEPS = [
  { id: 'spread', label: 'Spread', hint: 'Who is infected', next: '' },
  { id: 'reach', label: 'Reach', hint: 'What they can still touch', next: 'See what they can reach' },
  { id: 'contain', label: 'Contain', hint: 'The cheapest cut', next: 'Plan the containment' },
] as const;
type Step = (typeof STEPS)[number]['id'];

export function Console({ seed }: { seed: string }) {
  const { state, round, roundOf, replay, apply, reset, retry } = useConsole(seed);
  const [step, setStep] = useState<Step>('spread');
  const [showQueries, setShowQueries] = useState(false);
  const closeQueries = useCallback(() => setShowQueries(false), []);

  return (
    <div className={s.page}>
      <header className={s.bar}>
        <span className={s.wordmark}>Quarantine</span>
        <span className={s.tenant}>acme</span>
        <span className={s.barSpacer} />
        <button
          type="button"
          className={s.quiet}
          onClick={() => void reset()}
          disabled={state.status === 'loading'}
        >
          Reset demo
        </button>
      </header>

      <main className={s.main}>
        {state.status === 'loading' && <Loading />}
        {state.status === 'error' && (
          <div className={s.notice} role="alert">
            <h1 className={s.noticeTitle}>
              {state.error.code === 'GRAPH_NOT_READY'
                ? 'The demo graph is still loading.'
                : state.error.code === 'ENGINE_UNAVAILABLE'
                  ? 'The graph database is not reachable.'
                  : 'The console could not load.'}
            </h1>
            <p>
              {state.error.code === 'ENGINE_UNAVAILABLE'
                ? 'Start FalkorDB (docker compose up -d) or check the deployment, then try again.'
                : state.error.message}
            </p>
            <button type="button" className={s.primary} onClick={() => void retry()}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <Ready
            data={state.data}
            step={step}
            onStep={setStep}
            round={round}
            roundOf={roundOf}
            onReplay={replay}
            onApply={apply}
          />
        )}
      </main>

      <footer className={s.footer}>
        <p>
          Every result above is computed by Cypher and <span className="mono">algo.maxFlow</span> on FalkorDB.
          The LLM only narrates.
        </p>
        <button
          type="button"
          className={s.link}
          onClick={() => setShowQueries((v) => !v)}
          aria-expanded={showQueries}
        >
          {showQueries ? 'Hide queries' : 'Show queries'}
        </button>
        <a className={s.link} href="/debug">
          Raw console
        </a>
      </footer>
      {showQueries && <QueryLog onClose={closeQueries} />}
    </div>
  );
}

function Ready({
  data,
  step,
  onStep,
  round,
  roundOf,
  onReplay,
  onApply,
}: {
  data: ConsoleData;
  step: Step;
  onStep: (s: Step) => void;
  round: number;
  roundOf: Map<string, number>;
  onReplay: () => void;
  onApply: (planId: string) => Promise<unknown>;
}) {
  const { incident, plan } = data;
  const depth = useMemo(() => hops(incident.trace), [incident.trace]);
  const index = STEPS.findIndex((x) => x.id === step);
  const next = STEPS[index + 1];

  return (
    <>
      <CaseHeader data={data} hops={depth} />

      <nav className={s.steps} aria-label="Investigation steps">
        <ol role="tablist">
          {STEPS.map((x, i) => (
            <li key={x.id}>
              <button
                type="button"
                role="tab"
                id={`tab-${x.id}`}
                aria-selected={step === x.id}
                aria-controls="stage"
                className={s.step}
                onClick={() => onStep(x.id)}
              >
                <span className={`${s.stepNo} mono`}>{i + 1}</span>
                <span className={s.stepLabel}>{x.label}</span>
                <span className={s.stepHint}>{x.hint}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section id="stage" role="tabpanel" aria-labelledby={`tab-${step}`} className={s.stage}>
        {step === 'spread' && <Spread data={data} round={round} roundOf={roundOf} onReplay={onReplay} />}
        {step === 'reach' && <Reach data={data} />}
        {step === 'contain' && <Contain data={data} onApply={() => onApply(plan.id)} />}
        {next && (
          <div className={s.stageFoot}>
            <button type="button" className={s.primary} onClick={() => onStep(next.id)}>
              {next.next}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

function Loading() {
  return (
    <div className={s.loading} aria-busy="true" aria-live="polite">
      <div className={s.skelTitle} />
      <div className={s.skelLine} />
      <div className={s.skelStage} />
      <span className="visually-hidden">Loading the incident</span>
    </div>
  );
}
