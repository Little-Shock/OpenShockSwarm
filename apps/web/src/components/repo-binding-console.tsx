"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";

type RepoBindingSnapshot = {
  repo: string;
  repoUrl: string;
  branch: string;
  provider: string;
  bindingStatus: string;
  authMode: string;
  detectedAt?: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrFallback(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

export function RepoBindingConsole() {
  const [binding, setBinding] = useState<RepoBindingSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/v1/repo/binding`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error || `repo binding request failed: ${response.status}`);
        }
        return response.json() as Promise<RepoBindingSnapshot>;
      })
      .then((payload) => {
        if (!cancelled) {
          setBinding(payload);
          setError(null);
        }
      })
      .catch((fetchError: Error) => {
        if (!cancelled) {
          setError(fetchError.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleBindRepo() {
    setLoading(true);
    setError(null);

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
      if (!response.ok) {
        throw new Error(payload.error || `repo binding failed: ${response.status}`);
      }
      if (payload.binding) {
        setBinding(payload.binding);
      }
    } catch (bindError) {
      setError(bindError instanceof Error ? bindError.message : "repo binding failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-lime)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">
            仓库绑定
          </p>
          <h3 className="mt-2 font-display text-3xl font-bold">扫描并绑定当前 Repo</h3>
        </div>
        <span
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            binding?.bindingStatus === "bound" ? "bg-[var(--shock-lime)]" : "bg-[var(--shock-paper)]"
          )}
        >
          {binding?.bindingStatus === "bound" ? "已绑定" : "待绑定"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
        这里直接从本地 git 读取 `origin` 和当前分支，把工作区绑定到真正的代码仓库，不再只靠静态文案假装接好了。
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">仓库</p>
          <p className="mt-2 font-display text-xl font-semibold break-all">
            {valueOrFallback(binding?.repo, "等待扫描")}
          </p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">分支</p>
          <p className="mt-2 font-display text-xl font-semibold">
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
      </div>

      <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">Origin URL</p>
        <p className="mt-2 font-mono text-xs leading-6 break-all text-[color:rgba(24,20,14,0.78)]">
          {valueOrFallback(binding?.repoUrl, "等待扫描当前仓库 origin")}
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.56)]">
          当前实现先走 `local-git-origin`，先把 repo 真绑定，再继续接完整 GitHub 身份和远端 PR。
        </p>
        <button
          type="button"
          onClick={handleBindRepo}
          disabled={loading}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "扫描中..." : "绑定当前仓库"}
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
