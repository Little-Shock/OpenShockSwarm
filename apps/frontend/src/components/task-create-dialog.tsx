"use client";

import { useState } from "react";
import { TaskQuickCreate } from "@/components/task-quick-create";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";
import type { Agent, IssueSummary } from "@/lib/types";

type TaskCreateDialogProps = {
  issueId?: string;
  agents: Agent[];
  issueOptions?: IssueSummary[];
  defaultIssueId?: string;
  buttonLabel?: string;
  title?: string;
  description?: string;
  buttonVariant?: "primary" | "secondary" | "ghost" | "tint";
  buttonSize?: "sm" | "md";
  buttonClassName?: string;
};

export function TaskCreateDialog({
  issueId,
  agents,
  issueOptions,
  defaultIssueId,
  buttonLabel = "Create Task",
  title = "Create Task",
  description,
  buttonVariant = "primary",
  buttonSize = "md",
  buttonClassName,
}: TaskCreateDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={buttonVariant}
        size={buttonSize}
        className={cn(
          "control-pill shrink-0",
          buttonClassName,
        )}
        onClick={() => setOpen(true)}
      >
        {buttonLabel}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
      >
        <TaskQuickCreate
          issueId={issueId}
          agents={agents}
          issueOptions={issueOptions}
          defaultIssueId={defaultIssueId}
          onCreated={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
