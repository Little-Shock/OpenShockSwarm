"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import type { Agent, IssueSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";

type TaskQuickCreateProps = {
  issueId?: string;
  agents: Agent[];
  issueOptions?: IssueSummary[];
  defaultIssueId?: string;
  onCreated?: () => void;
};

export function TaskQuickCreate({
  issueId,
  agents,
  issueOptions = [],
  defaultIssueId,
  onCreated,
}: TaskQuickCreateProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeAgentId, setAssigneeAgentId] = useState(agents[0]?.id ?? "");
  const [selectedIssueId, setSelectedIssueId] = useState(
    issueId ?? defaultIssueId ?? issueOptions[0]?.id ?? "",
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const resolvedIssueId = issueId ?? selectedIssueId;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType: "Task.create",
          targetType: "issue",
          targetId: resolvedIssueId,
          idempotencyKey: `task-create-${Date.now()}`,
          payload: {
            title,
            description,
            assigneeAgentId,
          },
        });
        setTitle("");
        setDescription("");
        setFeedback(null);
        router.refresh();
        onCreated?.();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Failed to create task.",
        );
      }
    });
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      {!issueId && issueOptions.length > 0 ? (
        <select
          value={selectedIssueId}
          onChange={(event) => setSelectedIssueId(event.target.value)}
          className="form-field"
        >
          {issueOptions.map((issue) => (
            <option key={issue.id} value={issue.id}>
              {issue.title} · {issue.id.replace("_", "#")}
            </option>
          ))}
        </select>
      ) : null}
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="New task title"
        className="form-field"
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Describe the task outcome and constraints."
        className="form-field min-h-28 resize-y"
      />
      {agents.length > 0 ? (
        <select
          value={assigneeAgentId}
          onChange={(event) => setAssigneeAgentId(event.target.value)}
          className="form-field"
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} · {agent.role}
            </option>
          ))}
        </select>
      ) : (
        <div className="rounded-[14px] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3 text-[12px] text-black/55">
          No agents available for assignment yet.
        </div>
      )}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={
            isPending ||
            title.trim().length === 0 ||
            resolvedIssueId.length === 0 ||
            assigneeAgentId.length === 0
          }
          variant="primary"
          size="sm"
          className="control-pill"
        >
          {isPending ? "Creating..." : "Create Task"}
        </Button>
      </div>
      {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
    </form>
  );
}
