import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Show } from "@clerk/react";
import { ArrowLeft, Check, Loader2, Trash2, X } from "lucide-react";
import {
  useListUserAccess,
  useSetUserAccess,
  getListUserAccessQueryKey,
} from "@workspace/api-client-react";
import type { UserAccess } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { useAccessStatus } from "@/hooks/use-access-status";

type AccessStatus = "pending" | "approved" | "rejected";

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const styles: Record<string, string> = {
    approved: "bg-primary/10 text-primary",
    pending: "bg-amber-100 text-amber-700",
    rejected: "bg-destructive/10 text-destructive",
  };
  const labels: Record<string, string> = {
    approved: t("admin.statusApproved"),
    pending: t("admin.statusPending"),
    rejected: t("admin.statusRejected"),
  };
  return (
    <span
      className={
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium " +
        (styles[status] ?? "bg-muted text-muted-foreground")
      }
    >
      {labels[status] ?? status}
    </span>
  );
}

function AdminContent() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isOwner, isLoading: accessLoading } = useAccessStatus();

  const usersQuery = useListUserAccess({
    query: {
      queryKey: getListUserAccessQueryKey(),
      enabled: isOwner,
    },
  });
  const setAccess = useSetUserAccess();

  const updateStatus = async (
    user: UserAccess,
    status: AccessStatus,
  ) => {
    try {
      await setAccess.mutateAsync({ id: user.userId, data: { status } });
      await queryClient.invalidateQueries({
        queryKey: getListUserAccessQueryKey(),
      });
    } catch {
      toast({
        variant: "destructive",
        title: t("admin.error"),
      });
    }
  };

  if (accessLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("admin.loading")}
      </div>
    );
  }

  if (!isOwner) {
    return (
      <Alert variant="destructive">
        <X className="h-4 w-4" />
        <AlertTitle>{t("admin.forbidden")}</AlertTitle>
      </Alert>
    );
  }

  const users = usersQuery.data ?? [];
  const pending = setAccess.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("admin.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("admin.back")}
        </Button>
      </div>

      {usersQuery.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("admin.loading")}
        </div>
      )}

      {usersQuery.isError && (
        <Alert variant="destructive">
          <X className="h-4 w-4" />
          <AlertDescription>{t("admin.error")}</AlertDescription>
        </Alert>
      )}

      {!usersQuery.isLoading && !usersQuery.isError && users.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("admin.empty")}</p>
      )}

      {users.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">{t("admin.colUser")}</th>
                <th className="px-4 py-3 font-medium">{t("admin.colStatus")}</th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("admin.colActions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.userId}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {user.email || t("admin.noEmail")}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {user.userId}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {user.status !== "approved" && (
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() => updateStatus(user, "approved")}
                        >
                          <Check className="mr-1 h-4 w-4" />
                          {t("admin.approve")}
                        </Button>
                      )}
                      {user.status !== "rejected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => updateStatus(user, "rejected")}
                        >
                          <Trash2 className="mr-1 h-4 w-4" />
                          {user.status === "approved"
                            ? t("admin.remove")
                            : t("admin.reject")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const { t } = useI18n();
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Show when="signed-out">
          <Alert variant="destructive">
            <X className="h-4 w-4" />
            <AlertTitle>{t("admin.forbidden")}</AlertTitle>
            <AlertDescription>
              <Button
                variant="link"
                className="px-0"
                onClick={() => setLocation("/sign-in")}
              >
                {t("auth.signIn")}
              </Button>
            </AlertDescription>
          </Alert>
        </Show>
        <Show when="signed-in">
          <AdminContent />
        </Show>
      </div>
    </div>
  );
}
