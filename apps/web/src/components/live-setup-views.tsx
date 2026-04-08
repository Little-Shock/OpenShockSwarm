"use client";

import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveRuntimeTruth } from "@/lib/live-runtime";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function formatHeartbeatCadence(interval?: number, timeout?: number) {
  if (!interval && !timeout) {
    return "未返回 cadence";
  }
  const intervalLabel = interval ? `${interval}s interval` : "interval 未返回";
  const timeoutLabel = timeout ? `${timeout}s timeout` : "timeout 未返回";
  return `${intervalLabel} / ${timeoutLabel}`;
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
    case "stale":
      return "心跳陈旧";
    case "offline":
      return "离线";
    default:
      return state || "未知";
  }
}

function pairingStatusLabel(state: string) {
  switch (state) {
    case "paired":
      return "已配对";
    case "degraded":
      return "配对降级";
    case "unpaired":
      return "未配对";
    default:
      return state || "待同步";
  }
}

function pairingStateLabel(state: string) {
  switch (state) {
    case "paired":
      return "当前所选";
    case "available":
      return "可切换";
    default:
      return state || "待确认";
  }
}

function githubInstallLabel(ready: boolean, installed: boolean) {
  if (ready) {
    return "ready";
  }
  if (installed) {
    return "installed";
  }
  return "pending";
}

function runtimeSchedulerStrategyLabel(strategy: string) {
  switch (strategy) {
    case "selected_runtime":
      return "沿用 Selection";
    case "agent_preference":
      return "按 Owner 偏好";
    case "least_loaded":
      return "按 Lease 压力";
    case "failover":
      return "自动 Failover";
    default:
      return "待调度";
  }
}

function runtimeProviderInventoryLabel(
  providers: Array<{ label: string; models: string[] }>
) {
  return providers
    .map((provider) => {
      const models = provider.models.length > 0 ? provider.models.join(" / ") : "no models";
      return `${provider.label}: ${models}`;
    })
    .join(" · ");
}

function runtimeLeaseIsActive(status?: string) {
  return Boolean(status && status.trim() && status !== "done");
}

function WorkspaceMetric({
  label,
  value,
  testId,
  testID,
}: {
  label: string;
  value: string;
  testId?: string;
  testID?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p data-testid={testID} className="mt-1.5 break-all font-display text-[17px] font-semibold leading-5">{value}</p>
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
    <Panel tone={tone} className="!p-3.5">
      <p className="font-display text-2xl font-bold">{title}</p>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{message}</p>
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
    <Panel tone={statusTone(active)} className="!p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            {active ? "已接通" : "待补全"}
          </p>
          <h3 className="mt-1.5 font-display text-[24px] font-bold leading-7">{title}</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]",
            active ? "bg-[var(--shock-lime)]" : "bg-white"
          )}
        >
          {active ? "live" : "pending"}
        </span>
      </div>
      <p className="mt-2.5 text-sm leading-6">{summary}</p>
    </Panel>
  );
}

