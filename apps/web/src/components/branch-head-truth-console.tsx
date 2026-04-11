"use client";

import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

type RepoBindingSnapshot = {
  repo: string;
  repoUrl: string;
  branch: string;
  provider: string;
  bindingStatus: string;
  authMode: string;
  preferredAuthMode?: string;
};

type GitHubConnectionSnapshot = {
  repo: string;
  repoUrl: string;
  branch: string;
  provider: string;
  ready: boolean;
  authMode: string;
  preferredAuthMode?: string;
  message: string;
};

type CheckoutTruth = {
  workspaceRoot: string;
  worktreePath: string;
  repo?: string;
  repoUrl?: string;
  provider?: string;
  branch?: string;
  head?: string;
  dirty: boolean;
  dirtyEntries: number;
  status: string;
  message?: string;
};

type RefTruth = {
  name: string;
  head?: string;
  present: boolean;
};

type WorktreeTruth = {
  path: string;
  branch?: string;
  head?: string;
  current: boolean;
};

type LiveServiceTruth = {
  managed: boolean;
  status: string;
  owner?: string;
  workspaceRoot?: string;
  branch?: string;
  head?: string;
  baseUrl?: string;
  metadataPath: string;
  reloadCommand?: string;
  statusCommand?: string;
  message: string;
};

type DriftTruth = {
  kind: string;
  severity: string;
  summary: string;
};

