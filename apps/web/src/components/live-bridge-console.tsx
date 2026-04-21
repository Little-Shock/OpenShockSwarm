"use client";

import { useEffect, useState, type FormEvent } from "react";

import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveRuntimeTruth, type LiveRuntimeMachine, type LiveRuntimeSnapshot } from "@/lib/live-runtime";
import type { RuntimeRegistryRecord } from "@/lib/phase-zero-types";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";

type ExecResult = {
  provider: string;
  command: string[];
  output: string;
  error?: string;
  duration: string;
};

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function statusLabel(state: string) {
  switch (state) {
    case "online":
      return "在线";
    case "busy":
      return "忙碌";
    case "stale":
      return "心跳陈旧";
    case "offline":
      return "离线";
    case "syncing":
      return "同步中";
    case "unselected":
      return "未选择";
    default:
      return state || "未知";
  }
}

function pairingStatusLabel(state: string) {
  switch (state) {
    case "paired":
      return "已配对";
    case "available":
      return "可用";
    case "degraded":
      return "配对降级";
    case "unpaired":
      return "未配对";
    default:
      return state || "待同步";
  }
}

function permissionStatusLabel(state: string) {
  switch (state) {
    case "allowed":
      return "可操作";
    case "blocked":
      return "无权限";
    case "signed_out":
      return "未登录";
    default:
      return state || "待同步";
  }
}

function runtimeStatusTone(state: string) {
  switch (state) {
    case "online":
      return "bg-[var(--shock-lime)]";
    case "busy":
      return "bg-[var(--shock-yellow)]";
    case "syncing":
    case "stale":
    case "unselected":
      return "bg-white";
    default:
      return "bg-[var(--shock-pink)] text-white";
  }
}

function isSchedulableRuntime(state: string) {
  return state === "online" || state === "busy";
}

function formatHeartbeatCadence(interval?: number, timeout?: number) {
  if (!interval && !timeout) {
    return "未返回心跳节奏";
  }
  const intervalLabel = interval ? `${interval} 秒间隔` : "间隔未返回";
  const timeoutLabel = timeout ? `${timeout} 秒超时` : "超时未返回";
  return `${intervalLabel} / ${timeoutLabel}`;
}

function runtimeIdentityLabel(runtime: RuntimeRegistryRecord | LiveRuntimeSnapshot | null | undefined) {
  if (!runtime) {
    return "";
  }
  return "runtimeId" in runtime ? runtime.runtimeId : runtime.id;
}

function machineRuntimeSnapshot(machine: LiveRuntimeMachine | null | undefined): LiveRuntimeSnapshot | null {
  if (!machine) {
    return null;
  }
  const detectedCli = machine.cli
    .split("+")
    .map((item) => item.trim())
    .filter(Boolean);
  const cliText = machine.cli.toLowerCase();
  const providers = [];
  if (cliText.includes("codex")) {
    providers.push({
      id: "codex",
      label: "Codex CLI",
      mode: "local",
      capabilities: ["conversation", "stream"],
      models: [],
      transport: machine.daemonUrl ? "http bridge" : "local",
    });
  }
  if (cliText.includes("claude")) {
    providers.push({
      id: "claude",
      label: "Claude Code CLI",
      mode: "local",
      capabilities: ["conversation", "stream"],
      models: [],
      transport: machine.daemonUrl ? "http bridge" : "local",
    });
  }
  if (providers.length === 0) {
    providers.push({
      id: "codex",
      label: "本机通道",
      mode: "local",
      capabilities: ["conversation"],
      models: [],
      transport: machine.daemonUrl ? "http bridge" : "local",
    });
  }
  return {
    runtimeId: machine.id,
    daemonUrl: machine.daemonUrl,
    machine: machine.name,
    detectedCli,
    providers,
    shell: machine.shell,
    state: machine.state,
    workspaceRoot: "",
    reportedAt: machine.lastHeartbeat,
  };
}