export function LiveSetupContextRail() {
  const { state, loading, error } = usePhaseZeroState();
  const {
    loading: runtimeLoading,
    error: runtimeError,
    pairing,
    runtimes,
    selectedRuntimeName,
  } = useLiveRuntimeTruth();
  const workspace = state.workspace;
  const registryRuntimes = state.runtimes.length > 0 ? state.runtimes : runtimes;
  const onlineRuntimes = registryRuntimes.filter((item) => item.state === "online").length;
  const staleRuntimes = registryRuntimes.filter((item) => item.state === "stale").length;

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
          label: "Onboarding",
          value: loading
            ? "同步中"
            : error
              ? "未同步"
              : `${valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")} / ${valueOrPlaceholder(workspace.onboarding.status, "未声明")}`,
        },
        {
          label: "Runtime",
          value: loading || runtimeLoading
            ? "同步中"
            : error || runtimeError
              ? "未同步"
              : `${valueOrPlaceholder(selectedRuntimeName, "未选择")} / ${pairingStatusLabel(pairing?.pairingStatus || "")} / ${onlineRuntimes} 在线${staleRuntimes > 0 ? ` · ${staleRuntimes} 陈旧` : ""} / ${registryRuntimes.length} 台`,
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
  const {
    loading: runtimeLoading,
    error: runtimeError,
    pairing,
    selection,
    leases,
    runtimes,
    scheduler,
    selectedRuntimeName,
    selectedRuntimeRecord,
  } = useLiveRuntimeTruth();
  const workspace = state.workspace;
  const registryRuntimes = state.runtimes.length > 0 ? state.runtimes : runtimes;
  const onlineRuntimes = registryRuntimes.filter((item) => item.state === "online").length;
  const staleRuntimes = registryRuntimes.filter((item) => item.state === "stale").length;
  const selectableRuntimes = registryRuntimes.filter((item) => item.state !== "offline" && item.daemonUrl).length;
  const runtimeMachines = selection?.runtimes ?? [];
  const pairingStatus = pairing?.pairingStatus || selection?.pairingStatus || workspace.pairingStatus;
  const selectedRuntimeLabel = valueOrPlaceholder(selectedRuntimeName, "未选择");
  const selectedRuntimeStateRecord =
    registryRuntimes.find((item) => item.machine === selectedRuntimeName || item.id === selectedRuntimeName) ?? null;
  const selectedRuntimeTruth = selectedRuntimeRecord ?? selectedRuntimeStateRecord;
  const selectedRuntimeCLI =
    selectedRuntimeTruth?.detectedCli.join(" + ") || selectedRuntimeTruth?.providers.map((item) => item.label).join(" / ");
  const selectedRuntimeInventory = runtimeProviderInventoryLabel(selectedRuntimeTruth?.providers ?? []);
  const selectedHeartbeatCadence = formatHeartbeatCadence(
    selectedRuntimeTruth?.heartbeatIntervalSeconds,
    selectedRuntimeTruth?.heartbeatTimeoutSeconds
  );
  const activeLeases = leases.filter((item) => runtimeLeaseIsActive(item.status));
  const assignedRuntimeLabel = valueOrPlaceholder(scheduler.assignedMachine || scheduler.assignedRuntime, "暂无");

  if (loading || runtimeLoading) {
    return (
      <SetupStateNotice
        title="正在同步工作区真值"
        message="等待 server 返回当前 repo binding、runtime registry、heartbeat 与 selection；这页不再先摆一套本地 mock workspace。"
        tone="yellow"
      />
    );
  }

  if (error || runtimeError) {
    return (
      <SetupStateNotice
        title="工作区同步失败"
        message={error || runtimeError || "runtime truth fetch failed"}
        tone="pink"
      />
    );
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
      <div className="grid gap-3 md:grid-cols-2">
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
            registryRuntimes.length > 0
              ? `runtime registry 当前已登记 ${registryRuntimes.length} 台，其中 ${onlineRuntimes} 台在线${staleRuntimes > 0 ? `、${staleRuntimes} 台心跳陈旧` : ""}；当前 selection 是 ${selectedRuntimeLabel}，配对状态为 ${pairingStatusLabel(pairingStatus)}，下一条 lane 目标是 ${assignedRuntimeLabel}。`
              : "当前还没有已登记的 runtime registry；先完成 daemon pairing，再继续验证 selection 与 bridge。"
          }
          active={registryRuntimes.length > 0 && pairingStatus !== "unpaired"}
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
        <SetupCheckpointCard
          title="Onboarding 恢复"
          summary={`当前模板 ${valueOrPlaceholder(workspace.onboarding.templateId, "未声明")}，状态 ${valueOrPlaceholder(workspace.onboarding.status, "未声明")}，current step 为 ${valueOrPlaceholder(workspace.onboarding.currentStep, "未声明")}。reload / restart 后仍应回到 ${valueOrPlaceholder(workspace.onboarding.resumeUrl, "/setup")}。`}
          active={workspace.onboarding.status !== "not_started"}
        />
      </div>

      <div className="space-y-3">
        <Panel tone="yellow" className="!p-3.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">工作区在线状态</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <WorkspaceMetric label="仓库" value={valueOrPlaceholder(workspace.repo, "当前未返回 repo")} />
            <WorkspaceMetric label="分支" value={valueOrPlaceholder(workspace.branch, "当前未返回 branch")} />
            <WorkspaceMetric label="Runtime" value={`${selectedRuntimeLabel} / ${pairingStatusLabel(pairingStatus)}`} />
            <WorkspaceMetric
              label="Shell"
              value={valueOrPlaceholder(selectedRuntimeTruth?.shell, "未返回")}
              testId="setup-selected-runtime-shell"
            />
            <WorkspaceMetric label="下一条 Lane" value={assignedRuntimeLabel} />
            <WorkspaceMetric label="调度策略" value={runtimeSchedulerStrategyLabel(scheduler.strategy)} />
            <WorkspaceMetric label="心跳节奏" value={selectedHeartbeatCadence} />
            <WorkspaceMetric label="记忆" value={valueOrPlaceholder(workspace.memoryMode, "当前未返回 memory mode")} />
            <WorkspaceMetric label="模板" value={valueOrPlaceholder(workspace.onboarding.templateId, "未选模板")} testID="setup-onboarding-template" />
            <WorkspaceMetric label="Onboarding" value={valueOrPlaceholder(workspace.onboarding.status, "未声明")} testID="setup-onboarding-status" />
            <WorkspaceMetric label="恢复入口" value={valueOrPlaceholder(workspace.onboarding.resumeUrl, "未声明")} testID="setup-onboarding-resume-url" />
            <WorkspaceMetric label="GitHub Install" value={githubInstallLabel(workspace.githubInstallation.connectionReady, workspace.githubInstallation.appInstalled)} testID="setup-installation-status" />
          </dl>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
            当前 runtime control plane 已把 registry、selection 与 pairing 拆开：主状态里已收下 {state.runtimes.length} 条 runtime truth，
            当前有 {selectableRuntimes} 台可调度，默认指向 {selectedRuntimeLabel}
            {selectedRuntimeCLI ? `，CLI 为 ${selectedRuntimeCLI}` : ""}
            {selectedRuntimeInventory ? `，provider/model catalog 为 ${selectedRuntimeInventory}` : ""}。
          </p>
          <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 text-sm leading-6">
            {scheduler.summary || "当前还没有 scheduler truth。"}
          </p>
        </Panel>
        <Panel tone="paper" className="!p-3.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">多 Runtime 真值</p>
          <div className="mt-3 space-y-2">
            {registryRuntimes.length === 0 ? (
              <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                当前还没有已注册 runtime。先完成 daemon 配对，再继续做 selection 和调度验证。
              </p>
            ) : (
              registryRuntimes.map((runtime) => {
                const selected = runtime.machine === selectedRuntimeName || runtime.id === selectedRuntimeName;
                const assigned = runtime.machine === scheduler.assignedMachine || runtime.id === scheduler.assignedRuntime;
                const machine = runtimeMachines.find((item) => item.name === runtime.machine || item.id === runtime.id);
                const candidate =
                  scheduler.candidates.find((item) => item.runtime === runtime.id || item.machine === runtime.machine) ?? null;
                const activeLeaseCount = activeLeases.filter(
                  (lease) => lease.runtime === runtime.id || lease.machine === runtime.machine
                ).length;
                return (
                  <div
                    key={runtime.id}
                    data-testid={`setup-runtime-card-${runtime.id}`}
                    className={cn(
                      "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-3",
                      assigned ? "bg-[var(--shock-lime)]" : selected ? "bg-[var(--shock-yellow)]" : "bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-[18px] font-semibold leading-5">{runtime.machine}</p>
                        <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">
                          {runtime.detectedCli.join(" + ") || machine?.cli || "未返回 CLI 标签"}
                        </p>
                      </div>
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                        {assigned ? "next lane" : selected ? "selected" : runtimeStatusLabel(runtime.state)}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                      <p>{machine?.os || "Local"} / {machine?.lastHeartbeat || runtime.lastHeartbeatAt || "未返回心跳"}</p>
                      <p>{runtime.shell || machine?.shell || "shell 未返回"}</p>
                      <p>{runtime.daemonUrl || "未配对 daemon"} / {pairingStateLabel(runtime.pairingState)}</p>
                      <p>{formatHeartbeatCadence(runtime.heartbeatIntervalSeconds, runtime.heartbeatTimeoutSeconds)}</p>
                      <p>active leases: {activeLeaseCount} / schedulable: {candidate?.schedulable ? "yes" : "no"}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {runtime.providers.map((provider) => (
                        <span
                          key={`${runtime.id}-${provider.id}`}
                          className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1.5 font-mono text-[10px]"
                        >
                          {provider.label}: {(provider.models ?? []).join(" / ") || "no models"}
                        </span>
                      ))}
                    </div>
                    {candidate?.reason ? <p className="mt-2.5 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]">{candidate.reason}</p> : null}
                  </div>
                );
              })
            )}
          </div>
        </Panel>
        <Panel tone="ink" className="!p-3.5 shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em]">当前协作基线</p>
          <ol className="mt-3 space-y-2 text-sm leading-6 text-white/78">
            <li>1. Workspace 直接显示 live repo / branch / runtime selection 真值。</li>
            <li>2. Setup 不再把静态步骤卡当成当前环境状态。</li>
            <li>3. 当前工作区已有 {state.issues.length} 条 live issue、{state.runs.length} 条 live run。</li>
            <li>4. 当前已注册 {registryRuntimes.length} 台 runtime，selection 为 {selectedRuntimeLabel}，下一条 lane 指向 {assignedRuntimeLabel}，active lease 为 {activeLeases.length} 条。</li>
          </ol>
        </Panel>
      </div>
    </div>
  );
}
