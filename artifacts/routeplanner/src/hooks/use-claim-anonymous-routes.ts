import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import {
  useClaimSavedRoutes,
  getListSavedRoutesQueryKey,
} from "@workspace/api-client-react";
import {
  getLegacyOwnerKey,
  clearLegacyOwnerKey,
} from "@/lib/owner-key-migration";

// Offers returning users a one-time import of routes they saved anonymously
// (under the old per-browser owner key) before sign-in existed. The prompt
// surfaces only while the user is signed in and the legacy key is still in this
// browser; once imported or dismissed the key is cleared so it never shows again.
export function useClaimAnonymousRoutes() {
  const { isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const claimMutation = useClaimSavedRoutes();

  const [legacyKey, setLegacyKey] = useState<string | null>(null);

  useEffect(() => {
    setLegacyKey(isSignedIn ? getLegacyOwnerKey() : null);
  }, [isSignedIn]);

  const dismiss = useCallback(() => {
    clearLegacyOwnerKey();
    setLegacyKey(null);
  }, []);

  const claim = useCallback(async (): Promise<number> => {
    if (!legacyKey) return 0;
    // Only clear the legacy key once the claim succeeds. On a transient
    // failure we keep it (and the prompt) so the user can retry instead of
    // permanently losing access to the anonymously-saved routes.
    const result = await claimMutation.mutateAsync({
      data: { anonymousKey: legacyKey },
    });
    await queryClient.invalidateQueries({
      queryKey: getListSavedRoutesQueryKey(),
    });
    clearLegacyOwnerKey();
    setLegacyKey(null);
    return result.claimed;
  }, [legacyKey, claimMutation, queryClient]);

  return {
    canClaim: legacyKey !== null,
    claim,
    dismiss,
    isClaiming: claimMutation.isPending,
  };
}
