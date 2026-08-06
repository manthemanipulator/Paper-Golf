// submitScore was originally deployed as a 2nd-gen function — keep it on the
// v2 import explicitly. The Discord bots below were deployed as 1st-gen, so
// they stay on the v1 import. Mixing v1/v2 in one file is fine; redeploying
// an existing function under a *different* generation than it's already
// running as is what breaks ("Cannot set CPU on the functions X because they
// are GCF gen 1").
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const functionsV1 = require('firebase-functions/v1');
// firebase-admin v14 removed the old namespaced API (admin.firestore(),
// admin.database(), admin.firestore.FieldValue) — everything now comes from
// these modular imports instead.
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');
const fetch = require('node-fetch');

initializeApp();
const db = getFirestore();

const VALID_MODES = ['daily', 'random'];

// Mirrors the CURRENT_POLL object in script.js — kept in sync manually, same
// duplication tradeoff as countryCodeToFlag() below. Only `id` and each option's
// `id`/`label` are needed here (just enough to label the Discord tally); this
// doesn't need the question text or expiresAt.
const CURRENT_POLL = {
    id: 'clubs_2026_08',
    options: [
        { id: 'keep', label: '⛳ Keep it simple as-is' },
        { id: 'clubs', label: "🏌️ Yes, I'd try clubs" },
        { id: 'neutral', label: '🤷 No strong opinion either way' }
    ]
};

// Server-authoritative date helpers — never trust a raw date/monthYear string from
// the client, or anyone could submit a score into any day's or month's bucket they
// want. We DO accept a client-reported IANA timezone (e.g. "America/Los_Angeles") so
// "daily" resets at each player's own local midnight instead of one global UTC
// cutoff — that's a deliberate, lower-stakes trust call: a spoofed timezone can only
// shift which day-bucket a player's OWN score lands in (letting them replay the
// daily mode slightly more than once per real day), it can't forge a score value,
// touch another player's data, or affect the crown record.
function isValidTimeZone(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
        return true;
    } catch (e) {
        return false;
    }
}

function getServerDateString(timeZone, atDate) {
    // "YYYY-MM-DD", same shape as the client's toLocaleDateString('en-CA')
    return atDate.toLocaleDateString('en-CA', { timeZone });
}

function getServerMonthYearString(timeZone, atDate) {
    // "July 2026", same shape as the client's getMonthYearString()
    return atDate.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone });
}

