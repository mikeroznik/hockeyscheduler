const LEAGUES = ['NHL', 'AHL', 'ECHL', 'NCAA', 'MLB'];
const LEAGUE_COLOR = {
  NHL: 'var(--nhl)', AHL: 'var(--ahl)', ECHL: 'var(--echl)', NCAA: 'var(--ncaa)', MLB: 'var(--mlb)',
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MAX_CHIPS = 4;

const $ = (id) => document.getElementById(id);

/* ---------- persistent state ---------- */
const saved = JSON.parse(localStorage.getItem('hsc-state') || '{}');
const state = {
  year: saved.year ?? null,
  month: saved.month ?? null, // 0-based
  leaguesOn: { NHL: true, AHL: true, ECHL: true, NCAA: true, MLB: true, ...(saved.leaguesOn || {}) },
  teamsOff: new Set(saved.teamsOff || []), // team ids the user unchecked
  expanded: new Set(saved.expanded || []),
  // Roadtrip: full game objects keyed by id, so a selected game survives navigating
  // to other months (where it wouldn't otherwise be loaded).
  roadtrip: new Map((saved.roadtrip || []).map((g) => [g.id, g])),
};
function persist() {
  localStorage.setItem(
    'hsc-state',
    JSON.stringify({
      year: state.year,
      month: state.month,
      leaguesOn: state.leaguesOn,
      teamsOff: [...state.teamsOff],
      expanded: [...state.expanded],
      roadtrip: [...state.roadtrip.values()],
    })
  );
}

/* ---------- date helpers ---------- */
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

function etTodayISO() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return p;
}

