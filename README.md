# Hockey Schedule Calendar

A monthly calendar showing **NHL, AHL, ECHL, NCAA Division I men's** hockey and
**MLB** schedules for every team. Toggle whole leagues or individual teams on/off
from the sidebar, page month to month, and see every start time converted to
**US Eastern**.

First-time visitors get a one-time "how it works" overlay (stored in `localStorage`
as `hsc-intro-seen`); the **?** button in the header reopens it anytime.

## Promotions

Games with a home-team promotion (giveaway, theme night, fireworks, …) are marked
with a **`*`** on the calendar; the game detail popup lists each promotion with its
type, and they carry through to the roadtrip itinerary.

Two leagues are covered:

- **MLB** — the Stats API's official per-game promotions feed (`hydrate=game(promotions)`).
- **NHL** — scraped from [getpromonight.com](https://www.getpromonight.com/nhl),
  which aggregates promos from official team announcements. One page per club; the
  server pulls the embedded `promos` list, caches it 12 h, and matches entries to
  home games by date + opponent. Only *upcoming* promos are published, so past
  games show none.

AHL, ECHL and NCAA have no usable source (no API, and no aggregator with coverage),
so they have no promo markers.

## Roadtrips

Two tabs at the top: **Calendar** (the month view) and **RoadTrip Planning**.

### Build your own (Calendar)

Open any game and tick **🚗 Add this game to my roadtrip** (also available from the
"+N more" day list). The **Roadtrip** button in the header opens an itinerary of the
selected games in chronological order — league, date/time ET, venue, result — with a
Google Maps directions link between each arena and one "open full route" link. The
selection is saved in the browser. NCAA games have no venue in the feed, so those
legs route to `"<school> hockey arena"`.

### RoadTrip Planning tab

Same team list as the calendar, but everything defaults **off**. Pick 2+ teams,
choose a trip length (2–20 days) and a start date, and hit **Plan trips**. The
server (`GET /api/roadtrip`) loads those teams' games over the next 90 days and
[`server/lib/roadtrip.js`](server/lib/roadtrip.js) enumerates every itinerary — one
**home game per selected team**, each on a separate calendar day, all fitting inside
a single window of the chosen length. Away games are ignored, so each itinerary has
exactly one game per team. Each result lists the games, venues, and which team each
one is for, with a Google Maps route, and can be pushed into the roadtrip itinerary
above with one click.

**Visit in this exact order** (`&strict=1`): when ticked, the picked teams become an
ordered list (drag-free ▲▼ reordering on the chips) and only itineraries whose home
games fall in that sequence are returned.

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
| MLB | `statsapi.mlb.com` Stats API (`sportId=1`, `hydrate=game(promotions)`) |
| NHL promos | `getpromonight.com/nhl/<team>` (scraped; hockey has no promo API) |

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
- `GET /api/roadtrip?teams=NHL:EDM,NHL:CGY,AHL:CGY&days=4[&start=YYYY-MM-DD][&strict=1]`
  returns `{ searched, teams, count, truncated, itineraries, errors }` — every way
  to catch each team at a home game within a `days`-day window over the next 90 days
  (`strict=1` requires the `teams` order).

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
- NHL promos are scraped HTML — the loader in `server/lib/promonight.js` is the
  place to adjust if getpromonight.com changes its page structure or team slugs.
- This relies on undocumented public feeds; if one changes shape, that league's
  loader in `server/lib/` is the place to adjust.
