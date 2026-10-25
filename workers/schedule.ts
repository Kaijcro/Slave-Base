/**
 * Work the town runner starts by itself. Each item becomes a prompt in that agent's queue
 * (you'll see it in the Agent monitor), once on each listed day at the given hour, while the runner is on.
 * Days: 0 = Sunday ... 6 = Saturday. Times are your Mac's local time. Edit freely; delete an item to stop it.
 */
export interface Routine { id: string; agent: string; days: number[]; hour: number; prompt: string }

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
      'No brands, characters, celebrities or sports teams.',
  },
  {
    id: 'etsy-create',
    agent: 'priya',
    days: [1, 2, 3, 4, 5, 6], // Monday to Saturday
    hour: 11,
    prompt:
      'Create and publish today’s new products for our Etsy shop. Call shop_guide first, then read output/shop/research/latest.md. ' +
      'Pick the 3 best ideas we haven’t made yet (call shop_report to see what’s already published). For each: design it as original SVG with ' +
      'shop_make_design, look at the preview and fix anything that isn’t shop-quality, then publish with shop_publish_digital (find the category with ' +
      'shop_categories) or shop_publish_printify for tshirt and mug designs. Afterwards, list what you published with links.',
  },
];
