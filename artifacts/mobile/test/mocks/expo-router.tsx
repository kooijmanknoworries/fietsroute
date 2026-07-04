import React from "react";

// Minimal expo-router stand-in so navigation-aware components render under
// jsdom. Tests override these via vi.mock when they need to assert navigation.
export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    back: () => {},
    navigate: () => {},
  };
}

export function useLocalSearchParams() {
  return {} as Record<string, string>;
}

export function usePathname() {
  return "/";
}

export type Href = string;

export const Link = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
);

export const Stack = Object.assign(
  ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  { Screen: (_props: Record<string, unknown>) => null },
);

export const Redirect = (_props: { href: string }) => null;
