import { fetchJSON, mapLimit } from './http.js';
import { cached, ttlForDate } from './cache.js';
import { toEastern } from './time.js';
import { rememberTeam } from './teams.js';

// NCAA Division I men's ice hockey, via the public sdataprod GraphQL persisted queries
// that power ncaa.com's own scoreboard.
const GQL = 'https://sdataprod.ncaa.com/';
const SPORT = 'MIH';
const DIVISION = 1;
const HASH_SCHEDULE = 'a25ad021179ce1d97fb951a49954dc98da150089f9766e7e85890e439516ffbf';
const HASH_SCOREBOARD = '7287cda610a9326931931080cb3a604828febe6fe3c9016a7e4a36db99efdb7c';

function gqlURL(hash, variables, queryName) {
  const p = new URLSearchParams();
  p.set('extensions', JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }));
  if (queryName) p.set('queryName', queryName);
  p.set('variables', JSON.stringify(variables));
  return `${GQL}?${p}`;
}

// NCAA season year flips in August (Jan-Jul belong to the previous year's season).
function seasonYear(iso) {
  const [y, m] = iso.split('-').map(Number);
  return m < 8 ? y - 1 : y;
}

// -> Set of "YYYY-MM-DD" that actually have games, for the given season year.
async function gameDatesForSeason(year) {
  return cached(`ncaa:dates:${year}`, 60 * 60 * 1000, async () => {
    const data = await fetchJSON(
      gqlURL(HASH_SCHEDULE, { sportCode: SPORT, division: DIVISION, seasonYear: year }, 'NCAA_schedules_today_web')
    );
    const set = new Set();
    for (const row of data?.data?.schedules?.games || []) {
      const [mm, dd, yyyy] = String(row.contestDate).split('/');
      if (yyyy) set.add(`${yyyy}-${mm}-${dd}`);
    }
    return set;
  });
}

function mapState(s) {
  if (s === 'F') return 'final';
  if (s === 'I') return 'live';
  return 'scheduled';
}

async function scoreboardForDate(iso) {
  return cached(`ncaa:sb:${iso}`, ttlForDate(iso), async () => {
    const [y, m, d] = iso.split('-');
    const data = await fetchJSON(
      gqlURL(HASH_SCOREBOARD, {
        sportCode: SPORT,
        division: DIVISION,
        seasonYear: seasonYear(iso),
        contestDate: `${y}/${m}/${d}`,
      })
    );
    const games = [];
    for (const c of data?.data?.contests || []) {
      const teams = c.teams || [];
      const h = teams.find((t) => t.isHome);
      const a = teams.find((t) => !t.isHome);
      if (!h || !a) continue;
      const mk = (t) => {
        const obj = {
          id: `NCAA:${t.seoname || t.name6Char || t.nameShort}`,
          league: 'NCAA',
          name: t.nameShort || t.seoname || 'Unknown',
          abbrev: t.name6Char || '',
        };
        rememberTeam(obj);
        return obj;
      };
      const status = mapState(c.gameState);
      const hasEpoch = c.hasStartTime && c.startTimeEpoch && !c.tba;
      const t = hasEpoch ? toEastern(Number(c.startTimeEpoch) * 1000) : { etDate: iso, etTime: null, iso: null };
      const hs = Number(h.score);
      const as = Number(a.score);
      games.push({
        id: `ncaa-${c.contestId}`,
        league: 'NCAA',
        etDate: t.etDate || iso,
        etTime: hasEpoch ? t.etTime : 'TBD',
        etWeekday: hasEpoch ? t.etWeekday : null,
        startISO: t.iso,
        status,
        kind: c.isChampionship ? 'Tournament' : null,
        home: mk(h),
        away: mk(a),
        score:
          (status === 'final' || status === 'live') && Number.isFinite(hs) && Number.isFinite(as)
            ? { home: hs, away: as }
            : null,
        venue: null,
      });
    }
    return games;
  });
}

export async function getNCAAGames(startISO, endISO) {
  const years = new Set([seasonYear(startISO), seasonYear(endISO)]);
  const dateSets = await Promise.all(
    [...years].map((y) => gameDatesForSeason(y).catch(() => new Set()))
  );
  const wanted = new Set();
  for (const set of dateSets) {
    for (const iso of set) if (iso >= startISO && iso <= endISO) wanted.add(iso);
  }
  const perDate = await mapLimit([...wanted], 4, (iso) =>
    scoreboardForDate(iso).catch((err) => {
      console.error('NCAA scoreboard failed:', iso, err.message);
      return [];
    })
  );
  const out = [];
  for (const list of perDate) {
    for (const g of list) if (g.etDate >= startISO && g.etDate <= endISO) out.push(g);
  }
  return out;
}
