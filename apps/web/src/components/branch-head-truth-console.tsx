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
        throw new Error(payload.error || `branch-head-truth failed: ${response.status}`);
      }
      setSnapshot(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "branch-head-truth failed");
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
          <h3 className="mt-2 font-display text-3xl font-bold">Repo / GitHub / Runtime Branch-Head-Worktree</h3>
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
        {snapshot?.summary ?? "等待统一 route 返回 repo binding、GitHub probe、current checkout、live service 与 worktree truth。"}
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Repo Binding</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.repoBinding.branch, undefined, "等待绑定分支")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {valueOrFallback(snapshot?.repoBinding.bindingStatus, "未返回 binding status")} · {valueOrFallback(snapshot?.repoBinding.authMode, "未返回 auth mode")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">GitHub Probe</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.githubConnection.branch, undefined, "等待 GitHub branch")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.githubConnection.ready ? "ready" : "not ready"} · {valueOrFallback(snapshot?.githubConnection.authMode, "未返回 auth mode")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Current Checkout</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.checkout.branch, snapshot?.checkout.head, "等待 checkout truth")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.checkout.dirty ? `dirty (${snapshot.checkout.dirtyEntries})` : "clean"} · {valueOrFallback(snapshot?.checkout.worktreePath, "未返回 worktree")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Live Service</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {formatBranchHead(snapshot?.liveService.branch, snapshot?.liveService.head, snapshot?.liveService.managed ? "待返回 live head" : "unmanaged")}
          </p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            {snapshot?.liveService.managed ? valueOrFallback(snapshot?.liveService.owner, "unknown owner") : valueOrFallback(snapshot?.liveService.status, "unmanaged")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_0.85fr]">
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
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
              当前没有 branch/head/worktree 漂移信号。
            </p>
          )}
          {snapshot?.githubProbeError ? (
            <p className="mt-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-2.5 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.78)]">
              GitHub probe error: {snapshot.githubProbeError}
            </p>
          ) : null}
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Mainline Refs</p>
          <div className="mt-3 space-y-2">
            <RefPill label="dev" value={valueOrFallback(devRef?.head, "absent")} />
            <RefPill label="origin/dev" value={valueOrFallback(originDevRef?.head, "absent")} />
            <RefPill label="main" value={valueOrFallback(mainRef?.head, "absent")} />
            <RefPill label="origin/main" value={valueOrFallback(originMainRef?.head, "absent")} />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_0.9fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Linked Worktrees</p>
          {snapshot?.worktrees.length ? (
            <div className="mt-3 space-y-2">
              {snapshot.worktrees.map((worktree) => (
                <div
                  key={worktree.path}
                  className={cn(
                    "rounded-[16px] border-2 border-[var(--shock-ink)] px-3 py-2.5",
                    worktree.current ? "bg-[var(--shock-lime)]" : "bg-white"
                  )}
                >
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em]">
                    {worktree.current ? "current worktree" : "linked worktree"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                    {formatBranchHead(worktree.branch, worktree.head, "当前 worktree branch/head 正在整理中。")}
                  </p>
                  <p className="mt-1 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">{worktree.path}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">当前没有可见的 linked worktree truth。</p>
          )}
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Live Control</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            {valueOrFallback(snapshot?.liveService.message, "等待 live service truth。")}
          </p>
          <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
            {valueOrFallback(snapshot?.liveService.workspaceRoot, "未返回 live workspace root")}
          </p>
          <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
            {valueOrFallback(snapshot?.liveService.metadataPath, "未返回 metadata path")}
          </p>
          <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
            {valueOrFallback(snapshot?.liveService.reloadCommand, "未返回 reload command")}
          </p>
        </div>
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
