import React from "react";

export function useSafeAreaInsets() {
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

export function SafeAreaProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export const SafeAreaView = ({ children }: { children?: React.ReactNode }) => (
  <>{children}</>
);
