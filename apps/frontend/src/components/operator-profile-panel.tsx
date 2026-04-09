"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { DEFAULT_OPERATOR_NAME, normalizeOperatorName } from "@/lib/operator";

type OperatorProfilePanelProps = {
  workspaceName: string;
};

const operatorTouchpoints = [
  "Room messages and discussion room creation",
  "Task status updates, approvals, and delivery actions",
  "Workspace repo binding changes in this shell",
];

export function OperatorProfilePanel({
  workspaceName,
}: OperatorProfilePanelProps) {
  const router = useRouter();
  const { operatorName, setOperatorName } = useCurrentOperator();
  const [draftName, setDraftName] = useState(operatorName);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setDraftName(operatorName);
  }, [operatorName]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = normalizeOperatorName(draftName);
    setOperatorName(nextName);
    setDraftName(nextName);
    setFeedback("Operator identity updated for member-triggered actions.");
    router.refresh();
  }

  function handleReset() {
    setOperatorName(DEFAULT_OPERATOR_NAME);
    setDraftName(DEFAULT_OPERATOR_NAME);
    setFeedback("Operator identity reset to the default shell profile.");
    router.refresh();
  }

  return (
    <Card className="rounded-[18px] px-4 py-4">
      <Eyebrow className="mb-2">Current Operator</Eyebrow>
      <div className="display-font text-xl font-black text-black/88">
        {operatorName}
      </div>
      <p className="mt-2 max-w-2xl text-[13px] leading-6 text-black/68">
        This name is stored in this browser and attached to member actions across
        the {workspaceName} shell.
      </p>

      <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label
            htmlFor="operator-name"
            className="text-[11px] font-medium uppercase tracking-[0.12em] text-black/45"
          >
            Display name
          </label>
          <input
            id="operator-name"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Enter the human operator name"
            className="form-field"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            className="control-pill"
          >
            Save Name
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="control-pill"
            onClick={handleReset}
            disabled={operatorName === DEFAULT_OPERATOR_NAME}
          >
            Reset Default
          </Button>
        </div>
      </form>

      <div className="mt-5 rounded-[16px] border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-black/45">
          Used for
        </div>
        <div className="mt-2 space-y-2">
          {operatorTouchpoints.map((item) => (
            <div
              key={item}
              className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] text-black/72"
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      {feedback ? <p className="mt-3 text-xs text-black/60">{feedback}</p> : null}
    </Card>
  );
}
