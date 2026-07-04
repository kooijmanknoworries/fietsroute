---
name: Routeplanner mobile layout
description: Constraints for the stacked mobile layout of the routeplanner Home page + Map overlay controls.
---

# Routeplanner mobile layout

- Home page is a flex container: `flex-col` on mobile, `md:flex-row` on desktop. The control panel and the map split the viewport height on mobile.
  **Why:** the panel holds a long scroll (region/municipality search, network status, "Your Route" with Save + **Start ride**, saved routes, GPX). When the panel was `h-1/3`, the Start-ride button was buried in a tiny scroll area and users reported they "can't find the start button." Panel needs at least `h-1/2` so ride/route actions are reachable on a phone.
  **How to apply:** keep the mobile panel height generous (>= half the viewport); if you add more sections above "Your Route", re-check that Start ride is still reachable on a phone.

- Map overlay controls: recenter button is `absolute left-3 top-3`; the LF-routes / map-style / street-satellite group is `absolute right-3 top-3`. On a ~390px phone the right group is wide enough to collide with the left button.
  **Why:** users saw the controls overlapping ("LF routes in the top left ... a mess"). Fix: the right group uses `flex-wrap justify-end max-w-[calc(100%-6rem)]` so it wraps within the space left of the recenter button instead of overrunning it.
  **How to apply:** any new top overlay control must respect this wrap/max-width budget or it will collide on narrow screens.
