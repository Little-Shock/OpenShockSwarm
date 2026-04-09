"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import { Button } from "@/components/ui/button";

type DeliveryPRActionProps = {
  issueId: string;
  integrationStatus: string;
  existingDeliveryPRId?: string | null;
};

export function DeliveryPRAction({
  issueId,
  integrationStatus,
  existingDeliveryPRId,
}: DeliveryPRActionProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canCreate =
    integrationStatus === "ready_for_delivery" && !existingDeliveryPRId;

  function handleCreate() {
    if (!canCreate) {
      return;
    }

    startTransition(async () => {
      try {
        const response = (await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType: "DeliveryPR.create.request",
          targetType: "issue",
          targetId: issueId,
          idempotencyKey: `delivery-pr-${issueId}-${Date.now()}`,
          payload: {},
        })) as { resultMessage: string };

        setFeedback(response.resultMessage);
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Failed to create delivery PR.",
        );
      }
    });
  }

  return (
    <div className="space-y-3">
      <Button
        disabled={!canCreate || isPending}
        onClick={handleCreate}
        variant="primary"
        size="sm"
        className="control-pill"
      >
        {existingDeliveryPRId ? "Delivery PR Open" : "Create Delivery PR"}
      </Button>
      {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
    </div>
  );
}
