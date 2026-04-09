export type PlanningMirrorHrefOptions = {
  roomId?: string | null;
  issueKey?: string | null;
  returnTo?: string | null;
  returnLabel?: string | null;
};

export function buildPlanningMirrorHref(options: PlanningMirrorHrefOptions = {}) {
  const searchParams = new URLSearchParams();

  if (options.roomId) {
    searchParams.set("roomId", options.roomId);
  }

  if (options.issueKey) {
    searchParams.set("issueKey", options.issueKey);
  }

  if (options.returnTo?.startsWith("/")) {
    searchParams.set("returnTo", options.returnTo);
  }

  if (options.returnLabel) {
    searchParams.set("returnLabel", options.returnLabel);
  }

  const query = searchParams.toString();
  return query ? `/board?${query}` : "/board";
}
