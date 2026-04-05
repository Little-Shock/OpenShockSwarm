import Link from "next/link";
import type { ReactNode } from "react";

import { ClaudeAgentConsole } from "@/components/claude-agent-console";
import {
  agents,
  getBoardColumns,
  getIssueByRoomId,
  getRunById,
  issues,
  roomMessages,
  settingsSections,
  setupSteps,
  workspace,
  type InboxItem,
  type Issue,
  type Message,
  type Priority,
  type Room,
  type Run,
  type RunStatus,
  type SettingsSection,
  type SetupStep,
} from "@/lib/mock-data";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function toneClass(tone: "white" | "paper" | "yellow" | "lime" | "pink" | "ink") {
  switch (tone) {
    case "paper":
      return "bg-[var(--shock-paper)]";
    case "yellow":
      return "bg-[var(--shock-yellow)]";
    case "lime":
      return "bg-[var(--shock-lime)]";
    case "pink":
      return "bg-[var(--shock-pink)] text-white shadow-[6px_6px_0_0_var(--shock-yellow)]";
    case "ink":
      return "bg-[var(--shock-ink)] text-white";
    default:
      return "bg-white";
  }
}

function statusTone(status: RunStatus) {
  switch (status) {
    case "running":
      return "bg-[var(--shock-yellow)] text-[var(--shock-ink)]";
    case "blocked":
      return "bg-[var(--shock-pink)] text-white";
    case "review":
      return "bg-[var(--shock-lime)] text-[var(--shock-ink)]";
    case "done":
      return "bg-[var(--shock-ink)] text-white";
    default:
      return "bg-white text-[var(--shock-ink)]";
  }
}

function runStatusLabel(status: RunStatus) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "执行中";
    case "blocked":
      return "阻塞";
    case "review":
      return "待评审";
    case "done":
      return "已完成";
  }
}

function inboxKindLabel(kind: InboxItem["kind"]) {
  switch (kind) {
    case "approval":
      return "待批准";
    case "blocked":
      return "阻塞";
    case "review":
      return "待评审";
    default:
      return "状态";
  }
}

function messageRoleLabel(role: Message["role"]) {
  switch (role) {
    case "human":
      return "人类";
    case "agent":
      return "Agent";
    default:
      return "系统";
  }
}

function setupStatusLabel(status: SetupStep["status"]) {
  switch (status) {
    case "done":
      return "已完成";
    case "active":
      return "进行中";
    default:
      return "待接通";
  }
}

function priorityLabel(priority: Priority) {
  switch (priority) {
    case "critical":
      return "关键";
    case "high":
      return "高";
    default:
      return "中";
  }
}

function settingsGroupLabel(id: SettingsSection["id"]) {
  switch (id) {
    case "settings-auth":
      return "身份";
    case "settings-sandbox":
      return "沙盒";
    case "settings-memory":
      return "记忆";
    default:
      return "通知";
  }
}

export function Panel({
  children,
  tone = "white",
  className,
}: {
  children: ReactNode;
  tone?: "white" | "paper" | "yellow" | "lime" | "pink" | "ink";
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[28px] border-2 border-[var(--shock-ink)] p-5 shadow-[6px_6px_0_0_var(--shock-ink)]",
        toneClass(tone),
        className
      )}
    >
      {children}
    </section>
  );
}

export function DetailRail({
  label,
  items,
}: {
  label: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <Panel tone="paper" className="shadow-[8px_8px_0_0_var(--shock-yellow)]">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em]">{label}</p>
      <dl className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.label} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
              {item.label}
            </dt>
            <dd className="mt-2 font-display text-xl font-semibold">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold">{value}</p>
    </div>
  );
}

