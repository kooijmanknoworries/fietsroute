---
name: Headless Clerk sign-in & mobile map e2e
description: How to script sign-in and zoom in puppeteer against the expo web app
---

- Password sign-in from headless chromium fails silently: Clerk dev instance returns `needs_client_trust` (bot detection), UI stays on the form. Use the ticket strategy instead: create a `sign_in_tokens` token via the backend API, then in-page `window.Clerk.client.signIn.create({strategy:"ticket",ticket})` + `setActive` + page reload. `window.Clerk` is available on the expo web build too.
- **Why:** hours were lost assuming the button click wasn't registering; the sign_ins POST returns 200 but status is `needs_client_trust`.
- Zooming the mobile Leaflet shim: double-click zoom doesn't work and region search only reaches province level (above the zoom-11 node gate). Use `page.mouse.wheel({deltaY:-100})` on the map — each wheel tick jumps several zoom levels, so use 1–2 gentle ticks or you overshoot into blank tiles.
- Marker verification: the shim renders markers as absolutely-positioned divs with `transform: translate(-50%,-50%)` and drops `testID`; count those divs or verify via screenshot, not `data-testid` / `.leaflet-marker-icon`.
