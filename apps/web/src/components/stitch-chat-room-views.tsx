"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { QuickSearchSurface, StitchSidebar, StitchTopBar, WorkspaceStatusStrip } from "@/components/stitch-shell-primitives";
import { useQuickSearchController } from "@/lib/quick-search";
import {
  type Message,
  type PhaseZeroState,
  type Room,
} from "@/lib/mock-data";
import { type RoomStreamEvent, usePhaseZeroState } from "@/lib/live-phase0";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import { RunControlSurface } from "@/components/run-control-surface";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function roleLabel(role: Message["role"]) {
  switch (role) {
    case "human":
      return "人类";
    case "agent":
      return "Agent";
    default:
      return "System";
  }
}

function pullRequestStatusLabel(status?: string) {
  switch (status) {
    case "draft":
      return "草稿";
    case "open":
      return "已打开";
    case "in_review":
      return "评审中";
    case "changes_requested":
      return "待修改";
    case "merged":
      return "已合并";
    default:
      return "未创建";
  }
}

function runStatusLabel(status?: string) {
  switch (status) {
    case "running":
      return "执行中";
    case "paused":
      return "已暂停";
    case "review":
      return "评审中";
    case "blocked":
      return "阻塞";
    case "done":
      return "已完成";
    default:
      return "待同步";
  }
}

function DiscussionStateMessage({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[3px_3px_0_0_var(--shock-ink)]">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-3 max-w-xl text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{message}</p>
    </section>
  );
}

