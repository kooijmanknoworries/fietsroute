# Fietsrouteplanner — Project Context

## Stack
- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS 4, shadcn/ui components
- **Routing**: wouter
- **Maps**: MapLibre GL (via `react-map-gl`)
- **State**: React hooks + TanStack Query (`@tanstack/react-query`)
- **Auth**: Clerk (`@clerk/react`)
- **API Client**: Auto-generated from OpenAPI spec (`@workspace/api-client-react`)
- **Testing**: Vitest + Testing Library
- **Package Manager**: pnpm (workspace monorepo)

## Key Directories
| Path | Description |
|------|-------------|
| `artifacts/routeplanner/src/` | Frontend app source |
| `artifacts/routeplanner/src/pages/Home.tsx` | Main page — sidebar with route planner, map, controls |
| `artifacts/routeplanner/src/hooks/` | Custom React hooks (use-route-planner, use-ride, use-holiday-parks, etc.) |
| `artifacts/routeplanner/src/lib/` | Pure utility modules (holiday-parks, i18n, poi, map-view, etc.) |
| `artifacts/routeplanner/src/components/ui/` | shadcn/ui component library |
| `artifacts/routeplanner/src/components/` | App-specific components (Map, ElevationProfile, etc.) |
| `artifacts/routeplanner/src/lib/i18n.tsx` | i18n — English + Dutch translations keyed by string keys |
| `artifacts/routeplanner/vite.config.ts` | Vite config — requires `PORT` and `BASE_PATH` env vars |

## Dev Commands
```bash
cd artifacts/routeplanner
pnpm install
pnpm run dev          # requires PORT and BASE_PATH env vars
pnpm run typecheck    # run from workspace root
pnpm run test         # vitest run
```

## Architecture Notes
- **Monorepo**: Workspace root uses pnpm workspaces. Run `pnpm run typecheck` at root for full typecheck.
- **Hooks pattern**: Custom hooks encapsulate query logic + state (e.g., `use-holiday-parks` mirrors `use-municipality`).
- **i18n**: All user-facing strings use `t("key")` from `useTranslation()`. Keys are nested (e.g., `holiday.toggle`). Add both `en` and `nl` keys in `lib/i18n.tsx`.
- **Sidebar components**: Added in `Home.tsx` before the `<Separator />` that divides controls from the route list.
- **Search UI pattern**: Uses `Popover` + `Command` components (shadcn/ui command palette pattern) for searchable dropdowns.
- **Holiday Parks** (`lib/holiday-parks.ts`): Curated list of Dutch holiday parks. Selection persisted in localStorage.