function SetupStepCard({ step }: { step: SetupStep }) {
  const tone = step.status === "done" ? "lime" : step.status === "active" ? "yellow" : "white";
  return (
    <Panel tone={tone}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {setupStatusLabel(step.status)}
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">{step.title}</h3>
        </div>
        <Link
          href={step.href}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
        >
          打开
        </Link>
      </div>
      <p className="mt-3 text-base leading-7">{step.summary}</p>
      <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{step.detail}</p>
    </Panel>
  );
}

export function SetupOverview() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
      <div className="space-y-4">
        {setupSteps.map((step) => (
          <SetupStepCard key={step.id} step={step} />
        ))}
      </div>
      <div className="space-y-4">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">工作区在线状态</p>
          <dl className="mt-4 grid gap-3">
            <Metric label="仓库" value={workspace.repo} />
            <Metric label="分支" value={workspace.branch} />
            <Metric label="Runtime" value={workspace.pairedRuntime} />
            <Metric label="记忆" value={workspace.memoryMode} />
          </dl>
        </Panel>
        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">Phase 0 成功链路</p>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-white/78">
            <li>1. 建立工作区并绑定仓库。</li>
            <li>2. 配对 Runtime，识别本机 CLI。</li>
            <li>3. 创建 Issue，并自动生成讨论间。</li>
            <li>4. 在 worktree 中执行，把 Run 真相带回前端。</li>
            <li>5. 把结果收回 Inbox 与 PR 闭环。</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}

export function ChatFeed({ messages }: { messages: Message[] }) {
  return (
    <div className="space-y-4">
      {messages.map((message) => (
        <article
          key={message.id}
          className={cn(
            "rounded-[24px] border-2 border-[var(--shock-ink)] px-4 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]",
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
            <h3 className="font-display text-xl font-semibold">{message.speaker}</h3>
            <span className="rounded-full border-2 border-current px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
              {messageRoleLabel(message.role)}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-70">{message.time}</span>
          </div>
          <p className="mt-3 max-w-3xl text-base leading-7">{message.message}</p>
        </article>
      ))}
      <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-display text-xl font-semibold">把讨论升级成讨论间</p>
            <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">
              频道只负责轻量讨论。一旦上下文开始涉及 owner、branch、run 或 PR，就该进入专属讨论间干活。
            </p>
          </div>
          <Link
            href="/issues"
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition-transform hover:-translate-y-0.5"
          >
            创建讨论间
          </Link>
        </div>
      </Panel>
    </div>
  );
}

export function RoomOverview({ room }: { room: Room }) {
  const issue = getIssueByRoomId(room.id);
  const run = getRunById(room.runId);
  const messages = roomMessages[room.id] ?? [];

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-lime)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
                {room.issueKey}
              </p>
              <h3 className="mt-2 font-display text-3xl font-bold">{room.topic.title}</h3>
            </div>
            <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(room.topic.status))}>
              {runStatusLabel(room.topic.status)}
            </span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <Metric label="Run" value={run?.id ?? "未创建"} />
            <Metric label="分支" value={run?.branch ?? "等待中"} />
            <Metric label="Worktree" value={run?.worktree ?? "等待中"} />
          </div>
          <p className="mt-5 max-w-3xl text-base leading-7 text-[color:rgba(24,20,14,0.8)]">{room.topic.summary}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={`/rooms/${room.id}/runs/${room.runId}`}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
            >
              查看 Run 详情
            </Link>
            {issue ? (
              <Link
                href={`/issues/${issue.key}`}
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
              >
                查看 Issue
              </Link>
            ) : null}
          </div>
        </Panel>
        <ClaudeAgentConsole
          roomId={room.id}
          roomTitle={room.title}
          issueKey={room.issueKey}
          topicTitle={room.topic.title}
          topicSummary={room.topic.summary}
          initialMessages={messages}
        />
      </div>

      <div className="space-y-4">
        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">任务板</p>
          <p className="mt-3 font-display text-2xl font-bold">{room.boardCount} 张任务卡进行中</p>
          <p className="mt-2 text-sm leading-6 text-white/72">
            任务板只存在于讨论间内部，避免任务脱离聊天、Run 和上下文真相。
          </p>
        </Panel>
        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">当前主 Agent</p>
          <p className="mt-2 font-display text-2xl font-bold">{room.topic.owner}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这个 Agent 正在负责当前泳道。所有纠偏都留在房间里，而不是散落到私聊和外部文档中。
          </p>
        </Panel>
      </div>
    </div>
  );
}