function countryCodeToFlag(code) {
    // Same Unicode regional-indicator trick as the client's countryCodeToFlag() in
    // script.js — plain code-point math, no browser APIs needed, so it works
    // server-side too.
    // 'XX' passes the 2-letter check but isn't a real ISO region — it's the
    // client's own "couldn't figure it out" fallback — so give it its own
    // explicit case, same as the client-side countryCodeToFlag().
    if (code === 'XX' || !/^[A-Z]{2}$/.test(code)) return '🏳️';
    return code.replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

// Offline play support: a score queued while offline can sync days later, and it
// should land on the day it was actually PLAYED, not the day the request finally
// reached the server. We accept a client-reported `playedAt` timestamp for this —
// same category of trust as the timezone above, just extended to "when" as well as
// "which zone." Bounded so a spoofed timestamp can only reach so far: it can't be in
// the future, and can't reach back further than a generous offline-trip window.
const MAX_OFFLINE_BACKDATE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function resolvePlayedAtDate(playedAt) {
    if (typeof playedAt !== 'string') return new Date();
    const parsed = new Date(playedAt);
    if (isNaN(parsed.getTime())) return new Date();

    const now = Date.now();
    if (parsed.getTime() > now || parsed.getTime() < now - MAX_OFFLINE_BACKDATE_MS) {
        // Outside the trusted window (future-dated, or implausibly old) — ignore it
        // and just use the time the server actually received the request.
        return new Date();
    }
    return parsed;
}

// ==========================================
// SCORE SUBMISSION
// Validates and writes scores from the client, keyed to the caller's own
// verified auth UID. Also owns the all-time "random mode" crown update —
// clients are no longer allowed to write either of these directly.
// ==========================================
exports.submitScore = onCall(async (request) => {

    // 1. Check for the automatically verified Auth Token
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'You must be logged in to submit a score.');
    }

    // 2. Extract your payload from request.data (ignore the client's raw date/monthYear/uid
    //    — those are derived below from the server. `timezone` and `playedAt` are the
    //    exceptions: they're hints used to pick which local-midnight the date gets
    //    bucketed into, not trusted as the date itself — see resolvePlayedAtDate().)
    const { initials, score, mode, timezone, playedAt, country } = request.data;

    // 3. Validate the data
    // The literal ace-every-hole minimum is 18 (1 stroke × 18 holes), but that's
    // not a realistic bar for anti-cheat — it's just the absolute mathematical
    // floor, which is exactly how a spoofed "score: 18" API call slipped past this
    // check and onto the leaderboard. 54 (an implausibly lucky 3 strokes/hole) is
    // still well below the actual best score ever recorded (70), so it can't
    // reject any real round, while catching drive-by fake submissions instead.
    if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score) || score < 54) {
        throw new HttpsError('invalid-argument', 'Score is mathematically impossible.');
    }
    if (typeof initials !== 'string' || !/^[A-Za-z]{3}$/.test(initials)) {
        throw new HttpsError('invalid-argument', 'Initials must be exactly 3 letters.');
    }
    if (typeof mode !== 'string' || !VALID_MODES.includes(mode)) {
        throw new HttpsError('invalid-argument', 'Invalid game mode.');
    }

    const uid = request.auth.uid;
    const cleanInitials = initials.toUpperCase();
    // Fall back to UTC for anything malformed/missing rather than rejecting the
    // submission outright — worst case someone's daily just buckets by UTC that round.
    const safeTimeZone = isValidTimeZone(timezone) ? timezone : 'UTC';
    // Same low-stakes trust call as timezone above — this is just a self-guessed
    // country used to show a flag next to the player's initials, not anything
    // load-bearing. 'XX' (countryCodeToFlag's own "unknown" fallback) covers
    // anything malformed or missing instead of rejecting the whole submission.
    const safeCountry = (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) ? country : 'XX';
    const effectivePlayDate = resolvePlayedAtDate(playedAt);
    const date = mode === 'daily' ? getServerDateString(safeTimeZone, effectivePlayDate) : null;
    const monthYear = mode === 'random' ? getServerMonthYearString(safeTimeZone, effectivePlayDate) : null;

    const leaderboardRef = db.collection("globalLeaderboard");

    // 4. Keep only this player's best score per mode/bucket instead of piling up
    //    a new leaderboard row every time they submit.
    let existingQuery = leaderboardRef.where('uid', '==', uid).where('mode', '==', mode);
    existingQuery = mode === 'daily'
        ? existingQuery.where('date', '==', date)
        : existingQuery.where('monthYear', '==', monthYear);

    // 5. Write to the database securely. Wrapped in a transaction because the same
    //    player can legitimately submit from two devices near-simultaneously (e.g.
    //    finishing a round on a phone and a computer around the same moment) — a
    //    plain read-then-write here could let both submissions see "no existing
    //    doc" and both create one, leaving two rows for the same player/bucket
    //    instead of one. The transaction makes Firestore retry one of them if that
    //    happens, so only a single row ever exists.
    await db.runTransaction(async (transaction) => {
        const existingSnap = await transaction.get(existingQuery.limit(1));

        const payload = {
            uid,                    // Grabs the verified Auth ID
            initials: cleanInitials,
            score,
            mode,
            country: safeCountry,
            timestamp: FieldValue.serverTimestamp()
        };
        if (mode === 'daily') payload.date = date;
        if (mode === 'random') payload.monthYear = monthYear;

        if (!existingSnap.empty) {
            const existingDoc = existingSnap.docs[0];
            if (score < existingDoc.data().score) {
                // Lower score is better in golf — replace their old entry with the new best
                transaction.set(existingDoc.ref, payload);
            }
            // else: not an improvement, leave their existing entry alone
        } else {
            // .add() isn't usable inside a transaction (it generates its ref outside
            // the transaction's tracked read/write set) — create the ref explicitly.
            transaction.set(leaderboardRef.doc(), payload);
        }
    });

    // 6. Update the all-time "random mode" crown here, server-side, using the Admin SDK.
    //    The RTDB rules block clients from writing this path directly now.
    if (mode === 'random') {
        const crownRef = getDatabase().ref('paperGolf_stats/all_time_random_crown');
        const crownSnap = await crownRef.once('value');
        const currentCrown = crownSnap.val();
        if (!currentCrown || score < currentCrown.score) {
            await crownRef.set({ initials: cleanInitials, score, month: monthYear });
        }
    }

    return { success: true, message: "Score secured and verified." };
});


