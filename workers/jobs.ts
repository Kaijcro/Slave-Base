import type { PlaceKey } from '../src/world/places';

/**
 * The jobs your agents know how to do. Each job belongs to one townsperson and one building.
 * Edit the prompts freely; add a new entry to give someone a new job.
 *
 * Results are saved in the output/ folder.
 */
export interface Job {
  agent: string;
  place: PlaceKey;
  title: string;
  prompt: string;
  tools: string[];
}

const FINISH = `\n\nWhen you are done, end your reply with one line that starts with "SUMMARY:" and states the result in under 12 words.`;

export const JOBS: Record<string, Job> = {
  lots: {
    agent: 'hank',
    place: 'refuge',
    title: 'Scanning vacant lots in Lehigh Acres',
    tools: ['WebSearch', 'WebFetch', 'Write'],
    prompt:
      'Find up to 8 vacant residential lots currently listed for sale in Lehigh Acres, Florida, priced under $40,000. ' +
      'For each lot give the address or parcel ID, price, lot size, and the listing link. ' +
      'Save them as a markdown table in output/lots.md, with today’s date at the top.' + FINISH,
  },
  foreclosures: {
    agent: 'dex',
    place: 'refuge',
    title: 'Researching Palm Beach County foreclosure filings',
    tools: ['WebSearch', 'WebFetch', 'Write'],
    prompt:
      'Research where recent foreclosure filings (lis pendens) for Palm Beach County, Florida are published publicly, and summarize any recent counts or trends you can find. ' +
      'List the official sources and how to search them. Save to output/foreclosure-sources.md.' + FINISH,
  },
  rents: {
    agent: 'theo',
    place: 'refuge',
    title: 'Pulling rent comps for Port St. Lucie',
    tools: ['WebSearch', 'WebFetch', 'Write'],
    prompt:
      'Find current average asking rents for 1-bedroom and 2-bedroom apartments in Port St. Lucie, Florida from at least 3 different sources. ' +
      'Show each source, its number and date, then a blended average. Save to output/rent-comps.md.' + FINISH,
  },
  captions: {
    agent: 'june',
    place: 'goose',
    title: 'Writing Instagram captions',
    tools: ['Write'],
    prompt:
      'Write 7 short, playful Instagram captions for Goose Pop Shop, a dirty soda shop with a goose mascot. ' +
      'One caption per day of the week, each with a call to action and 2-3 hashtags. Save to output/captions.md.' + FINISH,
  },
  ideas: {
    agent: 'kofi',
    place: 'ai',
    title: 'Researching new AI business ideas',
    tools: ['WebSearch', 'WebFetch', 'Write'],
    prompt:
      'Research 5 ideas for small, income-generating businesses that run mostly on AI (tools, content services or automations) and could start for under $500. ' +
      'For each: what it sells, who pays for it, how to find the first 10 customers, startup cost, and a realistic monthly revenue range, citing sources where you can. ' +
      'Rank them by how fast they could make their first dollar. Save to output/ai-ideas.md.' + FINISH,
  },
};
