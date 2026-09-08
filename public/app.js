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

// A game where one of the currently-checked teams is playing at home.
function homeTeamSelected(g) {
  return state.leaguesOn[g.league] && !state.teamsOff.has(g.home.id);
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
  el.className =
    `chip ${g.league} ${g.status}` +
    (inRoadtrip(g.id) ? ' in-trip' : '') +
    (homeTeamSelected(g) ? ' home-pick' : '');
  const scoreTxt = g.score ? `${g.away.abbrev || short(g.away.name)} ${g.score.away} – ${g.home.abbrev || short(g.home.name)} ${g.score.home}` : null;
  const matchup = `${g.away.abbrev || short(g.away.name)} @ ${g.home.abbrev || short(g.home.name)}`;
  const right = g.status === 'live' ? 'LIVE' : g.status === 'final' ? 'F' : g.etTime;
  const flag = inRoadtrip(g.id) ? '<span class="trip-flag" title="On your roadtrip">🚗</span>' : '';
  const promo = g.promos && g.promos.length ? '<span class="promo-star" title="Promotion / giveaway">*</span>' : '';
  el.innerHTML = `<span class="chip-teams">${flag}${scoreTxt || matchup}${promo}</span><span class="chip-time">${right}</span>`;
  el.title = `${g.league} · ${g.away.name} at ${g.home.name}\n${g.etWeekday || ''} ${g.etDate} · ${g.etTime} ET${g.kind ? ' · ' + g.kind : ''}${g.venue ? '\n' + g.venue : ''}` +
    (g.promos && g.promos.length ? '\n★ ' + g.promos.map((p) => p.name).join('; ') : '');
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
      ${
        g.promos && g.promos.length
          ? `<div class="promo-note">
               <div class="promo-note-head">★ ${esc(g.home.name)} promotions</div>
               <ul>${g.promos
                 .map(
                   (p) => `<li>
                     <span class="promo-name">${p.icon ? esc(p.icon) + ' ' : ''}${esc(p.name)}</span>${
                     p.type ? ` <span class="promo-type">${esc(p.type)}</span>` : ''
                   }${p.whileSuppliesLast ? ' <span class="promo-type">while supplies last</span>' : ''}
                     ${p.description ? `<span class="promo-desc">${esc(p.description)}</span>` : ''}
                     ${p.presentedBy ? `<span class="promo-desc">Presented by ${esc(p.presentedBy)}</span>` : ''}
                   </li>`
                 )
                 .join('')}</ul>
             </div>`
          : ''
      }
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
        ${g.promos && g.promos.length ? '<span class="promo-star" title="Promotion / giveaway">*</span>' : ''}
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
  const lines = ['🚗 ROADTRIP', ''];
  games.forEach((g, i) => {
    lines.push(`${i + 1}. ${g.away.name} @ ${g.home.name}  (${g.league}${g.kind ? ' · ' + g.kind : ''})`);
    lines.push(`   ${g.etWeekday ? g.etWeekday + ' ' : ''}${g.etDate} · ${g.etTime} ET`);
    lines.push(`   ${g.venue || g.home.name + ' (home arena)'}`);
    for (const p of g.promos || []) lines.push(`   * ${p.name}${p.type ? ` (${p.type})` : ''}`);
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
      ${(g.promos || []).map((p) => `<div class="trip-meta promo">★ ${esc(p.name)}${p.type ? ` <span class="promo-type">${esc(p.type)}</span>` : ''}</div>`).join('')}
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

/* ================= RoadTrip Planner tab ================= */
const plannerSaved = JSON.parse(localStorage.getItem('hsc-planner') || '{}');
const planner = {
  selected: [...new Set(plannerSaved.selected || [])], // ordered list of team ids
  days: plannerSaved.days || 4,
  start: plannerSaved.start || '',
  strictOrder: !!plannerSaved.strictOrder,
  expanded: new Set(plannerSaved.expanded || []),
  lastResult: null,
};
function persistPlanner() {
  localStorage.setItem(
    'hsc-planner',
    JSON.stringify({
      selected: planner.selected,
      days: planner.days,
      start: planner.start,
      strictOrder: planner.strictOrder,
      expanded: [...planner.expanded],
    })
  );
}
const selHas = (id) => planner.selected.includes(id);
function selAdd(id) { if (!selHas(id)) planner.selected.push(id); }
function selDel(id) { planner.selected = planner.selected.filter((x) => x !== id); }
function selMove(id, dir) {
  const i = planner.selected.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= planner.selected.length) return;
  [planner.selected[i], planner.selected[j]] = [planner.selected[j], planner.selected[i]];
}

let activeTab = localStorage.getItem('hsc-tab') === 'planner' ? 'planner' : 'calendar';

function switchTab(name) {
  activeTab = name;
  try { localStorage.setItem('hsc-tab', name); } catch {}
  $('tabCalendar').classList.toggle('is-active', name === 'calendar');
  $('tabPlanner').classList.toggle('is-active', name === 'planner');
  $('calendarView').hidden = name !== 'calendar';
  $('plannerView').hidden = name !== 'planner';
  document.body.classList.toggle('planner-mode', name === 'planner');
  if (name === 'planner') {
    renderPlannerTeams();
    if (planner.lastResult) renderItineraries(planner.lastResult);
  }
}

function initPlannerControls() {
  const sel = $('plannerDays');
  for (let d = 2; d <= 20; d++) {
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = `${d} days`;
    if (d === planner.days) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => { planner.days = +sel.value; persistPlanner(); });

  const start = $('plannerStart');
  const today = etTodayISO();
  start.min = today;
  if (!planner.start || planner.start < today) planner.start = today;
  start.value = planner.start;
  start.addEventListener('change', () => {
    planner.start = start.value || today;
    persistPlanner();
  });

  const strict = $('plannerStrict');
  strict.checked = planner.strictOrder;
  strict.addEventListener('change', () => {
    planner.strictOrder = strict.checked;
    persistPlanner();
    renderPlannerChosen();
  });

  $('plannerPlan').addEventListener('click', runPlan);
}

function renderPlannerChosen() {
  const box = $('plannerChosen');
  const ids = planner.selected;
  if (!ids.length) {
    box.innerHTML = '<span class="hint">No teams selected yet</span>';
    return;
  }
  const strict = planner.strictOrder;
  box.classList.toggle('ordered', strict);
  box.innerHTML =
    ids
      .map((id, i) => {
        const t = teamsById.get(id);
        const label = t ? `${t.league} ${nickname(t.name)}` : id;
        const reorder = strict
          ? `<button class="mv" data-mv="up" ${i === 0 ? 'disabled' : ''} aria-label="earlier">▲</button>
             <button class="mv" data-mv="down" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="later">▼</button>`
          : '';
        return `<span class="chosen-chip" data-id="${id}" title="${t ? t.name : id}">${
          strict ? `<span class="ord">${i + 1}</span>` : ''
        }${label}${reorder}<span class="x">×</span></span>`;
      })
      .join('') + '<button class="chosen-clear" id="chosenClear">clear all</button>';

  box.querySelectorAll('.chosen-chip').forEach((chip) => {
    const id = chip.dataset.id;
    chip.querySelector('.x').addEventListener('click', () => {
      selDel(id);
      persistPlanner();
      renderPlannerTeams();
    });
    chip.querySelectorAll('.mv').forEach((btn) =>
      btn.addEventListener('click', () => {
        selMove(id, btn.dataset.mv === 'up' ? -1 : 1);
        persistPlanner();
        renderPlannerChosen();
      })
    );
  });
  $('chosenClear').addEventListener('click', () => {
    planner.selected = [];
    persistPlanner();
    renderPlannerTeams();
  });
}

function renderPlannerTeams() {
  renderPlannerChosen();
  const list = $('plannerFilterList');
  list.innerHTML = '';
  for (const league of LEAGUES) {
    const teams = teamsForLeague(league);
    const block = document.createElement('div');
    block.className = 'league-block';
    const selN = () => teams.filter((t) => selHas(t.id)).length;

    const row = document.createElement('div');
    row.className = 'league-row';
    row.innerHTML = `
      <span class="swatch" style="background:${LEAGUE_COLOR[league]}"></span>
      <span class="league-name">${league}</span>
      <span class="count">${selN() ? selN() + ' picked' : ''}</span>
      <span class="caret">${planner.expanded.has(league) ? '▾' : '▸'}</span>`;
    const toggle = () => {
      if (planner.expanded.has(league)) planner.expanded.delete(league);
      else planner.expanded.add(league);
      persistPlanner();
      renderPlannerTeams();
    };
    row.querySelector('.caret').addEventListener('click', toggle);
    row.querySelector('.league-name').addEventListener('click', toggle);
    block.appendChild(row);

    const tl = document.createElement('div');
    tl.className = 'team-list' + (planner.expanded.has(league) ? ' open' : '');
    if (planner.expanded.has(league)) {
      if (!teams.length) {
        tl.innerHTML = '<div class="hint">Team list still loading…</div>';
      } else {
        const bulk = document.createElement('div');
        bulk.className = 'bulk';
        bulk.innerHTML = '<button data-all>All</button><button data-none>None</button>';
        bulk.querySelector('[data-all]').addEventListener('click', () => {
          teams.forEach((t) => selAdd(t.id));
          persistPlanner();
          renderPlannerTeams();
        });
        bulk.querySelector('[data-none]').addEventListener('click', () => {
          teams.forEach((t) => selDel(t.id));
          persistPlanner();
          renderPlannerTeams();
        });
        tl.appendChild(bulk);
        for (const t of teams) {
          const item = document.createElement('div');
          item.className = 'team-item';
          const cid = `p_${btoa(t.id).replace(/=/g, '')}`;
          item.innerHTML = `<input type="checkbox" id="${cid}" ${
            selHas(t.id) ? 'checked' : ''
          }/><label for="${cid}">${t.name}</label>`;
          item.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) selAdd(t.id);
            else selDel(t.id);
            persistPlanner();
            renderPlannerChosen();
            row.querySelector('.count').textContent = selN() ? selN() + ' picked' : '';
          });
          tl.appendChild(item);
        }
      }
    }
    block.appendChild(tl);
    list.appendChild(block);
  }
}

