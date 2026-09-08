// Given a set of teams, a trip length in days, and a pool of their games, find
// every itinerary that lets you see all of them within a single window of `days`
// consecutive days — one game per calendar day (you can't be in two places at
// once). Only counts games where a selected team is playing AT HOME.
//
// With `strict`, the teams must be visited in the exact order given.

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/**
 * @param {Array} games   normalized games (any home/away)
 * @param {string[]} teamIds  the selected team ids, in the user's chosen order
 * @param {number} days   trip length (2..20)
 * @param {{cap?: number, strict?: boolean}} [opts]
 */
export function planRoadtrips(games, teamIds, days, opts = {}) {
  const { cap = 150, strict = false } = opts;
  const selected = new Set(teamIds);

  // Tag each game with the selected team it covers — HOME games only.
  const pool = [];
  for (const g of games) {
    if (selected.has(g.home.id)) pool.push({ ...g, covers: [g.home.id] });
  }
  pool.sort(
    (a, b) => a.etDate.localeCompare(b.etDate) || String(a.startISO).localeCompare(String(b.startISO))
  );

  const byTeam = new Map();
  for (const tid of teamIds) byTeam.set(tid, []);
  for (const g of pool) byTeam.get(g.covers[0]).push(g);

  // Strict: keep the user's order. Otherwise solve the most-constrained team first.
  const order = strict ? [...teamIds] : [...teamIds].sort((a, b) => byTeam.get(a).length - byTeam.get(b).length);

  const results = [];
  const seen = new Set();

  function record(chosen) {
    const sorted = [...chosen].sort(
      (a, b) => a.etDate.localeCompare(b.etDate) || String(a.startISO).localeCompare(String(b.startISO))
    );
    const key = sorted.map((g) => g.id).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      startDate: sorted[0].etDate,
      endDate: sorted[sorted.length - 1].etDate,
      spanDays: daysBetween(sorted[0].etDate, sorted[sorted.length - 1].etDate) + 1,
      games: sorted,
    });
  }

  function dfs(oi, chosen, usedDates, minDate, maxDate, afterDate) {
    if (results.length >= cap) return;
    if (oi === order.length) {
      record(chosen);
      return;
    }
    for (const g of byTeam.get(order[oi])) {
      if (usedDates.has(g.etDate)) continue;
      if (strict && afterDate && g.etDate <= afterDate) continue; // must come after the previous team
      const nMin = !minDate || g.etDate < minDate ? g.etDate : minDate;
      const nMax = !maxDate || g.etDate > maxDate ? g.etDate : maxDate;
      if (daysBetween(nMin, nMax) > days - 1) continue;
      usedDates.add(g.etDate);
      chosen.push(g);
      dfs(oi + 1, chosen, usedDates, nMin, nMax, strict ? g.etDate : afterDate);
      chosen.pop();
      usedDates.delete(g.etDate);
      if (results.length >= cap) return;
    }
  }

  dfs(0, [], new Set(), null, null, null);
  const truncated = results.length >= cap;

  results.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) || a.spanDays - b.spanDays || a.games.length - b.games.length
  );

  return { itineraries: results, truncated };
}
