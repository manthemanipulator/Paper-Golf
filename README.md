# Paper Apps™ GOLF Companion

A lightweight, mobile-friendly digital companion and procedural course generator designed for the *Paper Apps™ GOLF* notebook game by Tom Brinton. 

Now officially hosted at **[papergolf.app](https://papergolf.app)**!

This Progressive Web App (PWA) replaces the need to carry physical dice or draw grids by hand. It generates infinite 18-hole courses on the fly, enforces official terrain rules, features dynamic wind physics, tracks your stats, and connects you to a live global community of players in a clean, single-page interface. 

## ⛳ Features

### 🎲 Core Mechanics
* **Procedural Map Generation:** Uses cellular automata-style algorithms to naturally generate Fairways, Sand Traps, Water Hazards, and Trees on a clean dot-grid canvas. 
* **Integrated d6 Roller:** Replaces the physical die for Dice GOLF, generating your maximum hit distance with a single tap.
* **Automated Terrain Physics:** The app's collision engine enforces the official rulebook constraints mathematically:
  * **Fairway Bonus:** Automatically adds +1 to your roll distance.
  * **Sand Trap Penalty:** Automatically subtracts -1 from your roll distance.
  * **Hazard Penalties & Drops:** Landing in Water or hitting Trees issues a +1 stroke penalty and automatically calculates a safe drop zone one tile away.
  * **Unplayable Lie Fix:** Automatically detects if you are permanently boxed in by trees, issuing a penalty and a free reroll to prevent soft-locks.
* **Mulligan Tracking:** Tracks your 6 Mulligans per course, while automatically granting the single free re-roll for your opening tee-off shot. 

### 🌦️ Physics, Visuals & UI
* **Dynamic Weather:** Wind speed and direction change per hole, requiring players to aim using invisible "compensation zones" to let the wind carry the ball to the target. 
* **Juicy Animations:** Sweeping Bézier curve ball flights, comet trails, particle burst fireworks for sinking putts, animated water ripples, and blowing leaves.
* **Magnetic Touch UI:** Forgiving hitboxes with a generous magnetic snap so you never miss a tap on a mobile screen.
* **Smart Aiming:** Valid targets glow Arcade Orange, while blocked paths display as Red targets that warn the player of line-of-sight restrictions.

### 🌍 Game Modes & Global Community
* **Casual, Daily & Random:** Play infinitely in Casual mode, tackle a fully randomized 18-hole course, or compete on the Daily 18-Hole (locked to a daily seed so everyone plays the exact same weather and layout).
* **Cloud Leaderboards:** Submit your initials to a live Firebase leaderboard to compete for the Top 5 daily and all-time scores.
* **The Global Pulse:** Live MMO-style tracking displays the exact number of holes completed globally today the moment you open the app.
* **Career Stats:** Locally tracks your Best 18-hole score, Birdies, Eagles, and Achievements, while displaying a live, real-time counter of the massive all-time Global Community holes played.

## 📱 Installation (Offline Play)

This app is built to be run as a standalone Progressive Web App (PWA) on your mobile device. There is no App Store download required, and it can be played completely offline!

**🍎 iPhone (Safari):**
1. Open **Safari** and navigate to `https://papergolf.app`
2. Tap the **Share** icon at the bottom of the screen.
3. Scroll down and tap **Add to Home Screen**.

**🤖 Android (Chrome Only):**
1. Open the standalone **Chrome** app and navigate to `https://papergolf.app` *(Note: Do not use in-app browsers like Reddit or Discord).*
2. Tap the **3 dots** in the top right corner.
3. Tap **"Install App"** or **"Add to Home screen"**.

The GOLF Companion will now appear as an app icon on your home screen and will open in full-screen mode without the browser address bar.

## 🛠️ Tech Stack

* **HTML5 Canvas:** For rendering the grid, drawing the organic terrain blobs, particle effects, and plotting the ball's sweeping path.
* **Vanilla JavaScript:** For the game state logic, procedural generation, math validation, and ray-casting collision detection.
* **CSS3:** For the mobile-responsive layout, HUD elements, and modals.
* **Firebase (Realtime Database & Firestore):** Powers the live Global Pulse trackers, daily/lifetime community stats, and cloud leaderboards.

## ⚖️ Disclaimer

This is an unofficial, non-commercial fan project built strictly for personal utility. *Paper Apps™ GOLF* is created by Tom Brinton and published by Gladden. Please support the official physical release at [gladdendesign.com](https://gladdendesign.com/)!
