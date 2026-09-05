// Accumulating registry of every team we have ever seen, persisted to disk so the
// checkbox list stays complete even for leagues without a clean "all teams" endpoint
// (NCAA in particular builds up as the season is browsed).
//
// On a read-only/ephemeral filesystem (e.g. Vercel serverless) persistence quietly
// falls back to the OS temp dir, and if that also fails it is skipped — the registry
// still works in memory for the life of the process, and every /api/games response
// includes the teams for the games in that response regardless.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const PRIMARY_DIR =
  process.env.TEAMS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CANDIDATE_DIRS = [PRIMARY_DIR, join(tmpdir(), 'hockey-schedule')];
const FILENAME = 'teams.json';

/** @type {Map<string, {id:string, league:string, name:string, abbrev:string}>} */
const registry = new Map();
let dirty = false;
let writeDir = null; // resolved lazily on first successful write
let persistenceDisabled = false;

for (const dir of CANDIDATE_DIRS) {
  try {
    const raw = JSON.parse(readFileSync(join(dir, FILENAME), 'utf8'));
    for (const t of raw) registry.set(t.id, t);
    break;
  } catch {
    /* try next */
  }
}

export function rememberTeam(team) {
  if (!team || !team.id) return;
  const existing = registry.get(team.id);
  if (!existing) {
    registry.set(team.id, team);
    dirty = true;
    return;
  }
  if (team.name && team.name.length > (existing.name || '').length) {
    existing.name = team.name;
    dirty = true;
  }
  if (team.abbrev && !existing.abbrev) {
    existing.abbrev = team.abbrev;
    dirty = true;
  }
}

export function allTeams() {
  return [...registry.values()].sort(
    (a, b) => a.league.localeCompare(b.league) || a.name.localeCompare(b.name)
  );
}

export function persistTeams() {
  if (!dirty || persistenceDisabled) return;
  const payload = JSON.stringify(allTeams(), null, 2);
  const dirs = writeDir ? [writeDir] : CANDIDATE_DIRS;
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, FILENAME), payload);
      writeDir = dir;
      dirty = false;
      return;
    } catch {
      /* try next candidate */
    }
  }
  persistenceDisabled = true; // nowhere writable; stop trying
}

// Flush periodically rather than on every game. No-op if the interval/exit hooks
// are unavailable (some serverless runtimes).
setInterval(persistTeams, 30_000).unref?.();
process.on?.('exit', persistTeams);
