"use client";

import Link from "next/link";

import type { WorkspaceGovernanceEscalationRoomRollup } from "@/lib/phase-zero-types";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function governanceStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "进行中";
    case "ready":
      return "就绪";
    case "blocked":
      return "阻塞";
    case "done":
      return "完成";
    case "required":
      return "需要处理";
    case "watch":
      return "关注";
    case "draft":
      return "草稿";
    default:
      return "等待中";
  }
}

function governanceTone(status: string): "lime" | "yellow" | "pink" | "paper" | "white" | "ink" {
  switch (status) {
    case "done":
      return "ink";
    case "blocked":
      return "pink";
    case "active":
    case "required":
      return "yellow";
    case "ready":
      return "lime";
    case "watch":
      return "paper";
    default:
      return "white";
  }
}

function statusSurfaceClass(status: string) {
  switch (governanceTone(status)) {
    case "pink":
      return "bg-[var(--shock-pink)] text-white";
    case "lime":
      return "bg-[var(--shock-lime)]";
    case "yellow":
      return "bg-[var(--shock-yellow)]";
    case "ink":
      return "bg-[var(--shock-ink)] text-white";
    case "paper":
      return "bg-[var(--shock-paper)]";
    default:
      return "bg-white";
  }
}

function escalationRoomRollupSummary(entry: {
  escalationCount: number;
  blockedCount: number;
}) {
  const activeCount = Math.max(0, entry.escalationCount - entry.blockedCount);
  if (entry.blockedCount > 0 && activeCount > 0) {
    return `${entry.escalationCount} 项 · ${entry.blockedCount} 项阻塞 · ${activeCount} 项处理中`;
  }
  if (entry.blockedCount > 0) {
    return `${entry.escalationCount} 项 · ${entry.blockedCount} 项阻塞`;
  }
  return `${entry.escalationCount} 项 · 全部处理中`;
}

function ownerLabel(entry: WorkspaceGovernanceEscalationRoomRollup) {
  return entry.currentOwner?.trim() || "等待负责人";
}

function ownerSummary(entry: WorkspaceGovernanceEscalationRoomRollup) {
  if (entry.currentLane?.trim()) {
    return `当前分工 ${entry.currentLane}`;
  }
  return "当前分工待补齐";
}

function routeLabel(entry: WorkspaceGovernanceEscalationRoomRollup) {
  if (entry.nextRouteLabel?.trim()) {
    return entry.nextRouteLabel;
  }
  switch (entry.nextRouteStatus) {
    case "blocked":
      return "等待解除当前阻塞";
    case "done":
      return "当前链路已收口";
    case "ready":
      return "下一棒已就绪";
    case "active":
      return "下一棒正在推进";
    default:
      return "等待下一棒";
  }
}

function routeSummary(entry: WorkspaceGovernanceEscalationRoomRollup) {
  if (entry.nextRouteSummary?.trim()) {
    return entry.nextRouteSummary;
  }
  switch (entry.nextRouteStatus) {
    case "blocked":
      return "当前仍有阻塞点，解除后会继续往下一棒推进。";
    case "done":
      return "当前多房间治理链路已经收口。";
    case "ready":
      return "当前房间已经满足起下一棒的条件。";
    case "active":
      return "当前下一棒已经起单，正在沿治理链继续推进。";
    default:
      return "当前下一步治理建议正在整理中。";
  }
}

export type GovernanceEscalationGraphProps = {
  entries: WorkspaceGovernanceEscalationRoomRollup[];
  testIdPrefix: string;
  highlightRoomId?: string;
  compact?: boolean;
};

export function GovernanceEscalationGraph({
  entries,
  testIdPrefix,
  highlightRoomId,
  compact = false,
}: GovernanceEscalationGraphProps) {
  return (
    <div
      data-testid={`${testIdPrefix}-graph`}
      className={cn(
        "rounded-[18px] border-2 border-[var(--shock-ink)] bg-white",
        compact ? "px-3 py-3" : "px-4 py-4"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            cross-room dependency graph
          </p>
          <p className={cn("mt-2 font-display font-bold", compact ? "text-xl" : "text-2xl")}>多房间接力图</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            把每个 hot room 重新整理成「讨论间 → 当前负责人/分工 → 下一棒」；不用逐条读长卡，也能一眼看出卡在哪、接给谁。
          </p>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {entries.length} rooms
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {entries.length === 0 ? (
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            当前没有需要跨房间治理的 hot room；新的治理链路会直接出现在这里。
          </p>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.roomId}
              data-testid={`${testIdPrefix}-graph-room-${entry.roomId}`}
              className={cn(
                "rounded-[16px] border-2 border-[var(--shock-ink)]",
                compact ? "px-3 py-3" : "px-4 py-4",
                highlightRoomId === entry.roomId ? "bg-[var(--shock-yellow)]/35" : "bg-[var(--shock-paper)]"
              )}
            >
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      讨论间
                    </p>
                    <span
                      className={cn(
                        "rounded-full border border-[var(--shock-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                        statusSurfaceClass(entry.status)
                      )}
                    >
                      {governanceStatusLabel(entry.status)}
                    </span>
                    {highlightRoomId === entry.roomId ? (
                      <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                        current room
                      </span>
                    ) : null}
                  </div>
                  <p className={cn("mt-2 font-display font-semibold", compact ? "text-base" : "text-lg")}>{entry.roomTitle}</p>
                  <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{escalationRoomRollupSummary(entry)}</p>
                  {entry.latestLabel ? <p className="mt-2 text-sm font-semibold leading-6">{entry.latestLabel}</p> : null}
                  {entry.latestSummary ? (
                    <p className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{entry.latestSummary}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.href ? (
                      <Link
                        href={entry.href}
                        className="inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                      >
                        查看讨论
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div
                  data-testid={`${testIdPrefix}-graph-owner-${entry.roomId}`}
                  className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3"
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                    当前负责人
                  </p>
                  <p className={cn("mt-2 font-display font-semibold", compact ? "text-base" : "text-lg")}>{ownerLabel(entry)}</p>
                  <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{ownerSummary(entry)}</p>
                </div>

                <div
                  data-testid={`${testIdPrefix}-graph-route-${entry.roomId}`}
                  className={cn(
                    "rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-3",
                    statusSurfaceClass(entry.nextRouteStatus ?? "pending")
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em]">下一棒</p>
                    <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
                      {governanceStatusLabel(entry.nextRouteStatus ?? "pending")}
                    </span>
                  </div>
                  <p className={cn("mt-2 font-display font-semibold", compact ? "text-base" : "text-lg")}>{routeLabel(entry)}</p>
                  <p className="mt-2 text-sm leading-6">{routeSummary(entry)}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entry.nextRouteHref ? (
                      <Link
                        href={entry.nextRouteHref}
                        className="inline-flex rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                      >
                        打开下一步
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
