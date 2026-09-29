# Paper Golf — What's New

It's been a while since this page was updated, so here's everything that's changed since the last itch.io build. Short version: it's faster, fairer, more social, more secure, and a lot harder to break.

## 🛡️ Leaderboard Security

- Shipped a round of behind-the-scenes fixes to keep the leaderboards fair and accurate for everyone.
- Added a visual indicator on the Submit Score button when you're offline, so it's clear your score is saved and just waiting to sync — not lost.
- **Daily and Random scoring is temporarily paused** while we build stronger anti-cheat protection — both modes are unavailable in the mode picker for now. Casual and Pro are completely unaffected and remain fully playable. We'll turn scoring back on as soon as the next round of protections is ready.

## 🎯 Quality of Life

- The mode picker now remembers what you last played — Casual, Daily, Random, or Pro — so you don't have to reselect it every time you open the app.
- The community pulse popup that shows on launch now clears the screen a lot faster, so it's out of your way sooner.

## 📊 Community Poll

- There's now a Community Poll right in the menu — no Discord required. Vote once per device and see live results update in real time, including a quick breakdown of who's voting from where.
- First question up: should the game stay as simple as it is, or would you want a bigger change like club types (Driver, Iron, Wedge) for more control over shot distance? Voting has since closed — thanks to everyone who weighed in. Based on the results, club types are in the works for **Pro Mode** specifically; Casual, Daily, and Random stay exactly as they are.
- New poll now open: we're exploring building a native app for iOS and Android — let us know if you'd be interested, and what you play on.

## 🔴 New Mode: Pro

- Pro plays like Casual — one hole at a time, no leaderboard, no pressure — but the wind shifts on every single stroke instead of once per hole. Find it in the mode dropdown, marked in red.
- Casual got calmer to make room for Pro: wind now only changes once per hole for a more relaxed round.

## 📤 Share Your Daily Score

- Finish today's Daily round and share a Wordle-style result card with friends — your final score plus a hole-by-hole emoji shape of the round. No spoilers, just enough to brag or compare notes.

## 🌍 Country Flags

- Leaderboard entries and the live Discord score feed now show a flag next to each player, based on a rough guess from your device's regional settings.

## ☁️ Cloud Sync & Secure Leaderboards

- Scores are now verified by a secure server before they ever hit the leaderboard — no more client-side tampering.
- Sign in with Google to permanently protect your stats and play seamlessly across your phone, tablet, and computer.
- The leaderboard now keeps your single best score per day (Daily mode) or per month (Random mode), so it stays clean instead of piling up duplicate entries.
- The All-Time Random Record is now locked down server-side — it can only be set by an actual verified round, no exceptions.

## 📅 Daily Mode Fixes

- Daily now resets at *your* local midnight instead of a single global cutoff — so "today's" board actually means today, wherever you are.
- Fixed a bug where some scores would silently post under the wrong day.

## 📱 Offline Play, Actually Reliable

- Play anywhere — flights, road trips, out of signal range — and your round gets queued locally.
- Offline rounds now sync automatically once you're back online, and they post under the day you actually played, not the day your connection came back.
- Fixed a data-loss bug where a shaky or "fake-online" connection (think hotel wifi with no real internet) could cause a completed round to just vanish instead of queueing for retry.

## 🐛 Bug Fixes

- Tightened up leaderboard score validation to keep things fair for everyone.
- Fixed a crash that could stop achievements from unlocking properly after finishing a round.
- Fixed the leaderboard occasionally showing stale data after repeated opens.
- Fixed the app sometimes serving an outdated version of itself after an update — it should now always load the newest build on your next visit instead of needing a second reload.

## ✨ Also Included

- Dark mode that automatically matches your system theme.
- A redesigned Top 10 leaderboard with a sticky personal rank banner, so you always know where you stand.
- Invisible bot protection running in the background to keep the leaderboard fair for everyone.

Thanks for playing — if you run into anything weird, the feedback form and Discord link are both in the in-game menu (☰ → Roadmap / Feedback).
