## Run

Needs Node 20.19+ or 22.12+ (see `.nvmrc`).

```bash
npm start        # installs if needed, builds, serves http://localhost:4173
```

It serves the production build.

To run in dev mode

```bash
npm run setup    # only checks Node and installs dependencies (once)
npm run dev      # dev server with hot reload, same address (after setup)
```



There's no login: you are **Priya**. The fake backend keeps changes in this browser; **Simulator → Reset demo data** starts over.

## Try it

Everything works with shortcuts. `?` lists every shortcut.

Open the Simulator with "`"

| Problem from the brief | Do this | You should see |
|---|---|---|
| What to work on today | Look at **My deals**, then `g t` (Follow up today, an example saved view) | Every view is sorted by priority, most urgent first; each card says why ("Overdue 12d") |
| A save failed and nobody said | Simulator → Rejected deals 100%, move a card (`↓`, `4`) | Retrying…, then **Not saved · Retry**. Set 0%, press `r`: saved |
| Slow, flaky network | Failed saves 100%, or the Online switch off | New changes are paused (you can still browse); a change already on its way waits and is sent when you're back |
| Teammates editing | In Rahul's tab (Simulator → People), move one of Priya's deals, or select a column of them and move it | My deals: cards move at once, with a toast saying who did what. All deals: the pill counts them; `.` applies |
| Two people, same deal | Simulator → People → Open a tab as Rahul. Move the same deal differently in both, quickly | A **conflict**: *Keep theirs / Apply mine*. Nothing is overwritten |
| Move thousands to Lost | `g q` (Gone quiet), `Ctrl/⌘+A` twice, `7`, `Enter` | One request with the filter; the **server** runs it as a job. Tray: progress, Stop (`Shift+S`), Undo, Retry failed, Details |
| Smooth with 50k | `g a` (All deals), scroll a 10k-card column | No stutter |
| No mouse | Arrows, `x` select, `1`–`7` move, `z` undo, `?` | Everything works from the keyboard |

To prove the bulk job runs on the server: keep Rahul's tab open, start a select-all move on All deals, and **reload**. The job is still counting in the tray.

## Simulator

- **Network:** Online switch, save latency, failed saves (some of them are lost replies: the server saved but the answer never arrived), rejected deals (the server refuses a deal).
- **Teammates:** a background teammate changes someone else's deal about every 5s (never the deals of people with the app open, so your own board only changes when you test it). To act as a teammate yourself (single moves, bulk moves, conflicts), use Rahul's tab (People).
- **People:** open a second tab as a teammate. **Reset demo data.**

## Design decisions

Why it's built this way, the trade-offs and what I rejected: see [WRITEUP.md](WRITEUP.md).

## Tests

`npm test`: 101 unit tests for the sync engine (retries, idempotency, conflicts, offline, undo), server bulk jobs, priority rules, views and selection. The UI was checked by running the scenarios above in a browser.

## Architecture

- **The UI only draws.** React components read deals and call commands; they hold no sync logic.
- **`PipelineClient` is the sync engine** (plain TypeScript, outside React): confirmed deals, your unsaved changes, retries with idempotency keys, conflicts, live updates and bulk jobs. React subscribes to it, so a card re-renders only when its own deal changes.
- **The app only talks to the backend through `deal.api.ts`** (move, pushes, catch-up, bulk jobs). The fake server implements it today; a real API would replace one file.

Feature-based folders, imports go one way: `app → features → entities → shared`.

```
src/
  app/                  wiring: providers (one sync client per tab), router, layouts
  features/
    deals/              the Deals screen
      components/       board, table, job tray, panels
      hooks/            rows, selection, commands, shortcuts
      api/              pipelineClient (sync engine), bulkJobs (select-all jobs),
                        connection, outbox, conflicts, history (jobs, undo)
    simulator/          the control panel for the fake backend
  entities/deal/        deal types, priority, views/filters, and the API contract (deal.api.ts)
  shared/               UI kit and helpers (knows nothing about deals)
mock-server/            the fake backend (SharedWorker + IndexedDB). A real API would
                        implement deal.api.ts; only main.tsx would change.
```
