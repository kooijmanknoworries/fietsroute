---
name: Ride leg coverage rule
description: How knooppunt legs unlock during GPS rides (RouteCoverage) and how tests must drive fixes
---
Legs unlock only when accepted on-route fixes continuously cover the leg from start to end (`RouteCoverage` in the duplicated `ride-geo.ts` helpers, used by both web and mobile ride hooks). An accepted advance larger than COVERAGE_GAP_M (150 m along-route) breaks continuity: distance may still be credited (speed-plausible), but the skipped stretch never counts as ridden.

**Why:** "reached leg end" latching credited legs joined mid-way or skipped via GPS snap-ahead; locks must mean genuinely ridden roads.

**How to apply:**
- Ride-hook tests must drive fixes in small steps (≤150 m along-route) with plausible time between them, or legs never complete. One big fix at the leg end no longer unlocks anything.
- Mobile tests can't use fake timers (startRide awaits a real setTimeout); spy on `Date.now` instead.
- `ride-geo.ts` is duplicated in routeplanner and mobile — keep the copies byte-identical (diff them) when changing either.
