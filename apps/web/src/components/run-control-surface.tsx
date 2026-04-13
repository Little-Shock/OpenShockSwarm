"use client";

import { useState } from "react";

import type { Run, Session } from "@/lib/phase-zero-types";

export type RunControlAction = "stop" | "resume" | "follow_thread";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusLabel(status: Run["status"] | Session["status"]) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "paused":
      return "已暂停";
    case "blocked":
      return "阻塞";
    case "review":
      return "待评审";
    case "done":
      return "已完成";
    default:
      return "待同步";
  }
}

function controlPermissionLabel(status: string) {
  switch (status) {
    case "allowed":
      return "可操作";
    case "blocked":
      return "无权限";
    case "signed_out":
      return "未登录";
    case "syncing":
      return "同步中";
    case "sync_failed":
      return "读取失败";
    default:
      return status || "待同步";
  }
}

type RunControlSurfaceProps = {
  scope: "room" | "run" | "topic";
  run: Run;
  session?: Session;
  canControl: boolean;
  controlStatus: string;
  controlBoundary: string;
  onControl: (action: RunControlAction, note: string) => Promise<void>;
};

export function RunControlSurface({
  scope,
  run,
  session,
  canControl,
  controlStatus,
  controlBoundary,
  onControl,
}: RunControlSurfaceProps) {
  const [note, setNote] = useState("");
  const [busyAction, setBusyAction] = useState<RunControlAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const prefix = scope === "room" ? "room-run" : scope === "topic" ? "topic-run" : "run-detail";
  const currentStatus = session?.status ?? run.status;
  const followThread = session?.followThread ?? run.followThread ?? false;
  const controlNote = session?.controlNote?.trim() || run.controlNote?.trim() || "";
  const isPaused = currentStatus === "paused";
  const isDone = currentStatus === "done";
  const hasGate = !canControl || controlStatus === "blocked" || controlStatus === "signed_out";

  async function handleAction(action: RunControlAction) {
    if (busyAction || hasGate || isDone) return;
    if (action === "stop" && isPaused) return;
    if (action === "resume" && !isPaused) return;

    setBusyAction(action);
    setActionError(null);
    try {
      await onControl(action, note.trim());
      setNote("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "执行控制失败");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">执行控制</p>
          <p data-testid={`${prefix}-control-status`} className="mt-2 font-display text-[18px] font-bold leading-6">
            {statusLabel(currentStatus)}
          </p>
        </div>
        <span
          data-testid={`${prefix}-follow-thread-status`}
          className={cn(
            "rounded-[4px] border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px]",
            followThread ? "bg-[var(--shock-lime)]" : "bg-[#ececec]"
          )}
        >
          {followThread ? "跟随当前线程" : "未锁定线程"}
        </span>
      </div>

      <p className="mt-3 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
        暂停会把当前执行和会话切到暂停态；恢复会继续沿当前会话往下走；锁定线程会让后续恢复继续贴着当前线程，不再新开分支执行。
      </p>

      <textarea
        data-testid={`${prefix}-control-note`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={busyAction !== null || hasGate || isDone}
        className="mt-4 min-h-[84px] w-full border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 py-3 text-[13px] outline-none disabled:opacity-60"
        placeholder="补充暂停、恢复或锁定线程的说明；留空则走默认文案。"
      />

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <button
          type="button"
          data-testid={`${prefix}-control-stop`}
          onClick={() => void handleAction("stop")}
          disabled={busyAction !== null || hasGate || isDone || isPaused}
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white disabled:opacity-60"
        >
          {busyAction === "stop" ? "暂停中..." : "暂停"}
        </button>
        <button
          type="button"
          data-testid={`${prefix}-control-resume`}
          onClick={() => void handleAction("resume")}
          disabled={busyAction !== null || hasGate || isDone || !isPaused}
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60"
        >
          {busyAction === "resume" ? "恢复中..." : "恢复"}
        </button>
        <button
          type="button"
          data-testid={`${prefix}-control-follow-thread`}
          onClick={() => void handleAction("follow_thread")}
          disabled={busyAction !== null || hasGate || isDone}
          className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] disabled:opacity-60"
        >
          {busyAction === "follow_thread" ? "写回中..." : "锁定线程"}
        </button>
      </div>

      <p
        data-testid={`${prefix}-control-authz`}
        className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]"
      >
        {controlPermissionLabel(controlStatus)}
      </p>
      {hasGate ? <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{controlBoundary}</p> : null}
      {controlNote ? (
        <p data-testid={`${prefix}-control-note-preview`} className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
          当前控制说明：{controlNote}
        </p>
      ) : null}
      {actionError ? (
        <p data-testid={`${prefix}-control-error`} className="mt-2 font-mono text-[11px] text-[var(--shock-pink)]">
          {actionError}
        </p>
      ) : null}
    </section>
  );
}
