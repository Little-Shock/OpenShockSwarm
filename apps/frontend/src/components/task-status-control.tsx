"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";

const EDITABLE_TASK_STATUSES = [
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "ready_for_integration", label: "Ready for Integration" },
] as const;

function taskStatusStyles(status: string) {
  switch (status) {
    case "integrated":
      return "bg-[#e8f7ec] text-[#1f8f4d]";
    case "in_progress":
      return "bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]";
    case "todo":
      return "bg-[var(--surface-muted)] text-black/70";
    case "blocked":
      return "bg-orange-100 text-orange-700";
    case "ready_for_integration":
      return "bg-[#eef6ff] text-[#245bdb]";
    default:
      return "bg-[var(--surface-muted)] text-black/60";
  }
}

type TaskStatusControlProps = {
  taskId: string;
  taskTitle: string;
  status: string;
};

export function TaskStatusControl({
  taskId,
  taskTitle,
  status,
}: TaskStatusControlProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const [draftStatus, setDraftStatus] = useState(status);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const editable = EDITABLE_TASK_STATUSES.some((item) => item.value === status);

  function submitStatus(nextStatus: string) {
    startTransition(async () => {
      try {
        const response = (await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType: "Task.status.set",
          targetType: "task",
          targetId: taskId,
          idempotencyKey: `task-status-${taskId}-${nextStatus}-${Date.now()}`,
          payload: { status: nextStatus },
        })) as { resultMessage: string };
        setFeedback(`${taskTitle}: ${response.resultMessage}`);
        setEditing(false);
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Failed to update task status.",
        );
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${taskStatusStyles(status)}`}
        >
          {status.replaceAll("_", " ")}
        </span>
        {editable ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setDraftStatus(status);
              setEditing((value) => !value);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-[8px] border border-[var(--border)] bg-white text-[11px] text-black/55 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Edit task status"
          >
            ✎
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="w-[170px] rounded-[14px] border border-[var(--border)] bg-white p-2 shadow-[0_8px_20px_rgba(31,35,41,0.08)]">
          <select
            value={draftStatus}
            onChange={(event) => setDraftStatus(event.target.value)}
            className="w-full rounded-[10px] border border-[var(--border)] bg-white px-3 py-2 text-[11px] font-medium outline-none"
          >
            {EDITABLE_TASK_STATUSES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setDraftStatus(status);
                setEditing(false);
              }}
              className="rounded-[8px] border border-[var(--border)] bg-[var(--surface-muted)] px-2.25 py-[0.32rem] text-[10px] font-medium leading-none text-black/65"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isPending || draftStatus === status}
              onClick={() => submitStatus(draftStatus)}
              className="rounded-[8px] border border-[var(--accent-blue)] bg-[var(--accent-blue)] px-2.25 py-[0.32rem] text-[10px] font-medium leading-none text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
      {feedback ? (
        <p className="max-w-[220px] text-right text-[10px] leading-4 text-black/45">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
