"use client";

import { useEffect, useRef } from "react";
import { useCurrentOperator } from "@/components/operator-provider";
import { RoomMessageCard } from "@/components/room-message-card";
import { markRoomRead } from "@/lib/api";
import { ROOM_READ_EVENT } from "@/lib/room-read-events";
import { isScrollNearBottom, useAutoScrollBottom } from "@/lib/use-auto-scroll-bottom";
import type { Agent, Message, RoomSummary } from "@/lib/types";

type RoomMessageStreamProps = {
  roomId: string;
  unreadCount: number;
  messages: Message[];
  agents: Agent[];
  rooms: RoomSummary[];
  directRooms: RoomSummary[];
};

export function RoomMessageStream({
  roomId,
  unreadCount,
  messages,
  agents,
  rooms,
  directRooms,
}: RoomMessageStreamProps) {
  const { sessionToken } = useCurrentOperator();
  const lastMessage = messages[messages.length - 1];
  const changeKey = lastMessage
    ? `${messages.length}:${lastMessage.id}:${lastMessage.createdAt}`
    : "empty";
  const containerRef = useAutoScrollBottom<HTMLDivElement>(changeKey);
  const pendingMessageIdRef = useRef("");
  const lastMarkedMessageIdRef = useRef("");

  useEffect(() => {
    const element = containerRef.current;
    const latestMessageId = lastMessage?.id ?? "";
    if (!element || !latestMessageId) {
      return;
    }

    const tryMarkRead = () => {
      if (unreadCount <= 0) {
        lastMarkedMessageIdRef.current = latestMessageId;
        return;
      }
      if (
        pendingMessageIdRef.current === latestMessageId ||
        lastMarkedMessageIdRef.current === latestMessageId
      ) {
        return;
      }
      if (
        !isScrollNearBottom(
          element.scrollTop,
          element.clientHeight,
          element.scrollHeight,
        )
      ) {
        return;
      }

      pendingMessageIdRef.current = latestMessageId;
      void markRoomRead(roomId, { messageId: latestMessageId }, { sessionToken })
        .then(() => {
          lastMarkedMessageIdRef.current = latestMessageId;
          window.dispatchEvent(
            new CustomEvent(ROOM_READ_EVENT, {
              detail: { roomId },
            }),
          );
        })
        .catch(() => {
          // Keep the stream responsive even if the read receipt request races or fails.
        })
        .finally(() => {
          if (pendingMessageIdRef.current === latestMessageId) {
            pendingMessageIdRef.current = "";
          }
        });
    };

    const frame = window.requestAnimationFrame(tryMarkRead);
    element.addEventListener("scroll", tryMarkRead, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      element.removeEventListener("scroll", tryMarkRead);
    };
  }, [containerRef, lastMessage?.id, roomId, sessionToken, unreadCount]);

  return (
    <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        {messages.map((message) => (
          <RoomMessageCard
            key={message.id}
            message={message}
            agents={agents}
            rooms={rooms}
            directRooms={directRooms}
          />
        ))}
      </div>
    </div>
  );
}
