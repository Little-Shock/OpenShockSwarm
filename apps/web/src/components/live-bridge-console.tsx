"use client";

import { useEffect, useState, type FormEvent } from "react";

import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveRuntimeTruth } from "@/lib/live-runtime";

type ExecResult = {
  provider: string;
  command: string[];
  output: string;
  error?: string;
  duration: string;
};

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";
const DEFAULT_WORKSPACE_ROOT = "/home/lark/OpenShock";

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
    case "degraded":
      return "配对降级";
    case "unpaired":
      return "未配对";
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
    return "未返回 cadence";
  }
  const intervalLabel = interval ? `${interval}s interval` : "interval 未返回";
  const timeoutLabel = timeout ? `${timeout}s timeout` : "timeout 未返回";
  return `${intervalLabel} / ${timeoutLabel}`;
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
  const [prompt, setPrompt] = useState("请用一句中文确认：OpenShock 的多 runtime bridge 已经在线。");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const registryRuntimes = state.runtimes.length > 0 ? state.runtimes : runtimes;
  const selectedMachine =
    selection?.runtimes.find((item) => item.name === selectedRuntimeName || item.id === selectedRuntimeName) ?? null;
  const selectedRuntimeStateRecord =
    registryRuntimes.find((item) => item.machine === selectedRuntimeName || item.id === selectedRuntimeName) ?? null;
  const selectedRuntimeTruth = selectedRuntimeRecord ?? selectedRuntimeStateRecord;
  const selectedHeartbeatCadence = formatHeartbeatCadence(
    selectedRuntimeTruth?.heartbeatIntervalSeconds,
    selectedRuntimeTruth?.heartbeatTimeoutSeconds
  );
  const bridgeStatus = runtime
    ? runtime.state
    : selectedRuntimeName
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
    const providers = runtime?.providers ?? [];
    const preferredProvider = providers.find((item) => item.id === "claude")?.id ?? providers[0]?.id;
    if (preferredProvider) {
      setProvider(preferredProvider);
    }
  }, [runtime]);

  async function handlePairRuntime() {
    setExecError(null);

    try {
      await pairRuntime(daemonUrl);
      setResult(null);
    } catch {
      // runtimeError already carries the failure contract for the surface
    }
  }

  async function handleUnpairRuntime() {
    setExecError(null);

    try {
      await unpairRuntime();
      setResult(null);
    } catch {
      // runtimeError already carries the failure contract for the surface
    }
  }

  async function handleSelectRuntime(machine: string) {
    setExecError(null);

    try {
      await selectRuntime(machine);
      setResult(null);
    } catch {
      // runtimeError already carries the failure contract for the surface
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setExecError(null);
    setResult(null);

    try {
      const response = await fetch(`${API_BASE}/v1/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          prompt,
          cwd: runtime?.workspaceRoot || selectedRuntimeRecord?.workspaceRoot || DEFAULT_WORKSPACE_ROOT,
        }),
      });

      const payload = (await response.json()) as ExecResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `exec failed: ${response.status}`);
      }

      setResult(payload);
    } catch (bridgeError) {
      setExecError(bridgeError instanceof Error ? bridgeError.message : "unknown bridge error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-pink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            实时 CLI 桥
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">直接对话 Runtime</h3>
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
        这条桥先打到 Go server，再按当前 runtime registry / heartbeat / selection 真值派发到对应 daemon。前台现在不再把 pairing 和
        selection 混成一套本地猜测，也不会在没有 selection 时偷偷拿第一台 runtime 顶上。
      </p>

      {runtime || selectedRuntimeTruth ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前 Selection</p>
            <p className="mt-2 font-display text-xl font-semibold">{selectedRuntimeName || "未选择"}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">最新心跳</p>
            <p className="mt-2 font-display text-xl font-semibold">
              {selectedMachine?.lastHeartbeat || selectedRuntimeRecord?.lastHeartbeatAt || "未返回"}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Provider</p>
            <p className="mt-2 font-display text-xl font-semibold">
              {(runtime?.providers ?? selectedRuntimeTruth?.providers ?? []).map((item) => item.label).join(" / ") || "等待配对"}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">工作区</p>
            <p className="mt-2 break-all font-mono text-xs leading-5">
              {runtime?.workspaceRoot || selectedRuntimeTruth?.workspaceRoot || "未返回"}
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
        主状态当前已收下 {state.runtimes.length} 条 runtime registry truth；当前 selection 的心跳节奏是 {selectedHeartbeatCadence}。
      </p>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              Runtime Registry
            </p>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
              {runtimes.length} visible{refreshing ? " · sync" : ""}
            </span>
          </div>

          {runtimeLoading && runtimes.length === 0 ? (
            <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              正在同步 runtime registry、heartbeat 与 selection 真值。
            </div>
          ) : registryRuntimes.length === 0 ? (
            <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              当前还没有已注册 runtime。先用右侧 Daemon URL 把一台机器配进来，再继续做 selection 和 bridge smoke。
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
                        {selected ? "selected" : statusLabel(item.state)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2 font-mono text-[10px] leading-5 text-[color:rgba(24,20,14,0.68)]">
                      <p>daemon: {item.daemonUrl || "未配对 daemon"}</p>
                      <p>pairing: {item.pairingState || "available"} / workspace {pairingStatusLabel(pairing?.pairingStatus || selection?.pairingStatus || "")}</p>
                      <p>heartbeat: {machine?.lastHeartbeat || item.lastHeartbeatAt || "未返回"}</p>
                      <p>cadence: {formatHeartbeatCadence(item.heartbeatIntervalSeconds, item.heartbeatTimeoutSeconds)}</p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={runtimeActionLoading || !actionable || selected}
                        onClick={() => void handleSelectRuntime(item.machine)}
                        className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {selected ? "当前所选" : actionable ? "切换到此 Runtime" : "不可选择"}
                      </button>
                      {selected ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                          当前 selection 决定 setup bridge 与默认 exec
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
            新 Runtime 配对
          </p>
          <label className="space-y-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              Daemon URL
            </span>
            <input
              value={daemonUrl}
              onChange={(event) => setDaemonURL(event.target.value)}
              className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-sm"
              placeholder="http://127.0.0.1:8090"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handlePairRuntime()}
              disabled={runtimeActionLoading}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runtimeActionLoading ? "处理中..." : "配对 Runtime"}
            </button>
            <button
              type="button"
              onClick={() => void handleUnpairRuntime()}
              disabled={runtimeActionLoading || pairing?.pairingStatus !== "paired"}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              撤销当前授权
            </button>
          </div>
          <div className="grid gap-3 pt-2">
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Selection</p>
              <p className="mt-2 font-display text-xl font-semibold">{selectedRuntimeName || "未选择"}</p>
            </div>
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">授权 / 配对</p>
              <p className="mt-2 text-sm leading-6">
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
              Provider
            </span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-sm"
            >
              {(runtime?.providers ?? []).map((item) => (
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
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 text-sm leading-6"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading || !runtime || !isSchedulableRuntime(runtime.state)}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "执行中..." : "发送提示词"}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            当前 selection 会决定 setup bridge 默认命中的 daemon；Room / Run 路由则按各自绑定的 runtime 派发。
          </p>
        </div>
      </form>

      {runtimeError || execError ? (
        <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {runtimeError || execError}
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
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 font-mono text-sm leading-6 text-[var(--shock-lime)]">
            {result.output || "（没有输出）"}
          </div>
        </div>
      ) : null}
    </section>
  );
}
