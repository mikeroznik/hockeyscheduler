// Fallback NCAA D1 men's hockey schedule scraped from collegehockeynews.com.
// The official NCAA feed (ncaa.js) only exposes whatever season it currently
// recognizes as "current" and doesn't update to the new season until well after
// it starts; CHN publishes next season's full schedule (and TV info) months
// ahead. Used in ncaa.js only to fill dates the official feed has nothing for.
import { cached } from './cache.js';
import { rememberTeam, allTeams } from './teams.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Standard-time hours behind UTC; DST (US rule) subtracts 1.
// CHN's "AT" is Alaska Time (Alaska/Alaska-Anchorage home games), not Atlantic.
const TZ_OFFSET = { ET: 5, CT: 6, MT: 7, PT: 8, AT: 9 };

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

function nthSundayUTC(y, month, n) {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const dt = new Date(Date.UTC(y, month - 1, day));
    if (dt.getUTCMonth() !== month - 1) break;
    if (dt.getUTCDay() === 0 && ++count === n) return dt.getTime();
  }
  return null;
}

function isUSDaylightSaving(y, m, d) {
  const start = nthSundayUTC(y, 3, 2); // 2nd Sunday in March
  const end = nthSundayUTC(y, 11, 1); // 1st Sunday in November
  const t = Date.UTC(y, m - 1, d);
  return t >= start && t < end;
}

