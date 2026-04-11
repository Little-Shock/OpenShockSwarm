"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { usePhaseZeroState } from "@/lib/live-phase0";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

type GitHubConnectionStatus = {
  repo: string;
  repoUrl: string;
  branch: string;
  provider: string;
  remoteConfigured: boolean;
  ghCliInstalled: boolean;
  ghAuthenticated: boolean;
  appId?: string;
  appSlug?: string;
  appConfigured: boolean;
  appInstalled: boolean;
  installationId?: string;
  installationUrl?: string;
  callbackUrl?: string;
  webhookUrl?: string;
  missing?: string[];
  ready: boolean;
  authMode: string;
  preferredAuthMode?: string;
  message: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function boolLabel(value: boolean, yes: string, no: string) {
  return value ? yes : no;
}

function valueOrFallback(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function githubAppLabel(status: GitHubConnectionStatus | null) {
  if (!status) return "等待检查";
  if (status.appInstalled) return "已安装";
  if (status.appConfigured) return "待安装";
  return "未配置";
}

function ghCliLabel(status: GitHubConnectionStatus | null) {
  if (!status) return "等待检查";
  if (status.ghAuthenticated) return "已认证";
  if (status.ghCliInstalled) return "待认证";
  return "未安装";
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
      return valueOrFallback(value, "等待检查");
  }
}

export function GitHubConnectionConsole() {
  const { state } = usePhaseZeroState();
  const stateStatus = useMemo<GitHubConnectionStatus | null>(() => {
    if (!state.workspace.repo && !state.workspace.branch && !state.workspace.repoProvider) {
      return null;
    }
    return {
      repo: state.workspace.repo,
      repoUrl: state.workspace.repoUrl,
      branch: state.workspace.branch,
      provider: state.workspace.repoProvider,
      remoteConfigured: Boolean(state.workspace.repoUrl),
      ghCliInstalled: false,
      ghAuthenticated: false,
      appConfigured: false,
      appInstalled: false,
      installationId: "",
      installationUrl: "",
      callbackUrl: "",
      webhookUrl: "",
      ready: state.workspace.repoBindingStatus === "bound",
      authMode: state.workspace.repoAuthMode,
      preferredAuthMode: state.workspace.repoAuthMode,
      message: state.workspace.repo
        ? `当前工作区已读取到 GitHub 仓库：${state.workspace.repo}`
        : "正在检查 GitHub 连接状态。",
    };
  }, [state.workspace]);
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadStatus = useCallback(async (showFeedback = false) => {
    setLoading(true);
    setError(null);
    if (showFeedback) {
      setSuccess(null);
    }

    try {
      const response = await fetch(`${API_BASE}/v1/github/connection`, { cache: "no-store" });
      const payload = (await response.json()) as GitHubConnectionStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `GitHub 连接探测失败：${response.status}`);
      }
      setStatus(payload);
      if (showFeedback) {
        setSuccess(payload.ready ? "GitHub 状态已刷新，可以继续使用远端功能。" : "GitHub 状态已刷新，当前仍未完成连接。");
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "GitHub 连接探测失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
    const poll = window.setInterval(() => {
      void loadStatus();
    }, 5000);

    return () => {
      window.clearInterval(poll);
    };
  }, [loadStatus]);

  useEffect(() => {
    if (!status && stateStatus) {
      setStatus(stateStatus);
    }
  }, [stateStatus, status]);

  return (
    <section data-testid="setup-github-connection" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            GitHub 连接
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">检查 GitHub 连接状态</h3>
        </div>
        <span
          data-testid="setup-github-readiness-status"
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            status?.ready ? "bg-[var(--shock-lime)]" : "bg-[var(--shock-paper)]"
          )}
        >
          {status?.ready ? "已连接" : "未完成"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">这里只显示 GitHub 是否已配置完成，不会自动发起远端操作。</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">远端</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {status ? boolLabel(status.remoteConfigured, "已配置", "未配置") : "等待探测"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前认证路径</p>
          <p className="mt-2 font-display text-xl font-semibold">{authModeLabel(status?.authMode)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">偏好模式</p>
          <p className="mt-2 font-display text-xl font-semibold">{authModeLabel(status?.preferredAuthMode)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">GitHub 应用</p>
          <p className="mt-2 font-display text-xl font-semibold">{githubAppLabel(status)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">安装记录</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(status?.installationId, status?.installationUrl ? "待完成安装" : "未生成")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">命令行登录</p>
          <p className="mt-2 font-display text-xl font-semibold">{ghCliLabel(status)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前判断</p>
          <p data-testid="setup-github-message" className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">
            {status?.message ?? "正在检查 GitHub 连接状态。"}
          </p>
          <details className="mt-4 rounded-[16px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
              查看连接细节
            </summary>
            {status?.missing?.length ? (
              <p
                data-testid="setup-github-missing-fields"
                className="mt-3 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.72)]"
              >
                缺少信息：{status.missing.join(" / ")}
              </p>
            ) : null}
            {status?.repoUrl ? (
              <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">{status.repoUrl}</p>
            ) : null}
            <dl className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">仓库</dt>
                <dd className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">{valueOrFallback(status?.repo, "当前未返回仓库")}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">分支</dt>
                <dd data-testid="setup-github-branch" className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                  {valueOrFallback(status?.branch, "当前未返回分支")}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">代码平台</dt>
                <dd className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">{providerLabel(status?.provider)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">应用标识</dt>
                <dd className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                  {valueOrFallback(status?.appSlug, "当前未配置应用标识")}
                </dd>
              </div>
            </dl>
          </details>
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">安装动作</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            {status?.appInstalled
              ? "GitHub 应用安装已就绪，设置页已经能直接读到状态。"
              : status?.appConfigured
                ? "GitHub 应用已配置，但安装还没完成。"
                : "当前还没有完成 GitHub 应用配置，请先补充设置。"}
          </p>
          {status?.installationUrl ? (
            <a
              data-testid="setup-github-install-link"
              href={status.installationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
            >
              打开安装页面
            </a>
          ) : null}
          <details className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
              查看回流地址
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">公开回跳地址</p>
                {status?.callbackUrl ? (
                  <a
                    data-testid="setup-github-callback-link"
                    href={status.callbackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex break-all text-sm leading-6 underline underline-offset-2"
                  >
                    {status.callbackUrl}
                  </a>
                ) : (
                  <p data-testid="setup-github-callback-missing" className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
                    当前还没有配置公开回跳地址。
                  </p>
                )}
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">公开回调地址</p>
                <p data-testid="setup-github-webhook-url" className="mt-2 break-all text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                  {valueOrFallback(status?.webhookUrl, "当前还没有配置公开回调地址")}
                </p>
              </div>
            </div>
          </details>
          <p
            data-testid="setup-github-return-steps"
            className="mt-4 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]"
          >
            完成安装后会自动返回并刷新当前状态。如未自动更新，再手动重新检查。
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          data-testid="setup-github-refresh-button"
          type="button"
          onClick={() => void loadStatus(true)}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "检查中..." : "重新检查 GitHub"}
        </button>
      </div>

      {error ? (
        <div data-testid="setup-github-error" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}

      {success ? (
        <div data-testid="setup-github-success" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 text-sm text-[var(--shock-ink)]">
          {success}
        </div>
      ) : null}
    </section>
  );
}
