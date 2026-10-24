import { ri } from '../art/pixel';

/** Example work used only in demo mode. Real agents report their own tasks. */
export interface DemoTask { t: string; o: () => string }

/** What each person does at their home building. */
export const AGENT_TASKS: Record<string, DemoTask[]> = {
  governor: [
    { t: 'Setting this week’s priorities', o: () => 'Priorities posted: outreach, Goose Pop promo, one new AI idea' },
    { t: 'Signing off on a deal', o: () => `Approved: ${ri(12, 36)}-unit acquisition moves to due diligence` },
    { t: 'Reviewing the daily brief', o: () => `${ri(3, 8)} items approved, ${ri(1, 3)} sent back` },
  ],
  dex: [
    { t: 'Pulling new lis pendens, Palm Beach County', o: () => `${ri(9, 27)} new foreclosure filings found` },
    { t: 'Writing outreach letter, version 3', o: () => 'Letter draft sent for review' },
    { t: 'Prepping the mailer batch', o: () => `${ri(120, 340)} mailers addressed` },
  ],
  hank: [
    { t: 'Scanning vacant lots in Lehigh Acres', o: () => `${ri(6, 19)} lots match the builder’s criteria` },
    { t: 'Checking zoning and flood zones', o: () => `${ri(2, 7)} lots flagged for flood zone AE` },
    { t: 'Packaging lots for the builder', o: () => `Lot sheet sent with ${ri(4, 9)} lots` },
  ],
  theo: [
    { t: 'Underwriting a 24-unit in Port St. Lucie', o: () => `Cap rate ${(5.6 + Math.random() * 1.4).toFixed(1)}%, DSCR ${(1.15 + Math.random() * 0.3).toFixed(2)}` },
    { t: 'Pulling rent comps', o: () => `${ri(11, 24)} comps, average $${ri(1550, 1890)} a month` },
    { t: 'Updating the deal pipeline', o: () => `${ri(5, 12)} deals in the pipeline` },
  ],
  june: [
    { t: 'Writing Instagram captions', o: () => `${ri(5, 9)} captions queued` },
    { t: 'Costing a new dirty soda flavor', o: () => `Coconut-lime costs $${(0.9 + Math.random() * 0.8).toFixed(2)} a cup` },
    { t: 'Planning the weekend promo', o: () => 'Promo plan: two-for-one Saturday' },
  ],
  marisol: [
    { t: 'Reviewing yesterday’s sales by drink', o: () => `Top seller: Goose Juice, ${ri(40, 90)} cups` },
    { t: 'Counting syrup and cup inventory', o: () => `Reorder list: ${ri(2, 5)} syrups, ${ri(1, 3)} sleeves of cups` },
    { t: 'Checking margins by drink', o: () => `Best margin: vanilla cream at ${ri(68, 79)}%` },
  ],
  priya: [
    { t: 'Drafting a launch plan for an AI receipt sorter', o: () => `Launch plan ready: ${ri(5, 8)} steps` },
    { t: 'Setting up a landing page test', o: () => `Landing page live with ${ri(2, 4)} ad versions` },
    { t: 'Reviewing this week’s AI revenue', o: () => `AI revenue this week: $${ri(120, 980)}` },
  ],
  kofi: [
    { t: 'Scanning forums for unmet AI tool demand', o: () => `${ri(3, 8)} business ideas shortlisted` },
    { t: 'Sizing the market for an AI menu writer', o: () => `About ${ri(2, 9)},000 likely buyers in Florida` },
    { t: 'Testing prices for an AI listing writer', o: () => `Best price point: $${ri(9, 29)} a month` },
  ],
  ines: [
    { t: 'Reviewing agent outputs', o: () => `${ri(4, 11)} outputs approved` },
    { t: 'Compiling the daily brief', o: () => 'Daily brief updated' },
  ],
};

/** Used when someone helps out at a building that isn't their home. */
export const PLACE_TASKS: Record<'refuge' | 'goose' | 'ai' | 'hall', DemoTask[]> = {
  refuge: AGENT_TASKS.dex,
  goose: AGENT_TASKS.marisol,
  ai: AGENT_TASKS.kofi,
  hall: AGENT_TASKS.ines,
};

export const CHAT = ['Coffee break', 'Seen the new comps?', 'Mailers go out Tuesday', 'Builder wants more lots', 'Goose Pop run?', 'Back in five', 'Who parked the Mustang?', 'New AI idea!'];
