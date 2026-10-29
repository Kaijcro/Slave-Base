/**
 * Work the town runner starts by itself. Each item becomes a prompt in that agent's queue
 * (you'll see it in the Agent monitor), once on each listed day at the given hour, while the runner is on.
 * Days: 0 = Sunday ... 6 = Saturday, or monthDays (1–31) for monthly work. Times are your Mac's local time.
 * `needs` skips the routine until those .env keys are set. Edit freely; delete an item to stop it.
 */
export interface Routine { id: string; agent: string; days?: number[]; monthDays?: number[]; hour: number; needs?: string[]; prompt: string }

export const SCHEDULE: Routine[] = [
  {
    id: 'etsy-research',
    agent: 'kofi',
    days: [1, 4], // Monday and Thursday
    hour: 9,
    prompt:
      'Research what is selling on Etsy right now for our shop. Call shop_guide first. ' +
      'Until Thanksgiving (Thu Nov 26, 2026) research ONLY Thanksgiving and Friendsgiving products: invitations and flyers, party games, menus, ' +
      'place cards, table decor, signs and printables for hosts. No Christmas. After Thanksgiving, research broadly again. ' +
      'Use shop_find_hot_shops with 8–12 varied phrases to find shops opened in the last 18 months with at least 1,000 sales, then shop_top_listings for the 8 most promising. ' +
      'Write output/shop/research/latest.md (and a dated copy) with: the shops (name, sales, months open, sales per month, link); the styles that sell ' +
      '(illustration style, palettes, fonts, wording, formats, price ranges); and a ranked list of 10 ORIGINAL product ideas, each with the product type, ' +
      'a one-line concept, an art direction for the AI illustration, the buyer, suggested price and 13 tag ideas. Check shop_report so ideas don’t repeat what we have. ' +
      'No brands, characters, celebrities or sports teams. Finally, hand_off the top 4 ideas to priya, attaching output/shop/research/latest.md.',
  },
  {
    id: 'etsy-create',
    agent: 'priya',
    days: [2, 3, 5, 6], // Tuesday, Wednesday, Friday, Saturday (on Monday and Thursday, Kofi hands her ideas right after his research)
    hour: 11,
    prompt:
      'Create and publish today’s new products for our Etsy shop. Goal: 40 live listings by Thu Nov 12, 2026, so make 4 today. Call shop_guide first, then read output/shop/research/latest.md. ' +
      'Until Thanksgiving (Nov 26) make ONLY Thanksgiving and Friendsgiving designs (invitations, flyers, games, menus, place cards, decor); no Christmas. ' +
      'Pick the best ideas we haven’t made (check shop_report). For each: generate the illustration with shop_make_artwork (no words in it), Read it, ' +
      'build the SVG with the artwork as an image layer and all words as editable <text>, then shop_make_design with 2–3 backgrounds from shop_backgrounds ' +
      '(make a fitting one with shop_make_background if none suits). Optionally add one shop_ai_mockup and check every word. Read the preview and listing photos and fix anything ' +
      'that isn’t shop-quality. Publish with shop_publish_digital (find the category with shop_categories). Also give any held designs from earlier real-photo listing photos ' +
      'with shop_remake_photos and publish them. Afterwards, list what you published with links, and how many images you generated.',
  },
  {
    id: 'outreach-replies',
    agent: 'dex',
    days: [1, 2, 3, 4, 5], // weekdays
    hour: 10,
    needs: ['INSTANTLY_API_KEY'],
    prompt:
      'Check cold email replies for the receptionist business. Call sales_guide first, then outreach_replies. For each reply: update the prospect’s ' +
      'status (interested, replied, or do_not_contact for anyone who asks to stop), and draft a short, honest reply for the owner to send. ' +
      'For interested prospects without a demo, build one with the voice tools if you have them. List the drafts in your result. Do not send anything.',
  },
  {
    id: 'client-reports',
    agent: 'priya',
    monthDays: [1],
    hour: 8,
    needs: ['RETELL_API_KEY'],
    prompt:
      'Make last month’s call report for every active client. Call sales_guide first, then clients_list with status active, then client_report for each. ' +
      'In your result, list each client with calls, answered rate, jobs booked, estimated revenue and the PDF path, and point out anything unusual ' +
      '(very few calls, many spam calls, low booking). Do not send the reports; the owner does.',
  },
];
