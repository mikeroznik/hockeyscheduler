import { fetchJSON } from './http.js';
import { cached } from './cache.js';
import { toEastern } from './time.js';
import { rememberTeam } from './teams.js';
import { etTodayISO } from './cache.js';

const FEED = 'https://lscluster.hockeytech.com/feed/index.php';

// Public keys used by each league's own StatView widgets.
export const LEAGUES = {
  AHL: { code: 'ahl', key: '50c2cd9b5e18e390' },
  ECHL: { code: 'echl', key: '2c2b89ea7345cae8' },
};

function url(league, view, extra = {}) {
  const cfg = LEAGUES[league];
  const params = new URLSearchParams({
    feed: 'modulekit',
    view,
    key: cfg.key,
    client_code: cfg.code,
    fmt: 'json',
    ...extra,
  });
  return `${FEED}?${params}`;
}

async function getSeasons(league) {
  return cached(`ht:${league}:seasons`, 24 * 60 * 60 * 1000, async () => {
    const data = await fetchJSON(url(league, 'seasons'));
    const rows = data?.SiteKit?.Seasons || [];
    return rows
      .filter((s) => s.start_date && s.end_date)
      .map((s) => ({
        id: String(s.season_id),
        name: s.season_name,
        start: s.start_date,
        end: s.end_date,
        playoff: s.playoff === '1',
      }));
  });
}

async function getTeamMap(league, seasonId) {
  return cached(`ht:${league}:teams:${seasonId}`, 24 * 60 * 60 * 1000, async () => {
    const data = await fetchJSON(url(league, 'teamsbyseason', { season_id: seasonId }));
    const rows = data?.SiteKit?.Teamsbyseason || [];
    const map = new Map();
    for (const t of rows) {
      const team = {
        id: `${league}:${t.code || t.id}`,
        league,
        name: t.name || `${t.city} ${t.nickname}`.trim(),
        abbrev: t.code || '',
      };
      map.set(String(t.id), team);
      rememberTeam(team);
    }
    return map;
  });
}

async function getSeasonSchedule(league, seasonId, isCurrent) {
  const ttl = isCurrent ? 30 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return cached(`ht:${league}:sched:${seasonId}`, ttl, async () => {
    const [data, teamMap] = await Promise.all([
      fetchJSON(url(league, 'schedule', { season_id: seasonId })),
      getTeamMap(league, seasonId),
    ]);
    const rows = data?.SiteKit?.Schedule || [];
    const games = [];
    for (const g of rows) {
      const iso = g.GameDateISO8601 || g.date_time_played;
      const t = toEastern(iso);
      if (!t.etDate) continue;
      const fallback = (id) => ({ id: `${league}:${id}`, league, name: `Team ${id}`, abbrev: '' });
      const home = teamMap.get(String(g.home_team)) || fallback(g.home_team);
      const away = teamMap.get(String(g.visiting_team)) || fallback(g.visiting_team);
      const isFinal = g.final === '1' || g.status === '4';
      const isLive = !isFinal && (g.started === '1' || g.in_game === '1');
      const hg = Number(g.home_goal_count);
      const ag = Number(g.visiting_goal_count);
      games.push({
        id: `${league.toLowerCase()}-${g.game_id || g.id}`,
        league,
        etDate: t.etDate,
        etTime: g.time_tbd === '1' || g.date_tbd === '1' ? 'TBD' : t.etTime,
        etWeekday: t.etWeekday,
        startISO: t.iso,
        status: isFinal ? 'final' : isLive ? 'live' : 'scheduled',
        kind: null,
        home,
        away,
        score: isFinal || isLive ? { home: hg, away: ag } : null,
        venue: g.venue_name || null,
      });
    }
    return games;
  });
}

export async function getHockeyTechGames(league, startISO, endISO) {
  const seasons = await getSeasons(league);
  const today = etTodayISO();
  const overlapping = seasons.filter((s) => s.start <= endISO && s.end >= startISO);
  const out = [];
  const seen = new Set();
  for (const s of overlapping) {
    const isCurrent = s.start <= today && s.end >= today;
    let games;
    try {
      games = await getSeasonSchedule(league, s.id, isCurrent);
    } catch (err) {
      console.error(`${league} season ${s.id} schedule failed:`, err.message);
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