const MARKER_PATTERN =
  /(PR\s?#\d+|#\d+|TC-\d+|TKT-\d+|CHK-\d+|TS\d+|@[A-Za-z0-9_\u4e00-\u9fa5-]+|origin\/[A-Za-z0-9._/-]+|feat\/[A-Za-z0-9._/-]+|verify:[A-Za-z0-9._/-]+|in_progress|in_review|todo|done|MERGED|PASS|FAIL|OPEN|CLEAN|MERGEABLE)/g;

function renderMarkedMessage(text: string) {
  return text.split(MARKER_PATTERN).map((part, index) => {
    if (!part) return null;
    const matched = part.match(MARKER_PATTERN);
    if (matched) {
      return (
        <span
          key={`${part}-${index}`}
          className="inline-block border border-[var(--shock-ink)] bg-[#f4df7f] px-1.5 py-[1px] font-mono text-[11px] leading-5"
        >
          {part}
        </span>
      );
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function messageBadgeTone(message: Message) {
  if (message.tone === "blocked") return "bg-[var(--shock-pink)] text-white";
  if (message.role === "agent") return "bg-[var(--shock-cyan)]";
  if (message.role === "human") return "bg-[var(--shock-yellow)]";
  return "bg-white";
}

function messageGlyph(message: Message) {
  if (message.role === "human") return "人";
  if (message.role === "agent") return "AI";
  return "SYS";
}

type ReplyTarget = {
  messageId: string;
  speaker: string;
  excerpt: string;
};

type ThreadMap = Record<string, Message[]>;

const CHANNEL_THREAD_REPLIES: Record<string, ThreadMap> = {
  all: {
    "msg-all-2": [
      {
        id: "thread-all-1",
        speaker: "Mina",
        role: "human",
        tone: "human",
        message: "那就别把机器状态塞进 setup 了，直接留在主壳和 room 里常驻。",
        time: "09:18",
      },
      {
        id: "thread-all-2",
        speaker: "Codex Dockmaster",
        role: "agent",
        tone: "agent",
        message: "收到。我会把 presence 和 room context 一起留在左栏和右 rail，不再只给后台页。",
        time: "09:19",
      },
    ],
  },
  roadmap: {
    "msg-roadmap-1": [
      {
        id: "thread-roadmap-1",
        speaker: "System",
        role: "system",
        tone: "system",
        message: "已记录：Board 仅保留为 planning mirror，不再作为首页主心智。",
        time: "10:06",
      },
    ],
  },
};

const ROOM_THREAD_REPLIES: Record<string, ThreadMap> = {
  "room-runtime": {
    "msg-room-1": [
      {
        id: "thread-room-runtime-1",
        speaker: "Larkspur",
        role: "human",
        tone: "human",
        message: "房间里只保留当前 room 的执行信息，不要再搞一个总览页。",
        time: "09:24",
      },
      {
        id: "thread-room-runtime-2",
        speaker: "Codex Dockmaster",
        role: "agent",
        tone: "agent",
        message: "明白。当前 room 会只盯住 branch、runtime、PR 和当前 topic，不再分散视线。",
        time: "09:25",
      },
    ],
    "msg-room-2": [
      {
        id: "thread-room-runtime-3",
        speaker: "System",
        role: "system",
        tone: "system",
        message: "Follow-thread 已可把后续恢复继续锁在同一条 room discussion 上。",
        time: "09:27",
      },
    ],
  },
  "room-inbox": {
    "msg-room-4": [
      {
        id: "thread-room-inbox-1",
        speaker: "Mina",
        role: "human",
        tone: "human",
        message: "Inbox 入口放左下角是对的，但卡片正文还得更克制。",
        time: "10:03",
      },
    ],
  },
  "room-memory": {
    "msg-room-6": [
      {
        id: "thread-room-memory-1",
        speaker: "Larkspur",
        role: "human",
        tone: "human",
        message: "先别写回，优先级策略没定之前必须卡住。",
        time: "10:32",
      },
    ],
  },
};

function messageExcerpt(text: string, maxLength = 72) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildReplyTarget(message: Message): ReplyTarget {
  return {
    messageId: message.id,
    speaker: message.speaker,
    excerpt: messageExcerpt(message.message, 56),
  };
}

function initialThreadMessageId(messages: Message[], threadMap: ThreadMap) {
  const seeded = messages.find((message) => (threadMap[message.id] ?? []).length > 0);
  return seeded?.id ?? messages[messages.length - 1]?.id ?? null;
}

function actionTone(tone: "yellow" | "white" | "ink") {
  switch (tone) {
    case "yellow":
      return "bg-[var(--shock-yellow)]";
    case "ink":
      return "bg-black text-white";
    default:
      return "bg-white";
  }
}

function ReplyComposerChip({
  replyTarget,
  onClear,
}: {
  replyTarget: ReplyTarget;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
        Reply
      </span>
      <p className="min-w-0 flex-1 truncate text-[12px] text-[color:rgba(24,20,14,0.74)]">
        {replyTarget.speaker}: {replyTarget.excerpt}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]"
      >
        Clear
      </button>
    </div>
  );
}

function ThreadReplyRow({ message }: { message: Message }) {
  return (
    <article className="border-b border-[color:rgba(24,20,14,0.12)] px-3 py-3 last:border-b-0">
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-7 min-w-7 items-center justify-center border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
            messageBadgeTone(message)
          )}
        >
          {messageGlyph(message)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[13px] font-bold leading-none">{message.speaker}</span>
            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.5)]">{message.time}</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-6 text-[color:rgba(24,20,14,0.86)]">
            {renderMarkedMessage(message.message)}
          </div>
        </div>
      </div>
    </article>
  );
}

function ThreadRail({
  scopeLabel,
  selectedMessage,
  replies,
  replyTarget,
  onReply,
  primaryAction,
  emptyTitle,
  emptyMessage,
}: {
  scopeLabel: string;
  selectedMessage?: Message;
  replies: Message[];
  replyTarget?: ReplyTarget | null;
  onReply: () => void;
  primaryAction?: {
    label: string;
    onClick: () => void | Promise<void>;
    disabled?: boolean;
    tone?: "yellow" | "white" | "ink";
    testId?: string;
  };
  emptyTitle: string;
  emptyMessage: string;
}) {
  return (
    <>
      <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-[20px] font-bold leading-none">Thread</p>
            <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
              {scopeLabel}
            </p>
          </div>
          {primaryAction ? (
            <button
              type="button"
              data-testid={primaryAction.testId}
              onClick={() => void primaryAction.onClick()}
              disabled={primaryAction.disabled}
              className={cn(
                "min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60",
                actionTone(primaryAction.tone ?? "white")
              )}
            >
              {primaryAction.label}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-y-contain p-3 [scrollbar-gutter:stable]">
        {!selectedMessage ? (
          <section className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white p-4 shadow-[var(--shock-shadow-sm)]">
            <p className="font-display text-[18px] font-bold">{emptyTitle}</p>
            <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.7)]">{emptyMessage}</p>
          </section>
        ) : (
          <div className="space-y-3">
            <section className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                Parent Message
              </p>
              <div className="mt-3 flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 min-w-8 items-center justify-center border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
                    messageBadgeTone(selectedMessage)
                  )}
                >
                  {messageGlyph(selectedMessage)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-display text-[15px] font-bold leading-none">{selectedMessage.speaker}</p>
                    <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">{selectedMessage.time}</span>
                  </div>
                  <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.86)]">
                    {selectedMessage.message}
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)]">
              <div className="border-b-2 border-[var(--shock-ink)] px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                  Replies
                </p>
              </div>
              {replies.length > 0 ? (
                replies.map((reply) => <ThreadReplyRow key={reply.id} message={reply} />)
              ) : (
                <div className="px-3 py-4 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">
                  当前还没有独立 reply，下一条就从这里继续。
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <button
          type="button"
          onClick={onReply}
          disabled={!selectedMessage}
          className="min-h-[44px] w-full rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-yellow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
        >
          {selectedMessage && replyTarget?.messageId === selectedMessage.id
            ? "Reply target ready in composer"
            : "Reply in composer"}
        </button>
      </div>
    </>
  );
}

function MessageStreamRow({
  message,
  replyCount,
  threadActive = false,
  onOpenThread,
}: {
  message: Message;
  replyCount?: number;
  threadActive?: boolean;
  onOpenThread?: (message: Message) => void;
}) {
  return (
    <article
      className={cn(
        "border-b border-[color:rgba(24,20,14,0.12)] px-4 py-3.5 last:border-b-0",
        threadActive && "bg-[#fff4cc]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-7 min-w-7 items-center justify-center rounded-[10px] border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
            messageBadgeTone(message)
          )}
        >
          {messageGlyph(message)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[14px] font-bold leading-none">{message.speaker}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.42)]">
              {roleLabel(message.role)}
            </span>
            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.5)]">{message.time}</span>
          </div>
          <div className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-6 text-[color:rgba(24,20,14,0.9)]">
            {renderMarkedMessage(message.message)}
          </div>
          {typeof replyCount === "number" || onOpenThread ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenThread?.(message)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-1 rounded-full border border-[var(--shock-ink)] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff9ec]",
                  threadActive ? "bg-[var(--shock-yellow)]" : "bg-white"
                )}
              >
                {typeof replyCount === "number" && replyCount > 0
                  ? `${replyCount} ${replyCount > 1 ? "replies" : "reply"}`
                  : "Reply"}
              </button>
              {threadActive ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.5)]">
                  thread open
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function useStickyMessageScroll(scopeId: string, messageCount: number, latestMessageSize: number) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const updateStickiness = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldStickToBottomRef.current = distanceFromBottom <= 72;
    };

    updateStickiness();
    node.addEventListener("scroll", updateStickiness, { passive: true });
    return () => node.removeEventListener("scroll", updateStickiness);
  }, [scopeId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !shouldStickToBottomRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [scopeId, messageCount, latestMessageSize]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    shouldStickToBottomRef.current = true;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [scopeId]);

  return scrollRef;
}

