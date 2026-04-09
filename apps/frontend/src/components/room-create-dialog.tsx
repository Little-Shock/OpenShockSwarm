"use client";

import { useState } from "react";
import { RoomQuickCreate } from "@/components/room-quick-create";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

type RoomCreateDialogProps = {
  workspaceId: string;
};

export function RoomCreateDialog({ workspaceId }: RoomCreateDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="tint"
        size="sm"
        className="control-pill"
        onClick={() => setOpen(true)}
      >
        New Room
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Room"
      >
        <RoomQuickCreate
          workspaceId={workspaceId}
          onCreated={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