// ==========================================
// BOT 1: THE LIVE SCORE TRACKER
// ==========================================
exports.sendScoreToDiscord = functionsV1.firestore
    .document('globalLeaderboard/{docId}')
    .onWrite(async (change, context) => {
        // Fires on brand-new scores AND on personal-best overwrites — submitScore's
        // dedup logic only ever updates an existing doc when the new score actually
        // beats the old one, so every update here is a genuine improvement worth
        // announcing. Just skip deletions, since there's no score to post then.
        if (!change.after.exists) return;
        const newScore = change.after.data();
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

        const discordPayload = {
            embeds: [{
                title: "⛳️ New Score Submitted!",
                color: 3066993,
                fields: [
                    { name: "Player", value: `**${newScore.initials}**`, inline: true },
                    { name: "Score", value: `**${newScore.score}**`, inline: true },
                    // Only present on scores submitted after the leaderboard-flags
                    // feature shipped — countryCodeToFlag()'s own 'XX'/malformed
                    // fallback covers anything older with a generic white flag.
                    { name: "Country", value: countryCodeToFlag(newScore.country), inline: true },
                    { name: "Mode", value: newScore.mode === 'daily' ? "📅 Daily 18-Hole" : (newScore.mode === 'random' ? "🎲 Random 18-Hole" : "Casual"), inline: false }
                ],
                timestamp: new Date().toISOString(),
                footer: { text: "Paper Golf Live Tracker" }
            }]
        };

        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(discordPayload)
            });
        } catch (error) {
            console.error("Error sending live score:", error);
        }
    });


