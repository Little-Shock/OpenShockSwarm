"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";

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
  if (!status) return "等待探测";
  if (status.appInstalled) return "已安装";
  if (status.appConfigured) return "待安装";
  return "未配置";
}

function ghCliLabel(status: GitHubConnectionStatus | null) {
  if (!status) return "等待探测";
  if (status.ghAuthenticated) return "已认证";
  if (status.ghCliInstalled) return "待认证";
  return "未安装";
}

export function GitHubConnectionConsole() {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadStatus() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/v1/github/connection`, { cache: "no-store" });
      const payload = (await response.json()) as GitHubConnectionStatus & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `github connection failed: ${response.status}`);
      }
      setStatus(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "github connection failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  return (
    <section data-testid="setup-github-connection" className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            GitHub 连接
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">探测远端 PR 就绪度</h3>
        </div>
        <span
          data-testid="setup-github-readiness-status"
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            status?.ready ? "bg-[var(--shock-lime)]" : "bg-[var(--shock-paper)]"
          )}
        >
          {status?.ready ? "可进远端 PR" : "仅本地闭环"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        这一步不是直接创建远端 PR，而是先证明这台机器是否已经具备真正走 GitHub 闭环的前置条件。
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">origin</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {status ? boolLabel(status.remoteConfigured, "已配置", "未配置") : "等待探测"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前 auth path</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(status?.authMode, "等待探测")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">偏好模式</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(status?.preferredAuthMode, "未声明")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">GitHub App</p>
          <p className="mt-2 font-display text-xl font-semibold">{githubAppLabel(status)}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">installation</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {valueOrFallback(status?.installationId, status?.installationUrl ? "待完成安装" : "未生成")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">gh CLI</p>
          <p className="mt-2 font-display text-xl font-semibold">{ghCliLabel(status)}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_0.8fr]">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前判断</p>
          <p data-testid="setup-github-message" className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">
            {status?.message ?? "等待探测 GitHub 连接状态。"}
          </p>
          {status?.missing?.length ? (
            <p className="mt-3 font-mono text-xs leading-6 text-[color:rgba(24,20,14,0.72)]">
              缺失字段: {status.missing.join(" / ")}
            </p>
          ) : null}
          {status?.repoUrl ? (
            <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
              {status.repoUrl}
            </p>
          ) : null}
          <dl className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">仓库</dt>
              <dd className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                {valueOrFallback(status?.repo, "当前未返回 repo")}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">分支</dt>
              <dd data-testid="setup-github-branch" className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                {valueOrFallback(status?.branch, "当前未返回 branch")}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">provider</dt>
              <dd className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                {valueOrFallback(status?.provider, "未知")}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">App Slug</dt>
              <dd className="mt-1 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
                {valueOrFallback(status?.appSlug, "当前未配置 app slug")}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">安装动作</p>
          <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.82)]">
            {status?.appInstalled
              ? "GitHub App installation 已就绪，Setup 已能直接读到 install truth。"
              : status?.appConfigured
                ? "GitHub App 已配置但安装还没闭环；继续按 installation URL 补齐。"
                : "当前还没有完整 GitHub App 配置，先看缺失字段再继续推进。"}
          </p>
          {status?.installationUrl ? (
            <a
              href={status.installationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
            >
              打开 installation 页面
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          data-testid="setup-github-refresh-button"
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "探测中..." : "重新探测 GitHub"}
        </button>
      </div>

      {error ? (
        <div data-testid="setup-github-error" className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}
    </section>
  );
}
