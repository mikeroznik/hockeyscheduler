import express from 'express';

import { getNHLGames } from './lib/nhl.js';
import { getHockeyTechGames } from './lib/hockeytech.js';
import { getNCAAGames } from './lib/ncaa.js';
import { allTeams, rememberTeam, persistTeams } from './lib/teams.js';
import { fetchJSON } from './lib/http.js';
import { cached } from './lib/cache.js';

const LEAGUE_LOADERS = {
  NHL: (s, e) => getNHLGames(s, e),
  AHL: (s, e) => getHockeyTechGames('AHL', s, e),
  ECHL: (s, e) => getHockeyTechGames('ECHL', s, e),
  NCAA: (s, e) => getNCAAGames(s, e),
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
  try {
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
    persistTeams();
  } catch (err) {
    console.error('NHL seed failed:', err.message);
  }
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

  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  return app;
}
