// Accumulating registry of every team we have ever seen, persisted to disk so the
// checkbox list stays complete even for leagues without a clean "all teams" endpoint
// (NCAA in particular builds up as the season is browsed).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const FILE = join(DATA_DIR, 'teams.json');

/** @type {Map<string, {id:string, league:string, name:string, abbrev:string}>} */
const registry = new Map();
let dirty = false;

try {
  const raw = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const t of raw) registry.set(t.id, t);
} catch {
  /* first run */
}

export function rememberTeam(team) {
  if (!team || !team.id) return;
  const existing = registry.get(team.id);
  if (!existing) {
    registry.set(team.id, team);
    dirty = true;
    return;
  }
  // Fill in / improve fields over time.
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
  if (!dirty) return;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(allTeams(), null, 2));
    dirty = false;
  } catch (err) {
    console.error('Could not persist teams.json:', err.message);
  }
}

// Flush periodically rather than on every game.
setInterval(persistTeams, 30_000).unref?.();
process.on('exit', persistTeams);