function localToUTCms(y, m, d, hh, mm, tzAbbrev) {
  const base = TZ_OFFSET[tzAbbrev];
  if (base == null) return null;
  const dst = isUSDaylightSaving(y, m, d) ? 1 : 0;
  return Date.UTC(y, m - 1, d, hh + (base - dst), mm);
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// NCAA season flips in August, same rule the official feed uses.
function seasonLabelFor(iso) {
  const [y, m] = iso.split('-').map(Number);
  const startYear = m < 8 ? y - 1 : y;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const PLAIN_GROUPS = new Set([
  'Non-Conference', 'Non-Conference v. D3', 'Big Ten', 'CCHA', 'ECAC', 'Hockey East', 'NCHC', 'Atlantic Hockey',
]);

function parseGroup(group) {
  if (!group) return { kind: null, venue: null };
  const m = group.match(/^(.*?)\s*\(at\s+(.+)\)\s*$/i);
  if (m) return { kind: m[1].trim(), venue: m[2].trim() };
  return { kind: PLAIN_GROUPS.has(group) ? null : group, venue: null };
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normName(name) {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .split(/\s+/)
    .map((w) => (w === 'state' || w === 'saint' ? 'st' : w))
    .join('');
}

// Reuse an already-known NCAA team id (from the official feed, or seen earlier in
// this scrape) when the name clearly matches, so the same school doesn't end up
// listed twice in the picker once both sources have contributed teams.
const resolvedByName = new Map();
function resolveTeamId(rawName, chnId) {
  const compact = normName(rawName);
  if (resolvedByName.has(compact)) return resolvedByName.get(compact);
  // Exact match only (after normalizing "St." <-> "State") — no prefix/substring
  // matching. Schools like Michigan/Michigan State or Minnesota/Minnesota State
  // are distinct programs whose normalized names are prefixes of each other, so
  // any fuzzier match would silently merge two different teams' games.
  for (const t of allTeams()) {
    if (t.league !== 'NCAA') continue;
    if (normName(t.name) === compact) {
      resolvedByName.set(compact, t.id);
      return t.id;
    }
  }
  const id = chnId ? `NCAA:chn-${chnId}` : `NCAA:chn-x-${compact}`;
  resolvedByName.set(compact, id);
  return id;
}

function mkTeam(cellHtml) {
  const link = cellHtml.match(/\/reports\/team\/[^/"]+\/(\d+)"[^>]*>([^<]*)</);
  const name = decodeEntities(cellHtml);
  if (!name) return null;
  const chnId = link ? link[1] : null;
  const id = resolveTeamId(name, chnId);
  const team = { id, league: 'NCAA', name, abbrev: '' };
  rememberTeam(team);
  return allTeams().find((t) => t.id === id) || team;
}

function parseCells(rowHtml) {
  const cells = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(rowHtml))) cells.push(m[1]);
  return cells;
}

async function scrapeSeason(season) {
  const html = await fetchText(`https://www.collegehockeynews.com/schedules/season/${season}`);
  const games = [];
  let curDate = null; // { y, m, d }
  let curGroup = null;

  const rowRe = /<tr([^>]*)>([\s\S]*?)<\/tr>/g;
  let row;
  while ((row = rowRe.exec(html))) {
    const attrs = row[1];
    const body = row[2];

    if (/class="stats-section"/.test(attrs)) {
      const text = decodeEntities(body);
      const dm = text.match(/(\w+),\s*(\w+)\s+(\d{1,2}),\s*(\d{4})/);
      if (dm) {
        const mo = MONTHS[dm[2].toLowerCase()];
        if (mo) curDate = { y: Number(dm[4]), m: mo, d: Number(dm[3]) };
      }
      curGroup = null;
      continue;
    }
    if (/class="sked-header"/.test(attrs)) {
      curGroup = decodeEntities(body) || null;
      continue;
    }
    if (/class="empty"/.test(attrs) || !curDate) continue;

    const cells = parseCells(body);
    if (cells.length < 7) continue;

    // Skip unresolved tournament bracket slots ("TBDec1 @ TBDec4" etc.) — real
    // matchups replace these once the seeding is set.
    if (/^TBD/i.test(decodeEntities(cells[0])) || /^TBD/i.test(decodeEntities(cells[3]))) continue;

    const away = mkTeam(cells[0]);
    const home = mkTeam(cells[3]);
    if (!away || !home) continue;

    const sep = decodeEntities(cells[2]);
    const awayScoreTxt = decodeEntities(cells[1]);
    const homeScoreTxt = decodeEntities(cells[4]);
    const hasScore = awayScoreTxt !== '' && homeScoreTxt !== '' && /^\d+$/.test(awayScoreTxt) && /^\d+$/.test(homeScoreTxt);

    const timeTxt = decodeEntities(cells[6]);
    const tm = timeTxt.match(/(\d{1,2}):(\d{2})\s*([A-Z]{2})/);

    const iso = `${curDate.y}-${String(curDate.m).padStart(2, '0')}-${String(curDate.d).padStart(2, '0')}`;
    let etDate = iso;
    let etTime = 'TBD';
    let startISO = null;
    let etWeekday = null;

    if (tm) {
      // CHN times carry no am/pm marker. College hockey start times are 12:00-8:00
      // afternoon/evening the overwhelming majority of the time (7:00 and 6:00 are
      // by far the most common slots); 9:00-11:59 only ever shows up for the rare
      // early exhibition tilt, so treat those as AM.
      let hh = Number(tm[1]) % 12;
      if (hh <= 8) hh += 12;
      const utcMs = localToUTCms(curDate.y, curDate.m, curDate.d, hh, Number(tm[2]), tm[3]);
      if (utcMs != null) {
        const dt = new Date(utcMs);
        startISO = dt.toISOString();
        etDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(dt);
        etTime = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
        }).format(dt);
        etWeekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(dt);
      }
    }

    const { kind, venue } = parseGroup(curGroup);
    const gameKey = `${iso}-${away.id}-${home.id}`;

    games.push({
      id: `ncaa-chn-${gameKey}`,
      league: 'NCAA',
      etDate,
      etTime,
      etWeekday,
      startISO,
      status: hasScore ? 'final' : 'scheduled',
      kind,
      home,
      away,
      score: hasScore ? { home: Number(homeScoreTxt), away: Number(awayScoreTxt) } : null,
      venue,
      neutral: sep.toLowerCase().startsWith('vs'),
    });
  }

  return games;
}

export async function getCHNGames(startISO, endISO) {
  const seasons = [...new Set([seasonLabelFor(startISO), seasonLabelFor(endISO)])];
  const out = [];
  const seen = new Set();
  for (const season of seasons) {
    let games;
    try {
      games = await cached(`chn:season:${season}`, 6 * 60 * 60 * 1000, () => scrapeSeason(season));
    } catch (err) {
      console.error(`CHN season ${season} scrape failed:`, err.message);
      continue;
    }
    for (const g of games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      if (g.etDate >= startISO && g.etDate <= endISO) out.push(g);
    }
  }
  return out;
}
