# ⛳ Paper Golf — Version 2026.7.20: Birdie/Eagle Math Fix 🐛

Quick bug-fix release, and an apology for this one.

## 🐛 The Bug

Career Stats could show birdies + eagles adding up to *more* than your total holes played — obviously not possible. Turns out every Eagle (4 strokes or fewer) was also secretly getting counted as a Birdie, since the two checks weren't set up to be mutually exclusive. One great hole was quietly padding both counters instead of just one.

## ✅ The Fix

Eagle and Birdie are now exclusive — an eagle hole only counts as an eagle, not both. Going forward, your stats will add up correctly.

## 🔧 If Your Numbers Still Look Off

Existing totals from before this fix may still be inflated. Open **Menu → Stats & Achievements** and tap *"Birdie/Eagle/Holes counters look wrong? Reset them"* at the bottom to zero out birdies, eagles, and lifetime holes and start counting fresh. Your best score and unlocked achievements are untouched — this only resets the three affected counters.

Sorry for the bad math, and thanks for catching it!
