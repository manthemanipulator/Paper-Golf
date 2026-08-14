function getMonthYearString() {
    const d = new Date();
    // Force: "July 2026" (matches your screenshot text)
    // Local time on purpose — the server now buckets each score's monthYear using
    // the timezone the client reports (see getUserTimeZone()), so the client's own
    // "what month is it right now for me" needs to match that same local clock.
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function getUTCDateString() {
    // "YYYY-MM-DD" in the browser's local timezone. Named for its earlier UTC-only
    // version, but now local on purpose — see getMonthYearString() above for why.
    // The server buckets each score's `date` using the timezone reported via
    // getUserTimeZone(), so the client needs to match that same local clock too.
    return new Date().toLocaleDateString('en-CA');
}

function getUserTimeZone() {
    // IANA zone name, e.g. "America/Los_Angeles" — sent with every score so the
    // Cloud Function can bucket "today"/"this month" by the player's actual local
    // midnight instead of a single global UTC cutoff. The server treats this as a
    // hint, not a trusted fact — see functions/index.js for the fallback/validation.
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
        return 'UTC';
    }
}

function guessPlayerCountry() {
    // A rough, self-reported guess for the "players online by country" popup —
    // purely cosmetic/fun, so there's no need for real IP-based geolocation (which
    // would require a new Cloud Function). Intl.Locale's maximize() fills in a
    // likely region even when the browser's language tag doesn't include one (e.g.
    // "en" -> "en-Latn-US"). Won't be perfectly accurate for VPNs or a browser
    // language set differently than the player's actual country, same tradeoff
    // already accepted for timezone-based date bucketing elsewhere in this file.
    try {
        const locale = new Intl.Locale(navigator.language || 'en-US').maximize();
        return (locale.region || 'XX').toUpperCase();
    } catch (e) {
        return 'XX';
    }
}

function countryCodeToFlag(code) {
    // Each letter of a 2-letter ISO country code maps to a Unicode "regional
    // indicator symbol" — combining the two renders as that country's flag emoji,
    // no emoji library needed. Anything that isn't a clean 2-letter code (our own
    // 'XX' fallback, or anything malformed) just shows a generic flag instead of
    // rendering garbage.
    // 'XX' technically passes the 2-letter check below but isn't a real ISO
    // region — it's our own "couldn't figure it out" fallback — so it needs its
    // own explicit case here or it'd render as undefined/tofu flag glyphs
    // instead of the intended generic white flag.
    if (code === 'XX' || !/^[A-Z]{2}$/.test(code)) return '🏳️';
    return code.replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

function initializeTheme() {
    // Theme now always mirrors the device's own dark/light setting, live — no more
    // sticky manual override that silently outlives whatever the system is doing.
    // Clear out any old stored preference from before this change so it doesn't
    // keep overriding things for people who already toggled it once.
    localStorage.removeItem('paperGolf_theme');

    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(darkModeQuery.matches ? 'dark' : 'light');

    // Follow it live — e.g. when the device flips into dark mode at sunset —
    // instead of only checking once when the page first loads.
    darkModeQuery.addEventListener('change', (e) => {
        applyTheme(e.matches ? 'dark' : 'light');
    });
}

function toggleTheme() {
    // A tap here still flips the theme right away for a quick look, but it's
    // intentionally not saved anywhere — the device's own setting takes back over
    // the next time it changes, or the next time the app is reloaded.
    const currentTheme = document.documentElement.getAttribute('data-theme');
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
}

initializeTheme();

let currentMode = 'casual'; 
let ballZOffset = 0; 
let currentWeather = { windX: 1, windY: 0 }; 
let totalCampaignScore = 0;
// Per-hole stroke counts for the current 18-hole round — only populated for
// Daily/Random (the campaign modes), reset every time a new round starts. This
// is what the Wordle-style share card is built from at the end of a Daily round.
let currentRoundHoleScores = [];
let dailySeed = 1;
let currentHole = 1, strokes = 0, mulligans = 6, currentRoll = 0, canShoot = false, isPutting = false, isHoleComplete = false, usedTeeOffReroll = false;
let currentBallPos = { x: 0, y: 0 }, holePos = { x: 0, y: 0 }, gridData = [], validTargets = [], clickableTargets = [], particles = [], trail = [], leaves = [];
let hitSandThisHole = false;
let leaderboardUnsubscribe = null;
let localStats = JSON.parse(localStorage.getItem('paperGolfStats')) || { bestScore: null, birdies: 0, eagles: 0, unlocked: [], lifetimeHoles: 0 };

// One-time migration: lifetime holes used to live in its own separate localStorage
// key, entirely outside this stats blob, which is why it was never included in
// cloud sync. Fold the old value in here so it starts riding along with
// everything else instead of being left behind.
if (localStats.lifetimeHoles === undefined) {
    localStats.lifetimeHoles = parseInt(localStorage.getItem('paperGolf_lifetimeHoles')) || 0;
}

const ACHIEVEMENTS = {
    'birdie': { icon: '🐤', title: 'First Birdie', desc: 'Finish a hole in 5 strokes or less.' },
    'eagle': { icon: '🦅', title: 'Eagle Eye', desc: 'Finish a hole in 4 strokes or less.' },
    'sand': { icon: '🏖️', title: 'The Sandman', desc: 'Save Par (6) or better after hitting sand.' },
    'ironman': { icon: '🏅', title: 'Ironman', desc: 'Complete a full 18-hole round.' },
    'purist': { icon: '✨', title: 'Purist', desc: 'Finish 18 holes with ZERO mulligans used.' }
};
const TILE_SIZE = 20, COLS = 15, ROWS = 20;
const TERRAIN = { ROUGH: 0, FAIRWAY: 1, SAND: 2, WATER: 3, TREE: 4 };
const COLORS = { [TERRAIN.ROUGH]: '#e9f5e9', [TERRAIN.FAIRWAY]: '#90ee90', [TERRAIN.SAND]: '#f5deb3', [TERRAIN.WATER]: '#4682b4', [TERRAIN.TREE]: '#228b22', dot: 'rgba(0, 0, 0, 0.15)' };

const modeSelect = document.getElementById('modeSelect');
const rollBtn = document.getElementById('rollBtn');
const puttBtn = document.getElementById('puttBtn');
const rerollBtn = document.getElementById('rerollBtn');
const diceResult = document.getElementById('diceResult');
const statusText = document.getElementById('statusText');
const canvas = document.getElementById('courseMap');
const ctx = canvas.getContext('2d');

function updateHUD() {
    const uiHole = document.getElementById('uiHole');
    const uiStrokes = document.getElementById('uiStrokes');
    const uiTotal = document.getElementById('uiTotal');

    if (uiStrokes) uiStrokes.textContent = `Strokes: ${strokes}`;

    // Casual and Pro are both untracked, single-hole-at-a-time free play — same
    // HUD treatment for both, just a different wind rule (see updateWeatherForStroke
    // call sites below).
    if (currentMode === 'casual' || currentMode === 'pro') {
        if (uiHole) uiHole.textContent = `Hole: ${currentHole}`;
        if (uiTotal) uiTotal.classList.add('hidden');
    } else {
        if (uiHole) uiHole.textContent = `Hole: ${currentHole}/18`;
        if (uiTotal) uiTotal.textContent = ` | Total: ${totalCampaignScore}`;
        if (uiTotal) uiTotal.classList.remove('hidden');
    }

    const scoresBtn = document.getElementById('viewScoresBtn');
    if (scoresBtn) {
        if (currentMode === 'casual' || currentMode === 'pro') {
            scoresBtn.style.opacity = '0.3';
            scoresBtn.style.cursor = 'default';
        } else {
            scoresBtn.style.opacity = '1';
            scoresBtn.style.cursor = 'pointer';
        }
    }
}

modeSelect.addEventListener('change', (e) => {
    currentMode = e.target.value;
    if (currentMode === 'casual') modeSelect.className = "mode-dropdown";
    else if (currentMode === 'random') modeSelect.className = "mode-dropdown random";
    else if (currentMode === 'daily') modeSelect.className = "mode-dropdown daily";
    else if (currentMode === 'pro') modeSelect.className = "mode-dropdown pro";
    // Remembered across visits so the mode picker doesn't reset to Casual
    // every time the page loads — restored below, right before the first
    // resetGame() call.
    localStorage.setItem('paperGolfLastMode', currentMode);
    resetGame();
});

// Restore whatever mode was last selected, instead of always starting on
// Casual. Applied directly (not through the change handler) so it doesn't
// re-write the localStorage value it just read, and so it runs once before
// the first resetGame() call on page load.
const savedMode = localStorage.getItem('paperGolfLastMode');
if (savedMode && ['casual', 'daily', 'random', 'pro'].includes(savedMode)) {
    currentMode = savedMode;
    modeSelect.value = savedMode;
    if (savedMode === 'casual') modeSelect.className = "mode-dropdown";
    else if (savedMode === 'random') modeSelect.className = "mode-dropdown random";
    else if (savedMode === 'daily') modeSelect.className = "mode-dropdown daily";
    else if (savedMode === 'pro') modeSelect.className = "mode-dropdown pro";
}

function resetGame() {
    currentHole = 1;
    totalCampaignScore = 0;
    currentRoundHoleScores = [];
    strokes = 0;
    mulligans = 6;
    isHoleComplete = false;
    
    document.getElementById('victoryOverlay').style.display = 'none';
    document.getElementById('leaderboardModal').style.display = 'none';
    
    generateCourse(); 
    updateHUD();
}

const firebaseConfig = {
    apiKey: "AIzaSyCpYT1A8wLcdpwxaThbVr3k-IdPvnPnHzw",
    authDomain: "auth.papergolf.app",
    projectId: "paper-golf-e8364",
    storageBucket: "paper-golf-e8364.firebasestorage.app",
    messagingSenderId: "601427965342",
    appId: "1:601427965342:web:e2d36957d6dcf2ebf3d28f",
    measurementId: "G-DZT902BEM3"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

// App Check: proves requests to Firestore/RTDB/Functions are coming from this
// real, deployed app rather than a script someone wrote against the exposed
// firebaseConfig above. Get a reCAPTCHA v3 site key from Firebase Console >
// App Check > Apps > (register this web app) > reCAPTCHA v3, then paste it below.
firebase.appCheck().activate(
    '6LdkDUstAAAAANxJu8CI8c8eODvhv1qaT2spnzEn',
    true // isTokenAutoRefreshEnabled
);

// activate() doesn't return a promise, so nothing was ever actually waiting for
// the first token before Auth/Firestore/RTDB calls fired immediately after it —
// and since Firestore/RTDB hold long-lived socket connections, a connection
// opened before a token exists doesn't retroactively pick one up once it's
// ready. That silently left most real sessions completely unverified in App
// Check's metrics. Force-fetch the first token here and gate the calls below on
// it. Bounded to 2s so a slow/blocked reCAPTCHA (ad blockers, etc.) can't leave
// the game itself unplayable — worst case that one session proceeds unverified,
// same as before this fix.
const appCheckReady = Promise.race([
    firebase.appCheck().getToken().then(() => {}).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000))
]);

const analytics = firebase.analytics();
const db = firebase.firestore();
const rtdb = firebase.database();
const sessionId = Math.random().toString(36).substring(2, 15);
const myUserRef = rtdb.ref('online_users/' + sessionId);
const connectedRef = rtdb.ref('.info/connected');

let playerUID = null;

// The RTDB socket can report "connected" before signInAnonymously() resolves,
// so writing presence data as soon as we connect used to race with auth —
// harmless when online_users was world-writable, but it now needs auth != null,
// so an early write loses the race and gets rejected. Only register presence
// once we're both connected AND signed in.
let rtdbConnected = false;
let isAuthed = false;

// Guessed once per page load — no need to recompute on every heartbeat.
const myCountryGuess = guessPlayerCountry();

function tryRegisterPresence() {
    if (rtdbConnected && isAuthed) {
        // Register the disconnect cleanup BEFORE writing presence. If these were
        // reversed (as they used to be) and the connection dropped in the gap
        // between the two calls, the cleanup would never get registered, leaving
        // a permanent ghost entry in online_users that nothing would ever remove.
        myUserRef.onDisconnect().remove();
        // ts (instead of a bare `true`/timestamp) lets the player-count display
        // below self-heal from ghost entries (crashed tabs, force-quits, flaky
        // mobile connections where onDisconnect never fires) by ignoring anything
        // that hasn't refreshed recently. country powers the "players by country"
        // popup — see guessPlayerCountry() for how it's derived.
        myUserRef.set({ ts: firebase.database.ServerValue.TIMESTAMP, country: myCountryGuess });
    }
}

// Keep a connected session's presence timestamp fresh so it doesn't get
// filtered out as "stale" by the count below just for staying open a while.
setInterval(() => {
    if (rtdbConnected && isAuthed) {
        myUserRef.set({ ts: firebase.database.ServerValue.TIMESTAMP, country: myCountryGuess });
    }
}, 60 * 1000);

