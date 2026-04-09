"use client";

import { FormEvent, KeyboardEvent, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import { Button } from "@/components/ui/button";

type RoomActionComposerProps = {
  roomId: string;
};

export function RoomActionComposer({ roomId }: RoomActionComposerProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType: "RoomMessage.post",
          targetType: "room",
          targetId: roomId,
          idempotencyKey: `room-message-${Date.now()}`,
          payload: { body, kind: "message" },
        });
        setBody("");
        setFeedback(null);
        router.refresh();
      } catch (error) {
        setFeedback(
          error instanceof Error ? error.message : "Failed to post message.",
        );
      }
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} className="flex items-end gap-3" onSubmit={handleSubmit}>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="发消息，支持 @agent_xxx ..."
        className="min-h-[88px] flex-1 resize-y rounded-[12px] border border-[var(--border)] bg-white px-3.5 py-3 text-[13px] leading-5 text-black/80 outline-none transition placeholder:text-[13px] placeholder:text-black/42 focus:border-[var(--accent-blue)]"
      />
      <div className="shrink-0">
        <Button
          type="submit"
          disabled={isPending || body.trim().length === 0}
          variant="primary"
          size="sm"
          className="control-pill"
        >
          {isPending ? "Sending..." : "Send"}
        </Button>
      </div>
      {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
    </form>
  );
}
