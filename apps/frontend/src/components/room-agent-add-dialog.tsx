"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { submitAction } from "@/lib/api";
import type { Agent } from "@/lib/types";

type RoomAgentAddDialogProps = {
  roomId: string;
  agents: Agent[];
  joinedAgentIds: string[];
};

export function RoomAgentAddDialog({
  roomId,
  agents,
  joinedAgentIds,
}: RoomAgentAddDialogProps) {
  const router = useRouter();
  const { operatorName, sessionToken } = useCurrentOperator();
  const [open, setOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const availableAgents = useMemo(
    () => agents.filter((agent) => !joinedAgentIds.includes(agent.id)),
    [agents, joinedAgentIds],
  );

  function openDialog() {
    setSelectedAgentId(availableAgents[0]?.id ?? "");
    setFeedback(null);
    setOpen(true);
  }

  function closeDialog() {
    if (isPending) {
      return;
    }
    setOpen(false);
    setFeedback(null);
  }

  async function handleAddAgent() {
    if (!selectedAgentId || isPending) {
      return;
    }

    setIsPending(true);
    setFeedback(null);
    try {
      await submitAction(
        {
          actorType: "member",
          actorId: operatorName,
          actionType: "RoomAgent.add",
          targetType: "room",
          targetId: roomId,
          idempotencyKey: `room-agent-add-${roomId}-${selectedAgentId}-${Date.now()}`,
          payload: {
            agentId: selectedAgentId,
          },
        },
        { sessionToken },
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to add agent to room.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        className="control-pill"
        disabled={availableAgents.length === 0}
        onClick={openDialog}
      >
        Add Agent
      </Button>
      <Modal
        open={open}
        onClose={closeDialog}
        title="Add Agent To Room"
        description="Join a workspace agent to this room so it becomes part of the room context before it is directly mentioned by name."
      >
        <div className="space-y-3">
          <select
            value={selectedAgentId}
            onChange={(event) => setSelectedAgentId(event.target.value)}
            className="form-field"
          >
            {availableAgents.length > 0 ? (
              availableAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))
            ) : (
              <option value="">All workspace agents are already in this room.</option>
            )}
          </select>
          {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="control-pill"
              disabled={availableAgents.length === 0 || !selectedAgentId || isPending}
              onClick={() => void handleAddAgent()}
            >
              {isPending ? "Adding..." : "Add Agent"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