if (state.year == null) {
  const [y, m] = etTodayISO().split('-').map(Number);
  state.year = y;
  state.month = m - 1;
}

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const cells = [];
  const cursor = new Date(year, month, 1 - startOffset);
  for (let i = 0; i < 42; i++) {
    cells.push({
      y: cursor.getFullYear(),
      m: cursor.getMonth(),
      d: cursor.getDate(),
      iso: iso(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
      outside: cursor.getMonth() !== month,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

/* ---------- data ---------- */
const monthCache = new Map(); // "year-month" -> { games, teams, errors }
let teamsById = new Map();

async function loadMonth(year, month) {
  const key = `${year}-${month}`;
  if (monthCache.has(key)) return monthCache.get(key);
  const cells = monthGrid(year, month);
  const start = cells[0].iso;
  const end = cells[41].iso;
  setStatus('Loading…');
  const res = await fetch(`/api/games?start=${start}&end=${end}`);
  if (!res.ok) throw new Error(`server ${res.status}`);
  const data = await res.json();
  monthCache.set(key, data);
  return data;
}

function ingestTeams(teams) {
  for (const t of teams) teamsById.set(t.id, t);
}

/* ---------- filtering ---------- */
function gameVisible(g) {
  if (!state.leaguesOn[g.league]) return false;
  const homeOn = !state.teamsOff.has(g.home.id);
  const awayOn = !state.teamsOff.has(g.away.id);
  return homeOn || awayOn;
}

/* ---------- roadtrip ---------- */
function inRoadtrip(id) { return state.roadtrip.has(id); }

function toggleRoadtrip(g) {
  if (state.roadtrip.has(g.id)) state.roadtrip.delete(g.id);
  else state.roadtrip.set(g.id, g);
  persist();
  updateRoadtripBtn();
  renderCalendar(currentGames);
}

function updateRoadtripBtn() {
  const n = state.roadtrip.size;
  $('tripCount').textContent = n;
  $('roadtripBtn').disabled = n === 0;
}

function tripSorted() {
  return [...state.roadtrip.values()].sort(
    (a, b) =>
      a.etDate.localeCompare(b.etDate) ||
      String(a.startISO).localeCompare(String(b.startISO)) ||
      a.league.localeCompare(b.league)
  );
}

// A place string good enough for Google Maps search.
function mapPlace(g) {
  if (g.venue) return g.venue;
  const school = g.home.name.replace(/\bSt\./g, 'State');
  return `${school} hockey arena`;
}

function mapsRouteUrl(places) {
  return 'https://www.google.com/maps/dir/' + places.map((p) => encodeURIComponent(p)).join('/');
}

/* ---------- rendering: calendar ---------- */
function setStatus(text) { $('status').textContent = text; }

function renderWeekdays() {
  $('weekdayRow').innerHTML = WEEKDAYS.map((d) => `<div>${d}</div>`).join('');
}

function chipEl(g) {
  const el = document.createElement('div');
  el.className = `chip ${g.league} ${g.status}` + (inRoadtrip(g.id) ? ' in-trip' : '');
  const scoreTxt = g.score ? `${g.away.abbrev || short(g.away.name)} ${g.score.away} – ${g.home.abbrev || short(g.home.name)} ${g.score.home}` : null;
  const matchup = `${g.away.abbrev || short(g.away.name)} @ ${g.home.abbrev || short(g.home.name)}`;
  const right = g.status === 'live' ? 'LIVE' : g.status === 'final' ? 'F' : g.etTime;
  const flag = inRoadtrip(g.id) ? '<span class="trip-flag" title="On your roadtrip">🚗</span>' : '';
  el.innerHTML = `<span class="chip-teams">${flag}${scoreTxt || matchup}</span><span class="chip-time">${right}</span>`;
  el.title = `${g.league} · ${g.away.name} at ${g.home.name}\n${g.etWeekday || ''} ${g.etDate} · ${g.etTime} ET${g.kind ? ' · ' + g.kind : ''}${g.venue ? '\n' + g.venue : ''}`;
  el.addEventListener('click', () => openModal(g));
  return el;
}

function short(name) { return name.length > 10 ? name.slice(0, 10) : name; }

function renderCalendar(games) {
  const grid = $('calendarGrid');
  grid.innerHTML = '';
  const todayIso = etTodayISO();
  const byDate = new Map();
  for (const g of games) {
    if (!gameVisible(g)) continue;
    if (!byDate.has(g.etDate)) byDate.set(g.etDate, []);
    byDate.get(g.etDate).push(g);
  }

  let visible = 0;
  for (const list of byDate.values()) visible += list.length;
  const inMonth = games.filter((g) => {
    const [gy, gm] = g.etDate.split('-').map(Number);
    return gy === state.year && gm === state.month + 1;
  }).length;
  setStatus(`${visible} shown · ${inMonth} in ${MONTHS[state.month]}`);

  for (const cell of monthGrid(state.year, state.month)) {
    const div = document.createElement('div');
    div.className = 'day-cell' + (cell.outside ? ' outside' : '') + (cell.iso === todayIso ? ' today' : '');
    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = cell.d;
    div.appendChild(num);

    const dayGames = (byDate.get(cell.iso) || []);
    const shown = dayGames.slice(0, MAX_CHIPS);
    for (const g of shown) div.appendChild(chipEl(g));
    if (dayGames.length > MAX_CHIPS) {
      const more = document.createElement('span');
      more.className = 'more-link';
      more.textContent = `+${dayGames.length - MAX_CHIPS} more`;
      more.addEventListener('click', () => openDayModal(cell.iso, dayGames));
      div.appendChild(more);
    }
    grid.appendChild(div);
  }
}

/* ---------- rendering: sidebar ---------- */
function teamsForLeague(league) {
  return [...teamsById.values()]
    .filter((t) => t.league === league)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function renderSidebar(games) {
  const counts = {};
  for (const g of games) counts[g.league] = (counts[g.league] || 0) + 1;

  const list = $('filterList');
  list.innerHTML = '';

  for (const league of LEAGUES) {
    const block = document.createElement('div');
    block.className = 'league-block';

    const n = counts[league] || 0;
    const row = document.createElement('div');
    row.className = 'league-row';
    row.innerHTML = `
      <span class="swatch" style="background:${LEAGUE_COLOR[league]}"></span>
      <input type="checkbox" ${state.leaguesOn[league] ? 'checked' : ''} data-league="${league}" />
      <span class="league-name">${league}</span>
      <span class="count">${n ? n + ' this view' : 'none'}</span>
      <span class="caret" data-caret="${league}">${state.expanded.has(league) ? '▾' : '▸'}</span>`;
    block.appendChild(row);

    if (state.leaguesOn[league] && n === 0) {
      const note = document.createElement('div');
      note.className = 'league-note';
      note.textContent = monthIsFutureOrCurrent()
        ? 'No games — this league may not have published its schedule this far out yet.'
        : 'No games scheduled in this month.';
      block.appendChild(note);
    }

    row.querySelector('input').addEventListener('change', (e) => {
      state.leaguesOn[league] = e.target.checked;
      persist();
      rerender();
    });
    row.querySelector('.caret').addEventListener('click', () => {
      if (state.expanded.has(league)) state.expanded.delete(league);
      else state.expanded.add(league);
      persist();
      rerender();
    });

    const teamList = document.createElement('div');
    teamList.className = 'team-list' + (state.expanded.has(league) ? ' open' : '');
    const teams = teamsForLeague(league);
    if (state.expanded.has(league)) {
      const bulk = document.createElement('div');
      bulk.className = 'bulk';
      bulk.innerHTML = `<button data-all="${league}">All</button><button data-none="${league}">None</button>`;
      bulk.querySelector('[data-all]').addEventListener('click', () => {
        for (const t of teams) state.teamsOff.delete(t.id);
        persist(); rerender();
      });
      bulk.querySelector('[data-none]').addEventListener('click', () => {
        for (const t of teams) state.teamsOff.add(t.id);
        persist(); rerender();
      });
      teamList.appendChild(bulk);

      if (!teams.length) {
        const empty = document.createElement('div');
        empty.className = 'hint';
        empty.textContent = 'Teams appear as games load.';
        teamList.appendChild(empty);
      }

      for (const t of teams) {
        const item = document.createElement('div');
        item.className = 'team-item';
        const cbId = `t_${btoa(t.id).replace(/=/g, '')}`;
        item.innerHTML = `<input type="checkbox" id="${cbId}" ${state.teamsOff.has(t.id) ? '' : 'checked'} />
          <label for="${cbId}">${t.name}</label>`;
        item.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) state.teamsOff.delete(t.id);
          else state.teamsOff.add(t.id);
          persist(); rerender();
        });
        teamList.appendChild(item);
      }
    }
    block.appendChild(teamList);
    list.appendChild(block);
  }
}

/* ---------- modal ---------- */
function openModal(g) {
  const body = $('modalBody');
  const statusBadge = g.status === 'live' ? '<span class="badge live">● LIVE</span>'
    : g.status === 'final' ? '<span class="badge final">Final</span>'
    : '<span class="badge">Scheduled</span>';
  body.innerHTML = `
    <div class="modal-body">
      <h3>${g.away.name} <span style="color:var(--muted)">@</span> ${g.home.name}</h3>
      <div class="modal-row"><span class="k">League</span><span>${g.league}${g.kind ? ' · ' + g.kind : ''}</span></div>
      <div class="modal-row"><span class="k">Date</span><span>${g.etWeekday ? g.etWeekday + ', ' : ''}${g.etDate}</span></div>
      <div class="modal-row"><span class="k">Time (ET)</span><span>${g.etTime}</span></div>
      ${g.score ? `<div class="modal-row"><span class="k">Score</span><span>${g.away.abbrev || g.away.name} ${g.score.away} – ${g.score.home} ${g.home.abbrev || g.home.name}</span></div>` : ''}
      <div class="modal-row"><span class="k">Venue</span><span>${g.venue || g.home.name + ' (home)'}</span></div>
      ${statusBadge}
      <label class="trip-toggle">
        <input type="checkbox" id="tripCb" ${inRoadtrip(g.id) ? 'checked' : ''} />
        🚗 Add this game to my roadtrip
      </label>
    </div>`;
  body.querySelector('#tripCb').addEventListener('change', () => toggleRoadtrip(g));
  $('gameModal').hidden = false;
}

function openDayModal(dateIso, games) {
  const body = $('modalBody');
  const list = games.filter(gameVisible);
  body.innerHTML = `<div class="modal-body"><h3>${dateIso}</h3><div class="day-list"></div></div>`;
  const wrap = body.querySelector('.day-list');
  for (const g of list) {
    const result = g.score
      ? `${g.score.away}–${g.score.home}`
      : g.status === 'final' ? 'Final' : g.etTime;
    const row = document.createElement('div');
    row.className = 'modal-row day-row';
    row.innerHTML = `
      <span class="day-row-main">
        <input type="checkbox" ${inRoadtrip(g.id) ? 'checked' : ''} title="Add to roadtrip" />
        <button class="linklike">${g.away.abbrev || g.away.name} @ ${g.home.abbrev || g.home.name}</button>
        <span style="color:var(--muted)">· ${g.league}</span>
      </span>
      <span>${result}</span>`;
    row.querySelector('input').addEventListener('change', () => toggleRoadtrip(g));
    row.querySelector('.linklike').addEventListener('click', () => openModal(g));
    wrap.appendChild(row);
  }
  $('gameModal').hidden = false;
}

function closeModal() { $('gameModal').hidden = true; }

/* ---------- roadtrip itinerary ---------- */
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function tripItineraryText(games) {
  const lines = ['🚗 HOCKEY ROADTRIP', ''];
  games.forEach((g, i) => {
    lines.push(`${i + 1}. ${g.away.name} @ ${g.home.name}  (${g.league}${g.kind ? ' · ' + g.kind : ''})`);
    lines.push(`   ${g.etWeekday ? g.etWeekday + ' ' : ''}${g.etDate} · ${g.etTime} ET`);
    lines.push(`   ${g.venue || g.home.name + ' (home arena)'}`);
    if (g.score) lines.push(`   Result: ${g.away.name} ${g.score.away} – ${g.score.home} ${g.home.name}`);
    if (i < games.length - 1) {
      lines.push(`   ↓ drive: ${mapsRouteUrl([mapPlace(g), mapPlace(games[i + 1])])}`);
    }
    lines.push('');
  });
  const stops = games.map(mapPlace);
  lines.push(`Full route: ${mapsRouteUrl(stops.slice(0, 10))}${stops.length > 10 ? '  (first 10 stops)' : ''}`);
  return lines.join('\n');
}

function renderRoadtrip() {
  const games = tripSorted();
  const body = $('roadtripBody');
  if (!games.length) {
    body.innerHTML = '<div class="modal-body"><h3>🚗 Roadtrip</h3><p class="hint">No games selected yet. Open a game and tick “Add to my roadtrip”.</p></div>';
    $('roadtripModal').hidden = false;
    return;
  }

  const stops = games.map(mapPlace);
  const fullUrl = mapsRouteUrl(stops.slice(0, 10));

  let html = `<div class="modal-body">
    <h3>🚗 Roadtrip — ${games.length} game${games.length > 1 ? 's' : ''}</h3>
    <div class="trip-actions">
      <a class="btnlike" href="${fullUrl}" target="_blank" rel="noopener">🗺️ Open full route in Google Maps${stops.length > 10 ? ' (first 10)' : ''}</a>
      <button id="tripCopy" class="btnlike">📋 Copy itinerary</button>
      <button id="tripClear" class="btnlike danger">Clear all</button>
    </div>
    <ol class="trip-list">`;

  games.forEach((g, i) => {
    html += `<li class="trip-game">
      <div class="trip-game-head">
        <strong>${esc(g.away.name)} @ ${esc(g.home.name)}</strong>
        <button class="trip-remove" data-id="${esc(g.id)}" title="Remove">×</button>
      </div>
      <div class="trip-meta">${g.league}${g.kind ? ' · ' + g.kind : ''} &nbsp;•&nbsp; ${g.etWeekday ? g.etWeekday + ', ' : ''}${g.etDate} &nbsp;•&nbsp; ${g.etTime} ET</div>
      <div class="trip-meta">📍 ${esc(g.venue || g.home.name + ' (home arena)')}</div>
      ${g.score ? `<div class="trip-meta">Result: ${esc(g.away.name)} ${g.score.away} – ${g.score.home} ${esc(g.home.name)}</div>` : ''}
    </li>`;
    if (i < games.length - 1) {
      const legUrl = mapsRouteUrl([mapPlace(g), mapPlace(games[i + 1])]);
      html += `<li class="trip-leg"><a href="${legUrl}" target="_blank" rel="noopener">↓ Directions to next arena</a></li>`;
    }
  });

  html += '</ol></div>';
  body.innerHTML = html;

  body.querySelector('#tripClear').addEventListener('click', () => {
    if (!confirm('Remove all games from the roadtrip?')) return;
    state.roadtrip.clear();
    persist();
    updateRoadtripBtn();
    renderCalendar(currentGames);
    renderRoadtrip();
  });
  body.querySelector('#tripCopy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(tripItineraryText(games));
      e.target.textContent = '✓ Copied';
      setTimeout(() => (e.target.textContent = '📋 Copy itinerary'), 1500);
    } catch {
      e.target.textContent = 'Copy failed';
    }
  });
  body.querySelectorAll('.trip-remove').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.roadtrip.delete(btn.dataset.id);
      persist();
      updateRoadtripBtn();
      renderCalendar(currentGames);
      renderRoadtrip();
    })
  );

  $('roadtripModal').hidden = false;
}

