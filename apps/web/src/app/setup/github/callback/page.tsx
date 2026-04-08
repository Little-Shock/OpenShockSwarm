"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { OpenShockShell } from "@/components/open-shock-shell";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

type CallbackResponse = {
	installationId: string;
	setupAction?: string;
	connection: {
		authMode: string;
		message: string;
	};
	binding: {
		authMode: string;
		repo: string;
		branch: string;
		bindingStatus: string;
		connectionMessage: string;
	};
	syncedPullCount: number;
};

export default function GitHubInstallationCallbackPage() {
	return (
		<Suspense fallback={<GitHubInstallationCallbackFallback />}>
			<GitHubInstallationCallbackContent />
		</Suspense>
	);
}

function GitHubInstallationCallbackContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const installationId = (searchParams.get("installation_id") || searchParams.get("installationId") || "").trim();
	const setupAction = (searchParams.get("setup_action") || searchParams.get("setupAction") || "").trim();
	const [phase, setPhase] = useState<"submitting" | "success" | "error">(installationId ? "submitting" : "error");
	const [message, setMessage] = useState(
		installationId ? "正在把 GitHub installation 回跳收进 OpenShock 当前 workspace 真值。" : "当前回跳链接缺少 installation id。"
	);
	const [payload, setPayload] = useState<CallbackResponse | null>(null);

	useEffect(() => {
		if (!installationId) {
			return;
		}

		let cancelled = false;
		let redirectTimer: number | null = null;

		async function finalizeCallback() {
			try {
				const response = await fetch(`${API_BASE}/v1/github/installation-callback`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						installationId,
						setupAction,
					}),
				});
				const nextPayload = (await response.json()) as CallbackResponse & { error?: string };
				if (!response.ok) {
					throw new Error(nextPayload.error || `github installation callback failed: ${response.status}`);
				}
				if (cancelled) {
					return;
				}
				setPayload(nextPayload);
				setPhase("success");
				setMessage("installation truth 已写回，正在把 repo binding 与当前 PR 状态前滚回 Setup。");
				redirectTimer = window.setTimeout(() => {
					router.replace("/setup?github_installation=connected");
				}, 1800);
			} catch (callbackError) {
				if (cancelled) {
					return;
				}
				setPhase("error");
				setMessage(callbackError instanceof Error ? callbackError.message : "github installation callback failed");
			}
		}

		void finalizeCallback();

		return () => {
			cancelled = true;
			if (redirectTimer) {
				window.clearTimeout(redirectTimer);
			}
		};
	}, [installationId, router, setupAction]);

	return (
		<OpenShockShell
			view="setup"
			eyebrow="GitHub Callback"
			title="收口 installation-complete 回跳"
			description="这一步不再要求人手动回 Setup 再点两次同步，而是直接把 GitHub App installation 回跳前滚成 repo binding 与 PR truth。"
			contextTitle="callback intake"
			contextDescription="当前页面会把 installation id、setup action、repo binding 与 PR backfill 一次性写回控制面。"
			contextBody={
				<div className="space-y-2 rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm leading-6">
					<p>
						<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
							installation
						</span>
						<br />
						{installationId || "未返回"}
					</p>
					<p>
						<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
							setup_action
						</span>
						<br />
						{setupAction || "未返回"}
					</p>
				</div>
			}
		>
			<div className="space-y-4">
				<section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
					<p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Finalize</p>
					<h2 className="mt-2 font-display text-3xl font-bold">
						{phase === "success" ? "GitHub 安装回跳已接住" : phase === "error" ? "GitHub 安装回跳失败" : "正在同步 GitHub 真值"}
					</h2>
					<p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{message}</p>

					{payload ? (
						<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
							<CallbackMetric label="当前 auth path" value={payload.connection.authMode || "未返回"} />
							<CallbackMetric label="binding mode" value={payload.binding.authMode || "未返回"} />
							<CallbackMetric label="repo" value={payload.binding.repo || "未返回"} />
							<CallbackMetric label="PR backfill" value={`${payload.syncedPullCount}`} />
						</div>
					) : null}

					{payload ? (
						<div className="mt-4 rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 text-sm leading-6">
							<p>{payload.connection.message}</p>
							<p className="mt-2 text-[color:rgba(24,20,14,0.72)]">{payload.binding.connectionMessage}</p>
						</div>
					) : null}

					<div className="mt-4 flex flex-wrap gap-3">
						<Link
							href="/setup"
							className="inline-flex rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
						>
							返回 Setup
						</Link>
						{phase === "success" ? (
							<p className="self-center text-sm text-[color:rgba(24,20,14,0.68)]">页面会自动跳回 Setup。</p>
						) : null}
					</div>
				</section>
			</div>
		</OpenShockShell>
	);
}

function GitHubInstallationCallbackFallback() {
	return (
		<OpenShockShell
			view="setup"
			eyebrow="GitHub Callback"
			title="收口 installation-complete 回跳"
			description="正在解析 GitHub callback 参数，并把 installation 真值前滚回当前 Setup 视图。"
			contextTitle="callback intake"
			contextDescription="页面会在拿到 query 参数后，提交 installation id 并刷新 repo binding / PR 回流。"
		>
			<section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
				<p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">Finalize</p>
				<h2 className="mt-2 font-display text-3xl font-bold">正在同步 GitHub 真值</h2>
				<p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
					OpenShock 正在等待 callback 参数并准备提交 installation-complete 回流。
				</p>
			</section>
		</OpenShockShell>
	);
}

function CallbackMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
			<p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">{label}</p>
			<p className="mt-2 break-all font-display text-xl font-semibold">{value || "未返回"}</p>
		</div>
	);
}
