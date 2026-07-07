---
name: Expo Go deep link needs base path
description: Why the mobile /mobile landing "Open in Expo Go" / QR deep link must include BASE_PATH under a shared-domain, path-routed deployment
---

The mobile artifact is served under a base path (`/mobile`) on the SAME public domain
as the web app (nginx path-routes `/mobile` to an internal, `external:false` mobile
container). The landing page's `exps://` deep link (used by both the QR code and the
"Open in Expo Go" button) is built in `artifacts/mobile/server/serve.js`
(`serveLandingPage`, `expsUrl`).

Rule: `expsUrl` MUST be `${host}${basePath}` — not just `${host}`.

**Why:** Expo Go turns `exps://<host>/mobile` into `GET https://<host>/mobile` with an
`expo-platform` header, which nginx routes to the mobile container; serve.js strips the
base path → `/` → serves the manifest JSON. If the deep link is the bare host
(`exps://<host>/`), Expo Go fetches `/`, which is the sibling WEB app's HTML — so Expo
Go never gets a manifest and the app won't load. This is invisible on the web landing
page (it renders fine); it only breaks when a phone actually opens the link.

**How to apply:** Any shared-domain, path-routed mobile deployment must include the base
path in the Expo Go deep link. Verify live by fetching `/mobile` with
`expo-platform: ios|android` → expect `application/json` manifest whose `launchAsset.url`
is under `/mobile/...`, and confirm that bundle URL returns 200 (~4MB Hermes bundle).
The internal `*.internal.*.azurecontainerapps.io` mobile URL 404s in a browser by
design — that is not a bug; always test via the public `/mobile` path.
