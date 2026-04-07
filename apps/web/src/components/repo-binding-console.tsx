"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { usePhaseZeroState } from "@/lib/live-phase0";
import { hasSessionPermission, permissionBoundaryCopy, permissionStatus } from "@/lib/session-authz";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

type RepoBindingSnapshot = {
  repo: string;
  repoUrl: string;
  branch: string;
  provider: string;
  bindingStatus: string;
  authMode: string;
  detectedAt?: string;
  connectionReady: boolean;
  appConfigured: boolean;
  appInstalled: boolean;
  installationId?: string;
  installationUrl?: string;
  missing?: string[];
  connectionMessage: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrFallback(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function bindingBadge(snapshot: RepoBindingSnapshot | null) {
  if (!snapshot) return { label: "待绑定", tone: "bg-[var(--shock-paper)]" };
  if (snapshot.bindingStatus === "bound") return { label: "已绑定", tone: "bg-[var(--shock-lime)]" };
  if (snapshot.bindingStatus === "blocked") return { label: "待补安装", tone: "bg-[var(--shock-pink)] text-white" };
  return { label: "待绑定", tone: "bg-[var(--shock-paper)]" };
}

function githubAppLabel(snapshot: RepoBindingSnapshot | null) {
  if (!snapshot) return "等待扫描";
  if (snapshot.appInstalled) return "已安装";
  if (snapshot.appConfigured) return "待安装";
  return "未配置";
}

export function RepoBindingConsole() {
  const { state } = usePhaseZeroState();
  const stateBinding = useMemo<RepoBindingSnapshot | null>(() => {
    if (!state.workspace.repo && !state.workspace.branch && !state.workspace.repoBindingStatus) {
      return null;
    }
    return {
      repo: state.workspace.repo,
      repoUrl: state.workspace.repoUrl,
      branch: state.workspace.branch,
      provider: state.workspace.repoProvider,
      bindingStatus: state.workspace.repoBindingStatus,
      authMode: state.workspace.repoAuthMode,
      detectedAt: "",
      connectionReady: state.workspace.repoBindingStatus === "bound",
      appConfigured: false,
      appInstalled: false,
      installationId: "",
      installationUrl: "",
      connectionMessage: state.workspace.repo
        ? `当前工作区已读取到仓库真值：${state.workspace.repo}`
        : "等待工作区返回仓库真值。",
    };
  }, [state.workspace]);
  const [binding, setBinding] = useState<RepoBindingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canBindRepo = hasSessionPermission(state.auth.session, "repo.admin");
  const bindStatus = permissionStatus(state.auth.session, "repo.admin");
  const bindBoundary = permissionBoundaryCopy(state.auth.session, "repo.admin");

  const loadBinding = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/repo/binding`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || `repo binding request failed: ${response.status}`);
      }
      const payload = (await response.json()) as RepoBindingSnapshot;
      setBinding(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "repo binding request failed");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void loadBinding();
    const poll = window.setInterval(() => {
      if (!cancelled) {
        void loadBinding();
      }
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [loadBinding]);

  useEffect(() => {
    if (!binding && stateBinding) {
      setBinding(stateBinding);
    }
  }, [binding, stateBinding]);

  async function handleBindRepo() {
    if (!canBindRepo) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/v1/repo/binding`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        error?: string;
        binding?: RepoBindingSnapshot;
      };
      if (payload.binding) {
        setBinding(payload.binding);
      }
      if (!response.ok) {
        throw new Error(payload.error || `repo binding failed: ${response.status}`);
      }
      if (payload.binding) {
        setSuccess(`已同步当前仓库：${valueOrFallback(payload.binding.repo, "未知仓库")} @ ${valueOrFallback(payload.binding.branch, "未知分支")}`);
      } else {
        setSuccess("当前仓库状态已重新同步。");
      }
    } catch (bindError) {
      setError(bindError instanceof Error ? bindError.message : "repo binding failed");
    } finally {
      setLoading(false);
    }
  }

  const badge = bindingBadge(binding);

  return (
    <section data-testid="setup-repo-binding" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-lime)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            仓库绑定
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">扫描并绑定当前 Repo</h3>
        </div>
        <span
          data-testid="setup-repo-binding-status"
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            badge.tone
          )}
        >
          {badge.label}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        这里不再把 repo binding 读成固定的 `local-git-origin` 步骤卡，而是直接吃当前 effective auth path、install state 和 blocked contract。
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">仓库</p>
          <p className="mt-2 font-display text-xl font-semibold break-all">
            <span data-testid="setup-repo-binding-repo">{valueOrFallback(binding?.repo, "等待扫描")}</span>
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">分支</p>
          <p data-testid="setup-repo-binding-branch" className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(binding?.branch, "等待扫描")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Provider</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(binding?.provider, "未知")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">绑定模式</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(binding?.authMode, "待扫描")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">连接就绪</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {binding ? (binding.connectionReady ? "已就绪" : "待补全") : "等待扫描"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">GitHub App</p>
          <p className="mt-2 font-display text-xl font-semibold">{githubAppLabel(binding)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">installation</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(binding?.installationId, binding?.installationUrl ? "待完成安装" : "未生成")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Origin URL</p>
          <p className="mt-2 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.78)]">
            {valueOrFallback(binding?.repoUrl, "等待扫描当前仓库 origin")}
          </p>
          <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前判断</p>
          <p data-testid="setup-repo-binding-message" className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">
            {valueOrFallback(binding?.connectionMessage, "等待 repo binding contract 返回当前 GitHub 连接判断。")}
          </p>
          {binding?.missing?.length ? (
            <p
              data-testid="setup-repo-binding-missing-fields"
              className="mt-3 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.72)]"
            >
              缺失字段: {binding.missing.join(" / ")}
            </p>
          ) : null}
          {binding?.detectedAt ? (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
              detected at {binding.detectedAt}
            </p>
          ) : null}
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">安装动作</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            {binding?.appInstalled
              ? "GitHub App install 已闭环；repo binding 可以直接暴露 app-backed 真值。"
              : binding?.appConfigured
                ? "GitHub App 已配置但安装未完成；blocked contract 会停在这里，而不是继续沿旧口径假装可用。"
                : "当前还没有完整 GitHub App 配置；先补配置，再重新同步 binding。"}
          </p>
          {binding?.installationUrl ? (
            <a
              data-testid="setup-repo-binding-install-link"
              href={binding.installationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
            >
              打开 installation 页面
            </a>
          ) : null}
          <p
            data-testid="setup-repo-binding-return-steps"
            className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]"
          >
            完成安装或补齐配置后，回到 Setup，先点“重新探测 GitHub”，再点“同步 Repo Binding”。
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            当前按钮会重新同步 repo binding 与 GitHub 安装态；如果 server 返回 blocked contract，这里直接展示，不再退回旧文案。
          </p>
          <p data-testid="setup-repo-binding-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            {bindStatus}
          </p>
          {!canBindRepo ? <p className="text-sm leading-6 text-[var(--shock-pink)]">{bindBoundary}</p> : null}
        </div>
        <button
          data-testid="setup-repo-bind-button"
          type="button"
          onClick={handleBindRepo}
          disabled={loading || !canBindRepo}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "同步中..." : "同步 Repo Binding"}
        </button>
      </div>

      {error ? (
        <div data-testid="setup-repo-binding-error" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}

      {success ? (
        <div data-testid="setup-repo-binding-success" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 text-sm text-[var(--shock-ink)]">
          {success}
        </div>
      ) : null}
    </section>
  );
}
