"use client";

import Link from "next/link";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function statusTone(active: boolean) {
  return active ? "lime" : "paper";
}

function statusLabel(active: boolean) {
  return active ? "live" : "pending";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 break-words font-display text-xl font-semibold">{value}</p>
    </div>
  );
}

function AccessStateNotice({
  title,
  message,
  tone = "white",
}: {
  title: string;
  message: string;
  tone?: "white" | "paper" | "yellow" | "lime" | "pink" | "ink";
}) {
  return (
    <Panel tone={tone}>
      <p className="font-display text-3xl font-bold">{title}</p>
      <p className="mt-3 max-w-3xl text-base leading-7 text-[color:rgba(24,20,14,0.76)]">{message}</p>
    </Panel>
  );
}

function SurfaceCard({
  title,
  summary,
  currentTruth,
  nextGate,
  href,
  active,
}: {
  title: string;
  summary: string;
  currentTruth: string;
  nextGate: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-[28px] border-2 border-[var(--shock-ink)] p-5 shadow-[6px_6px_0_0_var(--shock-ink)] transition-transform hover:-translate-y-0.5",
        active ? "bg-[var(--shock-lime)]" : "bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">control surface</p>
          <h3 className="mt-2 font-display text-2xl font-bold">{title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            active ? "bg-white" : "bg-[var(--shock-paper)]"
          )}
        >
          {statusLabel(active)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{summary}</p>
      <div className="mt-5 rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前真值</p>
        <p className="mt-2 font-display text-xl font-semibold">{currentTruth}</p>
      </div>
      <div className="mt-4 rounded-[20px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">下一道 gate</p>
        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{nextGate}</p>
      </div>
    </Link>
  );
}

function GateRow({
  title,
  currentTruth,
  frontEndHandling,
  nextGate,
  tone,
}: {
  title: string;
  currentTruth: string;
  frontEndHandling: string;
  nextGate: string;
  tone: "lime" | "yellow" | "paper";
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border-2 border-[var(--shock-ink)] px-4 py-4",
        tone === "lime" ? "bg-[var(--shock-lime)]" : tone === "yellow" ? "bg-[var(--shock-yellow)]" : "bg-white"
      )}
    >
      <p className="font-display text-2xl font-bold">{title}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">current truth</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">{currentTruth}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">front-end handling</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">{frontEndHandling}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">next gate</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">{nextGate}</p>
        </div>
      </div>
    </div>
  );
}

export function LiveAccessContextRail() {
  const { state, loading, error } = usePhaseZeroState();
  const workspace = state.workspace;
  const runtimeSurfaceVisible = Boolean(workspace.pairedRuntime || workspace.pairingStatus || state.machines.length > 0);
  const visibleControlSurfaces = [
    workspace.repoBindingStatus === "bound",
    state.issues.length > 0 || state.rooms.length > 0 || state.runs.length > 0,
    state.inbox.length > 0,
    runtimeSurfaceVisible,
  ].filter(Boolean).length;

  return (
    <DetailRail
      label="身份检查点"
      items={[
        {
          label: "设备信任",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : valueOrPlaceholder(workspace.deviceAuth, "待返回"),
        },
        {
          label: "代码身份",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : workspace.repoBindingStatus === "bound"
                ? `${valueOrPlaceholder(workspace.repoProvider, "provider")} / ${valueOrPlaceholder(workspace.repoAuthMode, "auth path")}`
                : "repo binding 未完成",
        },
        {
          label: "成员目录",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : "待 #53 返回 member roster",
        },
        {
          label: "权限覆盖",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${visibleControlSurfaces} 个 surface 已在线 / role guard 待 #55`,
        },
      ]}
    />
  );
}

