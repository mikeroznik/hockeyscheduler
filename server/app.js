import express from 'express';

import { getNHLGames } from './lib/nhl.js';
import { getHockeyTechGames } from './lib/hockeytech.js';
import { getNCAAGames } from './lib/ncaa.js';
import { getMLBGames, getMLBTeamMap } from './lib/mlb.js';
import { allTeams, rememberTeam, persistTeams } from './lib/teams.js';
import { fetchJSON } from './lib/http.js';
import { cached, etTodayISO } from './lib/cache.js';
import { addDaysISO } from './lib/time.js';
import { planRoadtrips } from './lib/roadtrip.js';

const LEAGUE_LOADERS = {
  NHL: (s, e) => getNHLGames(s, e),
  AHL: (s, e) => getHockeyTechGames('AHL', s, e),
  ECHL: (s, e) => getHockeyTechGames('ECHL', s, e),
  NCAA: (s, e) => getNCAAGames(s, e),
  MLB: (s, e) => getMLBGames(s, e),
};
const ALL_LEAGUES = Object.keys(LEAGUE_LOADERS);

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
function daysBetween(a, b) {
  return (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000;
}

// Seed the 32 current NHL teams so they appear before any month is browsed.
// Runs at most once per process; safe to call from every entrypoint.
let warmed = false;
export async function warmup() {
  if (warmed) return;
  warmed = true;
  // Seed the full current rosters for leagues that have a clean team endpoint, so
  // their checkboxes are populated before any month is browsed.
  await Promise.allSettled([
    (async () => {
      const data = await cached('nhl:standings', 12 * 60 * 60 * 1000, () =>
        fetchJSON('https://api-web.nhle.com/v1/standings/now')
      );
      for (const row of data?.standings || []) {
        const abbrev = row.teamAbbrev?.default;
        if (!abbrev) continue;
        rememberTeam({
          id: `NHL:${abbrev}`,
          league: 'NHL',
          name: row.teamName?.default || row.teamCommonName?.default || abbrev,
          abbrev,
        });
      }
    })(),
    getMLBTeamMap(),
  ]).then((results) => {
    for (const r of results) if (r.status === 'rejected') console.error('seed failed:', r.reason?.message);
    persistTeams();
  });
}

export function createApp() {
  const app = express();

  app.get('/api/games', async (req, res) => {
    warmup();
    const { start, end } = req.query;
    if (!ISO_RE.test(start || '') || !ISO_RE.test(end || '')) {
      return res.status(400).json({ error: 'start and end must be YYYY-MM-DD' });
    }
    const span = daysBetween(start, end);
    if (span < 0 || span > 70) {
      return res.status(400).json({ error: 'range must be between 0 and 70 days' });
    }
    const leagues = (
      req.query.leagues ? String(req.query.leagues).split(',') : ALL_LEAGUES
    ).filter((l) => ALL_LEAGUES.includes(l));

    const settled = await Promise.allSettled(leagues.map((l) => LEAGUE_LOADERS[l](start, end)));
    const games = [];
    const errors = {};
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') games.push(...r.value);
      else {
        errors[leagues[i]] = r.reason?.message || 'failed';
        console.error(`${leagues[i]} load failed:`, r.reason?.message);
      }
    });

    games.sort(
      (a, b) =>
        a.etDate.localeCompare(b.etDate) ||
        String(a.startISO).localeCompare(String(b.startISO)) ||
        a.league.localeCompare(b.league)
    );

    res.set('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    res.json({ range: { start, end }, games, teams: allTeams(), errors });
  });

  app.get('/api/teams', (_req, res) => {
    warmup();
    res.json({ teams: allTeams() });
  });

  // RoadTrip planner: find every minimal way to catch all of `teams` within a
  // window of `days` consecutive days, searching forward from `start` (default
  // today) over a fixed horizon.
  const PLANNER_HORIZON_DAYS = 90;
  app.get('/api/roadtrip', async (req, res) => {
    warmup();
    const teamIds = String(req.query.teams || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const days = parseInt(req.query.days, 10);
    const start = ISO_RE.test(req.query.start || '') ? req.query.start : etTodayISO();
    const strict = req.query.strict === '1' || req.query.strict === 'true';

    if (teamIds.length < 2) return res.status(400).json({ error: 'Select at least 2 teams.' });
    if (new Set(teamIds).size !== teamIds.length)
      return res.status(400).json({ error: 'Duplicate teams in request.' });
    if (teamIds.length > 20) return res.status(400).json({ error: 'At most 20 teams.' });
    if (!(days >= 2 && days <= 20))
      return res.status(400).json({ error: 'Trip length must be 2–20 days.' });
    if (teamIds.length > days)
      return res
        .status(400)
        .json({ error: `${teamIds.length} teams need at least a ${teamIds.length}-day trip.` });

    const end = addDaysISO(start, PLANNER_HORIZON_DAYS);
    const leagues = [...new Set(teamIds.map((id) => id.split(':')[0]))].filter((l) =>
      ALL_LEAGUES.includes(l)
    );

    const settled = await Promise.allSettled(leagues.map((l) => LEAGUE_LOADERS[l](start, end)));
    const games = [];
    const errors = {};
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') games.push(...r.value);
      else errors[leagues[i]] = r.reason?.message || 'failed';
    });

    const selected = new Set(teamIds);
    const relevant = games.filter((g) => selected.has(g.home.id)); // home games only
    const { itineraries, truncated } = planRoadtrips(relevant, teamIds, days, { cap: 200, strict });

    const known = allTeams();
    res.json({
      searched: { start, end, days, strict, horizonDays: PLANNER_HORIZON_DAYS },
      teams: teamIds.map((id) => known.find((t) => t.id === id) || { id, name: id, league: id.split(':')[0] }),
      count: itineraries.length,
      truncated,
      itineraries,
      errors,
    });
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  return app;
}
