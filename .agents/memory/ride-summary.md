---
name: Ride end-of-ride summary
description: Why "new segments" must diff against a start-of-ride baseline, not live history
---

# Ride end-of-ride summary

When computing how many segments a rider "newly unlocked" during a ride, diff the
ride's completions against a snapshot of lifetime history taken **at ride start**,
not the live history query at stop time.

**Why:** segments are persisted to the server the instant they complete, and a
successful save invalidates/refetches the visited-segments query. So by the time
the ride stops, live `history` already contains this ride's own segments — diffing
against it undercounts "new" to ~0. A frozen start-of-ride baseline is the only
correct reference.

**How to apply:** capture the baseline before any early returns in the start
handler (so it's set on every code path), and reset the per-ride session state
there too so each ride's summary is independent. Lifetime total = baseline ∪
session completions. History is signed-in only; signed-out riders have an empty
baseline (all completions count as new) and no meaningful lifetime total.