// Same race applies to every other authenticated RTDB write scattered through
// this file (stat increments, offline-hole sync) — they were all firing
// immediately with no guarantee sign-in had actually completed yet. Anything
// that needs auth should do `authReady.then(() => { ... })` instead of writing
// straight away.
let authReadyResolve;
const authReady = new Promise((resolve) => { authReadyResolve = resolve; });

function updateSyncBadge(user) {
    const syncBadge = document.getElementById('syncStatusBadge');
    if (!syncBadge) return;
    if (user && !user.isAnonymous) {
        syncBadge.innerText = "Synced";
        syncBadge.style.background = "#2ecc71";
    } else {
        syncBadge.innerText = "Not Synced";
        syncBadge.style.background = "#ff3b30";
    }
}

let authRestoreChecked = false;

// Gated on appCheckReady — see the comment above where it's created.
appCheckReady.then(() => {
    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            playerUID = user.uid;
            isAuthed = true;
            tryRegisterPresence();
            authReadyResolve();
            console.log("Logged in securely! Player UID:", playerUID);
            updateSyncBadge(user);

            // Synced players get their personal stats/achievements pulled down from
            // the cloud on every sign-in (including a normal app reload with a
            // restored session) — see pullCloudStatsOnSignIn for why this replaces
            // rather than merges. Anonymous sessions stay purely local.
            if (!user.isAnonymous) {
                pullCloudStatsOnSignIn(user);
            }
        } else if (!authRestoreChecked) {
            // Only fall back to a fresh anonymous session on the very first check, and
            // only if there's truly no persisted session at all (first-ever visit, or
            // a genuinely signed-out browser). Calling signInAnonymously() unconditionally
            // on every load — the old approach — was overwriting an already-linked
            // Google account with a brand-new throwaway anonymous one on every single
            // reload, which is why "Sync Account" kept resetting back to "Not Synced".
            firebase.auth().signInAnonymously().catch((error) => {
                // This will pop up on your iPhone the second you open the app if it fails!
                alert("STARTUP AUTH FAILED: " + error.message);
            });
        } else {
            isAuthed = false;
        }
        authRestoreChecked = true;
    });
});

