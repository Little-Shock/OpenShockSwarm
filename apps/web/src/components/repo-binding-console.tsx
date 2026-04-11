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
  if (!snapshot) return "等待检查";
  if (snapshot.appInstalled) return "已安装";
  if (snapshot.appConfigured) return "待安装";
  return "未配置";
}

function providerLabel(value: string | undefined) {
  switch ((value ?? "").trim().toLowerCase()) {
    case "github":
      return "GitHub";
    case "gitlab":
      return "GitLab";
    case "bitbucket":
      return "Bitbucket";
    default:
      return valueOrFallback(value, "未知");
  }
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
      return valueOrFallback(value, "待扫描");
  }
}

function permissionStatusLabel(status: ReturnType<typeof permissionStatus>) {
  switch (status) {
    case "allowed":
      return "可同步";
    case "blocked":
      return "无权限";
    case "signed_out":
      return "未登录";
    default:
      return "待确认";
  }
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
        ? `当前工作区已识别仓库：${state.workspace.repo}`
        : "正在检查当前仓库。",
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
        throw new Error(payload.error || `仓库绑定请求失败：${response.status}`);
      }
      const payload = (await response.json()) as RepoBindingSnapshot;
      setBinding(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "仓库绑定请求失败");
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
        throw new Error(payload.error || `仓库绑定失败：${response.status}`);
      }
      if (payload.binding) {
        setSuccess(`已同步当前仓库：${valueOrFallback(payload.binding.repo, "未知仓库")} @ ${valueOrFallback(payload.binding.branch, "未知分支")}`);
      } else {
        setSuccess("当前仓库状态已重新同步。");
      }
    } catch (bindError) {
      setError(bindError instanceof Error ? bindError.message : "仓库绑定失败");
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
          <h3 className="mt-2 font-display text-3xl font-bold">扫描并绑定当前仓库</h3>
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

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">这里只回答一件事：当前仓库有没有接通，以及还卡在哪一步。</p>

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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">代码平台</p>
          <p className="mt-2 font-display text-xl font-semibold">{providerLabel(binding?.provider)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">绑定模式</p>
          <p className="mt-2 font-display text-xl font-semibold">{authModeLabel(binding?.authMode)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">连接就绪</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {binding ? (binding.connectionReady ? "已就绪" : "待补全") : "等待扫描"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">GitHub 应用</p>
          <p className="mt-2 font-display text-xl font-semibold">{githubAppLabel(binding)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">安装记录</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(binding?.installationId, binding?.installationUrl ? "待完成安装" : "未生成")}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前判断</p>
          <p data-testid="setup-repo-binding-message" className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">
              {valueOrFallback(binding?.connectionMessage, "正在检查仓库状态。")}
          </p>
          <details className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
              查看绑定依据
            </summary>
            <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.78)]">
              {valueOrFallback(binding?.repoUrl, "正在读取当前仓库远端地址")}
            </p>
            {binding?.missing?.length ? (
              <p
                data-testid="setup-repo-binding-missing-fields"
                className="mt-3 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.72)]"
              >
                缺少信息：{binding.missing.join(" / ")}
              </p>
            ) : null}
            {binding?.detectedAt ? (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
                检查时间 {binding.detectedAt}
              </p>
            ) : null}
          </details>
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">安装动作</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            {binding?.appInstalled
              ? "GitHub 应用安装已经完成，仓库状态可以直接回流。"
              : binding?.appConfigured
                ? "GitHub 应用已配置，但安装还没完成。"
                : "当前还没有完成 GitHub 应用配置，请先补充设置。"}
          </p>
          {binding?.installationUrl ? (
            <a
              data-testid="setup-repo-binding-install-link"
              href={binding.installationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
            >
              打开安装页面
            </a>
          ) : null}
          <p
            data-testid="setup-repo-binding-return-steps"
            className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]"
          >
            安装完成后会自动返回并更新仓库状态。如未自动更新，再回到这里手动同步。
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">当前权限</p>
          <p data-testid="setup-repo-binding-authz" className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
            {permissionStatusLabel(bindStatus)}
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
          {loading ? "同步中..." : "同步仓库绑定"}
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
