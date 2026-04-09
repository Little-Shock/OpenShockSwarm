"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import { ActionMenu } from "@/components/ui/action-menu";

type RunActionStripProps = {
  runId: string;
  status: string;
  title: string;
};

export function RunActionStrip({
  runId,
  status,
  title,
}: RunActionStripProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(actionType: "Run.approve" | "Run.cancel") {
    startTransition(async () => {
      try {
        const response = (await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType,
          targetType: "run",
          targetId: runId,
          idempotencyKey: `${actionType}-${runId}-${Date.now()}`,
          payload: {},
        })) as { resultMessage: string };

        setFeedback(`${title}: ${response.resultMessage}`);
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Run action failed.",
        );
      }
    });
  }

  const canApprove =
    status === "approval_required" || status === "blocked" || status === "failed";
  const canCancel =
    status === "queued" ||
    status === "running" ||
    status === "approval_required" ||
    status === "blocked";

  if (!canApprove && !canCancel) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2">
      <ActionMenu
        items={[
          ...(canApprove
            ? [
                {
                  label: "Approve + Requeue",
                  onSelect: () => runAction("Run.approve"),
                  disabled: isPending,
                  tone: "primary" as const,
                },
              ]
            : []),
          ...(canCancel
            ? [
                {
                  label: "Stop Run",
                  onSelect: () => runAction("Run.cancel"),
                  disabled: isPending,
                },
              ]
            : []),
        ]}
      />
      {feedback ? (
        <p className="text-[11px] leading-5 text-black/60">{feedback}</p>
      ) : null}
    </div>
  );
}
