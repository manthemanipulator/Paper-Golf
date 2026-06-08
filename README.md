# Paper Apps™ GOLF Companion

[cite_start]A lightweight, mobile-friendly digital companion and procedural course generator designed for the *Paper Apps™ GOLF* notebook game by Tom Brinton[cite: 2, 5]. 

This Progressive Web App (PWA) replaces the need to carry physical dice or draw grids by hand. It generates infinite 18-hole courses on the fly, enforces official terrain rules, tracks your strokes, and manages your mulligans in a clean, single-page interface. 

## Features

* **Procedural Map Generation:** Uses cellular automata-style algorithms to naturally generate Fairways, Sand Traps, Water Hazards, and Trees on a clean dot-grid canvas. 
* [cite_start]**Integrated d6 Roller:** Replaces the physical die for Dice GOLF, generating your maximum hit distance with a single tap[cite: 20].
* [cite_start]**Dedicated Putt Action:** Bypasses the die roll and enforces a strict 1-space maximum movement for when you are right next to the hole[cite: 37, 43].
* **Automated Terrain Physics:** The app's collision engine enforces the official rulebook constraints mathematically:
  * [cite_start]**Fairway Bonus:** Automatically adds +1 to your roll distance[cite: 21, 57].
  * [cite_start]**Sand Trap Penalty:** Automatically subtracts -1 from your roll distance[cite: 22, 60].
  * [cite_start]**Hazard Blocking:** Rejects any shot that lands directly in Water [cite: 62] [cite_start]or on a Tree[cite: 63].
  * [cite_start]**Line-of-Sight Restrictions:** Rejects any shot passing through Trees unless the shot originated from the Fairway[cite: 26, 63].
* [cite_start]**Snap-to-Grid Drawing:** Tap anywhere on the screen, and the engine calculates the distance, verifies a straight orthogonal or diagonal line[cite: 23], and snaps the ball to the precise grid intersection.
* [cite_start]**Mulligan Tracking:** Tracks your 6 Mulligans per course [cite: 34][cite_start], while automatically granting the single free re-roll for your opening tee-off shot[cite: 32]. 
* [cite_start]**Overshoot Logic:** Faithfully recreates the physical game's cup mechanics; the ball sinks if you land exactly on the hole or overshoot it by exactly 1 space[cite: 45, 46].

## Installation (iOS / iPhone)

This app is built to be run as a standalone web application on your mobile device. There is no App Store download required. 

1. Open **Safari** on your iPhone.
2. Navigate to the GitHub Pages URL for this repository (e.g., `https://[your-username].github.io/golf-companion/`).
3. Tap the **Share** icon at the bottom of the screen (the square with the upward arrow).
4. Scroll down and tap **Add to Home Screen**.
5. Tap **Add** in the top right corner. 

The GOLF Companion will now appear as an app icon on your home screen and will open in full-screen mode without the Safari address bar.

## Tech Stack

* **HTML5 Canvas:** For rendering the grid, drawing the organic terrain blobs, and plotting the ball's path.
* **Vanilla JavaScript:** For the game state logic, math validation, and ray-casting collision detection.
* **CSS3:** For the mobile-responsive layout and touch-action constraints.
* **Zero Dependencies:** Completely self-contained in a single `index.html` file. 

## Disclaimer

This is an unofficial, non-commercial fan project built strictly for personal utility. [cite_start]*Paper Apps™ GOLF* is created by Tom Brinton and published by Gladden[cite: 1, 2, 5]. Please support the official physical release!
