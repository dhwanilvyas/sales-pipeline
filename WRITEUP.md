## What I built and why

One screen for a team of 20 sharing 50,000 deals.

| Built                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Views**: tabs that each show a list of deals. My deals and All deals by default, plus two examples, Follow up today and Gone quiet | People need different lists: Priya wants her own deals, a manager wants everyone's, and at quarter end someone wants "deals nobody touched in 90 days". A view makes that list one click away. Users would save their own views; that isn't built, so I pre-made two examples.                                                                                                                                       |
| **Board layout** by default                                                                                                          | A rep starts the day asking "where do my deals stand?" The board answers at a glance: 12 deals waiting for a demo but only 3 in Negotiation, so this week's job is pushing Proposals forward. It also matches how reps think, a deal moving left to right towards Won, and moving one is a drag or a key. The table is for when they need a list instead, e.g. sorting by value before a forecast call, export, etc. |
| **Priority order** in every view, with the reason on each card ("Overdue 12d")                                                       | *"I don't know which deals to work on today."* Overdue follow-ups come first, then due today, then closing this week.                                                                                                                                                                                                                                                                                                |
| **A save state on every card** (saving, retrying, waiting to send, not saved, conflict), with Retry                                    | *"It didn't save, and nobody told me."* If a save fails, the card says so and offers Retry.                                                                                                                                                                                                                                                                                                                          |
| **Teammates' changes:** on your own deals they apply at once, with a toast saying who did what ("Riya moved 40 of your deals to Lost"); on All deals the board waits for "Apply 12 changes" (`.`) | *"Deals keep jumping around."* Your own deals change occasionally and you need the truth; All deals changes constantly, so it waits for you. A card you're dragging is never moved under you. |
| **Select all → a server job**, with progress, Stop, Undo, Retry failed and Details; hand-picked moves up to 1,000                    | *"Move thousands of old deals to Lost."* The app sends one request ("all deals in this view → Lost") and the server does the work, so closing the tab doesn't stop it.                                                                                                                                                                                                                                               |
| **Keyboard for everything**; `?` lists the keys                                                                                      | *"I can't use a mouse for long."* E.g. `↓` to a deal, `x` to select, `7` to move it to Lost, `z` to undo.                                                                                                                                                                                                                                                                                                            |
| **Only visible cards are drawn**, and a card redraws only when its own deal changes                                                  | Smooth with 50,000 deals: even a 10,000-card column draws only the ~20 cards on screen.                                                                                                                                                                                                                                                                                           |

## Key decisions and what I rejected

| Decision | Rejected | Why |
|---|---|---|
| **Product** | | |
| Views as saved filters (each with its own sort) | One screen with ad-hoc filters | A rep checks the same few lists every day ("my follow-ups", "quarter cleanup"). With ad-hoc filters they'd rebuild them each morning; a view is one click. |
| Priority in fixed tiers, shown on each card | A weighted score | With tiers a rep can say why a deal is on top ("it's overdue"). A score like 0.73 can't be explained, so people stop trusting the order. |
| Confirm only for 100+ deals, Undo for everything | A confirm on every bulk move | Confirming a 3-deal move every time trains people to click "OK" blindly. Undo handles small slips; the confirm is kept for moves big enough to hurt. |
| **Teammates and conflicts** | | |
| Live updates on your own deals, batched on All deals | One rule for every view | Changes to your deals are occasional and user must be aware of it immediately; the shared view changes frequently and doesn't need user's attention immediately |
| Conflicts are never resolved for you | Last write wins, or merging | With last write wins, Rahul's "Won" can be silently replaced by Priya's older "Lost", and nobody finds out. That's the "it didn't save and nobody told me" problem in reverse. |
| Conflicts grouped by who did what | One row per deal | After a teammate's cleanup, 40 conflicts are really one decision ("keep Riya's Lost or my Proposal?"). One row per deal means 40 clicks. |
| One message per multi-deal action | A push per deal | A teammate moving 1,000 deals is one event. A push per deal sends 1,000 messages, and the user can only be told "1,000 things changed" instead of "Riya moved 1,000 deals to Lost". |
| **Bulk moves** | | |
| Select all sends a filter to a server job; hand-picked sends IDs, max 1,000 | The browser sending thousands of IDs in chunks | If the browser sends 50,000 IDs in chunks, closing the tab stops the move halfway. As one server job it finishes anyway, and nobody hand-picks more than 1,000 deals. |
| Edits allowed during bulk jobs | Locking deals while a job runs | Locking would block the whole team for as long as a 50k job runs. Instead the job skips any deal changed after it started, so nothing is overwritten and nobody waits. |
| **Network** | | |
| Offline is read-only; changes already made still go out | Queue everything offline (offline-first) | Offline you don't see teammates' changes, so on a shared pipeline anything you change is likely stale and would come back as conflicts. Most web CRMs don't allow offline edits either. |
| **Architecture** | | |
| Sync logic in my own small engine (`PipelineClient`), outside React | TanStack Query or Redux | Query caches fetch and refetch lists; they don't track what this needs per deal (an unsaved change, its retry key, a conflict). Outside React, only the changed card re-renders, and the logic is tested without a browser. |

## Failed saves

Every move shows on the card at once and is sent with **the stage you saw** and an **idempotency key**.

- **Network error:** retried automatically with the same key, so a lost reply never saves twice.
- **Server refuses a deal:** 3 automatic retries, then the card says **Not saved** with Retry and Discard.
- **Server unreachable** (3 failures in a row) **or offline:** new changes pause; anything already made is **kept and sent** when the connection is back.
- **Reload or closed tab:** unsent changes are listed on the next visit (Continue or Discard); nothing is re-sent without asking.

## Teammates' changes

- **Every change is pushed** to all open tabs. A deal only accepts a newer version, so a late update can't roll it back.
- **Your own deals** update live, with a toast saying who did what (and View for the details). **All deals** waits for Apply.
- **Same deal, two people:** my save carries the stage I saw. If Rahul moved it first, I get *Keep theirs / Apply mine*; nothing is overwritten. The same move by both isn't a conflict.
- **Bulk jobs** skip deals someone changed after the job started.

## With more time

- **Edit deals on the card:** value, close date or next step in one key, with the same conflict check as stage moves.
- **Customisable cards and board:** choose which fields a card shows, collapse columns like Won/Lost, compact mode, saved with the view.
- **Quick follow-up:** log a call and set the next step in one key, so a deal leaves Follow up today until it's due again.
- **A notification bell** with history ("Riya moved 1,000 of your deals to Lost, 2h ago") and settings for what to be told about.
- **Presence:** show who's viewing a deal ("Rahul is on Acme"), so conflicts are avoided instead of resolved.
- **A command palette** (`Cmd+K`) to jump to any deal, view or action from the keyboard.
