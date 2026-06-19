const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const fetch = require('node-fetch');

// This wakes up the Admin SDK so we can read the database
admin.initializeApp();
const db = admin.firestore();


// ==========================================
// BOT 1: THE LIVE SCORE TRACKER (Unchanged)
// ==========================================
exports.sendScoreToDiscord = functions.firestore
    .document('globalLeaderboard/{docId}')
    .onCreate(async (snap, context) => {
        const newScore = snap.data();
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
exports.dailyRecapToDiscord = functions.pubsub
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
                        { name: "\u200B", value: "\u200B", inline: false }, // Blank line spacer
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