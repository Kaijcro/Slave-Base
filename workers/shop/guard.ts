/**
 * Guardrails for the shop. Etsy removes listings (and can close shops) for using brands,
 * characters, celebrities or sports teams without a license, so the agents can't publish anything
 * that mentions them. Add words here if you spot something that slips through.
 */
const BLOCKED = [
  'disney', 'mickey', 'minnie', 'pixar', 'marvel', 'avengers', 'spider-man', 'spiderman', 'star wars', 'mandalorian', 'baby yoda', 'grogu',
  'harry potter', 'hogwarts', 'pokemon', 'pokémon', 'pikachu', 'nintendo', 'super mario', 'zelda', 'hello kitty', 'sanrio', 'kuromi', 'barbie',
  'taylor swift', 'swiftie', 'eras tour', 'beyonce', 'beyoncé', 'nfl', 'nba', 'mlb', 'nhl', 'ncaa', 'super bowl', 'olympic',
  'coca-cola', 'coca cola', 'starbucks', 'nike', 'adidas', 'louis vuitton', 'chanel', 'gucci', 'stanley cup', 'stanley tumbler',
  'grinch', 'dr seuss', 'dr. seuss', 'snoopy', 'peanuts gang', 'bluey', 'minecraft', 'fortnite', 'roblox', 'stranger things', 'yellowstone',
  'grateful dead', 'harley davidson', 'john deere', 'jeep', 'labubu', 'sesame street', 'care bears', 'looney tunes', 'scooby', 'spongebob',
  'paw patrol', 'cocomelon', 'ms rachel', 'lilo and stitch', 'disney frozen', 'queen elsa', 'encanto', 'moana', 'jurassic park', 'lord of the rings',
  'game of thrones', 'friends tv', 'dunder mifflin', 'peaky blinders', 'sailor moon', 'naruto', 'one piece', 'dragon ball', 'studio ghibli', 'totoro',
  'winnie the pooh', 'peppa pig', 'my little pony', 'transformers', 'lego', 'hot wheels', 'crocs', 'yeti cup', 'trader joe', 'walmart',
];

export function brandProblems(...texts: string[]): string[] {
  const all = texts.join(' \n ').toLowerCase();
  return BLOCKED.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(all));
}

/** Etsy's limits: title up to 140 characters, up to 13 tags of 20 characters each. */
export function cleanListing(title: string, tags: string[]) {
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 140);
  const seen = new Set<string>();
  const g = tags
    .map((x) => x.toLowerCase().replace(/[^a-z0-9 &'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20).trim())
    .filter((x) => x && !seen.has(x) && seen.add(x))
    .slice(0, 13);
  return { title: t, tags: g };
}