function closeRoadtrip() { $('roadtripModal').hidden = true; }

/* ---------- orchestration ---------- */
let currentGames = [];

function rerender() {
  renderCalendar(currentGames);
  renderSidebar(currentGames);
  updateMonthLabel();
}

function updateMonthLabel() {
  $('monthLabel').textContent = `${MONTHS[state.month]} ${state.year}`;
}

function monthIsFutureOrCurrent() {
  const [ty, tm] = etTodayISO().split('-').map(Number);
  return state.year > ty || (state.year === ty && state.month + 1 >= tm);
}

async function go() {
  updateMonthLabel();
  try {
    const data = await loadMonth(state.year, state.month);
    ingestTeams(data.teams || []);
    currentGames = data.games || [];
    const errs = Object.entries(data.errors || {});
    const banner = $('errorBanner');
    if (errs.length) {
      banner.hidden = false;
      banner.textContent = 'Some schedules could not be loaded: ' + errs.map(([k]) => k).join(', ') + '. Showing what is available.';
    } else banner.hidden = true;
    setStatus(`${currentGames.length} games`);
  } catch (err) {
    setStatus('');
    const banner = $('errorBanner');
    banner.hidden = false;
    banner.textContent = 'Could not load schedule data: ' + err.message;
    currentGames = [];
  }
  rerender();
}