function nickname(name) {
  if (!name) return '';
  const w = name.trim().split(/\s+/);
  const last = w[w.length - 1].replace(/\.$/, '');
  return last.length >= 3 || w.length === 1 ? last : w.slice(-2).join(' ');
}

function fmtDay(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]} ${MONTHS[mo - 1].slice(0, 3)} ${d}`;
}

async function runPlan() {
  const msg = $('plannerMsg');
  const ids = planner.selected;
  if (ids.length < 2) { msg.textContent = 'Pick at least 2 teams.'; return; }
  if (ids.length > planner.days) {
    msg.textContent = `${ids.length} teams need at least a ${ids.length}-day trip.`;
    return;
  }
  msg.textContent = 'Searching the schedule…';
  $('plannerPlan').disabled = true;
  const params = new URLSearchParams({
    teams: ids.join(','),
    days: String(planner.days),
    start: planner.start || etTodayISO(),
  });
  if (planner.strictOrder) params.set('strict', '1');
  try {
    const res = await fetch('/api/roadtrip?' + params);
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || `Error ${res.status}`;
      return;
    }
    planner.lastResult = data;
    msg.textContent = '';
    renderItineraries(data);
  } catch (err) {
    msg.textContent = 'Request failed: ' + err.message;
  } finally {
    $('plannerPlan').disabled = false;
  }
}

function renderItineraries(data) {
  const wrap = $('plannerResults');
  const errs = Object.keys(data.errors || {});
  const errLine = errs.length
    ? `<div class="error-banner" style="border-radius:8px;margin-bottom:10px">Couldn't load: ${errs.join(', ')}</div>`
    : '';

  const orderNote = data.searched.strict ? ' <strong>in that exact order</strong>' : '';
  if (!data.itineraries.length) {
    wrap.innerHTML =
      errLine +
      `<div class="planner-empty"><h2>No trips found</h2>
       <p>No way to catch all ${data.teams.length} teams at a home game on separate days${orderNote} within
       ${data.searched.days} days, searching ${fmtDay(data.searched.start)} – ${fmtDay(data.searched.end)}.
       Try a longer trip, fewer teams, ${data.searched.strict ? 'a different order, ' : ''}or a later start date.</p></div>`;
    return;
  }

  const summary = `<div class="itin-summary">
    <strong>${data.count}${data.truncated ? '+' : ''} option${data.count === 1 ? '' : 's'}</strong>
    to catch ${data.teams.map((t) => t.name).join(data.searched.strict ? ' → ' : ', ')} at home on separate days${orderNote} within
    ${data.searched.days} days · searching ${fmtDay(data.searched.start)} – ${fmtDay(data.searched.end)}
    ${data.truncated ? `<div class="hint">Showing the first ${data.count}; narrow the start date or teams for fewer.</div>` : ''}
  </div>`;

  const cards = data.itineraries
    .map((it, i) => {
      const route = mapsRouteUrl(it.games.map(mapPlace).slice(0, 10));
      const legs = it.games
        .map((g) => {
          const cov = g.covers
            .map((cid) => {
              const t = data.teams.find((x) => x.id === cid) || {};
              return `<span class="cov" title="${t.name || cid}">${nickname(t.name) || cid}</span>`;
            })
            .join('');
          return `<li>
            <span class="leg-date">${fmtDay(g.etDate)}</span>
            <span class="leg-mid">
              <span class="leg-match"><span class="dot" style="background:${LEAGUE_COLOR[g.league]}"></span>${
                g.away.abbrev || g.away.name
              } @ ${g.home.abbrev || g.home.name}</span>
              <span class="leg-sub">${g.league}${g.kind ? ' · ' + g.kind : ''} · ${g.etTime} ET · ${
                g.venue || g.home.name
              }</span>
            </span>
            <span class="leg-cov">${cov}</span>
          </li>`;
        })
        .join('');
      return `<div class="itin">
        <div class="itin-head">
          <span><strong>${fmtDay(it.startDate)} – ${fmtDay(it.endDate)}</strong>
            <span class="hint">· ${it.spanDays} day${it.spanDays === 1 ? '' : 's'} · ${it.games.length} game${
              it.games.length === 1 ? '' : 's'
            }</span></span>
          <span class="itin-actions">
            <a class="btnlike" href="${route}" target="_blank" rel="noopener">🗺️ Route</a>
            <button class="btnlike itin-add" data-i="${i}">＋ Roadtrip</button>
          </span>
        </div>
        <ol class="itin-legs">${legs}</ol>
      </div>`;
    })
    .join('');

  wrap.innerHTML = errLine + summary + `<div class="itin-list">${cards}</div>`;
  wrap.querySelectorAll('.itin-add').forEach((btn) =>
    btn.addEventListener('click', () => {
      for (const g of data.itineraries[+btn.dataset.i].games) state.roadtrip.set(g.id, g);
      persist();
      updateRoadtripBtn();
      renderCalendar(currentGames);
      btn.textContent = '✓ Added';
      btn.disabled = true;
    })
  );
}

