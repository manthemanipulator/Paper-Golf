const functions = require('firebase-functions');
const fetch = require('node-fetch');

// This watches your Firestore Leaderboard for any new scores!
exports.sendScoreToDiscord = functions.firestore
    .document('globalLeaderboard/{docId}')
    .onCreate(async (snap, context) => {
        // Grab the data the player just uploaded
        const newScore = snap.data();
        
        // 🚨 YOUR SECRET DISCORD WEBHOOK URL GOES HERE 🚨
        const webhookUrl = "https://discord.com/api/webhooks/1517365185613004930/xiSmebXyNp159XN_9amewgdeVM9HNJe2uhaaYSj0XibMfOspMg0oCBzghutdCQhugJvu";

        // Construct a beautifully formatted Discord "Embed" card
        const discordPayload = {
            embeds: [
                {
                    title: "⛳️ New Score Submitted!",
                    color: 3066993, // A nice Paper Golf green
                    fields: [
                        {
                            name: "Player",
                            value: `**${newScore.initials}**`,
                            inline: true
                        },
                        {
                            name: "Score",
                            value: `**${newScore.score}**`,
                            inline: true
                        },
                        {
                            name: "Mode",
                            value: newScore.mode === 'daily' ? "📅 Daily 18-Hole" : (newScore.mode === 'random' ? "🎲 Random 18-Hole" : "Casual"),
                            inline: false
                        }
                    ],
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: "Paper Golf Live Tracker"
                    }
                }
            ]
        };

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(discordPayload)
            });

            if (!response.ok) {
                console.error(`Discord API responded with status: ${response.status}`);
            }
        } catch (error) {
            console.error("Error sending message to Discord:", error);
        }
    });