function ClaudeCompactComposer({
  room,
  initialMessages,
  onSend,
  canSend,
  sendStatus,
  sendBoundary,
  replyTarget,
  onClearReplyTarget,
  threadReplyCounts,
  activeThreadMessageId,
  onOpenThread,
}: {
  room: Room;
  initialMessages: Message[];
  onSend: (
    roomId: string,
    prompt: string,
    provider?: string,
    onEvent?: (event: RoomStreamEvent) => void
  ) => Promise<{ state?: PhaseZeroState; error?: string } | null | undefined>;
  canSend: boolean;
  sendStatus: string;
  sendBoundary: string;
  replyTarget?: ReplyTarget | null;
  onClearReplyTarget?: () => void;
  threadReplyCounts: Record<string, number>;
  activeThreadMessageId?: string | null;
  onOpenThread: (message: Message) => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("先给我一句结论：这个讨论间现在该先做哪一步？");
  const [loading, setLoading] = useState(false);
  const latestMessage = messages[messages.length - 1];
  const scrollRef = useStickyMessageScroll(room.id, messages.length, latestMessage?.message.length ?? 0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    if (replyTarget) {
      inputRef.current?.focus();
    }
  }, [replyTarget]);

  async function handleSend() {
    if (!draft.trim() || loading || !canSend) return;
    const prompt = draft.trim();
    const sendPrompt = replyTarget ? `回复 ${replyTarget.speaker}：${prompt}` : prompt;
    setLoading(true);
    const now = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const humanMessage: Message = {
      id: `local-human-${Date.now()}`,
      speaker: "Lead_Architect",
      role: "human",
      tone: "human",
      message: sendPrompt,
      time: now,
    };
    const agentMessageId = `local-agent-${Date.now()}`;
    const agentMessage: Message = {
      id: agentMessageId,
      speaker: "Shock_AI_Core",
      role: "agent",
      tone: "agent",
      message: "",
      time: now,
    };
    setMessages((current) => [...current, humanMessage, agentMessage]);

    try {
      const payload = await onSend(room.id, sendPrompt, "claude", (event) => {
        if (event.type === "stdout" && event.delta) {
          setMessages((current) =>
            current.map((item) =>
              item.id === agentMessageId ? { ...item, message: `${item.message}${event.delta}` } : item
            )
          );
        }
        if (event.type === "stderr" && event.delta) {
          setMessages((current) =>
            current.map((item) =>
              item.id === agentMessageId ? { ...item, tone: "blocked", message: `${item.message}${event.delta}` } : item
            )
          );
        }
      });
      const nextMessages = payload?.state?.roomMessages?.[room.id];
      if (nextMessages) {
        setMessages(nextMessages);
      } else {
        setMessages((current) =>
          current.map((item) =>
            item.id === agentMessageId && item.message.trim() === ""
              ? { ...item, message: payload?.error || "这次没有拿到可展示的输出。" }
              : item
          )
        );
      }
      setDraft("");
      onClearReplyTarget?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "bridge error";
      setMessages((current) => [
        ...current.filter((item) => item.id !== agentMessageId),
        {
          id: `err-${Date.now()}`,
          speaker: "System",
          role: "system",
          tone: "blocked",
          message: `Claude 连接失败：${message}`,
          time: new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleSend();
  }

  return (
    <>
      <div
        ref={scrollRef}
        data-testid="room-message-list"
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[var(--shock-paper)] [scroll-padding-bottom:11rem] [scrollbar-gutter:stable]"
      >
        <div className="mx-auto max-w-[1040px] border-x-2 border-[var(--shock-ink)] bg-[#fff9ec] pb-4">
          {messages.map((message) => (
            <MessageStreamRow
              key={message.id}
              message={message}
              replyCount={threadReplyCounts[message.id]}
              threadActive={activeThreadMessageId === message.id}
              onOpenThread={onOpenThread}
            />
          ))}
        </div>
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-white/95 px-4 py-3 shadow-[0_-3px_0_0_var(--shock-ink)] backdrop-blur supports-[backdrop-filter]:bg-white/85">
        <div className="mx-auto max-w-[1040px]">
          {replyTarget ? (
            <ReplyComposerChip replyTarget={replyTarget} onClear={() => onClearReplyTarget?.()} />
          ) : null}
        </div>
        <form onSubmit={(event) => void handleSubmit(event)} className="mx-auto flex max-w-[1040px] items-center gap-2">
          <button
            type="button"
            aria-label="attach room context"
            className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white text-lg shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            +
          </button>
          <input
            ref={inputRef}
            data-testid="room-message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canSend || loading}
            className="h-11 flex-1 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[13px] outline-none transition-colors duration-150 focus:bg-white focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
            placeholder={replyTarget ? `继续回复 ${replyTarget.speaker}...` : "输入指令、问题或新的约束..."}
          />
          <button
            type="submit"
            data-testid="room-send-message"
            disabled={loading || !canSend}
            className="min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
          >
            {loading ? "..." : "Send"}
          </button>
        </form>
        <p data-testid="room-reply-authz" className="mx-auto mt-2 max-w-[1040px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {sendStatus}
        </p>
        {!canSend ? (
          <p className="mx-auto mt-2 max-w-[1040px] text-sm leading-6 text-[var(--shock-pink)]">{sendBoundary}</p>
        ) : null}
      </div>
    </>
  );
}

export function StitchChannelsView({ channelId }: { channelId: string }) {
  const { state, approvalCenter, loading, error, postChannelMessage } = usePhaseZeroState();
  const quickSearch = useQuickSearchController(loading || error ? { ...state, channels: [], rooms: [], issues: [], runs: [], agents: [] } : state);
  const channel = loading || error ? undefined : state.channels.find((item) => item.id === channelId);
  const messages = channel ? state.channelMessages[channel.id] ?? [] : [];
  const channelThreadReplies = channel ? CHANNEL_THREAD_REPLIES[channel.id] ?? {} : {};
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const runningAgents = sidebarAgents.filter((agent) => agent.state === "running").length;
  const blockedAgents = sidebarAgents.filter((agent) => agent.state === "blocked").length;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const messageScrollRef = useStickyMessageScroll(
    channelId,
    messages.length,
    latestMessage?.message.length ?? 0
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;
  const selectedThreadMessage =
    messages.find((message) => message.id === selectedThreadId) ?? messages.find((message) => message.id === initialThreadMessageId(messages, channelThreadReplies));
  const selectedThreadReplies = selectedThreadMessage ? channelThreadReplies[selectedThreadMessage.id] ?? [] : [];

  useEffect(() => {
    const nextThreadId = initialThreadMessageId(messages, channelThreadReplies);
    setSelectedThreadId((current) => {
      if (current && messages.some((message) => message.id === current)) {
        return current;
      }
      return nextThreadId;
    });
    setReplyTarget((current) => {
      if (current && messages.some((message) => message.id === current.messageId)) {
        return current;
      }
      return null;
    });
  }, [channelId, messages, channelThreadReplies]);

  useEffect(() => {
    if (replyTarget) {
      inputRef.current?.focus();
    }
  }, [replyTarget]);

  function handleOpenThread(message: Message) {
    setSelectedThreadId(message.id);
    setReplyTarget(buildReplyTarget(message));
  }

  async function handleChannelSend() {
    if (!channel || !draft.trim() || sending || loading || Boolean(error)) {
      return;
    }
    const sendPrompt = replyTarget ? `回复 ${replyTarget.speaker}：${draft.trim()}` : draft.trim();
    setSending(true);
    setSendError(null);
    try {
      await postChannelMessage(channel.id, sendPrompt);
      setDraft("");
      setReplyTarget(null);
    } catch (channelError) {
      setSendError(channelError instanceof Error ? channelError.message : "频道消息发送失败");
    } finally {
      setSending(false);
    }
  }

  async function handleChannelSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await handleChannelSend();
  }

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <StitchSidebar
          active="channels"
          channels={sidebarChannels}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          selectedChannelId={channelId}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col bg-white">
          <WorkspaceStatusStrip
            workspaceName={workspaceName}
            disconnected={loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline")}
          />
          <StitchTopBar
            eyebrow="Workspace Channel"
            title={loading ? "频道同步中" : error ? "频道同步失败" : `# ${channel?.name ?? channelId}`}
            description={
              loading
                ? "等待 live channel state 返回。"
                : error
                  ? error
                  : channel?.purpose ?? "当前还没有拿到这条频道的 live purpose。"
            }
            searchPlaceholder="Search channel / thread / saved"
            tabs={["Chat", "Thread", "Saved"]}
            activeTab="Chat"
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {workspaceName || "OpenShock"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {sidebarMachines.length} machines
              </span>
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-lime)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {runningAgents} active citizens
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {blockedAgents} blocked
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {inboxCount} inbox
              </span>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div
                ref={messageScrollRef}
                data-testid="channel-message-list"
                className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain bg-[var(--shock-paper)] [scroll-padding-bottom:11rem] [scrollbar-gutter:stable]"
              >
                <div className="mx-auto max-w-[1040px] border-x-2 border-[var(--shock-ink)] bg-[#fff9ec] pb-4">
                  <div className="border-b-2 border-[var(--shock-ink)] px-4 py-3">
                    <p className="font-display text-[18px] font-bold">{channel?.name ?? "等待同步"}</p>
                    <p className="mt-1 text-[12px] leading-5 text-[color:rgba(24,20,14,0.64)]">
                      {channel?.summary ?? channel?.purpose ?? "当前还没有拿到这条频道的 live purpose。"}
                    </p>
                  </div>
                  {loading ? (
                    <DiscussionStateMessage
                      title="正在同步频道真值"
                      message="等待 server 返回当前频道对象和消息列表，前端不再自动退回到另一条 mock 频道。"
                    />
                  ) : error ? (
                    <DiscussionStateMessage title="频道同步失败" message={error} />
                  ) : !channel ? (
                    <DiscussionStateMessage
                      title="未找到频道"
                      message={`当前找不到 \`${channelId}\` 对应的 live channel 记录。`}
                    />
                  ) : messages.length === 0 ? (
                    <DiscussionStateMessage
                      title="这个频道当前还没有消息"
                      message="等第一条 live channel message 出现后，这里会直接显示真实频道流。"
                    />
                  ) : (
                    messages.map((message) => (
                      <MessageStreamRow
                        key={message.id}
                        message={message}
                        replyCount={channelThreadReplies[message.id]?.length}
                        threadActive={selectedThreadMessage?.id === message.id}
                        onOpenThread={handleOpenThread}
                      />
                    ))
                  )}
                </div>
              </div>

              <div className="border-t-2 border-[var(--shock-ink)] bg-white/95 px-4 py-3 shadow-[0_-3px_0_0_var(--shock-ink)] backdrop-blur supports-[backdrop-filter]:bg-white/85">
                <div className="mx-auto max-w-[1040px]">
                  {replyTarget ? (
                    <ReplyComposerChip replyTarget={replyTarget} onClear={() => setReplyTarget(null)} />
                  ) : null}
                </div>
                <form onSubmit={(event) => void handleChannelSubmit(event)} className="mx-auto flex max-w-[1040px] items-center gap-2">
                  <button
                    type="button"
                    aria-label="attach message context"
                    className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white text-lg shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  >
                    +
                  </button>
                  <input
                    ref={inputRef}
                    data-testid="channel-message-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={!channel || loading || Boolean(error) || sending}
                    className="h-11 flex-1 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[13px] outline-none transition-colors duration-150 focus:bg-white focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    placeholder={
                      replyTarget
                        ? `继续回复 ${replyTarget.speaker}...`
                        : channel
                          ? `发送消息到 ${channel.name}...`
                          : "等待频道同步..."
                    }
                  />
                  <button
                    type="button"
                    aria-label="mention teammate"
                    className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                  >
                    @
                  </button>
                  <button
                    type="submit"
                    data-testid="channel-send-message"
                    disabled={!channel || loading || Boolean(error) || sending || !draft.trim()}
                    className="min-h-[44px] rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-60"
                  >
                    {sending ? "..." : "Send"}
                  </button>
                </form>
                {sendError ? (
                  <p data-testid="channel-send-error" className="mx-auto mt-3 max-w-[1040px] text-sm leading-6 text-[var(--shock-pink)]">
                    {sendError}
                  </p>
                ) : null}
              </div>
            </div>

            <aside className="hidden min-h-0 flex-col border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex">
              <ThreadRail
                scopeLabel={channel?.name ?? "channel"}
                selectedMessage={selectedThreadMessage}
                replies={selectedThreadReplies}
                replyTarget={replyTarget}
                onReply={() => {
                  if (selectedThreadMessage) {
                    setReplyTarget(buildReplyTarget(selectedThreadMessage));
                  }
                }}
                primaryAction={{
                  label: "Focus Reply",
                  onClick: () => setReplyTarget(selectedThreadMessage ? buildReplyTarget(selectedThreadMessage) : null),
                  disabled: !selectedThreadMessage,
                }}
                emptyTitle="先选一条消息"
                emptyMessage="thread 是频道消息的局部回复区。先在左侧消息流里点一条消息，再从这里继续。"
              />
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export function StitchDiscussionView({ roomId }: { roomId: string }) {
  const { state, approvalCenter, loading, error, streamRoomMessage, createPullRequest, updatePullRequest, controlRun } = usePhaseZeroState();
  const quickSearch = useQuickSearchController(loading || error ? { ...state, channels: [], rooms: [], issues: [], runs: [], agents: [] } : state);
  const room = state.rooms.find((item) => item.id === roomId);
  const run = room ? state.runs.find((item) => item.id === room.runId) : undefined;
  const session = room ? state.sessions.find((item) => item.roomId === room.id) : undefined;
  const authSession = state.auth.session;
  const currentRunStatus = session?.status ?? run?.status;
  const runPaused = currentRunStatus === "paused";
  const messages = room ? state.roomMessages[room.id] ?? [] : [];
  const roomThreadReplies = room ? ROOM_THREAD_REPLIES[room.id] ?? {} : {};
  const pullRequest = room ? state.pullRequests.find((item) => item.roomId === room.id) : undefined;
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [railMode, setRailMode] = useState<"context" | "thread">("context");
  const canMerge = pullRequest && pullRequest.status !== "merged";
  const canReply = !loading && !error && !runPaused && hasSessionPermission(authSession, "room.reply");
  const roomReplyStatus = loading ? "syncing" : error ? "sync_failed" : runPaused ? "paused" : permissionStatus(authSession, "room.reply");
  const roomReplyBoundary = runPaused
    ? "当前 run 已暂停。先在右侧 Run Control 里 Resume，或先锁定 follow-thread 再恢复执行。"
    : permissionBoundaryCopy(authSession, "room.reply");
  const canControlRun = !loading && !error && hasSessionPermission(authSession, "run.execute");
  const runControlStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "run.execute");
  const runControlBoundary = permissionBoundaryCopy(authSession, "run.execute");
  const canReviewPullRequest = hasSessionPermission(authSession, "pull_request.review");
  const canMergePullRequest = hasSessionPermission(authSession, "pull_request.merge");
  const activeAgents =
    room && run
      ? state.agents.filter(
          (agent) => agent.lane === room.issueKey || agent.recentRunIds.includes(run.id)
        )
      : [];
  const sessionMemoryPaths =
    session && session.memoryPaths.length > 0
      ? session.memoryPaths
      : ["当前 session 还没有暴露 memory paths"];
  const latestTimelineEvent = run ? run.timeline[run.timeline.length - 1] : undefined;
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;
  const selectedThreadMessage =
    messages.find((message) => message.id === selectedThreadId) ?? messages.find((message) => message.id === initialThreadMessageId(messages, roomThreadReplies));
  const selectedThreadReplies = selectedThreadMessage ? roomThreadReplies[selectedThreadMessage.id] ?? [] : [];
  const threadReplyCounts = Object.fromEntries(
    messages.map((message) => [message.id, roomThreadReplies[message.id]?.length ?? 0])
  );

  useEffect(() => {
    const nextThreadId = initialThreadMessageId(messages, roomThreadReplies);
    setSelectedThreadId((current) => {
      if (current && messages.some((message) => message.id === current)) {
        return current;
      }
      return nextThreadId;
    });
    setReplyTarget((current) => {
      if (current && messages.some((message) => message.id === current.messageId)) {
        return current;
      }
      return null;
    });
  }, [roomId, messages, roomThreadReplies]);

  function handleOpenThread(message: Message) {
    setSelectedThreadId(message.id);
    setReplyTarget(buildReplyTarget(message));
    setRailMode("thread");
  }

  async function handleCreatePullRequest() {
    if (!room || prLoading || !canReviewPullRequest) return;
    setPrLoading(true);
    setPrError(null);
    try {
      await createPullRequest(room.id);
    } catch (pullRequestError) {
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "pull request create failed");
    } finally {
      setPrLoading(false);
    }
  }

  async function handleMergePullRequest() {
    if (!pullRequest || prLoading || !canMergePullRequest) return;
    setPrLoading(true);
    setPrError(null);
    try {
      await updatePullRequest(pullRequest.id, { status: "merged" });
    } catch (pullRequestError) {
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "pull request merge failed");
    } finally {
      setPrLoading(false);
    }
  }

  async function handleSyncPullRequest() {
    if (!pullRequest || prLoading || !canReviewPullRequest) return;
    setPrLoading(true);
    setPrError(null);
    try {
      await updatePullRequest(pullRequest.id, { status: pullRequest.status === "changes_requested" ? "changes_requested" : "in_review" });
    } catch (pullRequestError) {
      setPrError(pullRequestError instanceof Error ? pullRequestError.message : "pull request sync failed");
    } finally {
      setPrLoading(false);
    }
  }

  async function handleRunControl(action: "stop" | "resume" | "follow_thread", note: string) {
    if (!run) return;
    await controlRun(run.id, { action, note });
  }

  let pullRequestActionLabel = "发起 PR";
  let pullRequestActionDisabled = !room || prLoading || !canReviewPullRequest;
  let pullRequestActionHandler: (() => Promise<void>) | null = handleCreatePullRequest;
  let pullRequestActionStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "pull_request.review");
  let pullRequestBoundary = permissionBoundaryCopy(authSession, "pull_request.review");

  if (pullRequest?.status === "merged") {
    pullRequestActionLabel = "已合并";
    pullRequestActionDisabled = true;
    pullRequestActionHandler = null;
    pullRequestActionStatus = "merged";
    pullRequestBoundary = "当前 PR 已合并，不再提供新的 review / merge 动作。";
  } else if (pullRequest) {
    if (canMergePullRequest) {
      pullRequestActionLabel = canMerge ? "合并 PR" : "已合并";
      pullRequestActionDisabled = prLoading || !canMerge;
      pullRequestActionHandler = handleMergePullRequest;
      pullRequestActionStatus = loading ? "syncing" : error ? "sync_failed" : permissionStatus(authSession, "pull_request.merge");
      pullRequestBoundary = permissionBoundaryCopy(authSession, "pull_request.merge");
    } else {
      pullRequestActionLabel = "同步 PR";
      pullRequestActionDisabled = prLoading || !canReviewPullRequest;
      pullRequestActionHandler = handleSyncPullRequest;
      pullRequestActionStatus =
        loading || error ? "syncing" : canReviewPullRequest ? "review_only" : permissionStatus(authSession, "pull_request.review");
      pullRequestBoundary = canReviewPullRequest
        ? "当前 session 只有 review 权限，可以同步 PR 状态，但不能直接 merge。"
        : permissionBoundaryCopy(authSession, "pull_request.review");
    }
  }

  return (
    <main className="h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <QuickSearchSurface
        key={quickSearch.sessionKey}
        open={quickSearch.open}
        query={quickSearch.query}
        results={quickSearch.results}
        onClose={quickSearch.onCloseQuickSearch}
        onQueryChange={quickSearch.onQueryChange}
        onSelect={quickSearch.onSelectQuickSearch}
      />
      <div className="grid h-full min-h-0 w-full overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[298px_minmax(0,1fr)]">
        <StitchSidebar
          active="rooms"
          channels={sidebarChannels}
          rooms={sidebarRooms}
          machines={sidebarMachines}
          agents={sidebarAgents}
          workspaceName={workspaceName}
          workspaceSubtitle={workspaceSubtitle}
          selectedRoomId={roomId}
          inboxCount={inboxCount}
          onOpenQuickSearch={quickSearch.onOpenQuickSearch}
        />
        <section className="flex min-h-0 flex-col bg-white">
          <WorkspaceStatusStrip
            workspaceName={workspaceName}
            disconnected={loading || Boolean(error) || sidebarMachines.every((machine) => machine.state === "offline")}
          />
          <StitchTopBar
            eyebrow="Issue Room"
            title={loading ? "讨论间同步中" : error ? "讨论间同步失败" : room?.title ?? roomId}
            description={
              loading
                ? "等待 live room / run state 返回。"
                : error
                  ? error
                  : room?.summary ?? "当前还没有拿到这间房的 live 摘要。"
            }
            searchPlaceholder="Search room / run / PR / board"
            tabs={["Chat", "Thread", "Topic", "Run", "PR"]}
            activeTab="Chat"
            onOpenQuickSearch={quickSearch.onOpenQuickSearch}
          />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {room?.issueKey ?? "issue"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                run {currentRunStatus ?? "syncing"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {room?.boardCount ?? 0} board cards
              </span>
            </div>
          </div>
          <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-[18px] font-bold">
                      {room?.topic.title ?? "等待讨论间同步"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={room ? `/issues/${room.issueKey}` : "/issues"}
                      className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-[background-color,transform] duration-150 hover:-translate-y-0.5 hover:bg-[var(--shock-paper)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      Issue
                    </Link>
                    <Link
                      href="/board"
                      className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--shock-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                    >
                      Board
                    </Link>
                  </div>
                </div>
              </div>
              {loading ? (
                <div className="p-4">
                  <DiscussionStateMessage title="正在同步讨论间真值" message="等待 server 返回当前 room / run / message 状态，前端不再自动退回另一间 mock room。" />
                </div>
              ) : error ? (
                <div className="p-4">
                  <DiscussionStateMessage title="讨论间同步失败" message={error} />
                </div>
              ) : !room || !run ? (
                <div className="p-4">
                  <DiscussionStateMessage title="未找到讨论间" message={`当前找不到 \`${roomId}\` 对应的 live room / run 记录。`} />
                </div>
              ) : (
                <ClaudeCompactComposer
                  room={room}
                  initialMessages={messages}
                  onSend={streamRoomMessage}
                  canSend={canReply}
                  sendStatus={roomReplyStatus}
                  sendBoundary={roomReplyBoundary}
                  replyTarget={replyTarget}
                  onClearReplyTarget={() => setReplyTarget(null)}
                  threadReplyCounts={threadReplyCounts}
                  activeThreadMessageId={selectedThreadMessage?.id}
                  onOpenThread={handleOpenThread}
                />
              )}
            </div>

            <aside className="hidden min-h-0 flex-col border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <p className="font-display text-[20px] font-bold leading-none">
                  {railMode === "thread" ? "Thread Rail" : "Context Rail"}
                </p>
                <div className="mt-3 flex flex-wrap gap-0 border-2 border-[var(--shock-ink)]">
                  {["Context", "Thread", "Run", "PR"].map((tab) => (
                    <button
                      type="button"
                      key={tab}
                      onClick={() => setRailMode(tab === "Thread" ? "thread" : "context")}
                      className={cn(
                        "border-r-2 border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] last:border-r-0",
                        (tab === "Thread" && railMode === "thread") || (tab !== "Thread" && tab === "Context" && railMode === "context")
                          ? "bg-[var(--shock-yellow)]"
                          : "bg-white"
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {railMode === "thread" ? (
                  <ThreadRail
                    scopeLabel={room?.issueKey ?? roomId}
                    selectedMessage={selectedThreadMessage}
                    replies={selectedThreadReplies}
                    replyTarget={replyTarget}
                    onReply={() => {
                      if (selectedThreadMessage) {
                        setReplyTarget(buildReplyTarget(selectedThreadMessage));
                      }
                    }}
                    primaryAction={{
                      label: session?.followThread ?? run?.followThread ? "Thread Locked" : "Lock Thread",
                      onClick: () =>
                        void handleRunControl(
                          "follow_thread",
                          selectedThreadMessage
                            ? `锁定 thread: ${selectedThreadMessage.speaker} / ${messageExcerpt(selectedThreadMessage.message, 48)}`
                            : "锁定当前线程"
                        ),
                      disabled: !selectedThreadMessage || !canControlRun,
                      tone: session?.followThread ?? run?.followThread ? "ink" : "yellow",
                      testId: "room-thread-follow-current",
                    }}
                    emptyTitle="先选一条 room 消息"
                    emptyMessage="thread 只作为当前 room 的局部回复区，不会再生成新的一级页面。先在左侧消息流里点一条消息。"
                  />
                ) : (
                  <>
                    <div className="mb-3 flex gap-2">
                      <button className="flex-1 border-2 border-[var(--shock-ink)] bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)]">
                        注入 Guidance
                      </button>
                      <button
                        data-testid="room-pull-request-action"
                        disabled={pullRequestActionDisabled}
                        onClick={() => void pullRequestActionHandler?.()}
                        className="flex-1 border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
                      >
                        {pullRequestActionLabel}
                      </button>
                    </div>
                    <p data-testid="room-pull-request-authz" className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      {pullRequestActionStatus}
                    </p>
                    {(pullRequestActionStatus === "blocked" || pullRequestActionStatus === "signed_out" || pullRequestActionStatus === "review_only" || pullRequestActionStatus === "merged") ? (
                      <p className="mb-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">{pullRequestBoundary}</p>
                    ) : null}

                    <div className="space-y-3">
                      {loading ? (
                        <DiscussionStateMessage title="等待房间上下文" message="右侧 context rail 会在 live room / run / session 真值返回后展开。" />
                      ) : error ? (
                        <DiscussionStateMessage title="上下文同步失败" message={error} />
                      ) : !room || !run ? (
                        <DiscussionStateMessage title="缺少讨论间上下文" message={`当前找不到 \`${roomId}\` 对应的 live room / run 记录。`} />
                      ) : (
                        <>
                      <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Topic</p>
                        <p className="mt-2 font-display text-[18px] font-bold leading-6">{room.topic.title}</p>
                        <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.68)]">{room.topic.summary}</p>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Owner</p>
                            <p className="mt-2 text-sm font-semibold">{room.topic.owner}</p>
                          </div>
                          <div className="border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Board</p>
                            <p className="mt-2 text-sm font-semibold">{room.boardCount} planning cards</p>
                          </div>
                        </div>
                      </section>

                      <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Run</p>
                        <div className="mt-3 border-2 border-[var(--shock-ink)] bg-[#f7f7f7] px-3 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Current Branch</p>
                              <p className="mt-2 font-display text-[18px] font-bold leading-6">{session?.branch ?? run.branch}</p>
                            </div>
                            <span
                              data-testid="room-run-status"
                              className={cn(
                                "rounded-[4px] border border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px]",
                                currentRunStatus === "paused"
                                  ? "bg-[var(--shock-paper)]"
                                  : currentRunStatus === "blocked"
                                    ? "bg-[var(--shock-pink)] text-white"
                                    : currentRunStatus === "review"
                                      ? "bg-[var(--shock-lime)]"
                                      : currentRunStatus === "done"
                                        ? "bg-[var(--shock-ink)] text-white"
                                        : "bg-[var(--shock-yellow)]"
                              )}
                            >
                              {runStatusLabel(currentRunStatus)}
                            </span>
                          </div>
                          <p className="mt-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">Worktree {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}</p>
                          <p className="mt-1 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">Last Sync {session?.updatedAt || run.startedAt}</p>
                        </div>
                      </section>

                      <RunControlSurface
                        scope="room"
                        run={run}
                        session={session}
                        canControl={canControlRun}
                        controlStatus={runControlStatus}
                        controlBoundary={runControlBoundary}
                        onControl={handleRunControl}
                      />

                      <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Pull Request</p>
                            <p data-testid="room-pull-request-label" className="mt-2 font-display text-[18px] font-bold leading-6">{pullRequest?.label ?? run.pullRequest ?? "未创建"}</p>
                          </div>
                          <span data-testid="room-pull-request-status" className="rounded-[4px] border border-[var(--shock-ink)] bg-[#ececec] px-2 py-1 font-mono text-[10px]">
                            {pullRequestStatusLabel(pullRequest?.status)}
                          </span>
                        </div>
                        <p data-testid="room-pull-request-summary" className="mt-3 text-[13px] leading-6 text-[color:rgba(24,20,14,0.64)]">
                          {pullRequest?.reviewSummary ?? run.nextAction}
                        </p>
                        {prError ? (
                          <p data-testid="room-pull-request-error" className="mt-3 font-mono text-[11px] text-[var(--shock-pink)]">
                            {prError}
                          </p>
                        ) : null}
                      </section>

                      <section className="border-2 border-[var(--shock-ink)] bg-[#111827] p-3 text-white shadow-[var(--shock-shadow-sm)]">
                        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">Session Memory</p>
                        <div className="mt-3 space-y-2 font-mono text-[10px] leading-5 text-[#8bff9e]">
                          {sessionMemoryPaths.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </section>

                      <div className="grid gap-3 xl:grid-cols-2">
                        <section className="border-2 border-[var(--shock-ink)] bg-[#ead7ff] p-3 shadow-[var(--shock-shadow-sm)]">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Tool Calls</p>
                          <p className="mt-2 font-display text-[28px] font-bold leading-none">{run.toolCalls.length}</p>
                          <p className="mt-2 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.tool ?? "当前还没有工具调用"}</p>
                          <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.summary ?? "等待下一条执行事件"}</p>
                        </section>
                        <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Timeline</p>
                          <p className="mt-2 font-display text-[28px] font-bold leading-none">{run.timeline.length}</p>
                          <p className="mt-2 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{latestTimelineEvent?.label ?? "暂无事件"}</p>
                          <p className="mt-1 text-[11px] leading-5 text-[color:rgba(24,20,14,0.62)]">{latestTimelineEvent?.at ?? "等待同步"}</p>
                        </section>
                      </div>

                      <section className="border-2 border-[var(--shock-ink)] bg-white p-3 shadow-[var(--shock-shadow-sm)]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-purple)] text-[10px] text-white">AI</span>
                            <span className="flex h-6 w-6 items-center justify-center border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] text-[10px]">{activeAgents.length}</span>
                          </div>
                          <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">{run.runtime} / {run.provider}</p>
                        </div>
                        <div className="mt-4 border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">Board mirror</p>
                          <p className="mt-2 text-[13px] leading-6 text-[color:rgba(24,20,14,0.72)]">
                            这间房关联 {room.boardCount} 张 planning 卡。Board 只是镜像，不是主协作入口。
                          </p>
                        </div>
                      </section>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
