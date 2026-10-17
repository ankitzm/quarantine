import { buildEval } from '@quarantine/graph';
import results from '../../../../../eval/results/latest.json';

export function GET() {
  return Response.json(buildEval(results));
}
