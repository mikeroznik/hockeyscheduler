import { cached } from './cache.js';
import { mapLimit } from './http.js';
import { addDaysISO } from './time.js';

// Promotional schedules (giveaways, theme nights, bobbleheads, …) scraped from
// getpromonight.com, which aggregates them from official team sources. The NHL has
// no promotions API, so this is the only route. Each team page is a Next.js app
// whose RSC payload embeds a "promos" array of upcoming events.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// NHL team abbreviation -> getpromonight.com/nhl/<slug>
const NHL_SLUGS = {
  ANA: 'anaheim-ducks', BOS: 'boston-bruins', BUF: 'buffalo-sabres', CGY: 'calgary-flames',
  CAR: 'carolina-hurricanes', CHI: 'chicago-blackhawks', COL: 'colorado-avalanche',
  CBJ: 'columbus-blue-jackets', DAL: 'dallas-stars', DET: 'detroit-red-wings',
  EDM: 'edmonton-oilers', FLA: 'florida-panthers', LAK: 'los-angeles-kings',
  MIN: 'minnesota-wild', MTL: 'montreal-canadiens', NSH: 'nashville-predators',
  NJD: 'new-jersey-devils', NYI: 'new-york-islanders', NYR: 'new-york-rangers',
  OTT: 'ottawa-senators', PHI: 'philadelphia-flyers', PIT: 'pittsburgh-penguins',
  SJS: 'san-jose-sharks', SEA: 'seattle-kraken', STL: 'st-louis-blues',
  TBL: 'tampa-bay-lightning', TOR: 'toronto-maple-leafs', UTA: 'utah-hockey-club',
  VAN: 'vancouver-canucks', VGK: 'vegas-golden-knights', WSH: 'washington-capitals',
  WPG: 'winnipeg-jets',
};

const TYPE_LABEL = {
  giveaway: 'Giveaway',
  theme: 'Theme Night',
  kids: 'Kids',
  food: 'Food Deal',
  ticket: 'Ticket Offer',
};

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// Rebuild the concatenated Next.js RSC payload and pull out the first balanced
// JSON array that follows `"promos":`.
function extractPromos(html) {
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  let full = '';
  while ((m = re.exec(html))) {
    try {
      full += JSON.parse('"' + m[1] + '"');
    } catch {
      /* skip malformed chunk */
    }
  }
  const at = full.indexOf('"promos":[');
  if (at < 0) return [];
  const start = full.indexOf('[', at);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < full.length; j++) {
    const c = full[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) {
      try {
        return JSON.parse(full.slice(start, j + 1));
      } catch {
        return [];
      }
    }
  }
  return [];
}

async function getTeamPromos(sport, slug) {
  return cached(`promonight:${sport}:${slug}`, 12 * 60 * 60 * 1000, async () => {
    const html = await fetchText(`https://www.getpromonight.com/${sport}/${slug}`);
    return extractPromos(html).filter((p) => p && p.date && p.title);
  });
}

function toPromo(p) {
  return {
    name: p.title,
    type: TYPE_LABEL[p.type] || (p.type ? p.type[0].toUpperCase() + p.type.slice(1) : null),
    description: p.description || null,
    presentedBy: p.presentedBy || null,
    whileSuppliesLast: p.whileSuppliesLast || null,
    icon: p.icon || null,
  };
}

// -> Map<homeAbbrev, Array<{date, opponent, promo}>>
async function getNHLPromoIndex() {
  return cached('promonight:nhl:index', 12 * 60 * 60 * 1000, async () => {
    const entries = Object.entries(NHL_SLUGS);
    const index = new Map();
    await mapLimit(entries, 5, async ([abbrev, slug]) => {
      let promos;
      try {
        promos = await getTeamPromos('nhl', slug);
      } catch (err) {
        console.error(`promonight ${slug} failed:`, err.message);
        return;
      }
      index.set(
        abbrev,
        promos.map((p) => ({ date: p.date, opponent: (p.opponent || '').toLowerCase(), promo: toPromo(p) }))
      );
    });
    return index;
  });
}

// Attach a `promos` array to each NHL home game. Mutates and returns `games`.
export async function attachNHLPromos(games) {
  const nhl = games.filter((g) => g.league === 'NHL');
  if (!nhl.length) return games;
  let index;
  try {
    index = await getNHLPromoIndex();
  } catch (err) {
    console.error('promonight index failed:', err.message);
    return games;
  }
  for (const g of nhl) {
    const list = index.get(g.home.abbrev);
    if (!list) continue;
    const awayNick = (g.away.name.split(' ').pop() || '').toLowerCase();
    const hits = list.filter((e) => {
      const dateOk = e.date === g.etDate || e.date === addDaysISO(g.etDate, -1) || e.date === addDaysISO(g.etDate, 1);
      if (!dateOk) return false;
      // When the promo names an opponent, use it to disambiguate same-day entries.
      return !e.opponent || e.opponent === awayNick;
    });
    if (hits.length) g.promos = hits.map((h) => h.promo);
  }
  return games;
}
