"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

type LiveRolloutCurrentTruth = {
  repo?: string;
  branch?: string;
  startRoute: string;
  homeRoute: string;
  firstScreenStatus: string;
  firstScreenSummary: string;
  experienceSummary: string;
  liveServiceRoute: string;
  experienceMetricsRoute: string;
};

type LiveRolloutHealthTruth = {
  reachable: boolean;
  statusCode: number;
  ok: boolean;
  service?: string;
  error?: string;
};

type LiveRolloutStateTruth = {
  reachable: boolean;
  statusCode: number;
  repo?: string;
  branch?: string;
  startRoute?: string;
  onboardingStatus?: string;
  error?: string;
};

type LiveRolloutRouteTruth = {
  reachable: boolean;
  statusCode: number;
  available: boolean;
  managed?: boolean;
  status?: string;
  owner?: string;
  branch?: string;
  head?: string;
  summary?: string;
  collaborationShellStatus?: string;
  collaborationShellValue?: string;
  error?: string;
};

type LiveRolloutParitySnapshot = {
  status: string;
  summary: string;
  targetBaseUrl: string;
  current: LiveRolloutCurrentTruth;
  actual: {
    health: LiveRolloutHealthTruth;
    state: LiveRolloutStateTruth;
    liveService: LiveRolloutRouteTruth;
    experienceMetrics: LiveRolloutRouteTruth;
  };
  drifts: Array<{
    kind: string;
    severity: string;
    summary: string;
  }>;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrFallback(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function statusBadge(snapshot: LiveRolloutParitySnapshot | null) {
  switch (snapshot?.status) {
    case "aligned":
      return { label: "已对齐", tone: "bg-[var(--shock-lime)]" };
    case "drift":
      return { label: "存在漂移", tone: "bg-[var(--shock-pink)] text-white" };
    case "attention":
      return { label: "需留意", tone: "bg-[var(--shock-yellow)]" };
    default:
      return { label: "待探测", tone: "bg-[var(--shock-paper)]" };
  }
}

function formatBranchRoute(branch: string | undefined, route: string | undefined, fallback: string) {
  const branchText = branch?.trim() ?? "";
  const routeText = route?.trim() ?? "";
  if (!branchText && !routeText) {
    return fallback;
  }
  if (!branchText) {
    return routeText;
  }
  if (!routeText) {
    return branchText;
  }
  return `${branchText} · ${routeText}`;
}

function endpointStatus(truth: LiveRolloutRouteTruth | undefined, readyLabel: string) {
  if (!truth) {
    return "待探测";
  }
  if (truth.available) {
    return readyLabel;
  }
  if (truth.statusCode) {
    return `${truth.statusCode}`;
  }
  return "unreachable";
}

function actualFirstScreenRoute(snapshot: LiveRolloutParitySnapshot | null) {
  return snapshot?.actual.experienceMetrics.collaborationShellValue?.trim()
    ? snapshot.actual.experienceMetrics.collaborationShellValue
    : snapshot?.actual.state.startRoute;
}

export function LiveRolloutParityConsole() {
  const [snapshot, setSnapshot] = useState<LiveRolloutParitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadParity = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/v1/workspace/live-rollout-parity`, { cache: "no-store" });
      const payload = (await response.json()) as LiveRolloutParitySnapshot & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `live-rollout-parity failed: ${response.status}`);
      }
      setSnapshot(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "live-rollout-parity failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadParity();
    const poll = window.setInterval(() => {
      if (!cancelled) {
        void loadParity();
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [loadParity]);

  const badge = statusBadge(snapshot);

  return (
    <section data-testid="setup-live-rollout-parity" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">actual live parity</p>
          <h3 className="mt-2 font-display text-3xl font-bold">Current Workspace vs actual `:8080`</h3>
        </div>
        <span
          data-testid="setup-live-rollout-parity-status"
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            badge.tone
          )}
        >
          {badge.label}
        </span>
      </div>

      <p data-testid="setup-live-rollout-parity-summary" className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        {snapshot?.summary ?? "等待 current workspace 对比 actual live target 的 rollout parity truth。"}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Target actual live</p>
          <p className="mt-2 font-display text-xl font-semibold">{valueOrFallback(snapshot?.targetBaseUrl, "待返回 target")}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.actual.health.ok ? valueOrFallback(snapshot.actual.health.service, "openshock-server") : valueOrFallback(snapshot?.actual.health.error, "health probe pending")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Current first-screen</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchRoute(snapshot?.current.branch, snapshot?.current.startRoute, "待返回 current truth")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {valueOrFallback(snapshot?.current.firstScreenStatus, "unknown")} · {valueOrFallback(snapshot?.current.homeRoute, "未返回 home route")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Actual live first-screen</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchRoute(snapshot?.actual.state.branch, actualFirstScreenRoute(snapshot), "待返回 live truth")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            onboarding {valueOrFallback(snapshot?.actual.state.onboardingStatus, "unknown")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Route parity</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {endpointStatus(snapshot?.actual.liveService, "live-service ok")} / {endpointStatus(snapshot?.actual.experienceMetrics, "metrics ok")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {valueOrFallback(snapshot?.actual.liveService.branch, snapshot?.actual.state.repo ? snapshot.actual.state.repo : "等待 route truth")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_0.9fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Drift Summary</p>
          {snapshot?.drifts.length ? (
            <div className="mt-3 space-y-2">
              {snapshot.drifts.map((drift) => (
                <div
                  key={`${drift.kind}-${drift.summary}`}
                  className={cn(
                    "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-2.5 text-sm leading-6",
                    drift.severity === "drift" ? "bg-[var(--shock-pink)] text-white" : "bg-white"
                  )}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{drift.kind}</p>
                  <p className="mt-1">{drift.summary}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">当前 actual live 和 current workspace 没有 rollout parity drift。</p>
          )}
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Experience Snapshot</p>
          <div className="mt-3 space-y-3 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">current</p>
              <p className="mt-1">{valueOrFallback(snapshot?.current.experienceSummary, "未返回 current summary")}</p>
            </div>
            <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">actual live</p>
              <p className="mt-1">{valueOrFallback(snapshot?.actual.experienceMetrics.summary, "actual live 还没有 experience-metrics summary")}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          data-testid="setup-live-rollout-parity-refresh"
          type="button"
          onClick={() => void loadParity()}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "探测中..." : "重新探测 actual live"}
        </button>
      </div>

      {error ? (
        <div data-testid="setup-live-rollout-parity-error" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}
    </section>
  );
}
