import React from "react";

// Minimal @clerk/expo stand-in so components that read auth state can render
// under jsdom. Tests override these via vi.mock when they need specific values.
export function useAuth() {
  return {
    isSignedIn: false,
    isLoaded: true,
    userId: null as string | null,
    signOut: async () => {},
    getToken: async () => null,
  };
}

export function useUser() {
  return { isSignedIn: false, isLoaded: true, user: null };
}

export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export const SignedIn = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
);
export const SignedOut = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
);