function promptAccountSync() {
    const user = firebase.auth().currentUser;
    if (!user) {
        alert("Waiting for server connection. Try again in a moment.");
        return;
    }
    if (!user.isAnonymous) {
        alert("Your account is already synced and protected in the cloud!");
        return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().currentUser.linkWithPopup(provider).then((result) => {
        console.log("Account successfully upgraded and linked!", result.user.email);
        // linkWithPopup upgrades the existing signed-in session in place — it doesn't
        // re-fire onAuthStateChanged, so the badge has to be updated here directly or
        // it'll keep showing "Not Synced" until the next full page load.
        updateSyncBadge(result.user);

        // One-time reconciliation: this Google account might already have cloud
        // stats from a previous device, and this device might have local progress
        // that's never been synced anywhere. Combine them instead of either side
        // silently overwriting the other, then push the merged result back up.
        // Guarded so this can only ever run ONCE per target account from this
        // device — without the guard, re-triggering this flow (which used to
        // happen on every reload before the anonymous-session-persistence bug was
        // fixed) would re-sum birdies/eagles/holes every single time, compounding
        // them well past anything that actually happened in-game.
        performOneTimeStatsMerge(result.user.uid, () => {
            alert("Success! Your progress is now permanently synced to your Google Account.");
        });
    }).catch((error) => {
        console.error("Error linking account:", error);
        if (error.code === 'auth/credential-already-in-use') {
            // This browser session is a fresh anonymous identity, but the Google
            // account picked is already linked to a DIFFERENT (their real) profile —
            // linking can't merge two accounts together. The fix is to abandon this
            // throwaway anonymous session and sign straight into the one that's
            // already linked, which Firebase hands back to us as error.credential.
            const existingCredential = error.credential;
            if (existingCredential && confirm("This Google account is already linked to your other Paper Golf profile. Sign in to that one now? (Any unsynced progress in THIS browser session will be lost.)")) {
                firebase.auth().signInWithCredential(existingCredential).then((signInResult) => {
                    console.log("Switched to existing linked account:", signInResult.user.email);
                    updateSyncBadge(signInResult.user);
                    // Same one-time (guarded) reconciliation as a fresh link.
                    performOneTimeStatsMerge(signInResult.user.uid, () => {
                        alert("You're back in! Your synced progress has been restored.");
                        showLeaderboard();
                    });
                }).catch((signInError) => {
                    console.error("Failed to sign in with existing credential:", signInError);
                    alert("Couldn't switch accounts: " + signInError.message);
                });
            }
        } else {
            alert("Failed to sync account: " + error.message);
        }
    });
}

function performOneTimeStatsMerge(uid, onDone) {
    const mergeGuardKey = `paperGolf_statsMerged_${uid}`;
    if (localStorage.getItem(mergeGuardKey) === 'true') {
        // Already reconciled this device into this account before — do a plain
        // pull instead of merging again, so repeated link/recovery attempts (e.g.
        // retrying after a popup gets closed) can't keep re-summing the same
        // progress on top of itself.
        pullCloudStatsOnSignIn({ uid });
        onDone();
        return;
    }

    playerStatsRef(uid).get().then((doc) => {
        if (doc.exists) {
            mergeStatsOnAccountSwitch(doc.data());
        }
        pushStatsToCloud();
        localStorage.setItem(mergeGuardKey, 'true');
        onDone();
    });
}

const allUsersRef = rtdb.ref('online_users');

// Same gating as the auth listener above — these open the RTDB socket, so they
// need to wait for the first App Check token too.
appCheckReady.then(() => {
    connectedRef.on('value', (snap) => {
        rtdbConnected = snap.val() === true;
        tryRegisterPresence();
    });

    allUsersRef.on('value', (snap) => {
        // Count only entries refreshed recently. A raw numChildren() would count
        // every ghost entry ever left behind by a crashed tab or a connection
        // that dropped before onDisconnect could register — those would just
        // accumulate forever with nothing to remove them, permanently inflating
        // this number.
        const PRESENCE_STALE_MS = 3 * 60 * 1000; // 3 minutes
        const now = Date.now();
        let count = 0;
        const countryTally = {};
        snap.forEach(child => {
            const val = child.val();
            const ts = val && typeof val === 'object' ? val.ts : val; // old-format ghosts may just be a bare number/true
            if (typeof ts === 'number' && (now - ts) < PRESENCE_STALE_MS) {
                count++;
                const country = (val && typeof val === 'object' && val.country) || 'XX';
                countryTally[country] = (countryTally[country] || 0) + 1;
            }
        });
        const countDisplay = document.getElementById('playerCount');
        if (countDisplay) {
            countDisplay.innerText = `👤 ${count}`;
            countDisplay.style.opacity = '0.5';
            setTimeout(() => countDisplay.style.opacity = '1', 150);
        }
        renderCountryBreakdown(countryTally);
    });
});
db.enablePersistence().catch((err) => console.log("Offline mode failed: ", err.code));

function playerStatsRef(uid) {
    // Matches the existing "users/{userId}" Firestore rule already set up for
    // per-player career stats — no separate collection or new rule needed.
    return db.collection('users').doc(uid);
}

function saveStats() {
    localStorage.setItem('paperGolfStats', JSON.stringify(localStats));
    // NOTE: this intentionally no longer pushes the whole object to the cloud.
    // Doing that from here meant every stat change re-uploaded this device's
    // ENTIRE in-memory snapshot as a blanket overwrite — including whatever
    // fields hadn't actually changed. If a second device (e.g. a phone) pushed
    // newer progress in the meantime, a stale tab on a first device (e.g. a
    // computer left open) writing again would silently clobber it, since it had
    // no idea anything had changed elsewhere. Each stat now pushes its own atomic
    // delta at the moment it changes instead — see pushStatDeltas,
    // pushBestScoreIfBetter, incrementLocalHoles, and unlockAchievement — so two
    // devices updating different things (or even the same counter) at the same
    // time can never overwrite each other's progress.
}

function pushStatDeltas(fieldUpdates) {
    const user = firebase.auth().currentUser;
    // Only signed-in (non-anonymous) players get cloud-synced stats — an anonymous
    // uid is throwaway and can't be signed back into on another device, so there's
    // nothing useful to sync it to.
    if (!user || user.isAnonymous) return;

    // fieldUpdates should use FieldValue.increment()/arrayUnion() sentinels, not
    // plain numbers/arrays — that's what makes this safe against two devices
    // writing at the same time (the server applies the delta, not a snapshot).
    playerStatsRef(user.uid).set(fieldUpdates, { merge: true })
        .catch((error) => console.error("Failed to push stat delta to cloud:", error));
}

function pushBestScoreIfBetter(newScore) {
    const user = firebase.auth().currentUser;
    if (!user || user.isAnonymous) return;

    // bestScore can't use a simple increment — "keep the lower number" needs an
    // actual read-then-write, done as a transaction so it checks the REAL current
    // cloud value at the moment it commits, not a value cached in memory from
    // whenever this device last loaded. That's what prevents a stale device from
    // overwriting a genuinely better score another device already saved.
    const ref = playerStatsRef(user.uid);
    db.runTransaction((transaction) => {
        return transaction.get(ref).then((doc) => {
            const cloudBest = doc.exists ? doc.data().bestScore : null;
            if (cloudBest == null || newScore < cloudBest) {
                transaction.set(ref, { bestScore: newScore }, { merge: true });
            }
            // else: the cloud already has an equal-or-better score from another
            // device — leave it alone rather than overwrite with a worse one.
        });
    }).catch((error) => console.error("Failed to sync best score:", error));
}

function pushStatsToCloud() {
    const user = firebase.auth().currentUser;
    // Only signed-in (non-anonymous) players get cloud-synced stats — an anonymous
    // uid is throwaway and can't be signed back into on another device, so there's
    // nothing useful to sync it to. This full-object push is intentionally only
    // used for the one-time seed/merge moments (first-ever sync, linking, account
    // recovery) where overwriting the whole doc is actually correct — NOT for
    // routine gameplay, where pushStatDeltas/pushBestScoreIfBetter are used instead.
    if (!user || user.isAnonymous) return;

    playerStatsRef(user.uid).set(localStats, { merge: true })
        .catch((error) => console.error("Failed to push stats to cloud:", error));
}

function adoptCloudStats(cloudStats) {
    localStats = {
        bestScore: cloudStats.bestScore ?? null,
        birdies: cloudStats.birdies || 0,
        eagles: cloudStats.eagles || 0,
        unlocked: cloudStats.unlocked || [],
        lifetimeHoles: cloudStats.lifetimeHoles || 0
    };
    localStorage.setItem('paperGolfStats', JSON.stringify(localStats));
    renderStats();
    loadLocalHoleStats();
}

function pullCloudStatsOnSignIn(user) {
    // Cloud is the source of truth for a normal returning session — replace
    // whatever's stored locally with what the cloud already has. This runs on
    // every sign-in (including a plain app reload with a restored session), so it
    // deliberately does NOT merge/sum here — doing so would keep re-adding a
    // device's stale local numbers on top of the cloud total every time the app
    // loads. Summing only ever happens once, at the moment of actually linking or
    // switching accounts (see mergeStatsOnAccountSwitch below).
    playerStatsRef(user.uid).get().then((doc) => {
        if (doc.exists) {
            adoptCloudStats(doc.data());
        } else {
            // Nothing in the cloud yet for this account — seed it with whatever's
            // sitting in local storage right now instead of waiting for the next
            // stat change to trigger the first push. This matters for anyone whose
            // account got linked before cloud sync existed at all: their real
            // numbers are just sitting on this device, unsynced, until now.
            pushStatsToCloud();
        }
    }).catch((error) => console.error("Failed to pull cloud stats:", error));
}

function mergeStatsOnAccountSwitch(cloudStats) {
    // Only used at the exact moment an anonymous session becomes (or switches to)
    // a permanent account — the one point where two genuinely independent
    // histories might both hold real, not-yet-synced progress. Never silently
    // discard either side: take the best/union of both instead.
    const localBest = localStats.bestScore;
    const cloudBest = cloudStats.bestScore ?? null;
    const bestScore = (localBest == null) ? cloudBest
        : (cloudBest == null) ? localBest
        : Math.min(localBest, cloudBest);

    const unlockedSet = new Set([...(localStats.unlocked || []), ...(cloudStats.unlocked || [])]);

    localStats = {
        bestScore,
        birdies: (localStats.birdies || 0) + (cloudStats.birdies || 0),
        eagles: (localStats.eagles || 0) + (cloudStats.eagles || 0),
        unlocked: Array.from(unlockedSet),
        lifetimeHoles: (localStats.lifetimeHoles || 0) + (cloudStats.lifetimeHoles || 0)
    };
    localStorage.setItem('paperGolfStats', JSON.stringify(localStats));
    renderStats();
    loadLocalHoleStats();
}

function unlockAchievement(id) {
    if (localStats.unlocked.includes(id)) return;
    localStats.unlocked.push(id);
    saveStats();
    // arrayUnion is atomic and idempotent server-side — safe even if another
    // device unlocks a different achievement (or this same one) at the same time.
    pushStatDeltas({ unlocked: firebase.firestore.FieldValue.arrayUnion(id) });

    const ach = ACHIEVEMENTS[id];
    const toast = document.getElementById('achToast');
    if (!ach || !toast) return;

    toast.innerHTML = `
        <span style="font-size: 24px;">${ach.icon}</span>
        <span>
            <div style="font-weight: bold; font-size: 14px;">Achievement Unlocked!</div>
            <div style="font-size: 13px; opacity: 0.85;">${ach.title}</div>
        </span>
    `;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function triggerVictorySequence() {
    // Queue this round's community-stat increment the same durable way offline
    // holes/scores already are, instead of writing directly to RTDB. A plain
    // in-memory write here would be lost for good if the app gets closed or the
    // phone locks before reconnecting — a real risk over something like a
    // multi-hour flight. Queueing to localStorage first means it survives the app
    // being fully closed and picks back up on the next load or reconnect.
    queueRoundForStatsSync(currentMode);

    if (!localStats.bestScore || totalCampaignScore < localStats.bestScore) localStats.bestScore = totalCampaignScore;
    saveStats();
    pushBestScoreIfBetter(totalCampaignScore);
    syncOfflineHolesToDatabase();
    unlockAchievement('ironman');
    if (mulligans === 6) unlockAchievement('purist');
    
    document.getElementById('modalTitle').textContent = currentMode === 'daily' ? "DAILY COMPLETE!" : "ROUND COMPLETE!";
    
    // Make sure the final score is visible when the victory screen pops up
    document.getElementById('finalScoreDisplay').style.display = 'block';
    document.getElementById('finalScoreDisplay').textContent = `Final Score: ${totalCampaignScore}`;
    
    document.getElementById('inputSection').classList.remove('hidden');
    document.getElementById('leaderboardSection').classList.add('hidden');
    document.getElementById('initialsInput').value = '';
    document.getElementById('leaderboardModal').style.display = 'flex';
    // Refresh this now, not just after submitting — otherwise it shows whatever
    // was left over from the last time the leaderboard was opened, possibly in a
    // completely different mode. See updatePlaysCountDisplay() for the full story.
    updatePlaysCountDisplay();

    // Share is Daily-only for now, and shown immediately — it's independent of
    // (not gated behind) submitting to the leaderboard, since plenty of players
    // never bother submitting but might still want to text a friend their score.
    // Buttons are inline-block by default, which is what lets the modal's
    // text-align:center actually center them (same trick Submit Score relies on,
    // untouched by JS). Switching this to 'block' instead of 'inline-block' was
    // exactly what knocked it out of that centering and pinned it to the left.
    const shareBtn = document.getElementById('shareScoreBtn');
    if (shareBtn) shareBtn.style.display = currentMode === 'daily' ? 'inline-block' : 'none';
}

// Maps a hole's stroke count to one of the same birdie/eagle-style terms already
// used elsewhere in the app, so the share grid feels consistent with in-game
// language instead of inventing new terminology just for this. This is a
// CATEGORY only, not a precise value — eagle covers anything from a hole-in-one
// up through 4 strokes, same range the achievement itself uses. Pairing this
// with the actual stroke number in buildDailyShareText() is what keeps the card
// from silently implying a slightly-wrong total if someone adds up the emoji.
function getHoleResultEmoji(strokes) {
    if (strokes <= 4) return '🦅'; // Eagle
    if (strokes === 5) return '🐦'; // Birdie
    if (strokes <= 7) return '⛳'; // Solid, on the green
    return '🐢'; // Took a while — deliberately light-hearted, not a "bad" marker
}

// Wordle-style share text: shows the SHAPE of the round (a category emoji plus
// the real stroke count for each hole) without giving away anything about the
// actual course itself — no hole layout, no hazard positions, no dice rolls.
// Everyone plays the same seeded course each day, so leaking any of that would
// be a real spoiler for friends who haven't played yet. The exact stroke count
// isn't a course spoiler though — it's just your own performance, same as the
// final score already shown in the clear — so including it keeps the card
// mathematically honest instead of only "vibes-based."
function buildDailyShareText() {
    const dateLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const grid = currentRoundHoleScores.map(strokes => `${getHoleResultEmoji(strokes)}${strokes}`).join(' ');
    // Blank line after every section, including the title — it was only a single
    // \n there while everything else got a full blank-line break, so the title
    // and score looked glued together while the rest had breathing room.
    return `⛳ Paper Golf — Daily (${dateLabel})\n\nScore: ${totalCampaignScore}\n\n${grid}\n\nPlay today's round: https://papergolf.app`;
}

document.getElementById('shareScoreBtn')?.addEventListener('click', async () => {
    const shareText = buildDailyShareText();

    // Web Share API gives the native share sheet (Messages, WhatsApp, etc.) on
    // supported browsers — mainly mobile Safari/Chrome. Desktop browsers without
    // it fall back to just copying the text, same end result either way.
    if (navigator.share) {
        try {
            await navigator.share({ text: shareText });
        } catch (err) {
            // AbortError just means the player closed the share sheet without
            // picking anything — not an actual failure, nothing to do.
            if (err.name !== 'AbortError') console.error('Share failed:', err);
        }
        return;
    }

    try {
        await navigator.clipboard.writeText(shareText);
        alert('Score copied! Paste it anywhere to share.');
    } catch (err) {
        console.error('Clipboard copy failed:', err);
        alert('Could not copy your score — please try again.');
    }
});

document.getElementById('submitScoreBtn')?.addEventListener('click', () => {
    const initials = document.getElementById('initialsInput').value.trim().toUpperCase();
    if (initials.length !== 3) { alert("Please enter exactly 3 initials."); return; }
    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('leaderboardSection').classList.remove('hidden');
    document.getElementById('leaderboardList').innerHTML = '<li>Uploading score...</li>';
    saveScoreToCloud(initials, totalCampaignScore);
});

function formatLargeNumber(num) {
    if (num > 9999999) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    return num.toLocaleString();
}

function triggerDailyPulseToast(dailyHoleCount) {
    const toast = document.getElementById('dailyPulseToast');
    document.getElementById('dailyPulseText').innerText = formatLargeNumber(dailyHoleCount);
    toast.style.display = 'block';
    // Kept at its original position over the nav bar (also has pointer-events:
    // none, so it never actually blocks clicks on the mode dropdown), but the
    // dwell time is cut way down — from ~3.8s to ~1.1s visible — since it's
    // just a passing notice and doesn't need to linger.
    setTimeout(() => { toast.style.top = '30px'; }, 100);
    setTimeout(() => {
        toast.style.top = '-100px';
        setTimeout(() => { toast.style.display = 'none'; }, 600);
    }, 1800);
}

function incrementLocalHoles() {
    localStats.lifetimeHoles = (localStats.lifetimeHoles || 0) + 1;
    saveStats(); // persists locally
    pushStatDeltas({ lifetimeHoles: firebase.firestore.FieldValue.increment(1) });
    document.getElementById('statLocalHoles').innerText = formatLargeNumber(localStats.lifetimeHoles);

    let unsynced = parseInt(localStorage.getItem('paperGolf_unsyncedHoles')) || 0;
    unsynced++;
    localStorage.setItem('paperGolf_unsyncedHoles', unsynced);
}

async function syncOfflineHolesToDatabase() {
    if (!navigator.onLine) return;
    let unsynced = parseInt(localStorage.getItem('paperGolf_unsyncedHoles')) || 0;
    if (unsynced === 0) return;

    await authReady;
    const todayStr = getTodayDateString();

    // Chunked so a large backlog (e.g. after weeks fully offline, which the
    // 30-day playedAt trust window explicitly allows for) can never push a
    // single write's delta over the RTDB validate rule's cap (5000) and get
    // silently rejected. Before this, a rejected write just logged to the
    // console and left the whole backlog untouched, so the next sync attempt
    // retried the exact same oversized amount and failed the same way forever
    // — a permanent, invisible dead end. Each chunk shrinks the saved backlog
    // immediately on success, so a failure partway through a big sync doesn't
    // lose progress that already made it through.
    const CHUNK_SIZE = 4000;
    while (unsynced > 0) {
        const chunk = Math.min(unsynced, CHUNK_SIZE);
        const bulkIncrement = firebase.database.ServerValue.increment(chunk);
        const updates = {};
        updates[`paperGolf_stats/daily_holes/${todayStr}`] = bulkIncrement;
        updates['paperGolf_stats/global_lifetime_holes'] = bulkIncrement;
        // Same country guess used for the "players online by country" popup —
        // powers a holes-by-country breakdown in the Discord recap. Keyed by
        // holes (not rounds), same reasoning as daily_holes above: someone who
        // plays a bunch of casual holes without ever finishing a full round
        // would never show up in a rounds-based breakdown.
        updates[`country_holes/${todayStr}/${myCountryGuess}`] = bulkIncrement;

        try {
            await firebase.database().ref().update(updates);
            unsynced -= chunk;
            localStorage.setItem('paperGolf_unsyncedHoles', unsynced);
        } catch (error) {
            console.error("Firebase Sync FAILED.", error);
            return; // Stop here — the remainder retries next time this runs.
        }
    }
    console.log("Successfully synced all offline holes.");
}

function queueRoundForStatsSync(mode) {
    const pending = JSON.parse(localStorage.getItem('paperGolf_pendingRoundStats')) || [];
    pending.push({ mode, today: getUTCDateString(), monthYear: getMonthYearString() });
    localStorage.setItem('paperGolf_pendingRoundStats', JSON.stringify(pending));
    syncPendingRoundStats();
}

async function syncPendingRoundStats() {
    if (!navigator.onLine) return;
    let pending = JSON.parse(localStorage.getItem('paperGolf_pendingRoundStats')) || [];
    if (pending.length === 0) return;

    await authReady;

    // Processed in batches for the same reason as syncOfflineHolesToDatabase
    // above — a large backlog could otherwise push a single path's delta over
    // the RTDB validate rule's cap (1000) and get stuck retrying the same
    // oversized write forever. Even in the worst case where every queued round
    // in a batch shares the same mode/day/month, a 500-entry batch stays safely
    // under that cap.
    const BATCH_SIZE = 500;
    while (pending.length > 0) {
        const batch = pending.slice(0, BATCH_SIZE);
        const counts = {};
        batch.forEach(({ mode, today, monthYear }) => {
            counts[`daily_stats/${today}/${mode}`] = (counts[`daily_stats/${today}/${mode}`] || 0) + 1;
            counts[`lifetime_stats/${mode}`] = (counts[`lifetime_stats/${mode}`] || 0) + 1;
            counts[`monthly_stats/${monthYear}/${mode}`] = (counts[`monthly_stats/${monthYear}/${mode}`] || 0) + 1;
        });

        const updates = {};
        Object.entries(counts).forEach(([path, count]) => {
            updates[path] = firebase.database.ServerValue.increment(count);
        });

        try {
            await firebase.database().ref().update(updates);
            pending = pending.slice(batch.length);
            localStorage.setItem('paperGolf_pendingRoundStats', JSON.stringify(pending));
        } catch (error) {
            console.error("Failed to sync pending round stats:", error);
            return; // Stop here — the remainder retries next time this runs.
        }
    }
    console.log("Synced all queued round(s) of community stats.");
}

function syncOfflineScoresToCloud() {
    if (!navigator.onLine) return;

    const offlineScores = JSON.parse(localStorage.getItem('paperGolf_offlineScores')) || [];
    if (offlineScores.length === 0) return;

    const submitScoreSecure = firebase.functions().httpsCallable('submitScore');
    // The Cloud Function owns the all-time crown update too — nothing left to do here on success.

    // Wait to see which submissions actually succeeded before touching the queue —
    // clearing it up front meant any score that failed mid-sync (dropped connection,
    // server rejection, etc.) was lost for good instead of being retried.
    Promise.allSettled(offlineScores.map((payload) => submitScoreSecure(payload)))
        .then((results) => {
            const stillPending = offlineScores.filter((_, i) => {
                if (results[i].status === 'fulfilled') return false; // synced, drop it

                // A genuine server rejection (bad score/initials/mode) will never
                // succeed no matter how many times we retry it — drop it rather than
                // let a corrupted entry sit in the queue forever. Anything else
                // (dropped connection, timeout, etc.) stays queued for next time.
                const err = results[i].reason;
                const serverActuallyRejectedIt = err && (err.code === 'functions/invalid-argument' || err.code === 'functions/unauthenticated');
                return !serverActuallyRejectedIt;
            });
            if (stillPending.length > 0) {
                console.error(`Failed to sync ${stillPending.length} offline score(s); will retry next time.`);
            }
            localStorage.setItem('paperGolf_offlineScores', JSON.stringify(stillPending));
        });
}

function loadLocalHoleStats() {
    document.getElementById('statLocalHoles').innerText = formatLargeNumber(localStats.lifetimeHoles || 0);
}

function saveScoreToCloud(initials, score) {
    const today = getUTCDateString();
    const monthYear = getMonthYearString();

    const payload = {
        initials: initials,
        score: score,
        mode: currentMode,
        date: currentMode === 'daily' ? today : null,
        monthYear: currentMode === 'random' ? monthYear : null,
        timezone: getUserTimeZone(),
        // Same self-guessed country used for the online player count and the
        // Discord holes-by-country breakdown — not verified, just a low-stakes
        // guess from the browser's own locale. Lets the leaderboard show a flag
        // next to initials without any new trust/verification machinery.
        country: myCountryGuess,
        // Captured now, at the moment the round actually finished — not when this
        // payload eventually reaches the server. That distinction matters for
        // offline play: if this sits in the queue for a few days before syncing,
        // the server uses this to bucket the score under the day it was actually
        // played, not the day the phone finally got signal back.
        playedAt: new Date().toISOString()
    };

    if (!navigator.onLine) {
        let offlineScores = JSON.parse(localStorage.getItem('paperGolf_offlineScores')) || [];
        offlineScores.push(payload);
        localStorage.setItem('paperGolf_offlineScores', JSON.stringify(offlineScores));
        document.getElementById('leaderboardList').innerHTML = `
            <li style="color: #e67e22; font-weight: bold; font-size: 16px;">📶 OFFLINE MODE</li>
            <li style="font-size: 14px; color: var(--text-color);">Score securely saved! It will upload later.</li>
        `;
        return;
    }

    // Small helper so both failure paths below can fall back to the same offline
    // queue that the `!navigator.onLine` branch above uses.
    const queueForLaterSync = () => {
        let offlineScores = JSON.parse(localStorage.getItem('paperGolf_offlineScores')) || [];
        offlineScores.push(payload);
        localStorage.setItem('paperGolf_offlineScores', JSON.stringify(offlineScores));
        document.getElementById('leaderboardList').innerHTML = `
            <li style="color: #e67e22; font-weight: bold; font-size: 16px;">📶 CONNECTION ISSUE</li>
            <li style="font-size: 14px; color: var(--text-color);">Score securely saved! It will upload later.</li>
        `;
    };

    // Fallback: Ensure the browser hasn't dropped the background session
    if (!firebase.auth().currentUser) {
        document.getElementById('leaderboardList').innerHTML = '<li>Re-establishing secure connection...</li>';
        firebase.auth().signInAnonymously()
            .then(() => saveScoreToCloud(initials, score))
            // Couldn't even re-authenticate — almost certainly a connectivity problem,
            // not a real auth issue. Don't lose the round over it.
            .catch(err => {
                console.error("Auth error while submitting:", err.message);
                queueForLaterSync();
            });
        return;
    }

    const submitScoreSecure = firebase.functions().httpsCallable('submitScore');

    submitScoreSecure(payload)
        .then((result) => {
            console.log(result.data.message);
            // The Cloud Function updates the all-time crown itself now, so just refresh the view.
            showLeaderboard();
        })
        .catch((error) => {
            console.error("Score submission failed:", error.code, error.message);

            // Only these two mean the server actually looked at the request and said
            // no — resubmitting the exact same payload won't change that, so surface
            // it. Everything else (unavailable, deadline-exceeded, internal, or the
            // request never reaching the server at all) is what you get from a flaky
            // or fake-looking connection — navigator.onLine reports "online" plenty
            // of times when there's no real path to the internet (boat wifi with no
            // uplink, a cell signal that's technically connected but too weak to
            // complete a request, etc). Queue it instead of throwing the round away.
            const serverActuallyRejectedIt = error.code === 'functions/invalid-argument' || error.code === 'functions/unauthenticated';

            if (serverActuallyRejectedIt) {
                document.getElementById('leaderboardList').innerHTML = `<li>Error: ${error.message}</li>`;
            } else {
                queueForLaterSync();
            }
        });
}

function toggleStats(show) {
    document.getElementById('statsOverlay').style.display = show ? "flex" : "none";
    if (show) renderStats();
}

function renderStats() {
    document.getElementById('statBest').innerText = localStats.bestScore || '--';
    document.getElementById('statBirdies').innerText = localStats.birdies;
    document.getElementById('statEagles').innerText = localStats.eagles;
    
    let html = '';
    for (const [id, ach] of Object.entries(ACHIEVEMENTS)) {
        const isUnlocked = localStats.unlocked.includes(id);
        html += `
        <div class="ach-item ${isUnlocked ? 'unlocked' : ''}">
            <div class="ach-icon">${isUnlocked ? ach.icon : '🔒'}</div>
            <div class="ach-text">
                <div class="ach-title">${isUnlocked ? ach.title : '???'}</div>
                <div class="ach-desc">${isUnlocked ? ach.desc : 'Keep playing to unlock.'}</div>
            </div>
        </div>`;
    }
    document.getElementById('achievementsList').innerHTML = html;
}

function resetCareerCounters() {
    // Scoped specifically to the fields a past sync bug could inflate (additive
    // merges on account linking/recovery) — bestScore and unlocked achievements
    // use min/union logic instead of addition, so they were never at risk and
    // are deliberately left untouched here.
    const confirmed = confirm(
        "This resets your Birdie count, Eagle count, and Lifetime Holes Played back to 0 — useful if a past sync issue left them looking too high. " +
        "Your Best Score and unlocked Achievements are NOT affected. This can't be undone. Continue?"
    );
    if (!confirmed) return;

    localStats.birdies = 0;
    localStats.eagles = 0;
    localStats.lifetimeHoles = 0;
    saveStats();
    loadLocalHoleStats();
    renderStats();

    const user = firebase.auth().currentUser;
    if (user && !user.isAnonymous) {
        playerStatsRef(user.uid).set({ birdies: 0, eagles: 0, lifetimeHoles: 0 }, { merge: true })
            .catch((error) => console.error("Failed to reset cloud counters:", error));
    }

    alert("Counters reset!");
}

function updatePlaysCountDisplay() {
    // Pulled out of showLeaderboard() so it can also run the moment the victory
    // screen opens for initials entry. That screen and the full leaderboard view
    // share this same #dailyPlaysCount element, but only showLeaderboard() used to
    // refresh it — so right after finishing a Daily round, the initials screen
    // would show whatever text was left over from the last time the leaderboard
    // was opened (e.g. still showing "rounds completed this month" from an earlier
    // look at Random mode) until you actually submitted your score. Calling this
    // right away instead keeps it in sync with whatever mode was actually just played.
    const playsCountDisplay = document.getElementById('dailyPlaysCount');
    const currentMonthYear = getMonthYearString();

    playsCountDisplay.innerHTML = 'Loading stats...';

    const datePicker = document.getElementById('historyDate');
    const targetDate = (currentMode === 'daily' && datePicker.value) ? datePicker.value : getUTCDateString();

    if (currentMode === 'daily') {
        const statsRef = firebase.database().ref(`daily_stats/${targetDate}/daily`);
        statsRef.once('value').then((snap) => {
            const plays = snap.val() || 0;
            playsCountDisplay.innerHTML = `⛳️ ${plays} rounds completed today`;
        }).catch((error) => {
            console.error("Firebase Read Error:", error);
            playsCountDisplay.innerHTML = `<span style="color: #ff3b30;">⚠️ Stats temporarily unavailable</span>`;
        });

    } else if (currentMode === 'random') {
        const crownRef = firebase.database().ref('paperGolf_stats/all_time_random_crown');
        const monthlyRef = firebase.database().ref(`monthly_stats/${currentMonthYear}/random`);

        Promise.all([crownRef.once('value'), monthlyRef.once('value')]).then(([crownSnap, monthlySnap]) => {
            const crown = crownSnap.val();
            const monthlyPlays = monthlySnap.val() || 0;

            let displayHTML = '';
            if (crown) {
                displayHTML += `<div style="margin-bottom: 6px;">👑 ALL-TIME RECORD: <span style="color:var(--accent-color);">${crown.initials} - ${crown.score}</span> 👑</div>`;
            }
            displayHTML += `<span style="font-size: 14px; color: #4cd964;">⛳️ ${monthlyPlays} rounds completed this month</span>`;

            playsCountDisplay.innerHTML = displayHTML;
        }).catch((error) => {
            console.error("Firebase Read Error:", error);
            playsCountDisplay.innerHTML = `<span style="color: #ff3b30;">⚠️ Stats temporarily unavailable</span>`;
        });

    } else {
        const lifetimeRef = firebase.database().ref(`lifetime_stats/${currentMode}`);
        lifetimeRef.once('value').then((snap) => {
            const plays = snap.val() || 0;
            playsCountDisplay.innerHTML = `⛳️ ${plays} lifetime rounds completed`;
        }).catch((error) => {
            console.error("Firebase Read Error:", error);
            playsCountDisplay.innerHTML = `<span style="color: #ff3b30;">⚠️ Stats temporarily unavailable</span>`;
        });
    }
}

function showLeaderboard() {
    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('leaderboardSection').classList.remove('hidden');
    
    // Hide the redundant score text when viewing the leaderboard
    document.getElementById('finalScoreDisplay').style.display = 'none';
    
    const list = document.getElementById('leaderboardList');
    const rankBanner = document.getElementById('userRankBanner');
    const currentMonthYear = getMonthYearString();

    // Needed for the daily-mode filter below. This used to be computed inline
    // here, but got left behind in updatePlaysCountDisplay() when that fetch
    // logic was pulled out — leaving this function referencing an undefined
    // targetDate and throwing every time the daily leaderboard tried to render.
    const datePicker = document.getElementById('historyDate');
    const targetDate = (currentMode === 'daily' && datePicker.value) ? datePicker.value : getUTCDateString();

    // Keep these header controls synced to the mode every time this renders — not
    // just when the trophy button is clicked. showLeaderboard() also runs right
    // after submitting a score, and without this, the picker/toggle would show
    // whatever leftover state a previous, different-mode visit to the leaderboard
    // left behind (same class of bug as the stale plays-count text).
    const rangeToggle = document.getElementById('randomRangeToggle');
    if (currentMode === 'daily') {
        datePicker.style.display = 'inline-block';
        rangeToggle.style.display = 'none';
    } else if (currentMode === 'random') {
        datePicker.style.display = 'none';
        rangeToggle.style.display = 'flex';
        updateRangeToggleStyles();
    } else {
        datePicker.style.display = 'none';
        rangeToggle.style.display = 'none';
    }

    list.innerHTML = '<li>Loading...</li>';
    rankBanner.classList.add('hidden');

    updatePlaysCountDisplay();

    // 2. BUILD THE DYNAMIC LEADERBOARD LIST
    // Tear down any previous listener first so repeated opens don't stack duplicate subscriptions
    if (leaderboardUnsubscribe) {
        leaderboardUnsubscribe();
        leaderboardUnsubscribe = null;
    }
    leaderboardUnsubscribe = db.collection("globalLeaderboard").orderBy("score", "asc").orderBy("timestamp", "asc").onSnapshot((querySnapshot) => {
        list.innerHTML = ''; 
        let count = 0;
        let myRank = null;
        let myBestThisContext = null; 
        let totalScoresInCategory = 0;
        
        querySnapshot.forEach((doc) => {
            const entry = doc.data();

            if (currentMode === 'daily' && (entry.mode !== 'daily' || entry.date !== targetDate)) return;
            if (currentMode === 'random') {
                if (entry.mode !== 'random' || entry.monthYear !== currentMonthYear) return;
                // The monthly bucket only ever holds ONE row per player (their best
                // for the month), and entry.timestamp is server-set to whenever that
                // best was actually achieved — not "now." That means Daily/Weekly here
                // aren't separate buckets, they're just a narrower slice of this same
                // monthly-deduped data, same idea as how Daily mode's own leaderboard
                // already works (one PB per player per day).
                if (randomLeaderboardRange === 'daily' && !isTimestampToday(entry.timestamp)) return;
                if (randomLeaderboardRange === 'weekly' && !isTimestampThisWeek(entry.timestamp)) return;
            }
            if (currentMode === 'casual' && entry.mode !== 'casual') return;

            totalScoresInCategory++;
            
            if (entry.uid === playerUID && !myRank) {
                myRank = totalScoresInCategory;
                myBestThisContext = entry.score;
            }
            
            if (count >= 10) return;
            count++;
            
            const li = document.createElement('li');

            // entry.country only exists on scores submitted after this feature
            // shipped — older entries fall through to countryCodeToFlag()'s own
            // 🏳️ fallback for anything that isn't a clean 2-letter code, so this
            // works fine without any backfill.
            const flag = countryCodeToFlag(entry.country);

           // Shrink each subsequent row slightly so the top-10 list fits without scrolling
            let opacity = 1 - ((count - 1) * 0.08);
            let fontSize = 18 - (count - 1);
            let padding = 10 - Math.floor((count - 1) * 0.5);
            let bottomMargin = count === 1 ? "6px" : "2px";

            li.style.opacity = opacity;
            li.style.fontSize = `${fontSize}px`;
            li.style.padding = `${padding}px`;
            li.style.marginBottom = bottomMargin;
            li.style.lineHeight = "1.2";

            if (count === 1) {
                // Trophy stays on the left; the right-hand trophy is replaced by
                // the player's flag instead of a second copy of the same emoji.
                li.innerHTML = `🏆 <b>${entry.initials} ..... ${entry.score}</b> ${flag}`;
                li.style.color = '#d35400';
                li.style.border = "2px solid #d35400";
                li.style.fontSize = "18px"; 
            } else {
                li.textContent = `#${count} - ${entry.initials} ..... ${entry.score} ${flag}`;
            }
            list.appendChild(li);
        });
        
        if (count === 0) list.innerHTML = '<li>No scores yet!</li>';
        
        // 3. POPULATE THE STICKY RANK BANNER
        if (currentMode !== 'casual' && currentMode !== 'pro') {
            if (myBestThisContext) {
                document.getElementById('userBestBannerScore').innerText = myBestThisContext;
                document.getElementById('userRankText').innerText = `#${myRank} / ${totalScoresInCategory}`;
            } else {
                document.getElementById('userBestBannerScore').innerText = '--';
                document.getElementById('userRankText').innerText = `Unranked`;
            }
            rankBanner.classList.remove('hidden');
        }
    });
}

// Which slice of the Random-mode monthly leaderboard to show: 'daily' (today only),
// 'weekly' (last 7 days), or 'monthly' (the full existing behavior — one PB per
// player per month). Remembered across visits since it's a display preference,
// same idea as other little "how do you like to view this" choices.
let randomLeaderboardRange = localStorage.getItem('randomLeaderboardRange') || 'monthly';

function isTimestampToday(ts) {
    // entry.timestamp is a Firestore Timestamp (server-set to whenever that score
    // actually became the player's personal best), not a plain Date — .toDate()
    // converts it. Compared against the browser's own local calendar day, same as
    // what the player sees on their own clock.
    if (!ts || typeof ts.toDate !== 'function') return false;
    const d = ts.toDate();
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isTimestampThisWeek(ts) {
    if (!ts || typeof ts.toDate !== 'function') return false;
    const d = ts.toDate();
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    return d >= startOfWeek && d <= now;
}

function getRandomLeaderboardTitle() {
    if (randomLeaderboardRange === 'daily') return "TODAY'S LEADERBOARD";
    if (randomLeaderboardRange === 'weekly') return "THIS WEEK'S LEADERBOARD";
    const currentMonth = new Date().toLocaleString('default', { month: 'long' });
    return `${currentMonth.toUpperCase()} LEADERBOARD`;
}

function updateRangeToggleStyles() {
    document.querySelectorAll('#randomRangeToggle .rangeBtn').forEach((btn) => {
        const active = btn.dataset.range === randomLeaderboardRange;
        btn.style.backgroundColor = active ? 'var(--accent-color)' : 'var(--input-bg)';
        btn.style.color = active ? '#ffffff' : 'var(--text-color)';
    });
}

function getTodayDateString() {
    // Underscore-separated "YYYY_MM_DD" (local time) — this is its own established
    // format for the daily_holes bucket, distinct from getUTCDateString()'s hyphenated
    // format used by daily_stats. Weeks of history already exist under this format,
    // and external integrations (TRMNL dashboard, Home Assistant) read it directly,
    // so this stays as-is — the Discord recap function is the one that adapts to
    // match this, not the other way around. See functions/index.js.
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}_${month}_${day}`;
}

function initializeCommunityStats() {
    const todayStr = getTodayDateString();
    firebase.database().ref(`paperGolf_stats/daily_holes/${todayStr}`).once('value').then((snapshot) => {
        let dailyCount = snapshot.val() || 0;
        if (dailyCount > 0) triggerDailyPulseToast(dailyCount);
    });

    const compactFormatter = new Intl.NumberFormat('en-US', { notation: "compact", maximumFractionDigits: 1 });
    firebase.database().ref('paperGolf_stats/global_lifetime_holes').on('value', (snapshot) => {
        let globalCount = snapshot.val() || 0;
        document.getElementById('statGlobalHoles').innerText = formatLargeNumber(globalCount);
        document.getElementById('global-holes').innerText = `🌎⛳️ ${compactFormatter.format(globalCount)}`;
    });

    firebase.database().ref('paperGolf_stats/all_time_random_crown').on('value', (snapshot) => {
        const crown = snapshot.val();
        const crownDisplay = document.getElementById('statAllTimeCrown');
        if (crownDisplay) {
            if (crown) {
                crownDisplay.innerHTML = `<span style="font-weight: bold; font-size: 22px;">${crown.score}</span> by <b>${crown.initials}</b><br><span style="font-size: 12px; color: #888;">(${crown.month})</span>`;
            } else {
                crownDisplay.innerText = "None yet!";
            }
        }
    });
}

loadLocalHoleStats();
initializeCommunityStats();

document.getElementById('historyDate')?.addEventListener('change', showLeaderboard);

document.getElementById('viewScoresBtn')?.addEventListener('click', () => {
    if (currentMode === 'casual' || currentMode === 'pro') return;
    document.getElementById('modalTitle').textContent = currentMode === 'daily' ? "DAILY LEADERBOARD" : "ALL-TIME TOP 5";

    if (currentMode === 'daily') {
        document.getElementById('historyDate').value = getUTCDateString();
    } else if (currentMode === 'random') {
        document.getElementById('modalTitle').textContent = getRandomLeaderboardTitle();
    }
    // Picker/toggle visibility itself is synced inside showLeaderboard() now,
    // so it stays correct no matter which path led there.

    document.getElementById('inputSection').classList.add('hidden');
    document.getElementById('leaderboardSection').classList.remove('hidden');
    document.getElementById('leaderboardModal').style.display = 'flex';
    showLeaderboard();
});

document.querySelectorAll('#randomRangeToggle .rangeBtn').forEach((btn) => {
    btn.addEventListener('click', () => {
        randomLeaderboardRange = btn.dataset.range;
        localStorage.setItem('randomLeaderboardRange', randomLeaderboardRange);
        document.getElementById('modalTitle').textContent = getRandomLeaderboardTitle();
        updateRangeToggleStyles();
        showLeaderboard();
    });
});

document.getElementById('playAgainBtn')?.addEventListener('click', resetGame);
document.getElementById('backToCasualBtn')?.addEventListener('click', () => {
    currentMode = 'casual';
    modeSelect.value = 'casual';
    modeSelect.className = "mode-dropdown";
    resetGame();
});

function getRand() {
    if (currentMode === 'daily') {
        let t = dailySeed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    return Math.random();
}

function getSeededShotRand(baseSeed, holeNum, strokeNum) {
    if (currentMode !== 'daily') return Math.random();
    let h = baseSeed + (holeNum * 1337) + (strokeNum * 73); 
    h = Math.imul(h ^ h >>> 15, h | 1);
    h ^= h + Math.imul(h ^ h >>> 7, h | 61);
    return ((h ^ h >>> 14) >>> 0) / 4294967296;
}

function updateWeatherForStroke() {
    let weatherRoll = getSeededShotRand(dailySeed, currentHole, strokes);
    let wX = 0;
    let wY = 0;

    if (weatherRoll > 0.20) { 
        let isHeavy = (weatherRoll * 10) % 1 > 0.60; 
        let strength = isHeavy ? 2 : 1;

        let dirRandX = (weatherRoll * 100) % 1;
        let dirRandY = (weatherRoll * 1000) % 1;

        wX = (Math.floor(dirRandX * 3) - 1) * strength;
        wY = (Math.floor(dirRandY * 3) - 1) * strength;

        if (wX === 0 && wY === 0) {
            wX = dirRandX > 0.5 ? 1 : -1;
        }
    }

    currentWeather = { windX: wX, windY: wY };
    
    leaves = [];
    if (currentWeather.windX !== 0 || currentWeather.windY !== 0) {
        let maxWind = Math.max(Math.abs(currentWeather.windX), Math.abs(currentWeather.windY));
        let numLeaves = maxWind === 2 ? 15 : 6; 
        for(let i=0; i<numLeaves; i++) {
            leaves.push({
                x: Math.random() * (COLS * TILE_SIZE),
                y: Math.random() * (ROWS * TILE_SIZE),
                speedX: (Math.random() * 1.5 + 0.5) * currentWeather.windX, 
                speedY: (Math.random() * 1.5 + 0.5) * currentWeather.windY, 
                wobble: Math.random() * Math.PI * 2
            });
        }
    }

    updateTacticalDashboard();
    renderScene(); 
}

function toggleRules(forceState) { 
    const overlay = document.getElementById('rulesOverlay');
    overlay.style.display = (typeof forceState === 'boolean') ? (forceState ? 'flex' : 'none') : (overlay.style.display === 'flex' ? 'none' : 'flex');
}

function toggleOffline(show) {
    document.getElementById('offlineOverlay').style.display = show ? "flex" : "none";
}

function updateRerollButton() {
    if (!canShoot || isPutting || isHoleComplete) { rerollBtn.disabled = true; rerollBtn.innerText = "Re-roll"; return; }
    if (strokes === 0 && !usedTeeOffReroll) { rerollBtn.disabled = false; rerollBtn.innerText = "Free Re-roll"; }
    else if (mulligans > 0) { rerollBtn.disabled = false; rerollBtn.innerText = `Mulligan (${mulligans})`; }
    else { rerollBtn.disabled = true; rerollBtn.innerText = "0 Mulligans"; }
}

function calculateValidTargets() {
    validTargets = [];
    clickableTargets = []; 
    if (!canShoot || isHoleComplete) return;

    let sx = Math.floor(currentBallPos.x / TILE_SIZE), sy = Math.floor(currentBallPos.y / TILE_SIZE);
    let startingTerrain = gridData[sy][sx];
    let eff = currentRoll;

    if (startingTerrain === TERRAIN.FAIRWAY) eff += 1;
    else if (startingTerrain === TERRAIN.SAND) eff = Math.max(1, currentRoll - 1);
    if (isPutting) eff = 1;

    statusText.style.color = isPutting ? '#ff9500' : '#5cb85c';
    let modText = isPutting ? "" : (startingTerrain === TERRAIN.FAIRWAY ? " (+1 Fairway)" : (startingTerrain === TERRAIN.SAND ? " (-1 Sand)" : ""));
    statusText.innerText = isPutting ? "Tap a glowing dot to putt." : `Required distance: ${eff}${modText}`;

    let compX = (currentRoll === 1 || isPutting) ? 0 : -currentWeather.windX; 
    let compY = (currentRoll === 1 || isPutting) ? 0 : -currentWeather.windY;

    const directions = [{dx: 1, dy: 0}, {dx: -1, dy: 0}, {dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 1}, {dx: -1, dy: -1}, {dx: 1, dy: -1}, {dx: -1, dy: 1}];
    
    for (let dir of directions) {
        let pathBlocked = false;
        for (let i = 1; i <= eff; i++) {
            let tx = sx + dir.dx * i, ty = sy + dir.dy * i;
            if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) { pathBlocked = true; break; }
            let terrain = gridData[ty][tx];
            if (i < eff && terrain === TERRAIN.TREE && startingTerrain !== TERRAIN.FAIRWAY) { pathBlocked = true; break; }
            if (i === eff && (terrain === TERRAIN.WATER || terrain === TERRAIN.TREE)) { pathBlocked = true; break; }
        }
        
        let baseX = sx + dir.dx * eff;
        let baseY = sy + dir.dy * eff;

        if (baseX >= 0 && baseX < COLS && baseY >= 0 && baseY < ROWS) {
            validTargets.push({x: baseX, y: baseY, blocked: pathBlocked});
            clickableTargets.push({x: baseX, y: baseY, blocked: pathBlocked});

            if (!pathBlocked) {
                let windFactorX = (eff === 1) ? 0 : currentWeather.windX;
                let windFactorY = (eff === 1) ? 0 : currentWeather.windY;
                
                let maxSteps = Math.max(Math.abs(windFactorX), Math.abs(windFactorY));
                if (maxSteps > 0) {
                    let stepX = windFactorX === 0 ? 0 : Math.sign(windFactorX);
                    let stepY = windFactorY === 0 ? 0 : Math.sign(windFactorY);
                    
                    for (let w = -maxSteps; w <= maxSteps; w++) {
                        if (w === 0) continue; 
                        let cx = baseX + (stepX * w);
                        let cy = baseY + (stepY * w);
                        if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
                            clickableTargets.push({x: cx, y: cy, blocked: false});
                        }
                    }
                }
            }
        }
    }

    let hasSafeMove = validTargets.some(t => !t.blocked);
    if (!hasSafeMove && !isHoleComplete) {
        if (strokes === 0) {
            statusText.style.color = '#ff9500';
            statusText.innerText = "Blocked off the tee! Roll again for free.";
            canShoot = false; rollBtn.disabled = false; puttBtn.disabled = false;
        } else {
            statusText.style.color = '#d9534f';
            statusText.innerText = "Blocked! Unplayable lie (+1 Stroke). Roll again.";
            strokes++; updateHUD();
            // Casual is the one mode that only re-rolls wind once per hole (at
            // generateCourse()) instead of after every stroke — everything else,
            // including the new Pro mode, keeps the original every-stroke behavior.
            if (currentMode !== 'casual') updateWeatherForStroke();
            canShoot = false; rollBtn.disabled = false; puttBtn.disabled = false;
            if (navigator.vibrate) navigator.vibrate([50, 100, 50]);
        }
    }
}

function renderScene() { 
    if (gridData.length === 0) return; 

    ctx.clearRect(0,0,canvas.width, canvas.height);
    for(let y=0; y<ROWS; y++) {
        for(let x=0; x<COLS; x++) {
            let tile = gridData[y][x];
            if(tile === TERRAIN.TREE) {
                ctx.fillStyle = COLORS[TERRAIN.ROUGH]; ctx.fillRect(x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = COLORS[TERRAIN.TREE]; ctx.beginPath(); ctx.moveTo(x*TILE_SIZE + TILE_SIZE/2, y*TILE_SIZE + 4); ctx.lineTo(x*TILE_SIZE + TILE_SIZE - 4, y*TILE_SIZE + TILE_SIZE - 4); ctx.lineTo(x*TILE_SIZE + 4, y*TILE_SIZE + TILE_SIZE - 4); ctx.fill();
            } else if (tile === TERRAIN.WATER) {
                ctx.fillStyle = COLORS[TERRAIN.WATER]; 
                ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

                let time = Date.now() / 800;
                let driftX = time * 10 * currentWeather.windX;
                let driftY = time * 10 * currentWeather.windY;

                let localOffset1 = x * 4 + y * 6;
                let localOffset2 = x * 4 + y * 6 + 10;
                let wrap = (val, max) => ((val % max) + max) % max;

                let rx1 = wrap(driftX + localOffset1, TILE_SIZE);
                let ry1 = wrap(driftY + localOffset1, TILE_SIZE);
                let rx2 = wrap(driftX + localOffset2, TILE_SIZE);
                let ry2 = wrap(driftY + localOffset2, TILE_SIZE);

                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; 
                ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(x * TILE_SIZE + rx1, y * TILE_SIZE + ry1, 3, 0, Math.PI); ctx.stroke();
                ctx.beginPath(); ctx.arc(x * TILE_SIZE + rx2, y * TILE_SIZE + ry2, 3, 0, Math.PI); ctx.stroke();
            } else {
                ctx.fillStyle = COLORS[tile]; ctx.fillRect(x*TILE_SIZE, y*TILE_SIZE, TILE_SIZE, TILE_SIZE); 
            }
        }
    }
    ctx.fillStyle = COLORS.dot;
    for(let y=0; y<ROWS; y++) for(let x=0; x<COLS; x++) { ctx.beginPath(); ctx.arc(x*TILE_SIZE + TILE_SIZE/2, y*TILE_SIZE + TILE_SIZE/2, 1.5, 0, Math.PI*2); ctx.fill(); }
    
    ctx.fillStyle = 'black'; ctx.beginPath(); ctx.arc(holePos.x, holePos.y, 7, 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(holePos.x, holePos.y); 
    ctx.lineTo(holePos.x, holePos.y - 18); 
    ctx.stroke();

    let flagDir = currentWeather.windX < 0 ? -1 : 1; 
    let windStrength = Math.abs(currentWeather.windX);
    let flagLength = 10 + (windStrength === 2 ? 8 : 0);
    
    ctx.fillStyle = '#ff3b30'; ctx.beginPath();
    ctx.moveTo(holePos.x, holePos.y - 18); 
    ctx.lineTo(holePos.x + (flagLength * flagDir), holePos.y - 13); 
    ctx.lineTo(holePos.x, holePos.y - 8); 
    ctx.fill();

    if (canShoot && validTargets.length > 0) {
        let baseRadius = 6; 
        let time = (Date.now() % 1500) / 1500; 
        let pulseRadius = baseRadius * time;   
        let pulseOpacity = 1 - time;            

        for (let t of validTargets) {
            let centerX = t.x * TILE_SIZE + TILE_SIZE / 2;
            let centerY = t.y * TILE_SIZE + TILE_SIZE / 2;
            let targetColor = t.blocked ? '#ff3b30' : '#ff9500'; 

            ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.stroke();
            ctx.strokeStyle = targetColor; ctx.lineWidth = 2.5; ctx.stroke();
            ctx.globalAlpha = pulseOpacity; ctx.beginPath(); ctx.arc(centerX, centerY, pulseRadius, 0, Math.PI * 2);
            ctx.fillStyle = targetColor; ctx.fill(); 
        }
        ctx.globalAlpha = 1.0;
    }

    if (trail.length > 0) {
        trail.forEach((pos, index) => {
            let scale = (index + 1) / trail.length; 
            ctx.globalAlpha = scale * 0.6; 
            ctx.fillStyle = '#007aff'; ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4.5 * scale, 0, Math.PI * 2); ctx.fill();
        });
        ctx.globalAlpha = 1.0; 
    }

    if (ballZOffset > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath();
        let shadowSize = Math.max(1, 5 - (ballZOffset * 0.15)); 
        ctx.ellipse(currentBallPos.x, currentBallPos.y + 2, shadowSize, shadowSize * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.beginPath(); 
    ctx.arc(currentBallPos.x, currentBallPos.y - ballZOffset, 5, 0, Math.PI*2); 
    ctx.fillStyle='white'; ctx.fill(); 
    ctx.strokeStyle=strokes===0?'black':'red'; ctx.lineWidth=2; ctx.stroke();

    if (currentWeather.windX !== 0 || currentWeather.windY !== 0) {
        ctx.fillStyle = '#228b22'; 
        for (let l of leaves) {
            l.wobble += 0.05;
            let wobbleOffset = Math.sin(l.wobble) * 1.5;
            ctx.fillRect(l.x + wobbleOffset, l.y + wobbleOffset, 3, 3); 
            l.x += l.speedX; l.y += l.speedY;
            if (l.speedX > 0 && l.x > COLS * TILE_SIZE) l.x = -5;
            if (l.speedX < 0 && l.x < 0) l.x = COLS * TILE_SIZE + 5;
            if (l.speedY > 0 && l.y > ROWS * TILE_SIZE) l.y = -5;
            if (l.speedY < 0 && l.y < 0) l.y = ROWS * TILE_SIZE + 5;
        }
    }
    drawParticles();
}

function updateTacticalDashboard() {
    let wx = currentWeather.windX;
    let wy = currentWeather.windY;
    let windStr = "CALM";
    
    if (wx !== 0 || wy !== 0) {
        let arrow = "";
        if (wy < 0 && wx === 0) arrow = "⬆️";
        else if (wy > 0 && wx === 0) arrow = "⬇️";
        else if (wy === 0 && wx > 0) arrow = "➡️";
        else if (wy === 0 && wx < 0) arrow = "⬅️";
        else if (wy < 0 && wx > 0) arrow = "↗️";
        else if (wy < 0 && wx < 0) arrow = "↖️";
        else if (wy > 0 && wx > 0) arrow = "↘️";
        else if (wy > 0 && wx < 0) arrow = "↙️";

        let speed = Math.max(Math.abs(wx), Math.abs(wy));
        windStr = `${arrow} ${speed}`;
    }
    document.getElementById('windValue').innerText = windStr;

    let sx = Math.floor(currentBallPos.x / TILE_SIZE);
    let sy = Math.floor(currentBallPos.y / TILE_SIZE);
    let terrain = gridData[sy] ? gridData[sy][sx] : TERRAIN.ROUGH;
    
    let badge = document.getElementById('lieBadge');
    let val = document.getElementById('lieValue');
    
    badge.classList.remove('lie-fairway', 'lie-sand', 'lie-rough');

    if (strokes === 0) {
        badge.classList.add('lie-fairway'); val.innerText = "Tee (+1)";
    } else if (terrain === TERRAIN.FAIRWAY) {
        badge.classList.add('lie-fairway'); val.innerText = "Fairway (+1)";
    } else if (terrain === TERRAIN.SAND) {
        badge.classList.add('lie-sand'); val.innerText = "Sand (-1)";
    } else {
        badge.classList.add('lie-rough'); val.innerText = "Rough (0)";
    }
}

rollBtn.addEventListener('click', () => {
    if (isHoleComplete) return;
    if (navigator.vibrate) navigator.vibrate(50);
    
    rollBtn.disabled = true; puttBtn.disabled = true; rerollBtn.disabled = true; 
    canShoot = false; validTargets = []; renderScene();

    let flashes = 0;
    let suspense = setInterval(() => {
        diceResult.innerText = Math.floor(Math.random() * 6) + 1; 
        flashes++;
        if (flashes > 10) { 
            clearInterval(suspense);
            currentRoll = Math.floor(Math.random() * 6) + 1; 
            diceResult.innerText = currentRoll; 
            canShoot = true; isPutting = false; 
            calculateValidTargets(); updateRerollButton(); renderScene(); idleLoop(); 
        }
    }, 50); 
});

puttBtn.addEventListener('click', () => {
    if (isHoleComplete) return;
    if (navigator.vibrate) navigator.vibrate(30);
    
    rollBtn.disabled = true; puttBtn.disabled = true; rerollBtn.disabled = true;
    currentRoll = 1; diceResult.innerText = 'P'; canShoot = true; isPutting = true; 
    calculateValidTargets(); updateRerollButton(); renderScene(); idleLoop(); 
});

rerollBtn.addEventListener('click', () => {
    if (strokes !== 0 && mulligans <= 0) return; 
    
    if (strokes === 0 && !usedTeeOffReroll) { usedTeeOffReroll = true; } 
    else { mulligans--; updateHUD(); }
    
    rerollBtn.disabled = true; canShoot = false; validTargets = []; renderScene();
    
    let flashes = 0;
    let suspense = setInterval(() => {
        diceResult.innerText = Math.floor(Math.random() * 6) + 1; 
        flashes++;
        if (flashes > 10) { 
            clearInterval(suspense);
            currentRoll = Math.floor(Math.random() * 6) + 1; 
            diceResult.innerText = currentRoll; canShoot = true; isPutting = false; 
            calculateValidTargets(); renderScene(); idleLoop(); 
        }
    }, 50);
});

// Desktop keyboard controls: Space rolls, and — since there's no separate reroll
// key — pressing Space again does whatever action is actually available next
// (a fresh roll, or a reroll if that's what's active), matching the buttons'
// own enabled/disabled state instead of a hardcoded mapping. Ctrl putts.
document.addEventListener('keydown', (e) => {
    // Don't hijack keys while focus is in a text field (initials entry, etc.),
    // and ignore the OS's key-repeat firing while a key is held down.
    const focusedTag = document.activeElement && document.activeElement.tagName;
    if (focusedTag === 'INPUT' || focusedTag === 'TEXTAREA') return;
    if (e.repeat) return;

    if (e.code === 'Space') {
        e.preventDefault(); // Space's default behavior scrolls the page.
        if (!rollBtn.disabled) {
            rollBtn.click();
        } else if (!rerollBtn.disabled) {
            rerollBtn.click();
        }
    } else if (e.key === 'Control') {
        if (!puttBtn.disabled) {
            puttBtn.click();
        }
    }
});

document.getElementById('nextHoleBtn')?.addEventListener('click', () => {
    currentHole++; strokes = 0; isHoleComplete = false;
    document.getElementById('victoryOverlay').style.display = 'none';
    generateCourse(); updateHUD();
});

function generateCourse() {
    if (currentMode === 'daily') {
        const d = new Date();
        dailySeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + (currentHole * 1000000);
    }

    updateWeatherForStroke();
    console.log(`Hole ${currentHole} Wind: X=${currentWeather.windX}, Y=${currentWeather.windY}`);

    gridData = Array.from({length: ROWS}, () => Array(COLS).fill(TERRAIN.ROUGH));
    let startGridX = Math.floor(COLS / 2) + Math.floor(getRand() * 5 - 2), startGridY = ROWS - 3;
    let holeGridX = Math.floor(COLS / 2) + Math.floor(getRand() * 9 - 4), holeGridY = 2;

    function drawFairwayBlob(cx, cy) {
        let blobs = Math.floor(getRand() * 2) + 1; 
        for(let b=0; b<blobs; b++) {
            let bx = cx + Math.floor(getRand() * 3 - 1), by = cy + Math.floor(getRand() * 3 - 1);
            let bw = Math.floor(getRand() * 2) + 2, bh = Math.floor(getRand() * 2) + 2; 
            for(let y=by; y<by+bh; y++) for(let x=bx; x<bx+bw; x++) if(y>=0 && y<ROWS && x>=0 && x<COLS) gridData[y][x] = TERRAIN.FAIRWAY;
        }
    }
    drawFairwayBlob(startGridX - 1, startGridY - 1); drawFairwayBlob(holeGridX - 1, holeGridY - 1);

    let numIslands = Math.floor(getRand() * 3) + 2; 
    for(let i = 1; i <= numIslands; i++) drawFairwayBlob(Math.floor(startGridX + i * ((holeGridX - startGridX) / (numIslands + 1)) + (getRand() * 6 - 3)), Math.floor(startGridY - i * ((startGridY - holeGridY) / (numIslands + 1))));

    for(let i = 0; i < 12; i++) {
        let type = getRand() > 0.5 ? TERRAIN.WATER : TERRAIN.SAND;
        let hx = Math.floor(getRand() * (COLS - 2)), hy = Math.floor(getRand() * (ROWS - 3));
        if (Math.max(Math.abs(hx - holeGridX), Math.abs(hy - holeGridY)) > 2 && Math.max(Math.abs(hx - startGridX), Math.abs(hy - startGridY)) > 2) {
            for(let fy=hy; fy<hy+2; fy++) for(let fx=hx; fx<hx+2; fx++) if(gridData[fy] && gridData[fy][fx] !== undefined) gridData[fy][fx] = type;
        }
    }

    for(let i = 0; i < 35; i++) {
        let tx = Math.floor(getRand() * COLS), ty = Math.floor(getRand() * ROWS);
        if (Math.abs(tx - startGridX) > 1 && Math.abs(ty - startGridY) > 1 && Math.abs(tx - holeGridX) > 1 && Math.abs(ty - holeGridY) > 1) {
            if(gridData[ty] && gridData[ty][tx] === TERRAIN.ROUGH) gridData[ty][tx] = TERRAIN.TREE;
        }
    }

    gridData[holeGridY][holeGridX] = TERRAIN.FAIRWAY; gridData[startGridY][startGridX] = TERRAIN.FAIRWAY;
    holePos = { x: holeGridX * TILE_SIZE + TILE_SIZE/2, y: holeGridY * TILE_SIZE + TILE_SIZE/2 };
    currentBallPos = { x: startGridX * TILE_SIZE + TILE_SIZE/2, y: startGridY * TILE_SIZE + TILE_SIZE/2 };

    canShoot=false; isPutting=false; rollBtn.disabled=false; puttBtn.disabled=false; currentRoll=0; diceResult.innerText='-';
    validTargets = []; statusText.style.color = '#d9534f'; statusText.innerText = "Choose your shot type to start!";
    usedTeeOffReroll=false; isHoleComplete=false; 
    hitSandThisHole = false;
    
    updateRerollButton(); renderScene(); updateTacticalDashboard(); idleLoop();
}

function createParticles(x, y, colorPalette) {
    for(let i=0; i<25; i++) {
        particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 10, vy: (Math.random() - 0.5) * 10,
            life: 1.0, color: colorPalette[Math.floor(Math.random() * colorPalette.length)]
        });
    }
}

function drawParticles() {
    for(let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx; p.y += p.vy; p.life -= 0.04;
        if(p.life <= 0) { particles.splice(i, 1); continue; }
        ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1.0;
}

function playLandingAnimation(x, y, terrain, sankIt, callback) {
    currentBallPos = { x: x, y: y }; 

    let isSplash = (terrain === TERRAIN.WATER);
    let isTree = (terrain === TERRAIN.TREE);
    let isThud = (terrain === TERRAIN.SAND);

    if (sankIt || isSplash || isThud || isTree) {
        if (sankIt) {
            createParticles(x, y, ['#f1c40f', '#e74c3c', '#3498db', '#2ecc71', '#9b59b6']);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]); 
        } else if (isSplash) {
            createParticles(x, y, ['#85c1e9', '#3498db', '#2980b9', '#ffffff']);
            if (navigator.vibrate) navigator.vibrate(100);
        } else if (isTree) {
            createParticles(x, y, ['#2ecc71', '#27ae60', '#228b22', '#82e0aa']);
            if (navigator.vibrate) navigator.vibrate([30, 30]);
        } else if (isThud) {
            createParticles(x, y, ['#f5deb3', '#d2b48c', '#e6c280']);
            if (navigator.vibrate) navigator.vibrate([50, 50]);
        }

        let frames = 0;
        let maxFrames = (isThud || isTree) ? 20 : 30; 

        function particleLoop() {
            frames++;
            if (frames < maxFrames) {
                requestAnimationFrame(particleLoop);
            } else {
                callback();
            }
        }
        particleLoop();
        return;
    }

    if (isPutting || currentRoll === 1) {
        ballZOffset = 0; 
        callback();
        return;
    }

    let hopTime = 0, hopDuration = 15, bounceHeight = 12; 

    function hopLoop() {
        hopTime++;
        let progress = hopTime / hopDuration;
        ballZOffset = Math.sin(progress * Math.PI) * bounceHeight;

        if (hopTime < hopDuration) {
            requestAnimationFrame(hopLoop);
        } else {
            ballZOffset = 0; callback(); 
        }
    }
    hopLoop(); 
}

function playShotAnimation(aimX, aimY, finalX, finalY, sankIt, callback) {
    let startX = currentBallPos.x, startY = currentBallPos.y, t = 0; 
    
    function animLoop() {
        trail.push({ x: currentBallPos.x, y: currentBallPos.y });
        if (trail.length > 10) trail.shift(); 
        t += 0.05; if (t > 1) t = 1;
        let invT = 1 - t;
        currentBallPos.x = (invT * invT * startX) + (2 * invT * t * aimX) + (t * t * finalX);
        currentBallPos.y = (invT * invT * startY) + (2 * invT * t * aimY) + (t * t * finalY);

        renderScene();

        if (t < 1) {
            requestAnimationFrame(animLoop);
        } else {
            trail = []; 
            let gridX = Math.max(0, Math.min(Math.floor(finalX / TILE_SIZE), COLS - 1));
            let gridY = Math.max(0, Math.min(Math.floor(finalY / TILE_SIZE), ROWS - 1));
            let landingTerrain = gridData[gridY][gridX];
            playLandingAnimation(finalX, finalY, landingTerrain, sankIt, callback); 
        }
    }
    animLoop(); 
}

canvas.addEventListener('pointerdown', (e) => {
    if(!canShoot || isHoleComplete) return;
    
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    const clickX = (e.clientX - r.left) * scaleX;
    const clickY = (e.clientY - r.top) * scaleY;
    
    let closestTarget = null, minDistance = Infinity, magneticRadius = TILE_SIZE * 1.5; 

    for (let t of clickableTargets) { 
        let targetCenterX = t.x * TILE_SIZE + TILE_SIZE / 2;
        let targetCenterY = t.y * TILE_SIZE + TILE_SIZE / 2;
        let dist = Math.hypot(clickX - targetCenterX, clickY - targetCenterY);

        if (dist < minDistance && dist <= magneticRadius) {
            minDistance = dist; closestTarget = t;
        }
    }

    if (!closestTarget) { 
        document.getElementById('warningOverlay').style.display = 'flex';
        if (navigator.vibrate) navigator.vibrate([50, 50, 50]); 
        return; 
    }

    const tx = closestTarget.x, ty = closestTarget.y;
    const gx = tx * TILE_SIZE + TILE_SIZE / 2, gy = ty * TILE_SIZE + TILE_SIZE / 2;
    const sx = Math.floor(currentBallPos.x / TILE_SIZE), sy = Math.floor(currentBallPos.y / TILE_SIZE);
    const hx = Math.floor(holePos.x / TILE_SIZE), hy = Math.floor(holePos.y / TILE_SIZE);

    strokes++; updateHUD();
    if (gridData[ty] && gridData[ty][tx] === TERRAIN.SAND) hitSandThisHole = true;
    
    validTargets = []; clickableTargets = []; renderScene();

    const dx = tx - sx, dy = ty - sy;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const stepX = dist === 0 ? 0 : dx / dist, stepY = dist === 0 ? 0 : dy / dist;

    let sankIt = false;
    for (let i = 1; i <= dist; i++) {
        if (sx + (stepX * i) === hx && sy + (stepY * i) === hy) {
            let overshoot = dist - i;
            if (overshoot === 0 || overshoot === 1) sankIt = true; 
            break; 
        }
    }
    
    let startingTerrain = gridData[sy][sx];
    let eff = currentRoll;
    if (startingTerrain === TERRAIN.FAIRWAY) eff += 1;
    else if (startingTerrain === TERRAIN.SAND) eff = Math.max(1, currentRoll - 1);
    if (isPutting) eff = 1;

    let windShiftX = (eff === 1) ? 0 : currentWeather.windX;
    let windShiftY = (eff === 1) ? 0 : currentWeather.windY;

    let landingGridX = tx + windShiftX, landingGridY = ty + windShiftY;

    if (landingGridX === hx && landingGridY === hy) { sankIt = true; } 
    else if (sankIt && (Math.abs(landingGridX - hx) > 1 || Math.abs(landingGridY - hy) > 1 || (landingGridX !== hx && landingGridY !== hy))) {
        sankIt = false;
    }

    let isHazard = false, safeX = landingGridX, safeY = landingGridY;

    if (landingGridX < 0 || landingGridX >= COLS || landingGridY < 0 || landingGridY >= ROWS) {
        isHazard = true; 
    } else {
        let terrain = gridData[landingGridY][landingGridX];
        if (terrain === TERRAIN.WATER || terrain === TERRAIN.TREE) { isHazard = true; }
    }

    if (isHazard) {
        sankIt = false; 
        let foundSafe = false;
        let searchDirs = [
            {dx: windShiftX === 0 ? 0 : -Math.sign(windShiftX), dy: windShiftY === 0 ? 0 : -Math.sign(windShiftY)},
            {dx: 0, dy: 1}, {dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: -1, dy: 0},
            {dx: 1, dy: 1}, {dx: -1, dy: -1}, {dx: 1, dy: -1}, {dx: -1, dy: 1}
        ];
        
        for (let sd of searchDirs) {
            let checkX = landingGridX + sd.dx, checkY = landingGridY + sd.dy;
            if (checkX >= 0 && checkX < COLS && checkY >= 0 && checkY < ROWS) {
                let t = gridData[checkY][checkX];
                if (t !== TERRAIN.WATER && t !== TERRAIN.TREE) {
                    safeX = checkX; safeY = checkY; foundSafe = true; break;
                }
            }
        }
        if (!foundSafe) { safeX = sx; safeY = sy; }
    }

    let baseAimX = sankIt ? holePos.x : tx * TILE_SIZE + TILE_SIZE / 2;
    let baseAimY = sankIt ? holePos.y : ty * TILE_SIZE + TILE_SIZE / 2;
    let animTargetX = sankIt ? holePos.x : landingGridX * TILE_SIZE + TILE_SIZE / 2;
    let animTargetY = sankIt ? holePos.y : landingGridY * TILE_SIZE + TILE_SIZE / 2;
    
    animTargetX = Math.max(0, Math.min(animTargetX, COLS * TILE_SIZE));
    animTargetY = Math.max(0, Math.min(animTargetY, ROWS * TILE_SIZE));

    playShotAnimation(baseAimX, baseAimY, animTargetX, animTargetY, sankIt, () => {
        if (isHazard) {
            strokes++; updateHUD();
            currentBallPos = { x: safeX * TILE_SIZE + TILE_SIZE / 2, y: safeY * TILE_SIZE + TILE_SIZE / 2 };
            document.getElementById('hazardOverlay').style.display = 'flex';
            if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
            
            canShoot = false; isPutting = false; rollBtn.disabled = false; puttBtn.disabled = false; currentRoll = 0; diceResult.innerText = '-';
            statusText.style.color = '#d9534f'; statusText.innerText = "Penalty! Choose your shot type to continue.";
            if (currentMode !== 'casual') updateWeatherForStroke();
            updateRerollButton();
            
        } else if (sankIt) {
            isHoleComplete = true; canShoot = false; rollBtn.disabled = true; puttBtn.disabled = true; rerollBtn.disabled = true;
            
            // These used to be two independent `if` checks, both testing against the
            // same hole's stroke count — but strokes <= 4 always ALSO satisfies
            // strokes <= 5, so every eagle was silently also counting as a birdie.
            // That's exactly why birdies + eagles could add up to more than total
            // holes played: a single eagle hole was contributing +1 to each counter
            // instead of +1 to just one of them. Eagle is strictly better than birdie
            // for the same hole, not an additional category, so this needs to be
            // mutually exclusive.
            if (strokes <= 4) {
                localStats.eagles++;
                pushStatDeltas({ eagles: firebase.firestore.FieldValue.increment(1) });
                unlockAchievement('eagle');
            } else if (strokes === 5) {
                localStats.birdies++;
                pushStatDeltas({ birdies: firebase.firestore.FieldValue.increment(1) });
                unlockAchievement('birdie');
            }
            if (strokes <= 6 && hitSandThisHole) unlockAchievement('sand');
            saveStats();

            incrementLocalHoles(); 
            
            if (currentMode === 'casual' || currentMode === 'pro') {
                statusText.style.color = '#5cb85c'; statusText.innerText = "Hole completed!";
                document.getElementById('victoryOverlay').style.display = 'flex';
                document.getElementById('finalScoreText').innerText = `Score: ${strokes}`;
            } else {
                currentRoundHoleScores.push(strokes);
                totalCampaignScore += strokes;
                statusText.style.color = '#5cb85c'; statusText.innerText = `Hole ${currentHole} Complete! (Score: ${strokes})`;
                updateHUD();
                setTimeout(() => {
                    if (currentHole >= 18) triggerVictorySequence();
                    else { currentHole++; strokes = 0; generateCourse(); updateHUD(); }
                }, 1500);
            }
        } else {
            canShoot = false; isPutting = false; rollBtn.disabled = false; puttBtn.disabled = false; currentRoll = 0; diceResult.innerText = '-';
            statusText.style.color = '#d9534f'; statusText.innerText = "Choose your shot type to continue.";
            if (currentMode !== 'casual') updateWeatherForStroke();
            updateRerollButton();
        }
    });
});

let engineRunning = false;
function idleLoop() {
    if (!engineRunning) {
        engineRunning = true;
        function continuousRender() {
            renderScene();
            requestAnimationFrame(continuousRender);
        }
        continuousRender(); 
    }
}

document.addEventListener('DOMContentLoaded', () => { 
    resetGame(); 
    
    const CURRENT_VERSION = '2026.8.13';
    const lastSeenVersion = localStorage.getItem('paperGolfVersion');
    
    if (lastSeenVersion !== CURRENT_VERSION) {
        document.getElementById('whatsNewOverlay').style.display = 'flex';
        localStorage.setItem('paperGolfVersion', CURRENT_VERSION);
    } else {
        checkTutorial();
    }
});

syncOfflineHolesToDatabase();
syncOfflineScoresToCloud();
syncPendingRoundStats();

window.addEventListener('online', () => {
    syncOfflineHolesToDatabase();
    syncOfflineScoresToCloud();
    syncPendingRoundStats();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        syncOfflineHolesToDatabase();
    }
});

function checkTutorial() {
    const hideTutorial = localStorage.getItem('hideTutorial');
    if (hideTutorial !== 'true') {
        document.getElementById('tutorialOverlay').style.display = 'flex';
        // checkPoll() runs from the tutorial's own "Got it!" button in this case,
        // so the poll never pops up stacked on top of the tutorial.
    } else {
        checkPoll();
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        document.getElementById('updateToast').classList.remove('hidden');
                    }
                });
            });
        });
    });
}

function toggleMenu(forceClose) {
    const menu = document.getElementById('popupMenu');
    if (forceClose === false) { menu.style.display = 'none'; } 
    else { menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex'; }
}

function toggleRoadmap(show) { document.getElementById('roadmapOverlay').style.display = show ? "flex" : "none"; }
function toggleAbout(show) { document.getElementById('aboutOverlay').style.display = show ? "flex" : "none"; }
function toggleWhatsNew(show) { document.getElementById('whatsNewOverlay').style.display = show ? "flex" : "none"; }
function toggleCountryBreakdown(show) { document.getElementById('countryOverlay').style.display = show ? "flex" : "none"; }

// ==========================================
// COMMUNITY POLL
// Hardcoded here (and mirrored in functions/index.js so the Discord daily recap
// can label the tally) — no CMS, launching a new poll is just editing this object
// and pushing, same as everything else in this app. Bump `id` any time the
// question changes: that's what makes returning players see the auto-popup again,
// and it keeps a new question's votes from mixing with an old question's tally.
// ==========================================
const CURRENT_POLL = {
    id: 'clubs_2026_08',
    question: "Right now every shot uses one dice roll. We're considering adding club types (Driver, Iron, Wedge) so you can control shot distance instead — but it'd change how scoring and difficulty feel. Interested?",
    options: [
        { id: 'keep', label: '⛳ Keep it simple as-is' },
        { id: 'clubs', label: "🏌️ Yes, I'd try clubs" },
        { id: 'neutral', label: '🤷 No strong opinion either way' }
    ],
    // ISO string (e.g. '2026-08-15T00:00:00') to auto-close voting on a date, or
    // null to leave it open until it's replaced with a new poll.
    expiresAt: null
};

function isPollExpired() {
    return !!(CURRENT_POLL.expiresAt && new Date() > new Date(CURRENT_POLL.expiresAt));
}

function getMyPollVote() {
    return localStorage.getItem('paperGolf_pollVote_' + CURRENT_POLL.id);
}

function togglePoll(show) {
    document.getElementById('pollOverlay').style.display = show ? 'flex' : 'none';
    if (show) renderPoll();
}

// Auto-popup, once per poll — same "have they seen this yet" pattern the What's
// New modal already uses, just keyed to the poll's own id instead of the app
// version so a new poll can go out without needing a version bump.
function checkPoll() {
    const lastSeenPoll = localStorage.getItem('paperGolf_lastSeenPoll');
    if (lastSeenPoll !== CURRENT_POLL.id) {
        localStorage.setItem('paperGolf_lastSeenPoll', CURRENT_POLL.id);
        togglePoll(true);
    }
}

function renderPoll() {
    document.getElementById('pollQuestion').textContent = CURRENT_POLL.question;
    document.getElementById('pollClosedNote').classList.toggle('hidden', !isPollExpired());

    const myVote = getMyPollVote();
    // Once it's closed, everyone sees results regardless of whether they voted —
    // no more bandwagon risk once voting itself is over.
    if (myVote || isPollExpired()) {
        renderPollResults(myVote);
    } else {
        renderPollOptions();
    }
}

function renderPollOptions() {
    document.getElementById('pollResults').classList.add('hidden');
    const container = document.getElementById('pollOptions');
    container.classList.remove('hidden');
    container.innerHTML = '';
    CURRENT_POLL.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.textContent = opt.label;
        btn.style.width = '100%';
        // The actual bug: .overlay button in style.css caps every button at
        // max-width: 300px, and this modal is 360px wide. width:100% was being
        // capped down to 300px, leaving the button narrower than its container
        // and anchored to the left of that leftover space — nothing to do with
        // how the label text inside it was aligned, which is why the last two
        // fixes did nothing. Overriding max-width here is the actual fix.
        btn.style.maxWidth = 'none';
        btn.style.boxSizing = 'border-box';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.textAlign = 'center';
        // Outlined "ghost" style for the choices themselves — solid accent color
        // on 3-4 stacked buttons (plus the solid Close button below) reads as one
        // undifferentiated wall of blue. Keeping Close solid and these outlined
        // gives the eye a clear "these are choices, that's the exit" hierarchy.
        btn.style.background = 'transparent';
        btn.style.color = 'var(--accent-color)';
        btn.style.border = '2px solid var(--accent-color)';
        // .overlay button also sets margin-bottom: 15px, which would stack with
        // this container's own 10px flex gap and make the spacing uneven/larger
        // than intended between options.
        btn.style.marginBottom = '0';
        btn.onclick = () => castPollVote(opt.id);
        container.appendChild(btn);
    });
}

function castPollVote(optionId) {
    // Recorded locally right away so the UI flips to results immediately —
    // matches every other "have they already done this" gate in the app
    // (localStorage, not account-tied). This is feedback, not a competitive
    // leaderboard, so this lighter-touch guard is proportionate to the stakes.
    localStorage.setItem('paperGolf_pollVote_' + CURRENT_POLL.id, optionId);

    // Same authReady gate every other authenticated RTDB write in this file
    // uses — writing before sign-in resolves would get silently rejected by the
    // rules requiring auth != null.
    authReady.then(() => {
        // Same self-guessed country used for online_users/country_holes/the
        // leaderboard flag — written as a parallel counter alongside the vote
        // tally (mirrors daily_holes/country_holes) rather than nesting it
        // into poll_votes, so the existing tally logic doesn't need to change.
        const updates = {};
        updates[`poll_votes/${CURRENT_POLL.id}/${optionId}`] = firebase.database.ServerValue.increment(1);
        updates[`poll_votes_by_country/${CURRENT_POLL.id}/${optionId}/${myCountryGuess}`] = firebase.database.ServerValue.increment(1);
        rtdb.ref().update(updates)
            .catch((error) => console.error('Poll vote failed to save:', error));
    });

    renderPollResults(optionId);
}

function renderPollResults(myVote) {
    document.getElementById('pollOptions').classList.add('hidden');
    const resultsEl = document.getElementById('pollResults');
    resultsEl.classList.remove('hidden');
    resultsEl.innerHTML = '<p style="text-align:center; color: var(--text-color);">Loading results...</p>';

    Promise.all([
        rtdb.ref(`poll_votes/${CURRENT_POLL.id}`).once('value'),
        rtdb.ref(`poll_votes_by_country/${CURRENT_POLL.id}`).once('value')
    ]).then(([snap, countrySnap]) => {
        const counts = snap.val() || {};
        const total = CURRENT_POLL.options.reduce((sum, opt) => sum + (counts[opt.id] || 0), 0);

        resultsEl.innerHTML = '';
        CURRENT_POLL.options.forEach((opt) => {
            const count = counts[opt.id] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            const isMine = opt.id === myVote;

            const row = document.createElement('div');
            row.style.marginBottom = '12px';
            row.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:4px; color: var(--text-color); font-weight: ${isMine ? 'bold' : 'normal'};">
                    <span>${opt.label}${isMine ? ' ✅' : ''}</span>
                    <span>${pct}% (${count})</span>
                </div>
                <div style="background: var(--border-color); border-radius: 6px; height: 10px; overflow: hidden;">
                    <div style="background: var(--accent-color); height: 100%; width: ${pct}%;"></div>
                </div>
            `;
            resultsEl.appendChild(row);
        });

        if (total === 0) {
            resultsEl.innerHTML += '<p style="text-align:center; font-size: 13px; color: #999;">Be the first to vote!</p>';
        }

        renderPollCountryBreakdown(countrySnap.val() || {});
    }).catch((error) => {
        console.error('Failed to load poll results:', error);
        resultsEl.innerHTML = '<p style="text-align:center; color: var(--text-color);">Could not load results — try again later.</p>';
    });
}

