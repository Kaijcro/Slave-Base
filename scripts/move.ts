/**
 * Move someone in town by hand, to test the pipeline before any AI is involved.
 *
 *   npm run move -- hank started hall "Filing the lot list"
 *   npm run move -- hank finished hall "Lot list filed"
 *   npm run move -- june break plaza "Coffee"
 */
import { report } from '../workers/report';
import { PLACE_KEYS, isPlace } from '../src/world/places';
import { EVENT_KINDS, type EventKind } from '../src/data/types';
import { AGENTS } from '../src/world/agents';

const [agent, kind, place, ...rest] = process.argv.slice(2);

if (!agent || !kind || !place) {
  console.log('Usage: npm run move -- <agent> <kind> <place> "<text>"');
  console.log(`  agents: ${AGENTS.map((a) => a.id).join(', ')}`);
  console.log(`  kinds:  ${EVENT_KINDS.join(', ')}`);
  console.log(`  places: ${PLACE_KEYS.join(', ')}`);
  process.exit(1);
}
if (!AGENTS.some((a) => a.id === agent)) console.warn(`Note: "${agent}" isn't in src/world/agents.ts, so the town will ignore it.`);
if (!isPlace(place)) { console.error(`Unknown place "${place}". Use one of: ${PLACE_KEYS.join(', ')}`); process.exit(1); }

try {
  await report(agent, kind as EventKind, place, rest.join(' '));
} catch (e) {
  console.error('✖ ' + (e as Error).message);
  process.exit(1);
}
console.log(`Sent: ${agent} ${kind} at ${place}${rest.length ? ` (“${rest.join(' ')}”)` : ''}. Check the town.`);