function shiftMonth(delta) {
  const d = new Date(state.year, state.month + delta, 1);
  state.year = d.getFullYear();
  state.month = d.getMonth();
  persist();
  go();
}

/* ---------- wire up ---------- */
$('prevMonth').addEventListener('click', () => shiftMonth(-1));
$('nextMonth').addEventListener('click', () => shiftMonth(1));
$('todayBtn').addEventListener('click', () => {
  const [y, m] = etTodayISO().split('-').map(Number);
  state.year = y; state.month = m - 1;
  persist(); go();
});
$('toggleFilters').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('roadtripBtn').addEventListener('click', renderRoadtrip);
$('modalClose').addEventListener('click', closeModal);
$('roadtripClose').addEventListener('click', closeRoadtrip);
$('gameModal').addEventListener('click', (e) => { if (e.target.id === 'gameModal') closeModal(); });
$('roadtripModal').addEventListener('click', (e) => { if (e.target.id === 'roadtripModal') closeRoadtrip(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeModal();
  closeRoadtrip();
});

updateRoadtripBtn();
renderWeekdays();
// Pull the full known team list up front so checkboxes are populated before browsing.
fetch('/api/teams')
  .then((r) => r.json())
  .then((d) => { ingestTeams(d.teams || []); rerender(); })
  .catch(() => {});
go();