/* ---------- wire up ---------- */
$('tabCalendar').addEventListener('click', () => switchTab('calendar'));
$('tabPlanner').addEventListener('click', () => switchTab('planner'));
initPlannerControls();
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
  closeIntro();
});

/* ---------- first-visit intro ---------- */
const INTRO_KEY = 'hsc-intro-seen';
function openIntro() { $('introModal').hidden = false; }
function closeIntro() {
  $('introModal').hidden = true;
  try { localStorage.setItem(INTRO_KEY, '1'); } catch {}
}
$('helpBtn').addEventListener('click', openIntro);
$('introClose').addEventListener('click', closeIntro);
$('introGotIt').addEventListener('click', closeIntro);
$('introModal').addEventListener('click', (e) => { if (e.target.id === 'introModal') closeIntro(); });
try {
  if (!localStorage.getItem(INTRO_KEY)) openIntro();
} catch {
  openIntro();
}

updateRoadtripBtn();
renderWeekdays();
switchTab(activeTab);
// Pull the full known team list up front so checkboxes are populated before browsing.
fetch('/api/teams')
  .then((r) => r.json())
  .then((d) => {
    ingestTeams(d.teams || []);
    rerender();
    if (activeTab === 'planner') renderPlannerTeams();
  })
  .catch(() => {});
go();
