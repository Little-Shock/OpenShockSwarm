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
  ready: boolean;
  authMode: string;
  message: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function boolLabel(value: boolean, yes: string, no: string) {
  return value ? yes : no;
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
    <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            GitHub 连接
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">探测远端 PR 就绪度</h3>
        </div>
        <span
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

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">origin</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {status ? boolLabel(status.remoteConfigured, "已配置", "未配置") : "等待探测"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">gh CLI</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {status ? boolLabel(status.ghCliInstalled, "已安装", "未安装") : "等待探测"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">认证状态</p>
          <p className="mt-2 font-display text-xl font-semibold">
            {status ? boolLabel(status.ghAuthenticated, "已认证", "未认证") : "等待探测"}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">模式</p>
          <p className="mt-2 font-display text-xl font-semibold">{status?.authMode ?? "等待探测"}</p>
        </div>
      </div>

      <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">当前判断</p>
        <p className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.8)]">
          {status?.message ?? "等待探测 GitHub 连接状态。"}
        </p>
        {status?.repoUrl ? (
          <p className="mt-3 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.72)]">
            {status.repoUrl}
          </p>
        ) : null}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "探测中..." : "重新探测 GitHub"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white">
          {error}
        </div>
      ) : null}
    </section>
  );
}
