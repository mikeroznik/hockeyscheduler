import { fetchJSON } from './http.js';
import { cached } from './cache.js';
import { toEastern } from './time.js';
import { rememberTeam } from './teams.js';

// MLB via the public MLB Stats API (statsapi.mlb.com) — the same feed MLB.com uses.
const BASE = 'https://statsapi.mlb.com/api/v1';

const KIND = {
  R: null,
  S: 'Spring Training',
  E: 'Exhibition',
  A: 'All-Star',
  F: 'Postseason',
  D: 'Postseason',
  L: 'Postseason',
  W: 'World Series',
  P: 'Postseason',
  C: 'Postseason',
};

export async function getMLBTeamMap() {
  return cached('mlb:teams', 24 * 60 * 60 * 1000, async () => {
    const data = await fetchJSON(`${BASE}/teams?sportId=1`);
    const map = new Map();
    for (const t of data?.teams || []) {
      const team = {
        id: `MLB:${t.abbreviation || t.id}`,
        league: 'MLB',
        name: t.name || t.teamName,
        abbrev: t.abbreviation || '',
      };
      map.set(t.id, team);
      rememberTeam(team);
    }
    return map;
  });
}

function normalize(g, teamMap) {
  const t = toEastern(g.gameDate);
  const mk = (side) => {
    const known = teamMap.get(side.team?.id);
    const obj = known || {
      id: `MLB:${side.team?.id}`,
      league: 'MLB',
      name: side.team?.name || 'TBD',
      abbrev: '',
    };
    rememberTeam(obj);
    return obj;
  };
  const home = mk(g.teams.home);
  const away = mk(g.teams.away);

  const abstract = g.status?.abstractGameState; // Preview | Live | Final
  const detailed = g.status?.detailedState || '';
  const off = /Postponed|Cancelled|Suspended|Delayed/i.test(detailed);
  const status = abstract === 'Live' ? 'live' : abstract === 'Final' ? 'final' : 'scheduled';

  const hs = g.teams.home.score;
  const as = g.teams.away.score;
  const hasScore = (status === 'live' || status === 'final') && typeof hs === 'number' && typeof as === 'number';

  let etTime;
  if (off) etTime = detailed;
  else if (g.status?.startTimeTBD) etTime = 'TBD';
  else etTime = t.etTime;

  const parts = [];
  if (KIND[g.gameType]) parts.push(KIND[g.gameType]);
  if (g.doubleHeader && g.doubleHeader !== 'N') parts.push(`Game ${g.gameNumber || 1}`);

  return {
    id: `mlb-${g.gamePk}`,
    league: 'MLB',
    etDate: t.etDate,
    etTime,
    etWeekday: t.etWeekday,
    startISO: t.iso,
    status,
    kind: parts.join(' · ') || null,
    home,
    away,
    score: hasScore ? { home: hs, away: as } : null,
    venue: g.venue?.name || null,
  };
}

export async function getMLBGames(startISO, endISO) {
  const teamMap = await getMLBTeamMap().catch(() => new Map());
  const data = await cached(
    `mlb:sched:${startISO}:${endISO}`,
    10 * 60 * 1000,
    () => fetchJSON(`${BASE}/schedule?sportId=1&startDate=${startISO}&endDate=${endISO}`)
  );
  const out = [];
  for (const day of data?.dates || []) {
    for (const g of day.games || []) {
      // Skip unresolved postseason bracket slots ("AL #1 Seed" etc.) — real team
      // ids are < 1000; placeholder matchup ids are in the 4000s.
      const hi = g.teams?.home?.team?.id ?? 0;
      const ai = g.teams?.away?.team?.id ?? 0;
      if (hi >= 1000 || ai >= 1000) continue;
      const game = normalize(g, teamMap);
      if (game.etDate >= startISO && game.etDate <= endISO) out.push(game);
    }
  }
  return out;
}
