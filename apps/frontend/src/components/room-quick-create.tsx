"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import type { ActionResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";

type RoomKind = "discussion" | "issue";

type RoomQuickCreateProps = {
  workspaceId: string;
  onCreated?: (roomId: string) => void;
};

function roomIdFromResponse(response: ActionResponse) {
  return response.affectedEntities.find((entity) => entity.type === "room")?.id ?? "";
}

export function RoomQuickCreate({
  workspaceId,
  onCreated,
}: RoomQuickCreateProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const [kind, setKind] = useState<RoomKind>("discussion");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [priority, setPriority] = useState("medium");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = (await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType: kind === "issue" ? "Issue.create" : "Room.create",
          targetType: "workspace",
          targetId: workspaceId,
          idempotencyKey: `${kind}-create-${Date.now()}`,
          payload:
            kind === "issue"
              ? {
                  title,
                  summary,
                  priority,
                }
              : {
                  kind: "discussion",
                  title,
                  summary,
                },
        })) as ActionResponse;

        const roomId = roomIdFromResponse(response);
        setTitle("");
        setSummary("");
        setPriority("medium");
        setFeedback(null);
        router.refresh();
        if (roomId) {
          router.push(`/rooms/${roomId}`);
          onCreated?.(roomId);
          return;
        }
        onCreated?.("");
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Failed to create room.",
        );
      }
    });
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-2">
        {(["discussion", "issue"] as const).map((option) => {
          const active = kind === option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setKind(option)}
              className={`control-pill border transition ${
                active
                  ? "border-[var(--accent-blue)] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]"
                  : "border-[var(--border)] bg-[var(--surface-muted)] text-black/60"
              }`}
            >
              {option === "discussion" ? "Discussion" : "Issue"}
            </button>
          );
        })}
      </div>

      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={kind === "issue" ? "Issue title" : "Discussion room title"}
        className="form-field"
      />

      <textarea
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        placeholder={
          kind === "issue"
            ? "Describe the problem and expected outcome."
            : "Optional opening summary for the room."
        }
        className="form-field min-h-24 resize-y"
      />

      {kind === "issue" ? (
        <select
          value={priority}
          onChange={(event) => setPriority(event.target.value)}
          className="form-field"
        >
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      ) : null}

      <div className="flex items-center justify-end">
        <Button
          type="submit"
          disabled={isPending || title.trim().length === 0}
          variant="primary"
          size="sm"
          className="control-pill"
        >
          {isPending ? "Creating..." : "Create Room"}
        </Button>
      </div>
      {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
    </form>
  );
}
