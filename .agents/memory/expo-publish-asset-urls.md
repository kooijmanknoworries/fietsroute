---
name: Expo Go publish asset URLs
description: Why published bundle asset URLs must be dot-segment-free and how the build verifies them.
---

# Expo Go publish: asset URL normalization + verification

- **Expo Go's asset resolver uses `httpServerLocation` verbatim as the download URI** (when it is an http(s) URL). Any `./../../` dot segments in the baked URL reach the device's HTTP stack unresolved; the deployment proxy 302-redirects non-normalized paths, so asset loading then depends on each client's redirect/normalization behavior.
  **Why:** an Android Expo Go user got a blank screen after "downloading update" while every server-side check passed — dot-segment URLs were the main residual device-dependent risk (2026-07-05).
  **How to apply:** the mobile publish build rewrites bundle + manifest asset URLs through `path.posix.normalize` (no `..` allowed) so they hit files directly, and a `verifyBundleAssets` step fails the build if any bundle asset URL is un-rewritten, escapes static-build, or points at a missing file. Keep that verification when touching the publish pipeline.

- **Verification regex intentionally ignores 4 raw `httpServerLocation` occurrences** in each bundle — they are Expo runtime resolver *code*, not asset metadata. Only entries with `hash`/`name`/`type` are real assets (~49 as of SDK 54).

- **"New update available, downloading…" stuck with a small percentage counter = bundle transfer stalling on device.** The static server must gzip the Hermes bundle (~4x smaller) and set `cache-control: public, max-age=31536000, immutable` on timestamped build dirs — okhttp/Expo Go sends `Accept-Encoding: gzip` and serving 4+MB raw over slow mobile links stalls mid-download.
  **How to apply:** serve.js gzips compressible extensions with an mtime-keyed cache and sets content-length + vary. Diagnose via request logs: manifest + bundle 200 but zero follow-up font/asset requests means the JS never executed on the device.

- **Blank-screen defenses in the app shell:** root layout has a 5s font-load timeout (renders with system fonts instead of hanging on splash) and a `ClerkLoading` spinner; the static server logs every request (method/url/status/UA/expo-platform) so deployment logs show what a device actually fetched.
