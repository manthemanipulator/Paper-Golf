# Pro Mode: Club Selection — Planning Doc

Status: **Not started.** Design-only for now — revisit when back from leave (mid-September).

## Why this exists

Player feedback (verbatim, from the in-app feedback form):

> To make the game feel more like real golf and reduce pure randomness, I propose adding different types of clubs using specific dice (e.g., Driver = 1–6, Iron = 1–4, Wedge = 1–3). This solves the issue of repeatedly rolling high numbers (5 or 6) when you are already near the hole. To prevent abuse, available clubs could be restricted by terrain or distance to the hole — allowing long shots from the tee, but requiring short-range dice (1–3) as you get closer.

Validated with a Community Poll (as of 2026.8.17, 83 votes): 54% "keep it simple as-is," 28% "yes, I'd try clubs," 18% no strong opinion. Not a mandate, but a real minority interested — enough to build for, not enough to change the core game.

## Where it lives

**Pro mode only.** Not Casual, not Daily, not Random.

Reasoning:
- Pro and Casual are already untracked (no leaderboard, no saved scores), so this sidesteps the biggest risk entirely: changing the core dice mechanic would break score comparability on Daily/Random leaderboards and force a reset. Scoping to Pro means zero leaderboard impact, full stop.
- Pairs naturally with Pro's existing identity (wind changes every stroke instead of once per hole) — harder conditions, but more tools to handle them. Closer to real golf than either Casual or Pro alone currently is.
- Fully opt-in. Players who voted "keep it simple" never have to see it.

**Explicitly out of scope for this pass:** bringing clubs to Daily/Random. That's a separate future decision, contingent on how Pro reception goes.

## Proposed mechanic (starting point, not final)

- **Driver:** 1–6 (long range)
- **Iron:** 1–4 (mid range)
- **Wedge:** 1–3 (short, precise)

Player picks a club before rolling; the roll is constrained to that club's range instead of the current flat die.

## Open design questions (need answers before/during build)

- **Exact dice ranges** — are Driver/Iron/Wedge (1–6 / 1–4 / 1–3) final, or do they need tuning after playtesting?
- **Terrain/distance restriction** — is this a hard restriction (can't select Driver once you're within X tiles of the hole) or a soft nudge (all clubs always available, but the UI recommends one)? Original feedback wanted hard restriction "to prevent abuse."
  - Distance-to-hole isn't currently computed anywhere in the code — player and hole positions are both known (grid-based, `COLS`/`ROWS`/`TILE_SIZE`), so this is a straightforward addition, just not something to assume already exists.
  - Terrain *is* already tracked (`TERRAIN` enum: ROUGH/FAIRWAY/SAND/WATER/TREE), so terrain-based restriction is cheaper to build than distance-based.
- **Interaction with existing lie bonus** — the game already shows a `LIE` bonus (e.g. "Tee (+1)"). Does club choice interact with that, replace it, or stack with it?
- **Interaction with Pro's per-stroke wind** — does club type change wind sensitivity (e.g. Driver more wind-affected than Wedge, like real golf), or is wind independent of club choice?
- **UI/UX** — how does club selection fit into the existing Roll / Re-roll / Putt flow? A button group above Roll? Does it replace the current "Choose your shot type to start!" prompt or sit alongside it?
- **Does club choice persist across re-rolls**, or can the club be changed on a re-roll?
- **Does Putt involve club choice at all**, or does it stay a separate action like it is today?
- **Mulligans** — any interaction, or fully unaffected?
- **Any new achievements** tied to club usage, or skip that for v1?
- **Any passive stat tracking worth adding** (e.g. club-usage breakdown, purely for curiosity/Discord — same spirit as the existing country-holes breakdown), even though Pro itself stays unscored?

## Non-goals for this pass

- No changes to Casual, Daily, or Random scoring/mechanics.
- No leaderboard reset or dual-scoring-system work.
- No commitment yet to ever bringing this to tracked modes — that's a "see how Pro goes" decision, not a "assume we will" decision.

## Rough build phases (once resumed)

1. Finalize exact rules/numbers above (design decisions, not code).
2. Core mechanic — club state + dice-range swap, gated to `currentMode === 'pro'` only.
3. Club-selection UI, fit into existing input flow.
4. Terrain/distance restriction logic (if going with hard restriction).
5. Playtesting and balance iteration — likely the longest phase, needs real rounds played, not just code review.
6. Version bump, What's New modal, release notes, itch.io zip, ship.

## Notes / ideas to add over time

_(Add anything here as it comes to mind — doesn't need to be organized, just captured.)_
