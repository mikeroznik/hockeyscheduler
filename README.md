# Hockey Schedule Calendar

A monthly calendar showing **NHL, AHL, ECHL, NCAA Division I men's** hockey and
**MLB** schedules for every team. Toggle whole leagues or individual teams on/off
from the sidebar, page month to month, and see every start time converted to
**US Eastern**.

## Roadtrip planner

Open any game and tick **🚗 Add this game to my roadtrip** (also available from the
"+N more" day list). The **Roadtrip** button in the header (next to Today) opens an
itinerary of the selected games in chronological order — league, date/time ET,
venue, and result — with a Google Maps directions link between each arena and one
"open full route" link for the whole trip. The selection is saved in the browser,
so it survives reloads and browsing to other months. NCAA games have no venue in
the feed, so those legs route to `"<school> hockey arena"`.

## Running

```bash
npm install
npm start
```

Then open <http://localhost:4100>. Set `PORT` to use a different port.

`npm run dev` runs the same thing with `--watch` for development.

## Deploying to Vercel

```bash
npm i -g vercel   # if you don't have the CLI
vercel            # first run links/creates the project
vercel --prod     # production deploy
```

`vercel.json` serves `public/` as static assets on the CDN and routes `/api/*` to
`api/index.js`, which wraps the same Express app (`server/app.js`). No env vars or
database required.

Serverless caveats (all non-fatal): the in-memory response cache resets on cold
starts, and `server/data/teams.json` isn't writable — persistence falls back to the
function's temp dir and is skipped if that fails too. The team list still works in
memory, and every `/api/games` response already includes the teams for the games
it returns, so only teams from *un-browsed* months are affected.

For a long-lived process instead (keeps the cache warm, persists the team file),
deploy `npm start` as a single Node service on Render / Railway / Fly / a VPS.

## How it works

A small Express server (`server/`) proxies and normalizes five public schedule
feeds, then serves a dependency-free vanilla-JS front end (`public/`).

| League | Source |
|---|---|
| NHL | `api-web.nhle.com` club schedule feed |
| AHL | HockeyTech / LeagueStat feed (`lscluster.hockeytech.com`, `client_code=ahl`) |
| ECHL | HockeyTech / LeagueStat feed (`client_code=echl`) |
| NCAA D1 men | `sdataprod.ncaa.com` GraphQL (the feed ncaa.com's own scoreboard uses) |
| MLB | `statsapi.mlb.com` Stats API (`sportId=1`) |

Every feed gives a UTC instant (or an offset-aware timestamp); the server
converts each one to America/New_York with `Intl.DateTimeFormat` and returns both
the Eastern date and the Eastern clock time. Games with no confirmed time show
`TBD`.

### Endpoints

- `GET /api/games?start=YYYY-MM-DD&end=YYYY-MM-DD[&leagues=NHL,AHL,ECHL,NCAA,MLB]`
  returns `{ range, games, teams, errors }`. Each league is loaded independently,
  so if one feed is down the others still render and the failing league is listed
  in `errors`.
- `GET /api/teams` returns the accumulated team registry.

### Caching

Responses are cached in memory with a short TTL for today/future dates and a long
TTL for past dates. The team list is persisted to `server/data/teams.json` so
leagues without a clean "all teams" endpoint (NCAA) fill in as months are browsed;
the current NHL (32) and MLB (30) rosters are seeded at startup.

## Notes / limitations

- Off-season, the AHL/ECHL/NCAA feeds don't publish far-future schedules yet, so
  future months fill in as each league releases its season.
- NCAA coverage is Division I men only. MLB includes spring training and
  postseason; unresolved postseason bracket slots ("AL #1 Seed" etc.) are hidden
  until the matchup is set.
- This relies on undocumented public feeds; if one changes shape, that league's
  loader in `server/lib/` is the place to adjust.
