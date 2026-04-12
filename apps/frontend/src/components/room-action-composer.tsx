"use client";

import { FormEvent, KeyboardEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import {
  applyMentionSuggestion,
  buildMentionSuggestions,
  filterMentionSuggestions,
  findCompletionMatch,
  parseMentionSegments,
} from "@/lib/mentions";
import type { Agent, RoomSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type RoomActionComposerProps = {
  roomId: string;
  agents: Agent[];
  rooms: RoomSummary[];
  directRooms: RoomSummary[];
  placeholder?: string;
};

export function RoomActionComposer({
  roomId,
  agents,
  rooms,
  directRooms,
  placeholder = "发消息，支持 @agent 和 #room ...",
}: RoomActionComposerProps) {
  const router = useRouter();
  const { member, operatorName, sessionToken } = useCurrentOperator();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [highlightScrollTop, setHighlightScrollTop] = useState(0);
  const [highlightScrollLeft, setHighlightScrollLeft] = useState(0);
  const [selectionStart, setSelectionStart] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);

  const mentionSuggestions = buildMentionSuggestions(agents, rooms, directRooms, member);
  const completionMatch = findCompletionMatch(body, selectionStart);
  const filteredSuggestions = filterMentionSuggestions(mentionSuggestions, completionMatch).slice(0, 8);
  const bodySegments = parseMentionSegments(body, mentionSuggestions, member);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const messageBody = body.trim();
    if (messageBody.length === 0) {
      return;
    }

    setBody("");
    setFeedback(null);
    void submitAction(
      {
        actorType: "member",
        actorId: operatorName,
        actionType: "RoomMessage.post",
        targetType: "room",
        targetId: roomId,
        idempotencyKey: `room-message-${Date.now()}`,
        payload: { body: messageBody, kind: "message" },
      },
      { sessionToken },
    )
      .then(() => {
        router.refresh();
      })
      .catch((error) => {
        setBody((current) => current || messageBody);
        setFeedback(
          error instanceof Error ? error.message : "Failed to post message.",
        );
      });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (filteredSuggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveSuggestionIndex((current) =>
          current + 1 >= filteredSuggestions.length ? 0 : current + 1,
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveSuggestionIndex((current) =>
          current - 1 < 0 ? filteredSuggestions.length - 1 : current - 1,
        );
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        const activeSuggestion = filteredSuggestions[activeSuggestionIndex] ?? filteredSuggestions[0];
        if (activeSuggestion && completionMatch) {
          selectSuggestion(activeSuggestion);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setActiveSuggestionIndex(0);
        return;
      }
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    formRef.current?.requestSubmit();
  }

  function selectSuggestion(suggestion: (typeof filteredSuggestions)[number]) {
    if (!completionMatch) {
      return;
    }

    const next = applyMentionSuggestion(body, completionMatch, suggestion);
    setBody(next.value);
    setSelectionStart(next.caret);
    setActiveSuggestionIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.caret, next.caret);
    });
  }

  function handleBodyChange(value: string, nextSelectionStart: number) {
    setBody(value);
    setSelectionStart(nextSelectionStart);
    setFeedback(null);
    setActiveSuggestionIndex(0);
  }

  return (
    <form ref={formRef} className="flex flex-col gap-3" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="relative min-w-0 flex-1">
          <div className="relative overflow-hidden rounded-[12px] border border-[var(--border)] bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.78)] transition focus-within:border-[var(--accent-blue)]">
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 overflow-hidden px-3.5 py-3 text-[13px] leading-5",
                isComposing && "opacity-0",
              )}
              style={{
                transform: `translate(${-highlightScrollLeft}px, ${-highlightScrollTop}px)`,
              }}
            >
              {body ? (
                <div className="whitespace-pre-wrap break-words text-black/80">
                  {bodySegments.map((segment) => (
                    <span
                      key={segment.key}
                      className={cn(
                        segment.kind === "text" && "text-black/80",
                        segment.kind === "agent" &&
                          "rounded-[5px] bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]",
                        segment.kind === "room" &&
                          "rounded-[5px] bg-[#f2edff] text-[#6b4fd3]",
                        segment.kind === "member" &&
                          "rounded-[5px] bg-[#fff1c8] text-[#9a6a00]",
                        segment.isCurrentUser &&
                          "bg-[#ffe8a3] text-[#7d5600] shadow-[inset_0_0_0_1px_rgba(188,139,0,0.16)]",
                      )}
                    >
                      {segment.text}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words text-black/42">{placeholder}</div>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(event) =>
                handleBodyChange(
                  event.target.value,
                  event.target.selectionStart ?? event.target.value.length,
                )
              }
              onKeyDown={handleKeyDown}
              onClick={(event) =>
                setSelectionStart(event.currentTarget.selectionStart ?? body.length)
              }
              onSelect={(event) =>
                setSelectionStart(event.currentTarget.selectionStart ?? body.length)
              }
              onCompositionStart={() => {
                setIsComposing(true);
              }}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                handleBodyChange(
                  event.currentTarget.value,
                  event.currentTarget.selectionStart ?? event.currentTarget.value.length,
                );
              }}
              onScroll={(event) => {
                setHighlightScrollTop(event.currentTarget.scrollTop);
                setHighlightScrollLeft(event.currentTarget.scrollLeft);
              }}
              className={cn(
                "relative z-10 min-h-[80px] w-full resize-y bg-transparent px-3.5 py-3 text-[13px] leading-5 outline-none caret-black selection:bg-[var(--accent-blue)]/18 sm:min-h-[88px]",
                isComposing
                  ? "text-black/80 placeholder:text-black/42"
                  : "text-transparent placeholder:text-transparent",
              )}
              style={{
                WebkitTextFillColor: isComposing ? "rgba(31,35,41,0.8)" : "transparent",
              }}
            />
          </div>

          {filteredSuggestions.length > 0 && !isComposing ? (
            <div className="absolute left-0 right-0 top-full z-20 mt-2 rounded-[12px] border border-[var(--border)] bg-white p-1.5 shadow-[0_18px_42px_rgba(31,35,41,0.14)]">
              <div className="space-y-1">
                {filteredSuggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectSuggestion(suggestion);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left transition",
                      index === activeSuggestionIndex
                        ? "bg-[var(--accent-blue-soft)]"
                        : "hover:bg-[var(--surface-muted)]",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-black/82">
                        {suggestion.primaryLabel}
                      </div>
                      {suggestion.secondaryLabel ? (
                        <div className="truncate text-[11px] text-black/52">
                          {suggestion.secondaryLabel}
                        </div>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                        suggestion.kind === "agent" &&
                          "bg-[var(--accent-blue-soft)] text-[var(--accent-blue)]",
                        suggestion.kind === "room" && "bg-[#f2edff] text-[#6b4fd3]",
                        suggestion.kind === "member" && "bg-[#fff1c8] text-[#9a6a00]",
                      )}
                    >
                      {suggestion.trigger === "@" ? "mention" : "room"}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="shrink-0 sm:self-end">
          <Button
            type="submit"
            disabled={body.trim().length === 0}
            variant="primary"
            size="sm"
            className="control-pill w-full sm:w-auto"
          >
            Send
          </Button>
        </div>
      </div>
      {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
    </form>
  );
}
