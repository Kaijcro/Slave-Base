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
      'Research what is selling on Etsy right now for our shop. Call shop_guide first. Then use shop_find_hot_shops with 8–12 varied phrases ' +
      'across printable wall art, printables (planners, checklists, signs), SVG cut files, digital stickers, and graphic T-shirts and mugs, to find ' +
      'shops opened in the last 18 months with at least 1,000 sales. For the 8 most promising shops, use shop_top_listings. ' +
      'Write a report to output/shop/research/latest.md (and a dated copy in the same folder) with: the shops you found (name, sales, months open, ' +
      'sales per month, link); the patterns that sell (niches, styles, palettes, wording themes, formats, price ranges); and a ranked list of 10 ' +
      'ORIGINAL product ideas for us, each with the product type, a one-line concept, the buyer it is for, suggested price, and 13 tag ideas. ' +
      'No brands, characters, celebrities or sports teams. ' +
      'Finally, use hand_off to give priya the top 3 ideas to design and publish today, attaching output/shop/research/latest.md.',
  },
  {
    id: 'etsy-create',
    agent: 'priya',
    days: [2, 3, 5, 6], // Tuesday, Wednesday, Friday, Saturday (on Monday and Thursday, Kofi hands her ideas right after his research)
    hour: 11,
    prompt:
      'Create and publish today’s new products for our Etsy shop. Call shop_guide first, then read output/shop/research/latest.md. ' +
      'Pick the 3 best ideas we haven’t made yet (call shop_report to see what’s already published). For each: design it as original SVG with ' +
      'shop_make_design, look at the preview and fix anything that isn’t shop-quality, then publish with shop_publish_digital (find the category with ' +
      'shop_categories) or shop_publish_printify for tshirt and mug designs. Afterwards, list what you published with links.',
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
