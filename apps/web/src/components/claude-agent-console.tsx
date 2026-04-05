"use client";

import { useMemo, useState } from "react";

type RoomMessage = {
  id: string;
  speaker: string;
  role: "human" | "agent" | "system";
  tone: "human" | "agent" | "blocked" | "system";
  message: string;
  time: string;
};

type ClaudeAgentConsoleProps = {
  roomId: string;
  roomTitle: string;
  issueKey: string;
  topicTitle: string;
  topicSummary: string;
  initialMessages: RoomMessage[];
};

type ExecPayload = {
  provider: string;
  output: string;
  duration: string;
  error?: string;
};

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";
const WORKSPACE_CWD = "E:\\00.Lark_Projects\\00_OpenShock";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function nowLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function roleLabel(role: RoomMessage["role"]) {
  switch (role) {
    case "human":
      return "人类";
    case "agent":
      return "Agent";
    default:
      return "系统";
  }
}

export function ClaudeAgentConsole({
  roomId,
  roomTitle,
  issueKey,
  topicTitle,
  topicSummary,
  initialMessages,
}: ClaudeAgentConsoleProps) {
  const [messages, setMessages] = useState<RoomMessage[]>(initialMessages);
  const [draft, setDraft] = useState("先给我一句结论：这个房间当前最重要的下一步是什么？");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const helperPrompt = useMemo(
    () => `你是 OpenShock 里的虚拟 Agent「Claude 作战员」。
你当前在一个 Discuss Room 中协作，请用简洁、明确、偏执行的中文回答。

Room: ${roomTitle}
Issue: ${issueKey}
Topic: ${topicTitle}
Topic Summary: ${topicSummary}

规则：
1. 优先给执行建议，不要空泛讨论。
2. 默认站在协作室上下文里说话，能引用 run / task / inbox 就引用。
3. 回答保持 3 到 6 句。
4. 如果信息不足，先说缺什么，再给最稳妥的下一步。`,
    [issueKey, roomTitle, topicSummary, topicTitle]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || loading) return;

    const humanMessage: RoomMessage = {
      id: `human-${Date.now()}`,
      speaker: "你",
      role: "human",
      tone: "human",
      message: prompt,
      time: nowLabel(),
    };

    setMessages((current) => [...current, humanMessage]);
    setDraft("");
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude",
          cwd: WORKSPACE_CWD,
          prompt: `${helperPrompt}\n\n用户刚刚在房间里说：${prompt}`,
        }),
      });

      const payload = (await response.json()) as ExecPayload;
      if (!response.ok) {
        throw new Error(payload.error || `Claude bridge failed: ${response.status}`);
      }

      const agentMessage: RoomMessage = {
        id: `agent-${Date.now()}`,
        speaker: "Claude 作战员",
        role: "agent",
        tone: "agent",
        message: payload.output.trim() || "我收到了，但这次没有产出可显示的文本。",
        time: `${nowLabel()} · ${payload.duration}`,
      };

      setMessages((current) => [...current, agentMessage]);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Claude 连接失败";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          speaker: "系统",
          role: "system",
          tone: "blocked",
          message: `Claude 没有顺利回应：${message}`,
          time: nowLabel(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            讨论间 / Claude
          </p>
          <h3 className="mt-2 font-display text-2xl font-bold">讨论间对话</h3>
        </div>
        <div className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]">
          房间 {roomId}
        </div>
      </div>

      <div className="space-y-3">
        {messages.map((message) => (
          <article
            key={message.id}
            className={cn(
              "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-3 shadow-[4px_4px_0_0_var(--shock-ink)]",
              message.tone === "human"
                ? "bg-[var(--shock-yellow)]"
                : message.tone === "blocked"
                  ? "bg-[var(--shock-pink)] text-white shadow-[4px_4px_0_0_var(--shock-yellow)]"
                  : message.tone === "system"
                    ? "bg-[var(--shock-lime)]"
                    : "bg-[var(--shock-paper)]"
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-display text-lg font-semibold">{message.speaker}</p>
              <span className="rounded-full border-2 border-current px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                {roleLabel(message.role)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] opacity-70">{message.time}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7">{message.message}</p>
          </article>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-2 block font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            发给 Claude 作战员
          </span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
            placeholder="比如：请帮我把这个房间拆成 3 张 task 卡片，并告诉我应该先做什么。"
            className="w-full rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 text-sm leading-7 outline-none transition-colors focus:bg-white"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Claude 思考中..." : "发送到房间"}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[color:rgba(24,20,14,0.58)]">
            这条消息会走 {"`server -> daemon -> claude --bare`"}
          </p>
        </div>

        {error ? (
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
            {error}
          </div>
        ) : null}
      </form>
    </section>
  );
}
