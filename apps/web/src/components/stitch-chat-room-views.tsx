"use client";

import { useEffect, useState } from "react";

import {
  fallbackState,
  type Message,
  type PhaseZeroState,
  type Room,
} from "@/lib/mock-data";
import { type RoomStreamEvent, usePhaseZeroState } from "@/lib/live-phase0";
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
}: {
  room: Room;
  initialMessages: Message[];
  onSend: (
    roomId: string,
    prompt: string,
    provider?: string,
    onEvent?: (event: RoomStreamEvent) => void
  ) => Promise<{ state?: PhaseZeroState; error?: string } | null | undefined>;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("先给我一句结论：这个讨论间现在该先做哪一步？");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  async function handleSend() {
    if (!draft.trim() || loading) return;
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
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="h-11 flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[11px] outline-none"
            placeholder="输入指令、问题或新的约束..."
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading}
            className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] text-base disabled:opacity-60"
          >
            ↗
          </button>
        </div>
      </div>
    </>
  );
}

export function StitchChannelsView({ channelId }: { channelId: string }) {
  const { state } = usePhaseZeroState();
  const channel = state.channels.find((item) => item.id === channelId) ?? fallbackState.channels[0];
  const messages = state.channelMessages[channel.id] ?? fallbackState.channelMessages[channel.id] ?? [];

  return (
    <main className="h-screen overflow-hidden bg-[var(--shock-paper)] text-[var(--shock-ink)]">
      <div className="grid h-screen w-screen overflow-hidden border-y-2 border-[var(--shock-ink)] bg-white md:grid-cols-[256px_minmax(0,1fr)]">
        <StitchSidebar active="channels" channels={state.channels} machines={state.machines} agents={state.agents} />
        <section className="flex min-h-0 flex-col bg-white">
          <StitchTopBar searchPlaceholder="搜索系统日志..." />
          <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div className="flex-1 overflow-y-auto bg-[radial-gradient(var(--shock-grid)_1px,transparent_1px)] [background-size:20px_20px] p-8">
                <div className="mb-8 flex items-center gap-4">
                  <div className="h-[2px] flex-1 bg-[var(--shock-ink)]" />
                  <span className="rounded-full bg-black px-3 py-1 font-mono text-[10px] text-white">系统纪元 1715423</span>
                  <div className="h-[2px] flex-1 bg-[var(--shock-ink)]" />
                </div>

                <div className="mx-auto max-w-4xl space-y-8">
                  {messages.map((message, index) => (
                    <article key={message.id} className={cn("flex items-start gap-4", index === 1 && "flex-row-reverse")}>
                      <div
                        className={cn(
                          "flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border-2 border-[var(--shock-ink)] shadow-[2px_2px_0_0_var(--shock-ink)]",
                          index === 1 ? "bg-[var(--shock-purple)] text-white" : "bg-[var(--shock-yellow)]"
                        )}
                      >
                        {index === 1 ? "🤖" : "⚙"}
                      </div>
                      <div className={cn("flex-1", index === 1 && "text-right")}>
                        <div className={cn("mb-2 flex items-center gap-3", index === 1 && "justify-end")}>
                          <span className={cn("font-display text-lg font-bold", index === 1 && "text-[var(--shock-purple)]")}>{message.speaker}</span>
                          <span className="font-mono text-[10px] text-[color:rgba(24,20,14,0.52)]">{message.time}</span>
                        </div>
                        <div className={cn("relative rounded-[12px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[4px_4px_0_0_var(--shock-ink)]", index === 1 && "ml-auto max-w-[90%] bg-[#ead7ff] text-left")}>
                          <p className="text-sm leading-7">{message.message}</p>
                          {index === 1 ? (
                            <div className="mt-4 rounded-[8px] border-2 border-[var(--shock-ink)] bg-black px-4 py-4 font-mono text-[11px] leading-5 text-[var(--shock-lime)]">
                              <p>{">"} ping 127.0.0.1 --cluster=tokyo</p>
                              <p>[STATUS] 正在分析 shard health...</p>
                              <p>[WARN] shard 03 latency spike detected</p>
                              <p>[OK] garbage collection stabilized</p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}

                  <article className="max-w-[70%] rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 py-5 shadow-[4px_4px_0_0_var(--shock-ink)]">
                    <p className="font-display text-lg font-bold">QUICK ACTION REQUIRED</p>
                    <p className="mt-2 text-sm leading-7">自动恢复策略建议对 Tokyo-03 重新部署。要不要先授权执行？</p>
                  </article>
                </div>
              </div>

              <div className="border-t-2 border-[var(--shock-ink)] bg-white px-6 py-4">
                <div className="mx-auto flex max-w-4xl items-center gap-3">
                  <button className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white text-xl">+</button>
                  <div className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-4 py-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.48)]">
                    发送消息到 {channel.name}...
                  </div>
                  <button className="flex h-11 w-11 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white">☺</button>
                  <button className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 py-3 font-mono text-[11px] tracking-[0.14em]">发送 ↗</button>
                </div>
              </div>
            </div>

            <aside className="hidden overflow-y-auto bg-[#f6f6f6] p-4 xl:block">
              <div className="space-y-4">
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">活动内存</p>
                  <p className="mt-2 font-display text-4xl font-bold">14.8 GB</p>
                  <div className="mt-4 h-3 rounded-full border-2 border-[var(--shock-ink)] bg-[#f1f1f1]"><div className="h-full w-[72%] bg-[var(--shock-yellow)]" /></div>
                </div>
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Thread Health</p>
                  <div className="mt-4 flex gap-1">{["#22c55e", "#22c55e", "#facc15", "#22c55e", "#ef4444"].map((color, index) => <span key={`${color}-${index}`} className="h-4 flex-1 rounded-[2px] border border-[var(--shock-ink)]" style={{ backgroundColor: color }} />)}</div>
                </div>
                <div className="rounded-[8px] border-2 border-[var(--shock-ink)] bg-white p-4">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">在线公民</p>
                  <div className="mt-4 space-y-3">
                    {state.agents.map((agent) => (
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
  const { state, loading, error, streamRoomMessage, createPullRequest, updatePullRequest } = usePhaseZeroState();
  const room = state.rooms.find((item) => item.id === roomId);
  const run = room ? state.runs.find((item) => item.id === room.runId) : undefined;
  const session = room ? state.sessions.find((item) => item.roomId === room.id) : undefined;
  const messages = room ? state.roomMessages[room.id] ?? [] : [];
  const pullRequest = room ? state.pullRequests.find((item) => item.roomId === room.id) : undefined;
  const [prLoading, setPrLoading] = useState(false);
  const canMerge = pullRequest && pullRequest.status !== "merged";
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
    if (!room || prLoading) return;
    setPrLoading(true);
    try {
      await createPullRequest(room.id);
    } finally {
      setPrLoading(false);
    }
  }

  async function handleMergePullRequest() {
    if (!pullRequest || prLoading) return;
    setPrLoading(true);
    try {
      await updatePullRequest(pullRequest.id, { status: "merged" });
    } finally {
      setPrLoading(false);
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
                <ClaudeCompactComposer room={room} initialMessages={messages} onSend={streamRoomMessage} />
              )}
            </div>

            <aside className="hidden min-h-0 flex-1 overflow-y-auto bg-[#f5f5f5] p-4 xl:block">
              <div className="mb-3 flex gap-2">
                <button className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-black px-3 py-2 font-mono text-[10px] text-white">注入 Guidance</button>
                <button
                  disabled={!room || prLoading || (pullRequest?.status === "merged")}
                  onClick={pullRequest ? handleMergePullRequest : handleCreatePullRequest}
                  className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] disabled:opacity-60"
                >
                  {!pullRequest ? "发起 PR" : canMerge ? "合并 PR" : "已合并"}
                </button>
              </div>

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
                          <span className="rounded-[4px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[10px]">
                            {runStatusLabel(session?.status ?? run.status)}
                          </span>
                        </div>
                        <p className="mt-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">Worktree {session?.worktreePath || run.worktreePath || session?.worktree || run.worktree}</p>
                        <p className="mt-1 font-mono text-[11px] text-[color:rgba(24,20,14,0.56)]">Last Sync {session?.updatedAt || run.startedAt}</p>
                      </div>
                    </section>

                    <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[10px] tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Pull Request</p>
                          <p className="mt-2 font-display text-2xl font-bold">{pullRequest?.label ?? run.pullRequest ?? "未创建"}</p>
                        </div>
                        <span className="rounded-[4px] border border-[var(--shock-ink)] bg-[#ececec] px-2 py-1 font-mono text-[10px]">
                          {pullRequestStatusLabel(pullRequest?.status)}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.64)]">
                        {pullRequest?.reviewSummary ?? run.nextAction}
                      </p>
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
