"use client";

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

function runtimeStatusLabel(state: string) {
  switch (state) {
    case "online":
      return "在线";
    case "busy":
      return "忙碌";
    case "offline":
      return "离线";
    default:
      return state || "未知";
  }
}

function WorkspaceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold break-all">{value}</p>
    </div>
  );
}

function SetupStateNotice({
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
      <p className="mt-3 max-w-2xl text-base leading-7 text-[color:rgba(24,20,14,0.76)]">{message}</p>
    </Panel>
  );
}

function SetupCheckpointCard({
  title,
  summary,
  active,
}: {
  title: string;
  summary: string;
  active: boolean;
}) {
  return (
    <Panel tone={statusTone(active)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {active ? "已接通" : "待补全"}
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">{title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            active ? "bg-[var(--shock-lime)]" : "bg-white"
          )}
        >
          {active ? "live" : "pending"}
        </span>
      </div>
      <p className="mt-3 text-base leading-7">{summary}</p>
    </Panel>
  );
}

export function LiveSetupContextRail() {
  const { state, loading, error } = usePhaseZeroState();
  const workspace = state.workspace;

  return (
    <DetailRail
      label="配置检查点"
      items={[
        {
          label: "身份",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : valueOrPlaceholder(workspace.deviceAuth, "待确认"),
        },
        {
          label: "仓库",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : valueOrPlaceholder(workspace.repoBindingStatus, "待绑定"),
        },
        {
          label: "Runtime",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${valueOrPlaceholder(workspace.pairedRuntime, "未选择")} / ${valueOrPlaceholder(workspace.pairingStatus, "待同步")} / ${state.machines.length} 台`,
        },
        {
          label: "PR 链路",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : state.pullRequests.length > 0
                ? `${state.pullRequests.length} 条 live PR`
                : "待产生",
        },
      ]}
    />
  );
}

export function LiveSetupOverview() {
  const { state, loading, error } = usePhaseZeroState();
  const workspace = state.workspace;
  const onlineRuntimes = state.machines.filter((item) => item.state === "online").length;
  const selectableRuntimes = state.machines.filter((item) => item.state !== "offline").length;

  if (loading) {
    return (
      <SetupStateNotice
        title="正在同步工作区真值"
        message="等待 server 返回当前 repo binding、runtime pairing 和 Phase 2 setup 基线；这页不再先摆一套本地 mock workspace。"
        tone="yellow"
      />
    );
  }

  if (error) {
    return (
      <SetupStateNotice
        title="工作区同步失败"
        message={error}
        tone="pink"
      />
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
      <div className="grid gap-4 md:grid-cols-2">
        <SetupCheckpointCard
          title="仓库绑定"
          summary={
            workspace.repoBindingStatus === "bound"
              ? `当前仓库已绑定到 ${valueOrPlaceholder(workspace.repoProvider, "代码平台")}，可继续沿 live repo truth 推进。`
              : "当前工作区还没有把本地仓库真绑定到 OpenShock。"
          }
          active={workspace.repoBindingStatus === "bound"}
        />
        <SetupCheckpointCard
          title="Runtime 配对"
          summary={
            workspace.pairingStatus === "paired"
              ? `当前已注册 ${state.machines.length} 台 runtime，其中 ${onlineRuntimes} 台在线；默认 selection 是 ${valueOrPlaceholder(workspace.pairedRuntime, "runtime")}。`
              : "当前工作区还没有拿到 live runtime pairing。"
          }
          active={workspace.pairingStatus === "paired"}
        />
        <SetupCheckpointCard
          title="讨论间闭环"
          summary={
            state.rooms.length > 0
              ? `当前已有 ${state.rooms.length} 个 live room，Issue / Room / Run 链路已经可见。`
              : "当前还没有 live room，讨论间链路尚未显现。"
          }
          active={state.rooms.length > 0}
        />
        <SetupCheckpointCard
          title="PR 收口"
          summary={
            state.pullRequests.length > 0
              ? `当前已有 ${state.pullRequests.length} 个 live PR 对象，收口面不再停留在静态文案。`
              : "当前还没有 live PR 对象，收口链路仍待产生。"
          }
          active={state.pullRequests.length > 0}
        />
      </div>

      <div className="space-y-4">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">工作区在线状态</p>
          <dl className="mt-4 grid gap-3">
            <WorkspaceMetric label="仓库" value={valueOrPlaceholder(workspace.repo, "当前未返回 repo")} />
            <WorkspaceMetric label="分支" value={valueOrPlaceholder(workspace.branch, "当前未返回 branch")} />
            <WorkspaceMetric label="Runtime" value={`${valueOrPlaceholder(workspace.pairedRuntime, "当前未选择")} / ${selectableRuntimes} 可用`} />
            <WorkspaceMetric label="记忆" value={valueOrPlaceholder(workspace.memoryMode, "当前未返回 memory mode")} />
          </dl>
        </Panel>
        <Panel tone="paper">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">多 Runtime 真值</p>
          <div className="mt-4 space-y-3">
            {state.machines.length === 0 ? (
              <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                当前还没有已注册 runtime。先完成 daemon 配对，再继续做 selection 和调度验证。
              </p>
            ) : (
              state.machines.map((machine) => {
                const selected = machine.name === workspace.pairedRuntime;
                return (
                  <div
                    key={machine.id}
                    className={cn(
                      "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-3",
                      selected ? "bg-[var(--shock-yellow)]" : "bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-xl font-semibold">{machine.name}</p>
                        <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">{machine.cli || "未返回 CLI 标签"}</p>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                        {selected ? "selected" : runtimeStatusLabel(machine.state)}
                      </span>
                    </div>
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      {machine.os || "未知系统"} / {machine.lastHeartbeat || "未返回心跳"}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </Panel>
        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">当前协作基线</p>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-white/78">
            <li>1. Workspace 直接显示 live repo / branch / runtime selection 真值。</li>
            <li>2. Setup 不再把静态步骤卡当成当前环境状态。</li>
            <li>3. 当前工作区已有 {state.issues.length} 条 live issue、{state.runs.length} 条 live run。</li>
            <li>4. 当前已注册 {state.machines.length} 台 runtime，默认 selection 为 {valueOrPlaceholder(workspace.pairedRuntime, "未选择")}。</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