// Compact grid below the Close button — summed across every option (not
// split per-option, same reasoning as the Discord recap breakdown) so this
// stays a fixed handful of columns wide and just grows downward a row at a
// time as more countries vote, instead of the modal getting taller per
// option the way a full per-option breakdown would.
function renderPollCountryBreakdown(byOption) {
    const totals = {};
    Object.values(byOption).forEach((countries) => {
        Object.entries(countries).forEach(([code, count]) => {
            if (typeof count === 'number' && count > 0) {
                totals[code] = (totals[code] || 0) + count;
            }
        });
    });

    const container = document.getElementById('pollCountryBreakdown');
    const grid = document.getElementById('pollCountryGrid');
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.classList.add('hidden');
        return;
    }

    grid.innerHTML = entries
        .map(([code, count]) => `<div>${countryCodeToFlag(code)} ${count}</div>`)
        .join('');
    container.classList.remove('hidden');
}

let latestCountryTally = {};
function renderCountryBreakdown(countryTally) {
    // Called every time the presence list updates (see allUsersRef.on above), so
    // the popup always shows current data whenever it's opened rather than needing
    // its own separate read.
    latestCountryTally = countryTally;
    const listEl = document.getElementById('countryList');
    if (!listEl) return;

    const sorted = Object.entries(countryTally).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) {
        listEl.innerHTML = '<div style="text-align:center; color:#999;">No one else online right now.</div>';
        return;
    }
    listEl.innerHTML = sorted.map(([code, count]) => {
        const label = code === 'XX' ? 'Unknown' : code;
        return `<div style="display:flex; justify-content:space-between; padding: 4px 8px;">
            <span>${countryCodeToFlag(code)} ${label}</span>
            <span style="font-weight:bold;">${count}</span>
        </div>`;
    }).join('');
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.hamburger-btn') && !e.target.closest('#popupMenu')) {
        const menu = document.getElementById('popupMenu');
        if (menu) menu.style.display = 'none';
    }
});

document.querySelectorAll('.overlay').forEach(overlay => {
    overlay.addEventListener('click', function(event) {
        if (event.target === this) {
            if (this.id !== 'victoryOverlay') {
                this.style.display = 'none';
            }
        }
    });
});
