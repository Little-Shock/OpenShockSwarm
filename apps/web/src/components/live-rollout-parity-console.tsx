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
  return "不可达";
}

function actualFirstScreenRoute(snapshot: LiveRolloutParitySnapshot | null) {
  return snapshot?.actual.experienceMetrics.collaborationShellValue?.trim()
    ? snapshot.actual.experienceMetrics.collaborationShellValue
    : snapshot?.actual.state.startRoute;
}

function driftKindLabel(kind: string) {
  switch ((kind ?? "").trim().toLowerCase()) {
    case "target":
      return "目标环境";
    case "health":
      return "健康检查";
    case "first_screen":
    case "first-screen":
      return "首屏";
    case "route_parity":
    case "route-parity":
      return "路由对齐";
    case "experience":
    case "experience_summary":
    case "experience-summary":
      return "体验摘要";
    default:
      return valueOrFallback(kind.replace(/[_-]+/g, " "), "漂移项");
  }
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
        throw new Error(payload.error || `实时发布对账失败：${response.status}`);
      }
      setSnapshot(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "实时发布对账失败");
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
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">实时发布对账</p>
          <h3 className="mt-2 font-display text-3xl font-bold">当前工作区与实时环境</h3>
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
        {snapshot?.summary ?? "等待当前工作区与实时环境的对比结果。"}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">目标实时环境</p>
          <p className="mt-2 font-display text-xl font-semibold">{valueOrFallback(snapshot?.targetBaseUrl, "待返回目标地址")}</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.actual.health.ok ? valueOrFallback(snapshot.actual.health.service, "openshock-server") : valueOrFallback(snapshot?.actual.health.error, "健康探测待返回")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前首屏</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchRoute(snapshot?.current.branch, snapshot?.current.startRoute, "待返回当前配置")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {valueOrFallback(snapshot?.current.firstScreenStatus, "未知")} · {valueOrFallback(snapshot?.current.homeRoute, "未返回首页路由")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">实时首屏</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchRoute(snapshot?.actual.state.branch, actualFirstScreenRoute(snapshot), "待返回实时配置")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            引导 {valueOrFallback(snapshot?.actual.state.onboardingStatus, "未知")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">路由对齐</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {endpointStatus(snapshot?.actual.liveService, "服务可用")} / {endpointStatus(snapshot?.actual.experienceMetrics, "指标可用")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {valueOrFallback(snapshot?.actual.liveService.branch, snapshot?.actual.state.repo ? snapshot.actual.state.repo : "等待路由信息")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_0.9fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">漂移摘要</p>
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
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{driftKindLabel(drift.kind)}</p>
                  <p className="mt-1">{drift.summary}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">当前实时环境和本地工作区没有发布对账漂移。</p>
          )}
        </div>

        <details className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
            展开体验比对
          </summary>
          <div className="mt-3 space-y-3 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">当前</p>
              <p className="mt-1">{valueOrFallback(snapshot?.current.experienceSummary, "未返回当前摘要")}</p>
            </div>
            <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">实时</p>
              <p className="mt-1">{valueOrFallback(snapshot?.actual.experienceMetrics.summary, "实时环境还没有体验指标摘要")}</p>
            </div>
          </div>
        </details>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          data-testid="setup-live-rollout-parity-refresh"
          type="button"
          onClick={() => void loadParity()}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "探测中..." : "重新探测实时环境"}
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
