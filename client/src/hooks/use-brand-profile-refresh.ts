import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";

type ProfileRefreshStatus = {
  status: "running" | "done" | "error" | "needs_review" | "idle";
  reason?: string;
  updated?: string[];
  finishedAt?: number | string;
};
type SavedProfileRefreshStatus = ProfileRefreshStatus & { companyId: string };

const profileRefreshKey = (companyId: string) => ["/api/brand", companyId, "refresh-profile", "status"];

export function profileRefreshMessage(status?: ProfileRefreshStatus): string {
  if (!status || status.status === "idle") return "";
  if (status.reason) return status.reason;
  if (status.status === "running") return "Refreshing saved facts. You can leave this page and return to check progress.";
  if (status.status === "needs_review") return "Profile refresh needs review. Check the official website and retained facts.";
  if (status.status === "error") return "The profile could not be refreshed. Please try again.";
  if (status.status === "done") return status.updated?.length ? "Profile refreshed. New information has been saved." : "Profile checked. No saved facts changed.";
  return "The refresh has not reported an outcome yet.";
}

export function useBrandProfileRefresh(companyId: string, enabled = true) {
  const queryClient = useQueryClient();
  const handledCompletion = useRef("");
  const statusQuery = useQuery<SavedProfileRefreshStatus>({
    queryKey: profileRefreshKey(companyId),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/brand/${companyId}/refresh-profile/status`, { credentials: "include", headers: getAuthHeaders(), signal });
      if (!response.ok) throw new Error("Refresh progress could not be checked. Please try again.");
      return { ...await response.json(), companyId };
    },
    enabled,
    staleTime: 5_000,
    refetchOnMount: "always",
    retry: false,
    refetchInterval: query => query.state.status !== "error" && query.state.data?.status === "running" ? 5_000 : false,
  });
  const refresh = useMutation({
    onMutate: async (targetCompanyId: string) => {
      await queryClient.cancelQueries({ queryKey: profileRefreshKey(targetCompanyId) });
      queryClient.setQueryData(profileRefreshKey(targetCompanyId), { companyId: targetCompanyId, status: "running" });
    },
    mutationFn: async (targetCompanyId: string): Promise<ProfileRefreshStatus> => (await apiRequest("POST", `/api/brand/enrich/${targetCompanyId}`, {})).json(),
    onSuccess: (out, targetCompanyId) => {
      queryClient.setQueryData(profileRefreshKey(targetCompanyId), { ...out, companyId: targetCompanyId });
    },
    onError: (error: Error, targetCompanyId) => {
      queryClient.setQueryData(profileRefreshKey(targetCompanyId), { companyId: targetCompanyId, status: "error", reason: error.message || "The profile could not be refreshed." });
    },
  });
  const status = statusQuery.data?.companyId === companyId ? statusQuery.data : undefined;
  useEffect(() => {
    if (!enabled || !status || status.status === "idle") return;
    if (status.status === "running") { handledCompletion.current = ""; return; }
    const completion = JSON.stringify(status);
    if (handledCompletion.current === completion) return;
    handledCompletion.current = completion;
    for (const queryKey of [
      ["/api/brand", companyId, "profile"],
      ["/api/brand", companyId, "preparation"],
      ["/api/brand", companyId, "ai-take"],
      ["/api/crm/companies", companyId],
    ]) void queryClient.invalidateQueries({ queryKey });
  }, [companyId, enabled, queryClient, status]);
  return {
    mutate: () => refresh.mutate(companyId),
    isPending: enabled && ((refresh.isPending && refresh.variables === companyId) || (!statusQuery.isError && status?.status === "running")),
    message: enabled ? statusQuery.isError ? (statusQuery.error as Error).message : profileRefreshMessage(status) : "",
  };
}
