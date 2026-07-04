---
name: Testing async GPS/watch flows under vitest
description: Why sync act() + waitFor fails to flush floating async chains (expo-location watch), and the await-act pattern that works.
---

When a hook kicks off a floating async chain from a synchronous callback (e.g.
`startRide()` fires an un-awaited IIFE that `await`s
`requestForegroundPermissionsAsync()` then `watchPositionAsync()`), the pattern

```
act(() => result.current.startRide());
await waitFor(() => expect(watchPositionAsync).toHaveBeenCalled());
```

can flakily/consistently fail — the awaited microtasks never advance, so the
watch subscription is never registered and no fix callback exists to drive.

**Why:** the synchronous `act` returns before the IIFE's awaits resolve, and the
React act environment defers the interleaving in a way `waitFor`'s polling does
not reliably kick.

**How to apply:** wrap the trigger in an async `act` that yields a real macrotask
so the chain settles, then read `mock.calls` synchronously:

```
await act(async () => { result.current.startRide(); await new Promise(r => setTimeout(r, 30)); });
expect(watchPositionAsync).toHaveBeenCalled();
```

Push subsequent GPS fixes by grabbing the callback from
`watchPositionAsync.mock.calls[...][1]` and calling it inside
`await act(async () => { handler(fix); await Promise.resolve(); })`.

Mobile expo-location is a global vitest alias mock
(`test/mocks/expo-location.ts`, wired in `vitest.config.ts`) exposing
`PermissionStatus`, `Accuracy`, `requestForegroundPermissionsAsync`,
`watchPositionAsync` as `vi.fn()`s.