export function LiveAccessOverview() {
  const { state, loading, error } = usePhaseZeroState();
  const workspace = state.workspace;
  const issueRoomRunVisible = state.issues.length > 0 || state.rooms.length > 0 || state.runs.length > 0;
  const runtimeSurfaceVisible = Boolean(workspace.pairedRuntime || workspace.pairingStatus || state.machines.length > 0);
  const controlSurfaceCount = [
    workspace.repoBindingStatus === "bound",
    issueRoomRunVisible,
    state.inbox.length > 0,
    runtimeSurfaceVisible,
  ].filter(Boolean).length;
  const firstRoomHref = state.rooms[0] ? `/rooms/${state.rooms[0].id}` : "/runs";
  const deviceTrustLabel = valueOrPlaceholder(workspace.deviceAuth, "待返回 device trust");
  const codeIdentityLabel =
    workspace.repoBindingStatus === "bound"
      ? `${valueOrPlaceholder(workspace.repoProvider, "provider")} / ${valueOrPlaceholder(workspace.repoAuthMode, "auth path")}`
      : "repo binding 未完成";
  const memberContractLabel = workspace.name ? `${workspace.name} 已在线，但 member roster 尚未返回` : "待 workspace truth";

  if (loading) {
    return (
      <AccessStateNotice
        title="正在同步身份与权限真值"
        message="等待 server 返回当前 workspace、repo auth、inbox 和 runtime truth；这页不会先摆一套静态 auth/member/permission 假壳。"
        tone="yellow"
      />
    );
  }

  if (error) {
    return <AccessStateNotice title="身份页同步失败" message={error} tone="pink" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_0.9fr]">
        <Panel tone={statusTone(Boolean(workspace.deviceAuth || workspace.repoBindingStatus === "bound"))}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">auth surface</p>
              <h2 className="mt-2 font-display text-4xl font-bold">当前先把已返回的身份真值摆明</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {controlSurfaceCount} surfaces live
            </span>
          </div>
          <p className="mt-4 max-w-4xl text-base leading-7 text-[color:rgba(24,20,14,0.78)]">
            这页不伪造 email login form，也不假装已经有 workspace member API。它只消费 repo 里当前真实存在的
            workspace / repo auth / inbox / runtime truth，并把仍待 `#53/#55` 的 session、member roster 和 role guard 缺口直接前台化。
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <Metric label="设备信任" value={deviceTrustLabel} />
            <Metric label="代码身份" value={codeIdentityLabel} />
            <Metric label="成员目录" value={memberContractLabel} />
          </div>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">当前边界</p>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-white/78">
            <li>1. workspace、repo auth、runtime pairing 与 control-plane 真值现在已经能从 live state 直接读到。</li>
            <li>2. 邮箱 session、workspace member roster、role-scoped permission 仍然没有 server contract，不能冒充成已完成功能。</li>
            <li>3. 这页先把缺口和现有入口并排摆出来，让后续 `#53/#55` 只补 contract，不再回头重画前台壳。</li>
          </ol>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_1.05fr]">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">member / permission rollout</p>
          <div className="mt-4 space-y-3">
            <GateRow
              title="邮箱登录 / session"
              currentTruth="当前仓库还没有返回 email session contract；README 和 PRD 仍把这部分列为未完成。"
              frontEndHandling="身份页只展示 live identity shell，不渲染可以提交的假 login 表单。"
              nextGate="#53 返回 session / role contract 后，再把登录入口接成真正可操作 surface。"
              tone="yellow"
            />
            <GateRow
              title="workspace member roster"
              currentTruth={memberContractLabel}
              frontEndHandling="当前先把 workspace 壳、在线控制面和缺口说明摆出来，不伪造成员列表。"
              nextGate="#53 返回 member roster / invite / removal contract 后，再把成员目录接成 live truth。"
              tone="paper"
            />
            <GateRow
              title="role-scoped permission"
              currentTruth={`${controlSurfaceCount} 个控制面已经 live，但动作仍未按 workspace member role 裁剪。`}
              frontEndHandling="前台先把每个入口的当前真值和下一道 gate 并排展示，避免误读成已上权限。"
              nextGate="#55 把 issue / room / run / inbox / repo / runtime 动作接上权限校验与成员真值。"
              tone="lime"
            />
          </div>
        </Panel>

        <Panel tone="paper" className="shadow-[8px_8px_0_0_var(--shock-yellow)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">access map</p>
              <h2 className="mt-2 font-display text-3xl font-bold">当前控制面覆盖图</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              role guard pending
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这些入口已经在前台可见，但还没有 member-aware policy。`#54` 先把它们收成统一的 auth/member/permission surface，后面由
            `#53/#55` 把 live contract 补齐。
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <SurfaceCard
              title="Setup / GitHub"
              summary="代码身份、repo binding 和 runtime pairing 已经在 setup 页有 live truth。"
              currentTruth={codeIdentityLabel}
              nextGate="等 #53 明确 user session / member role 后，再决定谁可以改 repo binding 与 GitHub install。"
              href="/setup"
              active={workspace.repoBindingStatus === "bound"}
            />
            <SurfaceCard
              title="Issues / Board"
              summary="Issue、PR 与 board 已可见，但当前还没有按成员角色裁剪可见性和动作权限。"
              currentTruth={`${state.issues.length} issues / ${state.pullRequests.length} PR / ${state.runs.length} runs`}
              nextGate="等 #55 把 create / review / merge / mutate 动作接上 role-aware guard。"
              href="/board"
              active={issueRoomRunVisible}
            />
            <SurfaceCard
              title="Rooms / Runs"
              summary="讨论间和 run shell 已 live，但谁能进入、发言、继续执行还没有 member contract。"
              currentTruth={`${state.rooms.length} rooms / ${state.sessions.length} sessions / ${state.runs.length} runs`}
              nextGate="等 #53 给出 member roster，#55 再把 room / run / inbox action 绑到权限边界。"
              href={firstRoomHref}
              active={state.rooms.length > 0 || state.sessions.length > 0}
            />
            <SurfaceCard
              title="Inbox / Decision"
              summary="审批卡片和 blocked escalation 已经 live，但当前谁能 approve / resolve 还不是 role-aware。"
              currentTruth={`${state.inbox.length} inbox items / ${state.pullRequests.length} tracked PR`}
              nextGate="等 #55 把 inbox decision、review gate 和成员角色统一起来。"
              href="/inbox"
              active={state.inbox.length > 0}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
