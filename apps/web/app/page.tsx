import { Console } from '@/components/console/Console';

/** The acme incident: a partner page poisons the refunds SOP. */
const SEED = 'acme-mem-sop-v4';

export default function Home() {
  return <Console seed={SEED} />;
}
