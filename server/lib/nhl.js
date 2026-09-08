import { fetchJSON } from './http.js';
import { cached } from './cache.js';
import { toEastern } from './time.js';
import { rememberTeam } from './teams.js';
import { attachNHLPromos } from './promonight.js';

const BASE = 'https://api-web.nhle.com/v1';

function mapState(s) {
  if (s === 'LIVE' || s === 'CRIT') return 'live';
  if (s === 'OFF' || s === 'FINAL') return 'final';
  return 'scheduled';
}

const GAME_TYPE = { 1: 'Preseason', 2: 'Regular', 3: 'Playoffs' };

function normalizeGame(g) {
  const t = toEastern(g.startTimeUTC);
  const team = (side) => {
    const name = [side.placeName?.default, side.commonName?.default].filter(Boolean).join(' ').trim();
    const obj = { id: `NHL:${side.abbrev}`, league: 'NHL', name: name || side.abbrev, abbrev: side.abbrev };
    rememberTeam(obj);
    return obj;
  };
  const home = team(g.homeTeam);
  const away = team(g.awayTeam);
  const status = mapState(g.gameState);
  const hasScore =
    typeof g.homeTeam.score === 'number' && typeof g.awayTeam.score === 'number' && status !== 'scheduled';
  return {
    id: `nhl-${g.id}`,
    league: 'NHL',
    etDate: t.etDate,
    etTime: g.startTimeUTC ? t.etTime : 'TBD',
    etWeekday: t.etWeekday,
    startISO: t.iso,
    status,
    kind: GAME_TYPE[g.gameType] || null,
    home,
    away,
    score: hasScore ? { home: g.homeTeam.score, away: g.awayTeam.score } : null,
    venue: g.venue?.default || null,
  };
}

async function fetchWeek(startISO) {
  return cached(`nhl:week:${startISO}`, 10 * 60 * 1000, async () => {
    const data = await fetchJSON(`${BASE}/schedule/${startISO}`);
    const games = [];
    for (const day of data.gameWeek || []) {
      for (const g of day.games || []) games.push(normalizeGame(g));
    }
    return { games, nextStartDate: data.nextStartDate };
  });
}

export async function getNHLGames(startISO, endISO) {
  const out = [];
  const seen = new Set();
  let cursor = startISO;
  let guard = 0;
  while (cursor && cursor <= endISO && guard++ < 32) {
    let week;
    try {
      week = await fetchWeek(cursor);
    } catch (err) {
      console.error('NHL week fetch failed:', cursor, err.message);
      break;
    }
    for (const g of week.games) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      if (g.etDate >= startISO && g.etDate <= endISO) out.push(g);
    }
    if (!week.nextStartDate || week.nextStartDate <= cursor) break;
    cursor = week.nextStartDate;
  }
  await attachNHLPromos(out);
  return out;
}

// A single team's entire published season (preseason + regular + any playoffs so
// far) in one request — used by the roadtrip planner so it can look past a fixed
// day horizon to the end of the season.
export async function getNHLTeamSeasonGames(abbrev) {
  return cached(`nhl:teamseason:${abbrev}`, 6 * 60 * 60 * 1000, async () => {
    const data = await fetchJSON(`${BASE}/club-schedule-season/${abbrev}/now`);
    return (data.games || []).map(normalizeGame);
  });
}
