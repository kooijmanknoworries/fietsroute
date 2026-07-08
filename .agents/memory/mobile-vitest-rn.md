---
name: Mobile (Expo/RN) vitest setup
description: How the Expo mobile artifact runs unit tests under vitest without a native runtime.
---

# Mobile RN tests under vitest

The `@workspace/mobile` (Expo/React Native) artifact runs unit tests with **vitest + jsdom + @testing-library/react**, NOT jest/react-native preset.

**Why:** importing real `react-native` under vitest pulls in Flow source that needs the metro/babel jest transform — painful. Aliasing to `react-native-web` renders RN primitives to the DOM so `@testing-library/react` (render/screen/fireEvent) works.

**How to apply:** `artifacts/mobile/vitest.config.ts` sets `resolve.alias` in order:
- native-only modules → lightweight mocks in `artifacts/mobile/test/mocks/` (`expo-haptics`, `react-native-reanimated`, `@expo/vector-icons`, `react-native-safe-area-context`)
- `react-native` → `react-native-web`
- `@/…` → mobile root
`react-native-web` maps a component's `testID` prop to a DOM `data-testid`, so `screen.getByTestId(...)` works. Mock `@workspace/api-client-react`'s `planRoute` per-test with `vi.hoisted` + `vi.mock`.

Gotcha: type mock fns as plain `vi.fn()` — casting to `ReturnType<typeof vi.fn>` yields `Mock<Procedure | Constructable>` which tsc reports as not callable.

Note: `artifacts/mobile` typecheck has a pre-existing unrelated error in `hooks/useColors.ts` (a `Record` cast that clashes with the `radius` number key after dark tokens were synced) — not caused by tests. Separately, `tsc` reports `Cannot find module '@clerk/expo'`/`expo-auth-session` across app source because those packages aren't installed — pre-existing, unrelated to tests.

Any newly-installed expo native module (e.g. `expo-file-system`, `expo-sharing`) imported by app code must ALSO get a mock + alias in `vitest.config.ts`, or *unrelated* suites that render the importing component fail at import time (`__DEV__ is not defined` from expo-modules-core src). Symptom: "N tests passed, 2 suites failed" with 0 failing tests.

Testing anything that imports `SaveRouteModal` (directly, or via `RoutePanel`): `@clerk/expo` won't resolve under vitest and `expo-router` pulls native code, so Vite import-analysis fails *before* `vi.mock` applies. Fix once in `vitest.config.ts` by aliasing `@clerk/expo`→`test/mocks/clerk-expo.tsx` and `expo-router`→`test/mocks/expo-router.tsx` (per-test `vi.mock` still overrides the alias for controlling `isSignedIn` etc). `SaveRouteModal` also calls `useSaveRoute`/`useQueryClient`, so wrap its render tree in a real `QueryClientProvider` and mock `@workspace/api-client-react` (`useSaveRoute`, `getListSavedRoutesQueryKey`) + `@/lib/localRoutes` (`saveLocalRoute`). Mock `@react-native-async-storage/async-storage` with an in-memory Map default export.