// ==========================================
// BOT 2: THE DAILY RECAP (Runs every day at 8:00 PM PT)
// ==========================================
exports.dailyRecapToDiscord = functionsV1.pubsub
    .schedule('every day 20:00') // 24-hour time format
    .timeZone('America/Los_Angeles') // Set to Pacific Time
    .onRun(async (context) => {
        const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

        try {
            // Pull real per-mode round counts straight from the same RTDB counters
            // the in-app "X rounds completed" display already reads (daily_stats /
            // lifetime_stats), instead of approximating "rounds played" from the
            // Firestore leaderboard collection. The old approach counted leaderboard
            // DOCUMENTS, but this app keeps only one document per player per bucket
            // (best score wins) — a document's createTime only reflects the FIRST
            // time a player ever got a personal best in that bucket. Every replay
            // after that either updates the existing doc (createTime doesn't change
            // on an update) or gets discarded outright if it's not an improvement,
            // so this was chronically undercounting real activity, sometimes badly.
            const todayPT = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
            // daily_holes uses its own established underscore-separated format
            // ("YYYY_MM_DD"), distinct from daily_stats' hyphenated one — matching
            // months of existing history plus external integrations (TRMNL, Home
            // Assistant) that already read that format directly. This function
            // adapts to it rather than the other way around.
            const todayPTUnderscored = todayPT.replace(/-/g, '_');
            const rtdb = getDatabase();

            const [todaySnap, lifetimeSnap, todayHolesSnap, lifetimeHolesSnap, countryHolesSnap, pollVotesSnap, pollVotesByCountrySnap] = await Promise.all([
                rtdb.ref(`daily_stats/${todayPT}`).once('value'),
                rtdb.ref('lifetime_stats').once('value'),
                rtdb.ref(`paperGolf_stats/daily_holes/${todayPTUnderscored}`).once('value'),
                rtdb.ref('paperGolf_stats/global_lifetime_holes').once('value'),
                rtdb.ref(`country_holes/${todayPTUnderscored}`).once('value'),
                rtdb.ref(`poll_votes/${CURRENT_POLL.id}`).once('value'),
                rtdb.ref(`poll_votes_by_country/${CURRENT_POLL.id}`).once('value')
            ]);

            // Both round-count nodes have one child per mode (casual/daily/random) —
            // sum across whichever modes exist rather than hardcoding mode names, so
            // this doesn't need updating if a new mode gets added later.
            const sumModeValues = (snapshot) => {
                let total = 0;
                snapshot.forEach(child => {
                    const val = child.val();
                    if (typeof val === 'number') total += val;
                });
                return total;
            };

            const todayRounds = sumModeValues(todaySnap);
            const lifetimeRounds = sumModeValues(lifetimeSnap);

            // Read the real hole counters instead of assuming every round finished
            // all 18 holes (rounds * 18) — that assumption breaks the moment anyone
            // quits mid-round or plays a partial round, and it was badly understating
            // real activity (591 actual holes vs. 180 assumed on 2026-07-17).
            const todayHoles = todayHolesSnap.val() || 0;
            const lifetimeHoles = lifetimeHolesSnap.val() || 0;

            // Holes-by-country breakdown — keyed by holes rather than rounds, same
            // reasoning as daily_holes above: someone playing a bunch of casual
            // holes without ever finishing a full round still shows up here, where
            // they'd be invisible in a rounds-based breakdown. Capped to the top 8
            // so this can't blow past Discord's embed field length limit on a day
            // with a lot of countries represented.
            const countryEntries = [];
            countryHolesSnap.forEach(child => {
                const val = child.val();
                if (typeof val === 'number' && val > 0) {
                    countryEntries.push([child.key, val]);
                }
            });
            countryEntries.sort((a, b) => b[1] - a[1]);
            const countryBreakdownText = countryEntries.length > 0
                ? countryEntries.slice(0, 8)
                    .map(([code, holes]) => `${countryCodeToFlag(code)} ${code === 'XX' ? 'Unknown' : code}: **${holes}**`)
                    .join('\n')
                : '_No holes played yet today_';

            // Current community poll tally, if any votes exist yet. Reads whatever
            // CURRENT_POLL points at above — bump that id here (and in script.js)
            // together whenever a new poll goes out.
            const pollCounts = pollVotesSnap.val() || {};
            const pollTotal = CURRENT_POLL.options.reduce((sum, opt) => sum + (pollCounts[opt.id] || 0), 0);
            const pollBreakdownText = pollTotal > 0
                ? CURRENT_POLL.options
                    .map((opt) => {
                        const count = pollCounts[opt.id] || 0;
                        const pct = Math.round((count / pollTotal) * 100);
                        return `${opt.label}: **${count}** (${pct}%)`;
                    })
                    .join('\n')
                : '_No votes yet_';

            // Poll votes by country — summed across every option rather than
            // split per-option (that'd multiply the row count by 3 and risk
            // Discord's per-field length limit). Same top-8-by-count cap and
            // flag/code/count format as Holes By Country above, for the same
            // reason. No screen real estate to show this in-app, so the recap
            // is the only place voters-by-country shows up.
            const pollCountryTotals = {};
            pollVotesByCountrySnap.forEach(optionSnap => {
                optionSnap.forEach(countrySnap => {
                    const val = countrySnap.val();
                    if (typeof val === 'number' && val > 0) {
                        pollCountryTotals[countrySnap.key] = (pollCountryTotals[countrySnap.key] || 0) + val;
                    }
                });
            });
            const pollCountryEntries = Object.entries(pollCountryTotals).sort((a, b) => b[1] - a[1]);
            const pollCountryBreakdownText = pollCountryEntries.length > 0
                ? pollCountryEntries.slice(0, 8)
                    .map(([code, count]) => `${countryCodeToFlag(code)} ${code === 'XX' ? 'Unknown' : code}: **${count}**`)
                    .join('\n')
                : '_No votes yet_';

            // Build the Recap Card
            const discordPayload = {
                embeds: [{
                    title: "📊 Paper Golf Daily Recap",
                    description: "Another day on the links! Here are the updated stats:",
                    color: 15105570, // A nice sunset orange for the recap
                    fields: [
                        { name: "🏌️ Rounds Played Today", value: `**${todayRounds}**`, inline: true },
                        { name: "⛳️ Holes Played Today", value: `**${todayHoles}**`, inline: true },
                        { name: "​", value: "​", inline: false }, // Blank line spacer
                        { name: "🌎 Lifetime Rounds", value: `**${lifetimeRounds}**`, inline: true },
                        { name: "♾️ Lifetime Holes", value: `**${lifetimeHoles}**`, inline: true },
                        { name: "​", value: "​", inline: false }, // Blank line spacer
                        { name: "🗺️ Holes By Country Today", value: countryBreakdownText, inline: false },
                        { name: "​", value: "​", inline: false }, // Blank line spacer
                        { name: "📊 Community Poll So Far", value: pollBreakdownText, inline: false },
                        { name: "​", value: "​", inline: false }, // Blank line spacer
                        { name: "🗳️ Poll Votes By Country", value: pollCountryBreakdownText, inline: false }
                    ],
                    timestamp: new Date().toISOString(),
                    footer: { text: "Paper Golf Analytics" }
                }]
            };

            // Send it to Discord
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(discordPayload)
            });

        } catch (error) {
            console.error("Error sending daily recap:", error);
        }
    });
