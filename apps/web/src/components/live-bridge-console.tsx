"use client";

import { useEffect, useState } from "react";

type RuntimeSnapshot = {
  machine: string;
  detectedCli: string[];
  providers: Array<{
    id: string;
    label: string;
    mode: string;
    capabilities: string[];
    transport: string;
  }> | null;
  state: string;
  workspaceRoot: string;
  reportedAt: string;
};

type ExecResult = {
  provider: string;
  command: string[];
  output: string;
  error?: string;
  duration: string;
};

type PairingStatus = {
  daemonUrl: string;
  pairedRuntime: string;
  pairingStatus: string;
  deviceAuth: string;
  lastPairedAt: string;
};

type RuntimeRecord = {
  id: string;
  name: string;
  state: string;
  daemonUrl: string;
  cli: string;
  os: string;
  lastHeartbeat: string;
};

type RuntimeSelection = {
  selectedRuntime: string;
  selectedDaemonUrl: string;
  pairingStatus: string;
  runtimes: RuntimeRecord[];
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
    case "offline":
      return "离线";
    default:
      return state || "未知";
  }
}

export function LiveBridgeConsole() {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [selection, setSelection] = useState<RuntimeSelection | null>(null);
  const [daemonUrl, setDaemonURL] = useState("http://127.0.0.1:8090");
  const [provider, setProvider] = useState("codex");
  const [prompt, setPrompt] = useState("请用一句中文确认：OpenShock 的多 runtime bridge 已经在线。");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runtimeActionLoading, setRuntimeActionLoading] = useState(false);

  async function refresh(machineOverride?: string) {
    const [pairingResponse, selectionResponse] = await Promise.all([
      fetch(`${API_BASE}/v1/runtime/pairing`, { cache: "no-store" }),
      fetch(`${API_BASE}/v1/runtime/selection`, { cache: "no-store" }),
    ]);

    if (!pairingResponse.ok) {
      throw new Error(`pairing request failed: ${pairingResponse.status}`);
    }
    if (!selectionResponse.ok) {
      throw new Error(`runtime selection request failed: ${selectionResponse.status}`);
    }

    const pairingData = (await pairingResponse.json()) as PairingStatus;
    const selectionData = (await selectionResponse.json()) as RuntimeSelection;
    setPairing(pairingData);
    setSelection(selectionData);

    if (pairingData.daemonUrl) {
      setDaemonURL(pairingData.daemonUrl);
    } else if (selectionData.selectedDaemonUrl) {
      setDaemonURL(selectionData.selectedDaemonUrl);
    }

    const targetMachine =
      machineOverride || selectionData.selectedRuntime || pairingData.pairedRuntime || selectionData.runtimes[0]?.name;
    if (!targetMachine) {
      setRuntime(null);
      return;
    }

    const runtimeResponse = await fetch(`${API_BASE}/v1/runtime?machine=${encodeURIComponent(targetMachine)}`, {
      cache: "no-store",
    });
    if (!runtimeResponse.ok) {
      throw new Error(`runtime request failed: ${runtimeResponse.status}`);
    }

    const runtimeData = (await runtimeResponse.json()) as RuntimeSnapshot;
    setRuntime(runtimeData);
    const providers = runtimeData.providers ?? [];
    const preferredProvider = providers.find((item) => item.id === "claude")?.id ?? providers[0]?.id;
    if (preferredProvider) {
      setProvider(preferredProvider);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void refresh().catch((refreshError) => {
      if (cancelled) return;
      setError(refreshError instanceof Error ? refreshError.message : "runtime fetch failed");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePairRuntime() {
    setRuntimeActionLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/runtime/pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daemonUrl }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `pairing failed: ${response.status}`);
      }
      await refresh();
      setResult(null);
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : "runtime pairing failed");
    } finally {
      setRuntimeActionLoading(false);
    }
  }

  async function handleUnpairRuntime() {
    setRuntimeActionLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/runtime/pairing`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `unpair failed: ${response.status}`);
      }
      await refresh();
      setResult(null);
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : "runtime unpair failed");
    } finally {
      setRuntimeActionLoading(false);
    }
  }

  async function handleSelectRuntime(machine: string) {
    setRuntimeActionLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/runtime/selection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machine }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `runtime selection failed: ${response.status}`);
      }
      await refresh(machine);
      setResult(null);
    } catch (selectionError) {
      setError(selectionError instanceof Error ? selectionError.message : "runtime selection failed");
    } finally {
      setRuntimeActionLoading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`${API_BASE}/v1/exec`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          prompt,
          cwd: runtime?.workspaceRoot || DEFAULT_WORKSPACE_ROOT,
        }),
      });

      const payload = (await response.json()) as ExecResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `exec failed: ${response.status}`);
      }

      setResult(payload);
    } catch (execError) {
      setError(execError instanceof Error ? execError.message : "unknown bridge error");
    } finally {
      setLoading(false);
    }
  }

  const runtimes = selection?.runtimes ?? [];

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
            runtime?.state === "online" ? "bg-[var(--shock-lime)]" : "bg-[var(--shock-pink)] text-white"
          )}
        >
          {statusLabel(runtime?.state ?? "offline")}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        这条桥先打到 Go server，再按当前 selection 或 run 绑定派发到对应 daemon。前台现在会显式展示所有已注册 runtime，不再假设只有一台机器。
      </p>

      {runtime ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前机器</p>
            <p className="mt-2 font-display text-xl font-semibold">{runtime.machine}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">已发现 CLI</p>
            <p className="mt-2 font-display text-xl font-semibold">{runtime.detectedCli.join(", ") || "未探测"}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Provider</p>
            <p className="mt-2 font-display text-xl font-semibold">
              {(runtime.providers ?? []).map((item) => item.label).join(" / ") || "等待配对"}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">工作区</p>
            <p className="mt-2 break-all font-mono text-xs leading-5">{runtime.workspaceRoot || "未返回"}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
              已注册 Runtimes
            </p>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
              {runtimes.length} visible
            </span>
          </div>

          {runtimes.length === 0 ? (
            <div className="rounded-[18px] border-2 border-dashed border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
              当前还没有已注册 runtime。先用右侧 Daemon URL 把一台机器配进来，再继续做 selection 和 bridge smoke。
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {runtimes.map((item) => {
                const selected = item.name === selection?.selectedRuntime;
                const actionable = item.state !== "offline" && Boolean(item.daemonUrl);

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
                        <p className="font-display text-2xl font-bold">{item.name}</p>
                        <p className="mt-1 text-sm text-[color:rgba(24,20,14,0.72)]">{item.cli || "未返回 CLI 标签"}</p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full border-2 border-[var(--shock-ink)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                          item.state === "online"
                            ? "bg-[var(--shock-lime)]"
                            : item.state === "busy"
                              ? "bg-white"
                              : "bg-[var(--shock-pink)] text-white"
                        )}
                      >
                        {statusLabel(item.state)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2 font-mono text-[10px] leading-5 text-[color:rgba(24,20,14,0.68)]">
                      <p>daemon: {item.daemonUrl || "未配对 daemon"}</p>
                      <p>os: {item.os || "未返回"}</p>
                      <p>heartbeat: {item.lastHeartbeat || "未返回"}</p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled={runtimeActionLoading || !actionable || selected}
                        onClick={() => void handleSelectRuntime(item.name)}
                        className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {selected ? "当前所选" : actionable ? "切换到此 Runtime" : "不可选择"}
                      </button>
                      {selected ? (
                        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                          用于 setup bridge 与默认 exec
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
              onClick={handlePairRuntime}
              disabled={runtimeActionLoading}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {runtimeActionLoading ? "处理中..." : "配对 Runtime"}
            </button>
            <button
              type="button"
              onClick={handleUnpairRuntime}
              disabled={runtimeActionLoading || pairing?.pairingStatus !== "paired"}
              className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              撤销当前授权
            </button>
          </div>
          <div className="grid gap-3 pt-2">
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Selection</p>
              <p className="mt-2 font-display text-xl font-semibold">{selection?.selectedRuntime || "未选择"}</p>
            </div>
            <div className="rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">授权 / 配对</p>
              <p className="mt-2 text-sm leading-6">
                {pairing?.deviceAuth || "未授权"} / {pairing?.pairingStatus || selection?.pairingStatus || "未同步"}
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
            disabled={loading || !runtime || runtime.state === "offline"}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "执行中..." : "发送提示词"}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            当前 selection 会决定 setup bridge 默认命中的 daemon；Room / Run 路由则按各自绑定的 runtime 派发。
          </p>
        </div>
      </form>

      {error ? (
        <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em]">执行元信息</p>
            <p className="mt-2 text-sm leading-6">{result.provider}</p>
            <p className="mt-2 text-sm leading-6">{result.duration}</p>
            <p className="mt-2 font-mono text-[10px] leading-5 break-all">{result.command.join(" ")}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-3 font-mono text-sm leading-6 text-[var(--shock-lime)]">
            {result.output || "（没有输出）"}
          </div>
        </div>
      ) : null}
    </section>
  );
}
