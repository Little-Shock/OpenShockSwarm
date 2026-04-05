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
  }>;
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

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function LiveBridgeConsole() {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [daemonUrl, setDaemonURL] = useState("http://127.0.0.1:8090");
  const [provider, setProvider] = useState("codex");
  const [prompt, setPrompt] = useState("请用一句中文确认：OpenShock Phase 0 的本地 runtime bridge 已经在线。");
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch(`${API_BASE}/v1/runtime/pairing`).then(async (response) => {
        if (!response.ok) throw new Error(`pairing request failed: ${response.status}`);
        return response.json() as Promise<PairingStatus>;
      }),
      fetch(`${API_BASE}/v1/runtime`).then(async (response) => {
        if (!response.ok) throw new Error(`runtime request failed: ${response.status}`);
        return response.json() as Promise<RuntimeSnapshot>;
      }),
    ])
      .then(([pairingData, runtimeData]) => {
        if (cancelled) return;
        setPairing(pairingData);
        if (pairingData.daemonUrl) setDaemonURL(pairingData.daemonUrl);
        setRuntime(runtimeData);
        const preferredProvider =
          runtimeData.providers.find((item) => item.id === "claude")?.id ?? runtimeData.providers[0]?.id;
        if (preferredProvider) {
          setProvider(preferredProvider);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePairRuntime() {
    setPairingLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/runtime/pairing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daemonUrl }),
      });
      const payload = (await response.json()) as {
        error?: string;
        daemonUrl?: string;
        runtime?: RuntimeSnapshot;
      };
      if (!response.ok) {
        throw new Error(payload.error || `pairing failed: ${response.status}`);
      }
      if (payload.runtime) {
        setRuntime(payload.runtime);
        const preferredProvider =
          payload.runtime.providers.find((item) => item.id === "claude")?.id ?? payload.runtime.providers[0]?.id;
        if (preferredProvider) {
          setProvider(preferredProvider);
        }
      }
      const pairingResponse = await fetch(`${API_BASE}/v1/runtime/pairing`);
      if (pairingResponse.ok) {
        setPairing((await pairingResponse.json()) as PairingStatus);
      }
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "runtime pairing failed");
    } finally {
      setPairingLoading(false);
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
          cwd: "E:\\00.Lark_Projects\\00_OpenShock",
        }),
      });

      const payload = (await response.json()) as ExecResult & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `exec failed: ${response.status}`);
      }

      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown bridge error");
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
            runtime?.state === "online" ? "bg-[var(--shock-lime)]" : "bg-[var(--shock-pink)] text-white"
          )}
        >
          {runtime?.state === "online" ? "在线" : runtime?.state === "busy" ? "忙碌" : "离线"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        这条桥会先打到 Go server，再转给本地 daemon，最后由它去调用 `codex exec` 或 `claude --bare -p`。
      </p>

      {runtime ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">机器</p>
            <p className="mt-2 font-display text-xl font-semibold">{runtime.machine}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">已发现 CLI</p>
            <p className="mt-2 font-display text-xl font-semibold">{runtime.detectedCli.join(", ")}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">传输方式</p>
            <p className="mt-2 font-display text-xl font-semibold">
              {runtime.providers.map((item) => item.transport).join(" / ")}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
        <label className="space-y-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">
            Daemon URL
          </span>
          <input
            value={daemonUrl}
            onChange={(event) => setDaemonURL(event.target.value)}
            className="w-full rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 font-mono text-sm"
            placeholder="http://127.0.0.1:8090"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handlePairRuntime}
            disabled={pairingLoading}
            className="w-full rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pairingLoading ? "配对中..." : "配对 Runtime"}
          </button>
        </div>
      </div>

      {pairing ? (
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">配对状态</p>
            <p className="mt-2 font-display text-xl font-semibold">{pairing.pairingStatus}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">设备授权</p>
            <p className="mt-2 font-display text-xl font-semibold">{pairing.deviceAuth}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前 Runtime</p>
            <p className="mt-2 font-display text-xl font-semibold">{pairing.pairedRuntime}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">最近配对</p>
            <p className="mt-2 font-display text-xl font-semibold">{pairing.lastPairedAt}</p>
          </div>
        </div>
      ) : null}

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
            disabled={loading || !runtime}
            className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "执行中..." : "发送提示词"}
          </button>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            两个 provider 都走同一条本地 HTTP 桥。Codex 走直连 CLI，Claude 走 bare mode。
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