export function LiveBridgeConsole() {
  const { state } = usePhaseZeroState();
  const {
    loading: runtimeLoading,
    refreshing,
    runtimeActionLoading,
    error: runtimeError,
    pairing,
    selection,
    runtime,
    runtimes,
    selectedRuntimeName,
    selectedRuntimeRecord,
    pairRuntime,
    unpairRuntime,
    selectRuntime,
  } = useLiveRuntimeTruth();
  const [daemonUrl, setDaemonURL] = useState("http://127.0.0.1:8090");
  const [provider, setProvider] = useState("codex");
  const [prompt, setPrompt] = useState("请用一句中文确认：当前机器已经连通，可以开始执行任务。");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canManageRuntime = hasSessionPermission(state.auth.session, "runtime.manage");
  const canExec = hasSessionPermission(state.auth.session, "run.execute");
  const runtimeManageStatus = permissionStatus(state.auth.session, "runtime.manage");
  const execStatus = permissionStatus(state.auth.session, "run.execute");
  const runtimeManageBoundary = permissionBoundaryCopy(state.auth.session, "runtime.manage");
  const execBoundary = permissionBoundaryCopy(state.auth.session, "run.execute");

  const registryRuntimes = state.runtimes.length > 0 ? state.runtimes : runtimes;
  const selectedMachine =
    selection?.runtimes.find((item) => item.name === selectedRuntimeName || item.id === selectedRuntimeName) ?? null;
  const scheduledMachine =
    selection?.runtimes.find(
      (item) => item.name === state.runtimeScheduler.assignedMachine || item.id === state.runtimeScheduler.assignedRuntime
    ) ?? null;
  const firstSchedulableMachine = selection?.runtimes.find((item) => isSchedulableRuntime(item.state)) ?? null;
  const selectedMachineTruth = selectedMachine ?? scheduledMachine ?? firstSchedulableMachine ?? selection?.runtimes[0] ?? null;
  const selectedRuntimeStateRecord =
    registryRuntimes.find((item) => item.machine === selectedRuntimeName || item.id === selectedRuntimeName) ?? null;
  const scheduledRuntimeTruth =
    registryRuntimes.find(
      (item) =>
        item.machine === state.runtimeScheduler.assignedMachine || item.id === state.runtimeScheduler.assignedRuntime
    ) ?? null;
  const firstSchedulableRuntime = registryRuntimes.find((item) => isSchedulableRuntime(item.state)) ?? registryRuntimes[0] ?? null;
  const machineRuntimeTruth = machineRuntimeSnapshot(selectedMachineTruth);
  const selectedRuntimeTruth =
    selectedRuntimeRecord ?? selectedRuntimeStateRecord ?? scheduledRuntimeTruth ?? firstSchedulableRuntime ?? machineRuntimeTruth;
  const effectiveRuntime = runtime ?? selectedRuntimeTruth;
  const activeRuntimeName = selectedRuntimeName || effectiveRuntime?.machine || runtimeIdentityLabel(effectiveRuntime) || "";
  const selectedHeartbeatCadence = formatHeartbeatCadence(
    selectedRuntimeTruth?.heartbeatIntervalSeconds,
    selectedRuntimeTruth?.heartbeatTimeoutSeconds
  );
  const bridgeStatus = effectiveRuntime
    ? effectiveRuntime.state
    : activeRuntimeName
      ? runtimeLoading
        ? "syncing"
        : "offline"
      : "unselected";

  useEffect(() => {
    const nextDaemonURL = pairing?.daemonUrl || selection?.selectedDaemonUrl;
    if (nextDaemonURL) {
      setDaemonURL(nextDaemonURL);
    }
  }, [pairing?.daemonUrl, selection?.selectedDaemonUrl]);

  useEffect(() => {
    const providers = effectiveRuntime?.providers ?? [];
    const preferredProvider = providers.find((item) => item.id === "codex")?.id ?? providers[0]?.id;
    if (preferredProvider) {
      setProvider(preferredProvider);
    }
  }, [effectiveRuntime]);

  async function handlePairRuntime() {
    if (!canManageRuntime) {
      return;
    }
    setExecError(null);
    setActionSuccess(null);

    try {
      await pairRuntime(daemonUrl);
      setResult(null);
      setActionSuccess(`已连接机器：${daemonUrl}`);
    } catch {
      // runtimeError already carries the failure contract for the surface
    }
  }

  async function handleUnpairRuntime() {
    if (!canManageRuntime) {
      return;
    }
    setExecError(null);
    setActionSuccess(null);

    try {
      await unpairRuntime();
      setResult(null);
      setActionSuccess("已取消当前机器连接。");
    } catch {
      // runtimeError already carries the failure contract for the surface
    }
  }

  async function handleSelectRuntime(machine: string) {
    if (!canManageRuntime) {
      return;
    }
    setExecError(null);
    setActionSuccess(null);

    try {
      await selectRuntime(machine);
      setResult(null);
      setActionSuccess(`已切换到机器：${machine}`);
    } catch {
      // runtimeError already carries the failure contract for the surface
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canExec) {
      return;
    }
    setLoading(true);
    setExecError(null);
    setResult(null);
    setActionSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/v1/runtime/bridge-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          prompt,
        }),
      });

      const payload = (await response.json()) as ExecResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `执行请求失败：${response.status}`);
      }

      setResult(payload);
      setActionSuccess(`已完成 ${payload.provider} 通道自检。`);
    } catch (bridgeError) {
      setExecError(bridgeError instanceof Error ? bridgeError.message : "连接测试失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      data-testid="setup-live-bridge"
      className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-pink)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            本机连接
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">直接连接机器</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            runtimeStatusTone(bridgeStatus)
          )}
        >
          {statusLabel(bridgeStatus)}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        确认当前浏览器连到哪台机器、哪条执行通道可用，以及测试请求是否返回。
      </p>

      {effectiveRuntime ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前机器</p>
            <p className="mt-2 font-display text-xl font-semibold">{activeRuntimeName || "未选择"}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">最新心跳</p>
            <p className="mt-2 font-display text-xl font-semibold">
              {selectedMachineTruth?.lastHeartbeat || selectedRuntimeTruth?.lastHeartbeatAt || "未返回"}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">可用通道</p>
            <p className="mt-2 font-display text-xl font-semibold">
              {(effectiveRuntime.providers ?? []).map((item) => item.label).join(" / ") || "等待配对"}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">连接说明</p>
            <p className="mt-2 text-sm leading-6">
              当前页只显示你真正会用到的连接信息，不再暴露内部工作路径。
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
        当前已识别 {state.runtimes.length} 台机器；当前机器的心跳节奏为 {selectedHeartbeatCadence}。
      </p>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              已连接机器
            </p>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
              {runtimes.length} 台{refreshing ? " · 同步中" : ""}
            </span>
          </div>

          {runtimeLoading && runtimes.length === 0 ? (
            <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              正在同步机器状态、心跳和当前选择。
            </div>
          ) : registryRuntimes.length === 0 ? (
            <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              当前还没有可用机器。先在右侧填写地址并连接，再继续测试。
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {registryRuntimes.map((item) => {
                const selected = item.machine === selectedRuntimeName || item.id === selectedRuntimeName;
                const machine = selection?.runtimes.find((candidate) => candidate.name === item.machine || candidate.id === item.id);
                const actionable = isSchedulableRuntime(item.state) && Boolean(item.daemonUrl);

                return (
                  <article
                    key={item.id}
                    data-testid={`setup-runtime-card-${item.machine}`}
                    className={cn(
                      "rounded-[18px] border-2 border-[var(--shock-ink)] px-4 py-4",
                      selected ? "bg-[var(--shock-yellow)]" : "bg-white"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-display text-2xl font-bold">{item.machine}</p>
                        <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">
                          {item.detectedCli.join(" + ") || machine?.cli || "未返回 CLI 标签"}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                          runtimeStatusTone(item.state)
                        )}
                      >
                        {selected ? "当前机器" : statusLabel(item.state)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2 font-mono text-[10px] leading-5 text-[color:rgba(24,20,14,0.68)]">
                      <p>地址：{item.daemonUrl || "未连接"}</p>
                      <p>连接状态：{pairingStatusLabel(item.pairingState || "")} / 工作区 {pairingStatusLabel(pairing?.pairingStatus || selection?.pairingStatus || "")}</p>
                      <p>最近心跳：{machine?.lastHeartbeat || item.lastHeartbeatAt || "未返回"}</p>
                      <p>心跳节奏：{formatHeartbeatCadence(item.heartbeatIntervalSeconds, item.heartbeatTimeoutSeconds)}</p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        data-testid={`setup-runtime-select-${item.machine}`}
                        disabled={runtimeActionLoading || !actionable || selected || !canManageRuntime}
                        onClick={() => void handleSelectRuntime(item.machine)}
                        className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {selected ? "当前机器" : !canManageRuntime ? "仅所有者可切换" : actionable ? "切换到这里" : "不可切换"}
                      </button>
                      {selected ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                          当前页默认会把测试请求发到这台机器。
                        </span>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            连接新机器
          </p>
          <label className="space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              机器地址
            </span>
            <input
              data-testid="setup-runtime-daemon-url"
              value={daemonUrl}
              onChange={(event) => setDaemonURL(event.target.value)}
              className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-sm"
              placeholder="http://127.0.0.1:8090"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              data-testid="setup-runtime-pair"
              type="button"
              onClick={() => void handlePairRuntime()}
              disabled={runtimeActionLoading || !canManageRuntime}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runtimeActionLoading ? "处理中..." : "连接机器"}
            </button>
            <button
              data-testid="setup-runtime-unpair"
              type="button"
              onClick={() => void handleUnpairRuntime()}
              disabled={runtimeActionLoading || pairing?.pairingStatus !== "paired" || !canManageRuntime}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              撤销当前授权
            </button>
          </div>
          <p data-testid="setup-runtime-manage-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            {permissionStatusLabel(runtimeManageStatus)}
          </p>
          {!canManageRuntime ? <p className="text-sm leading-6 text-[var(--shock-pink)]">{runtimeManageBoundary}</p> : null}
          <div className="grid gap-3 pt-2">
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前机器</p>
              <p data-testid="setup-runtime-selection-value" className="mt-2 font-display text-xl font-semibold">
                {selectedRuntimeName || "未选择"}
              </p>
            </div>
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">授权 / 配对</p>
              <p data-testid="setup-runtime-pairing-value" className="mt-2 text-sm leading-6">
                {pairing?.deviceAuth || "未授权"} / {pairingStatusLabel(pairing?.pairingStatus || selection?.pairingStatus || "")}
              </p>
            </div>
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">最近切换</p>
              <p className="mt-2 break-all font-mono text-xs leading-5">{pairing?.lastPairedAt || "未返回"}</p>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <label className="space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              发送通道
            </span>
            <select
              data-testid="setup-bridge-provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              disabled={!canExec}
              className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-sm"
            >
              {(effectiveRuntime?.providers ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              提示词
            </span>
            <textarea
              data-testid="setup-bridge-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={!canExec}
              rows={4}
              className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 text-sm leading-6"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            data-testid="setup-runtime-exec-submit"
            type="submit"
            disabled={loading || !effectiveRuntime || !isSchedulableRuntime(effectiveRuntime.state) || !canExec}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "检查中..." : "做连接测试"}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            当前页只检查这台机器和通道是否可用；真正的执行会在聊天和讨论间里发生。
          </p>
        </div>
        <p data-testid="setup-exec-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          {permissionStatusLabel(execStatus)}
        </p>
        {!canExec ? <p className="text-sm leading-6 text-[var(--shock-pink)]">{execBoundary}</p> : null}
      </form>

      {runtimeError || execError ? (
        <div
          data-testid="setup-bridge-error"
          className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white"
        >
          {runtimeError || execError}
        </div>
      ) : null}

      {actionSuccess ? (
        <div
          data-testid="setup-bridge-success"
          className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 text-sm text-[var(--shock-ink)]"
        >
          {actionSuccess}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em]">执行元信息</p>
            <p className="mt-2 text-sm leading-6">{result.provider}</p>
            <p className="mt-2 text-sm leading-6">{result.duration}</p>
            <p className="mt-2 break-all font-mono text-[10px] leading-5">{result.command.join(" ")}</p>
          </div>
          <div
            data-testid="setup-bridge-output"
            className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 font-mono text-sm leading-6 text-[var(--shock-lime)]"
          >
            {result.output || "（没有输出）"}
          </div>
        </div>
      ) : null}
    </section>
  );
}