type BranchHeadTruthSnapshot = {
  status: string;
  summary: string;
  repoBinding: RepoBindingSnapshot;
  githubConnection: GitHubConnectionSnapshot;
  githubProbeError?: string;
  checkout: CheckoutTruth;
  refs: RefTruth[];
  worktrees: WorktreeTruth[];
  liveService: LiveServiceTruth;
  drifts: DriftTruth[];
  linkedWorktreeCount: number;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function normalizeBranchHeadTruthSnapshot(
  payload: Partial<BranchHeadTruthSnapshot> & { error?: string }
): BranchHeadTruthSnapshot {
  return {
    status: payload.status ?? "",
    summary: payload.summary ?? "",
    repoBinding: payload.repoBinding ?? {
      repo: "",
      repoUrl: "",
      branch: "",
      provider: "",
      bindingStatus: "",
      authMode: "",
    },
    githubConnection: payload.githubConnection ?? {
      repo: "",
      repoUrl: "",
      branch: "",
      provider: "",
      ready: false,
      authMode: "",
      message: "",
    },
    githubProbeError: payload.githubProbeError,
    checkout: payload.checkout ?? {
      workspaceRoot: "",
      worktreePath: "",
      branch: "",
      head: "",
      dirty: false,
      dirtyEntries: 0,
      status: "",
    },
    refs: Array.isArray(payload.refs) ? payload.refs : [],
    worktrees: Array.isArray(payload.worktrees) ? payload.worktrees : [],
    liveService: payload.liveService ?? {
      managed: false,
      status: "",
      metadataPath: "",
      message: "",
    },
    drifts: Array.isArray(payload.drifts) ? payload.drifts : [],
    linkedWorktreeCount: payload.linkedWorktreeCount ?? 0,
  };
}

function valueOrFallback(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function formatBranchHead(branch: string | undefined, head: string | undefined, fallback: string) {
  const branchText = valueOrFallback(branch, "");
  const headText = valueOrFallback(head, "");
  if (!branchText && !headText) {
    return fallback;
  }
  if (!headText) {
    return branchText;
  }
  if (!branchText) {
    return headText;
  }
  return `${branchText} @ ${headText}`;
}

function statusBadge(snapshot: BranchHeadTruthSnapshot | null) {
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

function findRef(snapshot: BranchHeadTruthSnapshot | null, name: string) {
  return snapshot?.refs.find((item) => item.name === name) ?? null;
}

function authModeLabel(value: string | undefined) {
  switch ((value ?? "").trim().toLowerCase()) {
    case "github-app":
      return "GitHub 应用";
    case "gh-cli":
      return "GitHub 命令行";
    case "local":
    case "local-only":
      return "仅本地";
    case "ssh":
      return "SSH";
    case "https":
      return "HTTPS";
    case "token":
      return "访问令牌";
    case "signed_out":
      return "未登录";
    default:
      return valueOrFallback(value, "待同步");
  }
}

function bindingStatusLabel(value: string | undefined) {
  switch ((value ?? "").trim().toLowerCase()) {
    case "bound":
      return "已绑定";
    case "blocked":
      return "已阻塞";
    case "pending":
      return "处理中";
    default:
      return valueOrFallback(value, "待同步");
  }
}

function driftKindLabel(kind: string) {
  switch ((kind ?? "").trim().toLowerCase()) {
    case "repo_binding":
    case "repo-binding":
      return "仓库绑定";
    case "github_connection":
    case "github-connection":
      return "GitHub 连接";
    case "checkout":
      return "当前检出";
    case "live_service":
    case "live-service":
      return "实时服务";
    case "worktree":
      return "工作区";
    case "ref":
      return "引用";
    default:
      return valueOrFallback(kind.replace(/[_-]+/g, " "), "漂移项");
  }
}

function RefPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{label}</p>
      <p className="mt-2 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.82)]">{value}</p>
    </div>
  );
}

export function BranchHeadTruthConsole() {
  const [snapshot, setSnapshot] = useState<BranchHeadTruthSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTruth = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/v1/workspace/branch-head-truth`, { cache: "no-store" });
      const payload = (await response.json()) as BranchHeadTruthSnapshot & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `统一真值探测失败：${response.status}`);
      }
      setSnapshot(normalizeBranchHeadTruthSnapshot(payload));
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "统一真值探测失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTruth();
    const poll = window.setInterval(() => {
      if (!cancelled) {
        void loadTruth();
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [loadTruth]);

  const badge = statusBadge(snapshot);
  const devRef = findRef(snapshot, "dev");
  const originDevRef = findRef(snapshot, "origin/dev");
  const mainRef = findRef(snapshot, "main");
  const originMainRef = findRef(snapshot, "origin/main");

  return (
    <section data-testid="setup-branch-head-truth" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-pink)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">统一真值</p>
          <h3 className="mt-2 font-display text-3xl font-bold">仓库 / GitHub / 运行环境 分支与工作区真值</h3>
        </div>
        <span
          data-testid="setup-branch-head-truth-status"
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            badge.tone
          )}
        >
          {badge.label}
        </span>
      </div>

      <p data-testid="setup-branch-head-truth-summary" className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        {snapshot?.summary ?? "等待统一路由返回仓库绑定、GitHub 探测、当前检出、实时服务与工作区真值。"}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">仓库绑定</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.repoBinding.branch, undefined, "等待绑定分支")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {bindingStatusLabel(snapshot?.repoBinding.bindingStatus)} · {authModeLabel(snapshot?.repoBinding.authMode)}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">GitHub 探测</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.githubConnection.branch, undefined, "等待 GitHub 分支")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.githubConnection.ready ? "已就绪" : "未就绪"} · {authModeLabel(snapshot?.githubConnection.authMode)}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前检出</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.checkout.branch, snapshot?.checkout.head, "等待检出真值")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.checkout.dirty ? `未清理 (${snapshot.checkout.dirtyEntries})` : "干净"} · {valueOrFallback(snapshot?.checkout.worktreePath, "未返回工作区")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">实时服务</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.liveService.branch, snapshot?.liveService.head, snapshot?.liveService.managed ? "待返回实时头指针" : "未托管")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.liveService.managed ? valueOrFallback(snapshot?.liveService.owner, "未知负责人") : valueOrFallback(snapshot?.liveService.status, "未托管")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
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
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
              当前没有分支、头指针或工作区漂移信号。
            </p>
          )}
          {snapshot?.githubProbeError ? (
            <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.78)]">
              GitHub 探测错误：{snapshot.githubProbeError}
            </p>
          ) : null}
        </div>

        <details className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">
            展开主线与工作区细节
          </summary>
          <div className="mt-3 space-y-3">
            <div className="space-y-2">
              <RefPill label="dev" value={valueOrFallback(devRef?.head, "未找到")} />
              <RefPill label="origin/dev" value={valueOrFallback(originDevRef?.head, "未找到")} />
              <RefPill label="main" value={valueOrFallback(mainRef?.head, "未找到")} />
              <RefPill label="origin/main" value={valueOrFallback(originMainRef?.head, "未找到")} />
            </div>
            <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">关联工作区</p>
              {snapshot?.worktrees.length ? (
                <div className="mt-3 space-y-2">
                  {snapshot.worktrees.map((worktree) => (
                    <div
                      key={worktree.path}
                      className={cn(
                        "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-2.5",
                        worktree.current ? "bg-[var(--shock-lime)]" : "bg-[var(--shock-paper)]"
                      )}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em]">{worktree.current ? "当前工作区" : "关联工作区"}</p>
                      <p className="mt-2 text-sm leading-6">{formatBranchHead(worktree.branch, worktree.head, "当前工作区分支和头指针正在整理中。")}</p>
                      <p className="mt-1 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">{worktree.path}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">当前没有可见的关联工作区真值。</p>
              )}
            </div>
            <div className="rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">实时控制</p>
              <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">{valueOrFallback(snapshot?.liveService.message, "等待实时服务真值。")}</p>
              <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
                {valueOrFallback(snapshot?.liveService.workspaceRoot, "未返回实时工作目录")}
              </p>
              <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
                {valueOrFallback(snapshot?.liveService.metadataPath, "未返回元数据文件")}
              </p>
              <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
                {valueOrFallback(snapshot?.liveService.reloadCommand, "未返回重载命令")}
              </p>
            </div>
          </div>
        </details>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          data-testid="setup-branch-head-truth-refresh"
          type="button"
          onClick={() => void loadTruth()}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "探测中..." : "重新探测统一真值"}
        </button>
      </div>

      {error ? (
        <div data-testid="setup-branch-head-truth-error" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}
    </section>
  );
}