export function RunDetailView({ run }: { run: Run }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
                {run.issueKey}
              </p>
              <h3 className="mt-2 font-display text-3xl font-bold">{run.summary}</h3>
            </div>
            <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(run.status))}>
              {runStatusLabel(run.status)}
            </span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <Metric label="Runtime" value={`${run.runtime} / ${run.provider}`} />
            <Metric label="分支" value={run.branch} />
            <Metric label="Worktree" value={run.worktree} />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Metric label="负责人" value={run.owner} />
            <Metric label="下一步" value={run.nextAction} />
          </div>
        </Panel>
        <Panel tone={run.approvalRequired ? "pink" : "lime"}>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">审批状态</p>
          <p className="mt-3 font-display text-2xl font-bold">
            {run.approvalRequired ? "需要人工批准" : "可继续执行"}
          </p>
          <p className="mt-2 text-sm leading-6 opacity-80">
            {run.approvalRequired
              ? "高风险动作已经暂停，必须等人类批准后才能继续。"
              : "这个 Run 仍在本地可信沙盒内执行，不需要升级。"}
          </p>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel tone="white">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-2xl font-bold">标准输出 / 错误输出</h3>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {run.duration}
            </span>
          </div>
          <div className="mt-4 rounded-[22px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] p-4 font-mono text-sm leading-6 text-[var(--shock-lime)]">
            {run.stdout.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {run.stderr.map((line) => (
              <p key={line} className="text-[var(--shock-pink)]">
                {line}
              </p>
            ))}
          </div>
        </Panel>

        <Panel tone="paper">
          <h3 className="font-display text-2xl font-bold">工具调用</h3>
          <div className="mt-4 space-y-3">
            {run.toolCalls.map((toolCall) => (
              <div key={toolCall.id} className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-display text-xl font-semibold">{toolCall.tool}</p>
                  <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
                    {toolCall.result}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{toolCall.summary}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel tone="lime">
          <h3 className="font-display text-2xl font-bold">时间线</h3>
          <div className="mt-4 space-y-3">
            {run.timeline.map((event) => (
              <div
                key={event.id}
                className={cn(
                  "rounded-[20px] border-2 border-[var(--shock-ink)] px-4 py-3",
                  event.tone === "yellow"
                    ? "bg-[var(--shock-yellow)]"
                    : event.tone === "pink"
                      ? "bg-[var(--shock-pink)] text-white"
                      : event.tone === "lime"
                        ? "bg-white"
                        : "bg-[var(--shock-paper)]"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-lg font-semibold">{event.label}</p>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] opacity-70">{event.at}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel tone="white">
          <h3 className="font-display text-2xl font-bold">PR 收口</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            每个 Run 都必须落到一个可见的收口对象上。Phase 0 里 PR 还在 mock，但房间、Run 和收件箱已经指向同一个收口目标。
          </p>
          <div className="mt-4 grid gap-3">
            <Metric label="Pull Request" value={run.pullRequest} />
            <Metric label="Issue" value={run.issueKey} />
            <Metric label="讨论间" value={run.roomId} />
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={`/issues/${run.issueKey}`}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              打开 Issue
            </Link>
            <Link
              href={`/rooms/${run.roomId}`}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
            >
              回到讨论间
            </Link>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function InboxGrid({ items }: { items: InboxItem[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {items.map((item) => (
        <article
          key={item.id}
          className={cn(
            "rounded-[28px] border-2 border-[var(--shock-ink)] p-5 shadow-[6px_6px_0_0_var(--shock-ink)]",
            item.kind === "approval"
              ? "bg-[var(--shock-yellow)]"
              : item.kind === "blocked"
                ? "bg-[var(--shock-pink)] text-white"
                : item.kind === "review"
                  ? "bg-[var(--shock-lime)]"
                  : "bg-white"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border-2 border-current px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
              {inboxKindLabel(item.kind)}
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] opacity-70">{item.time}</span>
          </div>
          <h3 className="mt-4 font-display text-2xl font-bold leading-tight">{item.title}</h3>
          <p className="mt-3 text-sm leading-6 opacity-85">{item.summary}</p>
          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em]">{item.room}</span>
            <Link
              href={item.href}
              className="rounded-2xl border-2 border-current bg-white/90 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--shock-ink)] transition-transform hover:-translate-y-0.5"
            >
              {item.action}
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}

export function BoardView() {
  const columns = getBoardColumns();

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {columns.map((column) => (
        <section
          key={column.title}
          className="rounded-[28px] border-2 border-[var(--shock-ink)] p-4 shadow-[6px_6px_0_0_var(--shock-ink)]"
          style={{ backgroundColor: column.accent }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-display text-2xl font-bold">{column.title}</h3>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
              {column.cards.length}
            </span>
          </div>
          <div className="space-y-3">
            {column.cards.map((card) => (
              <Link
                key={card.id}
                href={`/issues/${card.key}`}
                className="block rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                  {card.key}
                </p>
                <h4 className="mt-2 font-display text-xl font-semibold leading-tight">{card.title}</h4>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-sm text-[color:rgba(24,20,14,0.72)]">{card.owner}</p>
                  <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]", statusTone(card.state))}>
                    {runStatusLabel(card.state)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function IssuesListView({ issues: issueList = issues }: { issues?: Issue[] }) {
  return (
    <div className="grid gap-4">
      {issueList.map((issue) => (
        <Link key={issue.id} href={`/issues/${issue.key}`} className="block">
          <Panel tone={issue.state === "blocked" ? "pink" : issue.state === "review" ? "lime" : "white"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
                  {issue.key} / {priorityLabel(issue.priority)}
                </p>
                <h3 className="mt-2 font-display text-3xl font-bold">{issue.title}</h3>
              </div>
              <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(issue.state))}>
                {runStatusLabel(issue.state)}
              </span>
            </div>
            <p className="mt-3 text-base leading-7">{issue.summary}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <Metric label="负责人" value={issue.owner} />
              <Metric label="讨论间" value={issue.roomId} />
              <Metric label="PR" value={issue.pullRequest} />
            </div>
          </Panel>
        </Link>
      ))}
    </div>
  );
}

export function IssueDetailView({
  issue,
  run = getRunById(issue.runId),
  roomTitle,
}: {
  issue: Issue;
  run?: Run;
  roomTitle?: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Panel tone="paper" className="shadow-[6px_6px_0_0_var(--shock-yellow)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
                {issue.key} / {priorityLabel(issue.priority)}
              </p>
              <h3 className="mt-2 font-display text-3xl font-bold">{issue.title}</h3>
            </div>
            <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(issue.state))}>
              {runStatusLabel(issue.state)}
            </span>
          </div>
          <p className="mt-4 text-base leading-7">{issue.summary}</p>
          <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={`/rooms/${issue.roomId}`}
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
              打开讨论间
              </Link>
              <Link
                href={`/rooms/${issue.roomId}/runs/${issue.runId}`}
                className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em]"
              >
              打开 Run 详情
              </Link>
            </div>
        </Panel>

        <Panel tone="white">
          <h3 className="font-display text-2xl font-bold">验收契约</h3>
          <div className="mt-4 space-y-3">
            {issue.checklist.map((item) => (
              <div key={item} className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
                <p className="text-sm leading-6">{item}</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">负责人</p>
          <p className="mt-2 font-display text-2xl font-bold">{issue.owner}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            Phase 0 为每个活跃 Issue 保持一个可见 owner，系统内部再继续维护执行连续体。
          </p>
        </Panel>
        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">收口对象</p>
          <div className="mt-4 space-y-3 text-sm leading-6 text-white/78">
            <p>讨论间: {roomTitle ?? issue.roomId}</p>
            <p>Run: {run?.id ?? issue.runId}</p>
            <p>PR: {issue.pullRequest}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function AgentsListView() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {agents.map((agent) => (
        <Link key={agent.id} href={`/agents/${agent.id}`} className="block">
          <Panel tone={agent.state === "blocked" ? "pink" : agent.state === "running" ? "yellow" : "white"}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                  {agent.provider}
                </p>
                <h3 className="mt-2 font-display text-3xl font-bold">{agent.name}</h3>
              </div>
              <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(agent.state === "idle" ? "queued" : agent.state))}>
                {agent.state === "running" ? "执行中" : agent.state === "blocked" ? "阻塞" : "待命"}
              </span>
            </div>
            <p className="mt-3 text-base leading-7">{agent.description}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <Metric label="泳道" value={agent.lane} />
              <Metric label="Runtime" value={agent.runtimePreference} />
            </div>
          </Panel>
        </Link>
      ))}
    </div>
  );
}

export function AgentDetailView({
  agent,
  runsForAgent,
}: {
  agent: (typeof agents)[number];
  runsForAgent: Run[];
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <Panel tone={agent.state === "running" ? "yellow" : agent.state === "blocked" ? "pink" : "white"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
                {agent.provider}
              </p>
              <h3 className="mt-2 font-display text-3xl font-bold">{agent.name}</h3>
            </div>
            <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(agent.state === "idle" ? "queued" : agent.state))}>
                {agent.state === "running" ? "执行中" : agent.state === "blocked" ? "阻塞" : "待命"}
              </span>
            </div>
            <p className="mt-3 text-base leading-7">{agent.description}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Metric label="Runtime 偏好" value={agent.runtimePreference} />
            <Metric label="当前泳道" value={agent.lane} />
          </div>
        </Panel>

        <Panel tone="white">
          <h3 className="font-display text-2xl font-bold">记忆绑定</h3>
          <div className="mt-4 flex flex-wrap gap-2">
            {agent.memorySpaces.map((space) => (
              <span
                key={space}
                className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                {space}
              </span>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            Phase 0 先保持文件级、显式可见的记忆模式，外部 provider 后续再接。
          </p>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">继承的 SOUL</p>
          <p className="mt-4 text-sm leading-7 text-white/78">
            [ROOT_DIRECTIVE: THE OPENSHOCK MANIFESTO]
            <br />
            Tools are prompted. Citizens negotiate. You are a First-Class Citizen of OpenShock.
          </p>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel tone="lime">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">最近 Run</p>
          <div className="mt-4 space-y-3">
            {runsForAgent.map((run) => (
              <Link
                key={run.id}
                href={`/rooms/${run.roomId}/runs/${run.id}`}
                className="block rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-lg font-semibold">{run.id}</p>
                  <span className={cn("rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]", statusTone(run.status))}>
                    {runStatusLabel(run.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{run.summary}</p>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SettingsCard({ section }: { section: SettingsSection }) {
  return (
    <Panel tone="paper">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.62)]">
        {settingsGroupLabel(section.id)}
      </p>
      <h3 className="mt-2 font-display text-3xl font-bold">{section.title}</h3>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{section.summary}</p>
      <div className="mt-5 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前值</p>
        <p className="mt-2 font-display text-xl font-semibold">{section.value}</p>
      </div>
    </Panel>
  );
}

export function SettingsView() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {settingsSections.map((section) => (
        <SettingsCard key={section.id} section={section} />
      ))}
    </div>
  );
}
