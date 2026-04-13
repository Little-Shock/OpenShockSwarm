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
		default:
			return value || "未返回";
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
			return value || "未返回";
	}
}

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
	const friendlyMessage = (message: string) =>
		message.toLowerCase().includes("workspace member not found") ? "还没有找到当前账号，请先回到引导页完成创建。" : message;
	const [phase, setPhase] = useState<"submitting" | "success" | "error">(installationId ? "submitting" : "error");
	const [message, setMessage] = useState(
		installationId ? "正在同步 GitHub 连接结果。" : "当前链接缺少安装编号。"
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
					throw new Error(nextPayload.error || `GitHub 安装回跳失败：${response.status}`);
				}
				if (cancelled) {
					return;
				}
				setPayload(nextPayload);
				setPhase("success");
				setMessage("GitHub 已连接，正在返回设置页。");
				redirectTimer = window.setTimeout(() => {
					router.replace("/setup?github_installation=connected");
				}, 1800);
			} catch (callbackError) {
				if (cancelled) {
					return;
				}
				setPhase("error");
				setMessage(callbackError instanceof Error ? friendlyMessage(callbackError.message) : "GitHub 连接失败");
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
			eyebrow="GitHub 回跳"
			title="同步 GitHub 连接结果"
			description="页面会自动完成同步，然后返回设置页。"
			contextTitle="当前回跳"
			contextDescription="这里会显示本次回跳的安装编号和同步状态。"
			contextBody={
				<div className="space-y-2 rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm leading-6">
					<p>
						<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
							安装编号
						</span>
						<br />
						{installationId || "未返回"}
					</p>
					<p>
						<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.56)]">
							回跳动作
						</span>
						<br />
						{setupAction || "未返回"}
					</p>
				</div>
			}
		>
			<div className="space-y-4">
				<section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
					<p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">同步结果</p>
					<h2 className="mt-2 font-display text-3xl font-bold">
						{phase === "success" ? "GitHub 安装回跳已接住" : phase === "error" ? "GitHub 安装回跳失败" : "正在同步 GitHub 设置"}
					</h2>
					<p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{message}</p>

					{payload ? (
						<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
							<CallbackMetric label="当前认证路径" value={authModeLabel(payload.connection.authMode)} />
							<CallbackMetric label="绑定方式" value={authModeLabel(payload.binding.authMode)} />
							<CallbackMetric label="仓库" value={payload.binding.repo || "未返回"} />
							<CallbackMetric label="回填条数" value={`${payload.syncedPullCount}`} />
						</div>
					) : null}

					{payload ? (
						<div className="mt-4 rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 text-sm leading-6">
							<p>{payload.connection.message}</p>
							<p className="mt-2 text-[color:rgba(24,20,14,0.72)]">{payload.binding.connectionMessage}</p>
							<p className="mt-2 text-[color:rgba(24,20,14,0.72)]">绑定状态：{bindingStatusLabel(payload.binding.bindingStatus)} · 分支：{payload.binding.branch || "未返回"}</p>
						</div>
					) : null}

					<div className="mt-4 flex flex-wrap gap-3">
						<Link
							href="/setup"
							className="inline-flex rounded-2xl border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] transition-transform hover:-translate-y-0.5"
						>
							返回设置
						</Link>
						{phase === "success" ? (
							<p className="self-center text-sm text-[color:rgba(24,20,14,0.68)]">页面会自动跳回设置页。</p>
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
			eyebrow="GitHub 回跳"
			title="收下安装完成后的回流"
			description="正在解析 GitHub 回跳参数，并把安装状态同步回当前设置视图。"
			contextTitle="当前回跳"
			contextDescription="页面会在拿到参数后提交安装编号，并刷新仓库绑定与拉取请求回流。"
		>
			<section className="rounded-[28px] border-2 border-[var(--shock-ink)] bg-white p-5 shadow-[6px_6px_0_0_var(--shock-yellow)]">
				<p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">同步结果</p>
				<h2 className="mt-2 font-display text-3xl font-bold">正在同步 GitHub 设置</h2>
				<p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
					正在等待回跳参数，并准备提交安装完成后的回流。
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
