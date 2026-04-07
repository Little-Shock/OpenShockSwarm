"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  type Message,
  type PhaseZeroState,
  type Room,
} from "@/lib/mock-data";
import { type RoomStreamEvent, usePhaseZeroState } from "@/lib/live-phase0";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import { RunControlSurface } from "@/components/run-control-surface";
import {
  StitchSidebar,
  StitchTopBar,
  WorkspaceStatusStrip,
} from "@/components/stitch-shell-primitives";

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

function MessageStreamRow({
  message,
  replyCount,
}: {
  message: Message;
  replyCount?: number;
}) {
  return (
    <article className="border-b border-[color:rgba(24,20,14,0.12)] px-4 py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-8 min-w-8 items-center justify-center border-2 border-[var(--shock-ink)] font-mono text-[10px] font-bold shadow-[var(--shock-shadow-sm)]",
            messageBadgeTone(message)
          )}
        >
          {messageGlyph(message)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-[15px] font-bold leading-none">{message.speaker}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.42)]">
              {roleLabel(message.role)}
            </span>
            <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.5)]">{message.time}</span>
          </div>
          <div className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-7 text-[color:rgba(24,20,14,0.9)]">
            {renderMarkedMessage(message.message)}
          </div>
          {typeof replyCount === "number" && replyCount > 0 ? (
            <div className="mt-3">
              <span className="inline-flex items-center gap-1 border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]">
                {replyCount} {replyCount > 1 ? "replies" : "reply"}
              </span>
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
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("先给我一句结论：这个讨论间现在该先做哪一步？");
  const [loading, setLoading] = useState(false);
  const latestMessage = messages[messages.length - 1];
  const scrollRef = useStickyMessageScroll(room.id, messages.length, latestMessage?.message.length ?? 0);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  async function handleSend() {
    if (!draft.trim() || loading || !canSend) return;
    const prompt = draft.trim();
    setLoading(true);
    const now = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const humanMessage: Message = {
      id: `local-human-${Date.now()}`,
      speaker: "Lead_Architect",
      role: "human",
      tone: "human",
      message: prompt,
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
      const payload = await onSend(room.id, prompt, "claude", (event) => {
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
        className="min-h-0 flex-1 overflow-y-auto bg-[var(--shock-paper)]"
      >
        <div className="mx-auto max-w-[1100px] border-x-2 border-[var(--shock-ink)] bg-[#fff9ec]">
          {messages.map((message) => (
            <MessageStreamRow key={message.id} message={message} />
          ))}
        </div>
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <form onSubmit={(event) => void handleSubmit(event)} className="mx-auto flex max-w-[1100px] items-center gap-2">
          <button
            type="button"
            aria-label="attach room context"
            className="flex h-10 w-10 items-center justify-center border-2 border-[var(--shock-ink)] bg-white text-lg shadow-[var(--shock-shadow-sm)]"
          >
            +
          </button>
          <input
            data-testid="room-message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canSend || loading}
            className="h-10 flex-1 border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[12px] outline-none"
            placeholder="输入指令、问题或新的约束..."
          />
          <button
            type="submit"
            data-testid="room-send-message"
            disabled={loading || !canSend}
            className="border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
          >
            {loading ? "..." : "Send"}
          </button>
        </form>
        <p data-testid="room-reply-authz" className="mx-auto mt-2 max-w-[1100px] font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {sendStatus}
        </p>
        {!canSend ? (
          <p className="mx-auto mt-2 max-w-[1100px] text-sm leading-6 text-[var(--shock-pink)]">{sendBoundary}</p>
        ) : null}
      </div>
    </>
  );
}

export function StitchChannelsView({ channelId }: { channelId: string }) {
  const { state, approvalCenter, loading, error, postChannelMessage } = usePhaseZeroState();
  const channel = loading || error ? undefined : state.channels.find((item) => item.id === channelId);
  const messages = channel ? state.channelMessages[channel.id] ?? [] : [];
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarRooms = loading || error ? [] : state.rooms;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const runningAgents = sidebarAgents.filter((agent) => agent.state === "running").length;
  const blockedAgents = sidebarAgents.filter((agent) => agent.state === "blocked").length;
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const messageScrollRef = useStickyMessageScroll(
    channelId,
    messages.length,
    latestMessage?.message.length ?? 0
  );
  const inboxCount = loading || error ? 0 : approvalCenter.openCount;
  const workspaceName = loading || error ? undefined : state.workspace.name;
  const workspaceSubtitle = loading || error ? undefined : `${state.workspace.branch} · ${state.workspace.pairedRuntime}`;

  async function handleChannelSend() {
    if (!channel || !draft.trim() || sending || loading || Boolean(error)) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await postChannelMessage(channel.id, draft.trim());
      setDraft("");
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
                className="min-h-0 flex-1 overflow-y-auto bg-[var(--shock-paper)]"
              >
                <div className="mx-auto max-w-[1100px] border-x-2 border-[var(--shock-ink)] bg-[#fff9ec]">
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
                    messages.map((message) => <MessageStreamRow key={message.id} message={message} />)
                  )}
                </div>
              </div>

              <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <form onSubmit={(event) => void handleChannelSubmit(event)} className="mx-auto flex max-w-[1100px] items-center gap-2">
                  <button
                    type="button"
                    aria-label="attach message context"
                    className="flex h-10 w-10 items-center justify-center border-2 border-[var(--shock-ink)] bg-white text-lg shadow-[var(--shock-shadow-sm)]"
                  >
                    +
                  </button>
                  <input
                    data-testid="channel-message-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={!channel || loading || Boolean(error) || sending}
                    className="h-10 flex-1 border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[12px] outline-none"
                    placeholder={channel ? `发送消息到 ${channel.name}...` : "等待频道同步..."}
                  />
                  <button
                    type="button"
                    aria-label="mention teammate"
                    className="flex h-10 w-10 items-center justify-center border-2 border-[var(--shock-ink)] bg-white shadow-[var(--shock-shadow-sm)]"
                  >
                    @
                  </button>
                  <button
                    type="submit"
                    data-testid="channel-send-message"
                    disabled={!channel || loading || Boolean(error) || sending || !draft.trim()}
                    className="border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
                  >
                    {sending ? "..." : "Send"}
                  </button>
                </form>
                {sendError ? (
                  <p data-testid="channel-send-error" className="mx-auto mt-3 max-w-[1100px] text-sm leading-6 text-[var(--shock-pink)]">
                    {sendError}
                  </p>
                ) : null}
              </div>
            </div>

            <aside className="hidden min-h-0 flex-col border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-2xl font-bold leading-none">Thread</p>
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
                      {channel?.name ?? "channel"}
                    </p>
                  </div>
                  <Link
                    href={channel ? `/chat/${channel.id}` : "/chat/all"}
                    className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em]"
                  >
                    View Channel
                  </Link>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  <section className="rounded-[18px] border-3 border-[var(--shock-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--shock-ink)]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
                      Latest Relay
                    </p>
                    <p className="mt-3 font-display text-xl font-bold">
                      {latestMessage?.speaker ?? "等待新消息"}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[color:rgba(17,17,17,0.72)]">
                      {latestMessage?.message ?? "线程摘要会在频道里有新互动后出现。"}
                    </p>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.52)]">
                      {latestMessage?.time ?? "now"}
                    </p>
                  </section>

                  <section className="rounded-[18px] border-3 border-[var(--shock-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--shock-ink)]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
                      Saved Context
                    </p>
                    <div className="mt-4 space-y-3">
                      <div className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3">
                        <p className="font-display text-lg font-bold">Channel purpose</p>
                        <p className="mt-2 text-sm leading-6 text-[color:rgba(17,17,17,0.72)]">
                          {channel?.purpose ?? "等待同步频道基线。"}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(17,17,17,0.52)]">
                            Unread
                          </p>
                          <p className="mt-2 font-display text-3xl font-bold">{channel?.unread ?? 0}</p>
                        </div>
                        <div className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
                          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(17,17,17,0.52)]">
                            Agents
                          </p>
                          <p className="mt-2 font-display text-3xl font-bold">{runningAgents}</p>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[18px] border-3 border-[var(--shock-ink)] bg-white p-4 shadow-[4px_4px_0_0_var(--shock-ink)]">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(17,17,17,0.56)]">
                      Live Citizens
                    </p>
                    <div className="mt-4 space-y-3">
                      {sidebarAgents.slice(0, 4).map((agent) => (
                        <div
                          key={agent.id}
                          className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                        >
                          <div className="flex items-start gap-3">
                            <span
                              className={cn(
                                "mt-1 h-3 w-3 rounded-full border border-[var(--shock-ink)]",
                                agent.state === "blocked"
                                  ? "bg-[var(--shock-pink)]"
                                  : agent.state === "running"
                                    ? "bg-[var(--shock-lime)]"
                                    : "bg-white"
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{agent.name}</p>
                              <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(17,17,17,0.52)]">
                                {agent.state} · {agent.runtimePreference}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-[color:rgba(17,17,17,0.72)]">
                                {agent.mood}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
              <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="rounded-[12px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-4 py-3 font-mono text-[11px] text-[color:rgba(17,17,17,0.48)]">
                  Reply to thread...
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

export function StitchDiscussionView({ roomId }: { roomId: string }) {
  const { state, approvalCenter, loading, error, streamRoomMessage, createPullRequest, updatePullRequest, controlRun } = usePhaseZeroState();
  const room = state.rooms.find((item) => item.id === roomId);
  const run = room ? state.runs.find((item) => item.id === room.runId) : undefined;
  const session = room ? state.sessions.find((item) => item.roomId === room.id) : undefined;
  const authSession = state.auth.session;
  const currentRunStatus = session?.status ?? run?.status;
  const runPaused = currentRunStatus === "paused";
  const messages = room ? state.roomMessages[room.id] ?? [] : [];
  const pullRequest = room ? state.pullRequests.find((item) => item.roomId === room.id) : undefined;
  const [prLoading, setPrLoading] = useState(false);
  const [prError, setPrError] = useState<string | null>(null);
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
            tabs={["Chat", "Topic", "Run", "PR", "Board"]}
            activeTab="Chat"
          />
          <div className="border-b-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {room?.issueKey ?? "issue"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                topic {room?.topic.status ?? "syncing"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-[var(--shock-cyan)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                run {currentRunStatus ?? "syncing"}
              </span>
              <span className="border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {activeAgents.length} agents
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
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                      Live Collaboration
                    </p>
                    <p className="mt-1 font-display text-[18px] font-bold">
                      {room?.topic.title ?? "等待讨论间同步"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={room ? `/issues/${room.issueKey}` : "/issues"}
                      className="border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
                    >
                      Issue
                    </Link>
                    <Link
                      href="/board"
                      className="border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] shadow-[var(--shock-shadow-sm)]"
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
                />
              )}
            </div>

            <aside className="hidden min-h-0 flex-col border-l-2 border-[var(--shock-ink)] bg-[#f1efe7] xl:flex">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <p className="font-display text-[20px] font-bold leading-none">Context Rail</p>
                <div className="mt-3 flex flex-wrap gap-0 border-2 border-[var(--shock-ink)]">
                  {["Chat", "Topic", "Run", "PR", "Board"].map((tab) => (
                    <span
                      key={tab}
                      className={cn(
                        "border-r-2 border-[var(--shock-ink)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] last:border-r-0",
                        tab === "Chat" ? "bg-[var(--shock-yellow)]" : "bg-white"
                      )}
                    >
                      {tab}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
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
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
