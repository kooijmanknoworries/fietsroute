import { useAuth } from "@clerk/expo";
import {
  useGetMyAccess,
  getGetMyAccessQueryKey,
} from "@workspace/api-client-react";

// Exposes the signed-in user's approval status for the access gate. New sign-ins
// land as "pending" (read-only map, Save route / Start ride disabled) until the
// owner approves them; the owner email is auto-approved server-side. The query
// only runs while signed in — anonymous visitors browse read-only without it.
export function useAccessStatus() {
  const { isSignedIn } = useAuth();

  const query = useGetMyAccess({
    query: {
      queryKey: getGetMyAccessQueryKey(),
      enabled: !!isSignedIn,
    },
  });

  const status = query.data?.status ?? null;

  return {
    isApproved: status === "approved",
    isPending: !!isSignedIn && status === "pending",
    isRejected: !!isSignedIn && status === "rejected",
    isOwner: !!query.data?.isOwner,
    status,
    isLoading: !!isSignedIn && query.isLoading,
  };
}
