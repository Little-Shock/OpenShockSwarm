"use client";

import { useMemo, useState } from "react";

import {
  agents,
  channelMessages,
  channels,
  getIssueByRoomId,
  getRunById,
  roomMessages,
  rooms,
  type Message,
  type Room,
} from "@/lib/mock-data";
import { StitchSidebar, StitchTopBar } from "@/components/stitch-shell-primitives";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";
const WORKSPACE_CWD = "E:\\00.Lark_Projects\\00_OpenShock";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function roleLabel(role: Message["role"]) {
  switch (role) {
    case "human":
      return "HUMAN";
    case "agent":
      return "AGENT";
    default:
      return "SYSTEM";
  }
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function StitchChannelsView({ channelId }: { channelId: string }) {
  const channel = channels.find((item) => item.id === channelId) ?? channels[0];
  const messages = channelMessages[channel.id] ?? [];

  return (
    <main className="min-h-screen bg-[var(--shock-paper)] px-3 py-3 text-[var(--shock-ink)]">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1720px] overflow-hidden rounded-[8px] border-2 border-[var(--shock-ink)] bg-white shadow-[6px_6px_0_0_var(--shock-ink)] xl:grid-cols-[190px_minmax(0,1fr)]">
        <StitchSidebar active="channels" />
        <section className="flex min-h-full flex-col">
          <StitchTopBar searchPlaceholder="Search system logs..." />
          <div className="grid flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_210px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div className="border-b-2 border-[var(--shock-ink)] px-4 py-3">
                <div className="mx-auto h-[2px] max-w-full bg-[var(--shock-ink)]/20" />
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="mx-auto max-w-3xl space-y-5">
                  {messages.map((message, index) => (
                    <article
                      key={message.id}
                      className={cn(
                        "max-w-[85%] rounded-[8px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 shadow-[3px_3px_0_0_var(--shock-ink)]",
                        index === 1 && "ml-auto border-[var(--shock-purple)] bg-[#ead7ff]",
                        message.role === "system" && "bg-[var(--shock-yellow)]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-display text-base font-semibold">{message.speaker}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.52)]">
                          {message.time}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6">{message.message}</p>
                      {index === 1 ? (
                        <div className="mt-3 rounded-[6px] border-2 border-[var(--shock-ink)] bg-black px-3 py-3 font-mono text-[11px] leading-5 text-[var(--shock-lime)]">
                          <p>{">"} ping 127.0.0.1 --cluster=tokyo</p>
                          <p>[STATUS] analyzing shard health...</p>
                          <p>[WARN] shard 03 latency spike detected</p>
                          <p>[OK] garbage collection stabilized</p>
                        </div>
                      ) : null}
                    </article>
                  ))}

                  <article className="max-w-[70%] rounded-[8px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-4 shadow-[3px_3px_0_0_var(--shock-ink)]">
                    <p className="font-display text-base font-bold">⚡ QUICK ACTION REQUIRED</p>
                    <p className="mt-2 text-sm leading-6">
                      自动恢复策略建议对 Tokyo-03 重新部署。要不要先授权执行？
                    </p>
                  </article>
                </div>
              </div>

              <div className="border-t-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <div className="mx-auto flex max-w-3xl items-center gap-2">
                  <button className="flex h-10 w-10 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white text-xl">
                    +
                  </button>
                  <div className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-4 py-3 font-mono text-[11px] text-[color:rgba(24,20,14,0.48)]">
                    Send a message to {channel.name}...
                  </div>
                  <button className="flex h-10 w-10 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-white">
                    ☺
                  </button>
                  <button className="rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em]">
                    Send ↗
                  </button>
                </div>
              </div>
            </div>

            <aside className="bg-[#f6f6f6] px-3 py-3">
              <div className="space-y-3">
                <div className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                    Active Memory
                  </p>
                  <p className="mt-2 font-display text-2xl font-bold">14.8 GB</p>
                  <div className="mt-3 h-3 rounded-[999px] border-2 border-[var(--shock-ink)] bg-[#f1f1f1]">
                    <div className="h-full w-[72%] bg-[var(--shock-yellow)]" />
                  </div>
                </div>
                <div className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                    Thread Health
                  </p>
                  <div className="mt-3 flex gap-1">
                    {["#22c55e", "#22c55e", "#facc15", "#22c55e", "#ef4444"].map((color, index) => (
                      <span key={`${color}-${index}`} className="h-4 flex-1 rounded-[2px] border border-[var(--shock-ink)]" style={{ backgroundColor: color }} />
                    ))}
                  </div>
                </div>
                <div className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                    Online Agents
                  </p>
                  <div className="mt-3 space-y-3">
                    {agents.map((agent) => (
                      <div key={agent.id} className="flex items-start gap-3">
                        <span className="mt-1 h-3 w-3 rounded-full border border-[var(--shock-ink)] bg-[var(--shock-lime)]" />
                        <div>
                          <p className="text-sm font-semibold">{agent.name}</p>
                          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.48)]">
                            {agent.state === "blocked" ? "offline" : "active"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-8 rounded-[6px] border-2 border-dashed border-[var(--shock-ink)] px-4 py-6 text-center">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em]">Local Mode Active</p>
                  <p className="mt-2 text-xs text-[color:rgba(24,20,14,0.56)]">Data secured on-device</p>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function ClaudeCompactComposer({ room }: { room: Room }) {
  const seedMessages = roomMessages[room.id] ?? [];
  const [messages, setMessages] = useState<Message[]>(seedMessages);
  const [draft, setDraft] = useState("请先给我一句结论：这个讨论间现在该先做哪一步？");
  const [loading, setLoading] = useState(false);

  const helperPrompt = useMemo(() => {
    const issue = getIssueByRoomId(room.id);
    return `你是 OpenShock 讨论间里的 Claude Code Agent。
请严格站在当前讨论间上下文里，用简洁中文回答。

房间：${room.title}
Issue：${room.issueKey}
Topic：${room.topic.title}
摘要：${room.topic.summary}
PR：${issue?.pullRequest ?? "尚未创建"}

要求：
1. 只给当前讨论间相关的执行建议。
2. 优先提 task、run、review、approval。
3. 保持 2 到 5 句。`;
  }, [room]);

  async function handleSend() {
    if (!draft.trim() || loading) return;
    const prompt = draft.trim();

    setMessages((current) => [
      ...current,
      {
        id: `local-${Date.now()}`,
        speaker: "Lead_Architect",
        role: "human",
        tone: "human",
        message: prompt,
        time: nowLabel(),
      },
    ]);
    setDraft("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/v1/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude",
          cwd: WORKSPACE_CWD,
          prompt: `${helperPrompt}\n\n用户输入：${prompt}`,
        }),
      });

      const payload = (await response.json()) as { output?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "bridge failed");

      setMessages((current) => [
        ...current,
        {
          id: `agent-${Date.now()}`,
          speaker: "Shock_AI_Core",
          role: "agent",
          tone: "agent",
          message: payload.output?.trim() || "已收到，但这次没有可展示的文本输出。",
          time: nowLabel(),
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "bridge error";
      setMessages((current) => [
        ...current,
        {
          id: `err-${Date.now()}`,
          speaker: "System",
          role: "system",
          tone: "blocked",
          message: `Claude 连接失败：${message}`,
          time: nowLabel(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {messages.map((message, index) => (
            <article key={message.id} className={cn("max-w-[82%]", index > 0 && message.role === "human" && "ml-auto")}>
              <div
                className={cn(
                  "rounded-[6px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 shadow-[2px_2px_0_0_var(--shock-ink)]",
                  message.role === "agent" && "bg-[#ead7ff]",
                  message.tone === "blocked" && "bg-[#ffdce7]"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-display text-base font-semibold">{message.speaker}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                    {roleLabel(message.role)}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.message}</p>
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
            className="h-10 flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#fafafa] px-3 font-mono text-[11px] outline-none"
            placeholder="Type instructions or commands..."
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading}
            className="flex h-10 w-10 items-center justify-center rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] text-base disabled:opacity-60"
          >
            ↗
          </button>
        </div>
      </div>
    </>
  );
}

export function StitchDiscussionView({ roomId }: { roomId: string }) {
  const room = rooms.find((item) => item.id === roomId) ?? rooms[0];
  const run = getRunById(room.runId);

  return (
    <main className="min-h-screen bg-[var(--shock-paper)] px-3 py-3 text-[var(--shock-ink)]">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-[1720px] overflow-hidden rounded-[8px] border-2 border-[var(--shock-ink)] bg-white shadow-[6px_6px_0_0_var(--shock-ink)] xl:grid-cols-[190px_minmax(0,1fr)]">
        <StitchSidebar active="rooms" />
        <section className="flex min-h-full flex-col">
          <StitchTopBar searchPlaceholder="Search Workspace..." />
          <div className="grid flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex min-h-0 flex-col border-r-2 border-[var(--shock-ink)]">
              <div className="border-b-2 border-[var(--shock-ink)] px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.48)]">
                    Live Collaborative Stream
                  </p>
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                    1 active agents
                  </p>
                </div>
              </div>

              <ClaudeCompactComposer room={room} />
            </div>

            <aside className="bg-[#f5f5f5] px-3 py-3">
              <div className="mb-3 flex gap-2">
                <button className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-black px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white">
                  Inject Guidance
                </button>
                <button className="flex-1 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                  Authorize PR
                </button>
              </div>

              <div className="space-y-3">
                <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em]">Execution Context</p>
                  <div className="mt-3 rounded-[4px] border-2 border-[var(--shock-ink)] bg-[#f7f7f7] px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                          Room State
                        </p>
                        <p className="mt-2 font-display text-lg font-bold">{room.issueKey.toLowerCase().replace("ops-", "fix/")}-memory-leak</p>
                      </div>
                      <span className="rounded-[4px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em]">
                        Dirty State
                      </span>
                    </div>
                    <p className="mt-3 font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">
                      Active Path /core/session_mgr.ts
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-[color:rgba(24,20,14,0.56)]">
                      Last Sync 2s ago
                    </p>
                  </div>
                </section>

                <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-[#111827] p-3 text-white">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/70">Hotfile</p>
                  <div className="mt-3 font-mono text-[10px] leading-5 text-[#8bff9e]">
                    <p>pub observers: Vec&lt;Box&lt;dyn Observer&gt;&gt;</p>
                    <p>pub fn register(&amp;mut self, observer: Observer)</p>
                    <p>let weak_ob = Arc::downgrade(&amp;obj)</p>
                    <p>self.observers.push(Box::new(obs));</p>
                  </div>
                </section>

                <div className="grid gap-3 xl:grid-cols-2">
                  <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-[#ead7ff] p-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">PR Readiness</p>
                    <p className="mt-2 font-display text-3xl font-bold">88%</p>
                    <p className="mt-2 text-xs leading-5 text-[color:rgba(24,20,14,0.62)]">Unit tests passed 21/24</p>
                    <p className="mt-1 text-xs leading-5 text-[color:rgba(24,20,14,0.62)]">还剩 2 个 warning 待清理</p>
                  </section>
                  <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">Memory Delta</p>
                    <div className="mt-5 flex items-end gap-2">
                      {[36, 54, 32, 70].map((height) => (
                        <span key={height} className="w-8 border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)]" style={{ height }} />
                      ))}
                    </div>
                    <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.48)]">est. peak reduction</p>
                  </section>
                </div>

                <section className="rounded-[6px] border-2 border-[var(--shock-ink)] bg-white p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-purple)] text-[10px] text-white">
                        AI
                      </span>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] text-[10px]">
                        {agents.length}
                      </span>
                    </div>
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.48)]">
                      {run?.runtime ?? "shock-main"}: active
                    </p>
                  </div>
                </section>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
