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
    const { initials, score, mode, timezone, playedAt } = request.data;

    // 3. Validate the data
    if (typeof score !== 'number' || !Number.isFinite(score) || !Number.isInteger(score) || score < 18) {
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
// BOT 1: THE LIVE SCORE TRACKER (Unchanged)
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
            // Grab the entire leaderboard
            const snapshot = await db.collection('globalLeaderboard').get();

            let lifetimeRounds = 0;
            let todayRounds = 0;

            // Figure out exactly when midnight was today
            const midnight = new Date();
            midnight.setHours(0, 0, 0, 0);

            // Crunch the numbers
            snapshot.forEach(doc => {
                lifetimeRounds++;

                // Read Google's hidden server timestamp of when the score was created
                const createTime = doc.createTime.toDate();
                if (createTime >= midnight) {
                    todayRounds++;
                }
            });

            // Calculate Holes (Assuming 18 per round)
            const lifetimeHoles = lifetimeRounds * 18;
            const todayHoles = todayRounds * 18;

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
                        { name: "♾️ Lifetime Holes", value: `**${lifetimeHoles}**`, inline: true }
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
