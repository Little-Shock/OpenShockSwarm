"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import { ActionMenu } from "@/components/ui/action-menu";

type TaskActionStripProps = {
  taskId: string;
  issueId: string;
  taskTitle: string;
  compact?: boolean;
  showContextHint?: boolean;
};

export function TaskActionStrip({
  taskId,
  issueId,
  taskTitle,
  compact = false,
  showContextHint = true,
}: TaskActionStripProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(actionType: string) {
    startTransition(async () => {
      try {
        const response = (await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType,
          targetType: "task",
          targetId: taskId,
          idempotencyKey: `${actionType}-${taskId}-${Date.now()}`,
          payload: {},
        })) as {
          resultMessage: string;
        };

        setFeedback(`${taskTitle}: ${response.resultMessage}`);
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Action request failed.",
        );
      }
    });
  }

  return (
    <div className={compact ? "space-y-2" : "mt-4 space-y-3"}>
      <ActionMenu
        items={[
          {
            label: "Queue Run",
            onSelect: () => runAction("Run.create"),
            disabled: isPending,
            tone: "primary",
          },
          {
            label: "Ready for Integration",
            onSelect: () => runAction("Task.mark_ready_for_integration"),
            disabled: isPending,
          },
          {
            label: "Request Merge",
            onSelect: () => runAction("GitIntegration.merge.request"),
            disabled: isPending,
            tone: "tint",
          },
        ]}
      />
      {feedback ? (
        <p className={compact ? "text-[10px] leading-4 text-black/55" : "text-[11px] leading-5 text-black/60"}>
          {feedback}
        </p>
      ) : null}
      {showContextHint ? (
        <div className={compact ? "text-[9px] uppercase tracking-[0.12em] text-black/40" : "text-[10px] uppercase tracking-[0.14em] text-black/45"}>
          Routed via {issueId.replace("_", "#")}
        </div>
      ) : null}
    </div>
  );
}
