"use client";

import { useEffect, useState } from "react";

import {
  type Message,
  type PhaseZeroState,
  type Room,
} from "@/lib/mock-data";
import { type RoomStreamEvent, usePhaseZeroState } from "@/lib/live-phase0";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";
import { RunControlSurface } from "@/components/run-control-surface";
import { StitchSidebar, StitchTopBar } from "@/components/stitch-shell-primitives";

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

  return (
    <>
      <div className="flex-1 overflow-y-auto bg-[#fbfbfb] p-6">
        <div className="space-y-6">
          {messages.map((message, index) => (
            <article key={message.id} className={cn("max-w-[90%]", index > 0 && message.role === "human" && "ml-auto")}>
              <div
                className={cn(
                  "rounded-[6px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[2px_2px_0_0_var(--shock-ink)]",
                  message.role === "human" ? "inline-block bg-white text-left" : "bg-[#ececec]",
                  message.role === "agent" && "bg-[#ead7ff]",
                  message.tone === "blocked" && "bg-[#ffdce7]"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-display text-sm font-bold">{message.speaker}</span>
                  <span className="bg-black px-1 py-0.5 font-mono text-[10px] text-white">{roleLabel(message.role)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{message.message}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="border-t-2 border-[var(--shock-ink)] bg-white px-3 py-2">
        <div className="flex items-center gap-2">
          <input
            data-testid="room-message-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canSend || loading}
            className="h-11 flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[11px] outline-none"
            placeholder="输入指令、问题或新的约束..."
          />
          <button
            type="button"
            onClick={handleSend}
            data-testid="room-send-message"
            disabled={loading || !canSend}
            className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] text-base disabled:opacity-60"
          >
            ↗
          </button>
        </div>
        <p data-testid="room-reply-authz" className="mt-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {sendStatus}
        </p>
        {!canSend ? (
          <p className="mt-2 text-sm leading-6 text-[var(--shock-pink)]">{sendBoundary}</p>
        ) : null}
      </div>
    </>
  );
}

export function StitchChannelsView({ channelId }: { channelId: string }) {
  const { state, loading, error } = usePhaseZeroState();
  const channel = loading || error ? undefined : state.channels.find((item) => item.id === channelId);
  const messages = channel ? state.channelMessages[channel.id] ?? [] : [];
  const sidebarChannels = loading || error ? [] : state.channels;
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;
  const runningAgents = sidebarAgents.filter((agent) => agent.state === "running").length;
  const blockedAgents = sidebarAgents.filter((agent) => agent.state === "blocked").length;

  return (
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[256px_minmax(0,1fr)]">
        <StitchSidebar active="channels" channels={sidebarChannels} machines={sidebarMachines} agents={sidebarAgents} />
        <section className="flex min-h-0 flex-col bg-white">
          <StitchTopBar
            title={
              loading
                ? "频道同步中"
                : error
                  ? "频道同步失败"
                  : channel
                    ? `频道：${channel.name}`
                    : `频道：${channelId}`
            }
            searchPlaceholder="搜索频道消息..."
          />
          <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div className="flex-1 overflow-y-auto bg-[radial-gradient(var(--shock-grid)_1px,transparent_1px)] [background-size:20px_20px] p-8">
                <div className="mx-auto max-w-4xl space-y-8">
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
                    messages.map((message) => {
                      const isHuman = message.role === "human";
                      const isAgent = message.role === "agent";
                      const blockedTone = message.tone === "blocked";

                      return (
                        <article
                          key={message.id}
                          className={cn("flex items-start gap-4", isHuman && "flex-row-reverse")}
                        >
                          <div
                            className={cn(
                              "flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--shock-ink)] shadow-[2px_2px_0_0_var(--shock-ink)]",
                              blockedTone
                                ? "bg-[var(--shock-pink)] text-white"
                                : isAgent
                                  ? "bg-[var(--shock-purple)] text-white"
                                  : isHuman
                                    ? "bg-[var(--shock-yellow)]"
                                    : "bg-white"
                            )}
                          >
                            {message.role === "human" ? "人" : message.role === "agent" ? "A" : "S"}
                          </div>
                          <div className={cn("flex-1", isHuman && "text-right")}>
                            <div className={cn("mb-2 flex items-center gap-3", isHuman && "justify-end")}>
                              <span
                                className={cn(
                                  "font-display text-lg font-bold",
                                  blockedTone
                                    ? "text-[var(--shock-pink)]"
                                    : isAgent
                                      ? "text-[var(--shock-purple)]"
                                      : undefined
                                )}
                              >
                                {message.speaker}
                              </span>
                              <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.52)]">
                                {message.time}
                              </span>
                            </div>
                            <div
                              className={cn(
                                "relative rounded-[12px] border-2 border-[var(--shock-ink)] p-5 shadow-[4px_4px_0_0_var(--shock-ink)]",
                                blockedTone
                                  ? "bg-[var(--shock-pink)] text-white"
                                  : isAgent
                                    ? "bg-[#ead7ff]"
                                    : isHuman
                                      ? "ml-auto max-w-[90%] bg-white text-left"
                                      : "bg-[var(--shock-paper)]"
                              )}
                            >
                              <p className="whitespace-pre-wrap text-sm leading-7">{message.message}</p>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="border-t-2 border-[var(--shock-ink)] bg-white px-6 py-4">
                <div className="mx-auto flex max-w-4xl items-center gap-3">
                  <button className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white text-xl">+</button>
                  <div className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-4 py-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.48)]">
                    {channel ? `发送消息到 ${channel.name}...` : "等待频道同步..."}
                  </div>
                  <button className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white">☺</button>
                  <button
                    disabled={!channel || loading || Boolean(error)}
                    className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 py-3 font-mono text-[11px] tracking-[0.14em] disabled:opacity-60"
                  >
                    发送 ↗
                  </button>
                </div>
              </div>
            </div>

            <aside className="hidden overflow-y-auto bg-[#f6f6f6] p-4 xl:block">
              <div className="space-y-4">
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">频道定位</p>
                  <p className="mt-2 font-display text-2xl font-bold">{channel?.name ?? "等待同步"}</p>
                  <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    {channel?.purpose ?? "当前还没有拿到这条频道的 live purpose。"}
                  </p>
                </div>
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">频道基线</p>
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span>消息数</span>
                      <span className="font-mono text-[11px]">{messages.length}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>未读</span>
                      <span className="font-mono text-[11px]">{channel?.unread ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>活跃公民</span>
                      <span className="font-mono text-[11px]">{runningAgents}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span>阻塞公民</span>
                      <span className="font-mono text-[11px]">{blockedAgents}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">在线公民</p>
                  <div className="mt-4 space-y-3">
                    {sidebarAgents.map((agent) => (
                      <div key={agent.id} className="flex items-start gap-3">
                        <span className={cn("mt-1 h-3 w-3 rounded-full border border-[var(--shock-ink)]", agent.state === "blocked" ? "bg-[var(--shock-pink)]" : "bg-[var(--shock-lime)]")} />
                        <div>
                          <p className="text-sm font-semibold">{agent.name}</p>
                          <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">{agent.state}</p>
                        </div>
                      </div>
                    ))}
                  </div>
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
  const { state, loading, error, streamRoomMessage, createPullRequest, updatePullRequest, controlRun } = usePhaseZeroState();
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
  const sidebarMachines = loading || error ? [] : state.machines;
  const sidebarAgents = loading || error ? [] : state.agents;

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
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[256px_minmax(0,1fr)]">
        <StitchSidebar active="rooms" channels={sidebarChannels} machines={sidebarMachines} agents={sidebarAgents} />
        <section className="flex min-h-0 flex-col bg-white">
          <StitchTopBar title={`讨论间：${room?.title ?? roomId}`} searchPlaceholder="搜索工作区..." />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-h-0 w-full flex-col border-r-2 border-[var(--shock-ink)] xl:w-1/2">
              <div className="border-b-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[11px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">实时协作流</p>
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">{activeAgents.length} active agents</p>
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

            <aside className="hidden min-h-0 flex-1 overflow-y-auto bg-[#f5f5f5] p-4 xl:block">
              <div className="mb-3 flex gap-2">
                <button className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-black px-3 py-2 font-mono text-[10px] text-white">注入 Guidance</button>
                <button
                  data-testid="room-pull-request-action"
                  disabled={pullRequestActionDisabled}
                  onClick={() => void pullRequestActionHandler?.()}
                  className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] disabled:opacity-60"
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
                    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4">
                      <p className="font-mono text-[10px] tracking-[0.16em]">Execution Context</p>
                      <div className="mt-3 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#f7f7f7] px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">Current Branch</p>
                            <p className="mt-2 font-display text-2xl font-bold">{session?.branch ?? run.branch}</p>
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

                    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Pull Request</p>
                          <p data-testid="room-pull-request-label" className="mt-2 font-display text-2xl font-bold">{pullRequest?.label ?? run.pullRequest ?? "未创建"}</p>
                        </div>
                        <span data-testid="room-pull-request-status" className="rounded-[4px] border border-[var(--shock-ink)] bg-[#ececec] px-2 py-1 font-mono text-[10px]">
                          {pullRequestStatusLabel(pullRequest?.status)}
                        </span>
                      </div>
                      <p data-testid="room-pull-request-summary" className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.64)]">
                        {pullRequest?.reviewSummary ?? run.nextAction}
                      </p>
                      {prError ? (
                        <p data-testid="room-pull-request-error" className="mt-3 font-mono text-[11px] text-[var(--shock-pink)]">
                          {prError}
                        </p>
                      ) : null}
                    </section>

                    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-[#111827] p-4 text-white">
                      <p className="font-mono text-[10px] tracking-[0.16em] text-white/70">Session Memory</p>
                      <div className="mt-3 space-y-2 font-mono text-[11px] leading-5 text-[#8bff9e]">
                        {sessionMemoryPaths.map((item) => (
                          <p key={item}>{item}</p>
                        ))}
                      </div>
                    </section>

                    <div className="grid gap-3 xl:grid-cols-2">
                      <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-[#ead7ff] p-4">
                        <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Tool Calls</p>
                        <p className="mt-2 font-display text-4xl font-bold">{run.toolCalls.length}</p>
                        <p className="mt-2 text-xs leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.tool ?? "当前还没有工具调用"}</p>
                        <p className="mt-1 text-xs leading-5 text-[color:rgba(24,20,14,0.62)]">{run.toolCalls[0]?.summary ?? "等待下一条执行事件"}</p>
                      </section>
                      <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4">
                        <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Timeline</p>
                        <p className="mt-2 font-display text-4xl font-bold">{run.timeline.length}</p>
                        <p className="mt-2 text-xs leading-5 text-[color:rgba(24,20,14,0.62)]">{latestTimelineEvent?.label ?? "暂无事件"}</p>
                        <p className="mt-1 text-xs leading-5 text-[color:rgba(24,20,14,0.62)]">{latestTimelineEvent?.at ?? "等待同步"}</p>
                      </section>
                    </div>

                    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-purple)] text-[10px] text-white">AI</span>
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] text-[10px]">{activeAgents.length}</span>
                        </div>
                        <p className="font-mono text-[10px] text-[color:rgba(24,20,14,0.48)]">{run.runtime} / {run.provider}</p>
                      </div>
                    </section>
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
