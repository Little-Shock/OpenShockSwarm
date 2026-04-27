"use client";

import Link from "next/link";

import { buildWorkspaceContinueTarget } from "@/lib/continue-target";
import { usePhaseZeroState } from "@/lib/live-phase0";

function statusLabel(ready: boolean, positive: string, negative: string) {
  return ready ? positive : negative;
}

function actionButtonTone() {
  return "bg-[var(--shock-ink)] text-[var(--shock-paper)]";
}

export default function HomePage() {
  const { state, approvalCenter, loading, error, refresh } = usePhaseZeroState();
  const actionableSignals = approvalCenter.signals.filter((item) => item.kind !== "status");
  const workspaceContinue = buildWorkspaceContinueTarget(state, {
    approvalSignals: actionableSignals,
    preferLaunchWhenIdle: true,
  });
  const journey = workspaceContinue.journey;
  const actionableInbox = state.inbox.filter((item) => item.kind !== "status");
  const openMailbox = state.mailbox.filter((handoff) => handoff.status !== "completed");
  const reviewPullRequests = state.pullRequests.filter((pullRequest) => pullRequest.status !== "merged");
  const channelCount = state.channels.length;
  const agentCount = state.agents.length;
  const directMessageCount = state.directMessages.length;
  const unreadChatCount =
    state.channels.filter((channel) => channel.unread > 0).length + state.directMessages.filter((message) => message.unread > 0).length;
  const connectedMachineCount = state.machines.filter((machine) => machine.state === "online" || machine.state === "busy").length;
  const recentRoom = state.rooms.find((room) => room.unread > 0) ?? state.rooms[0];
  const liveRun = state.runs.find((run) => run.status === "running" || run.status === "blocked" || run.status === "paused") ?? state.runs[0];
  const runtimeReady = state.workspace.pairingStatus.trim() === "paired";
  const githubReady = Boolean(state.workspace.githubInstallation.connectionReady);
  const firstDirectMessage = state.directMessages[0];
  const chatHref = "/chat/all";
  const directMessageHref = firstDirectMessage ? `/chat/${firstDirectMessage.id}` : chatHref;
  const agentHref = state.agents[0] ? `/profiles/agent/${state.agents[0].id}` : "/agents";
  const machineHref = runtimeReady ? "/chat/all" : "/setup";
  const roomHref = recentRoom ? `/rooms/${recentRoom.id}` : "/rooms";
  const settingsHref = githubReady ? "/settings" : "/setup";
  const needsOnboarding = !journey.onboardingDone;
  const continueTarget = loading || error ? null : workspaceContinue.target;
  const primaryEntryHref = needsOnboarding ? "/setup" : chatHref;
  const primaryEntryLabel = needsOnboarding ? (journey.onboardingStarted ? "继续设置" : "开始设置") : "进入聊天";
  const primaryContinueHref = continueTarget?.href ?? primaryEntryHref;
  const primaryContinueLabel = continueTarget?.ctaLabel ?? primaryEntryLabel;
  const productHeadline = "让人和智能体在同一条对话里继续工作";
  const productSummary = "先回到聊天、讨论或待处理；缺设置时只补当前缺的这一步。";
  const primaryEntryReason = needsOnboarding ? "先把工作区接通，完成后聊天会成为默认入口。" : "先进入聊天，再决定回讨论、处理交接或检查设置。";
  const primaryContinueReason = needsOnboarding
    ? primaryEntryReason
    : continueTarget
      ? `${continueTarget.reason}，一键回到当前工作。`
      : primaryEntryReason;
  const runtimeStatus = loading ? "正在确认" : statusLabel(runtimeReady, "已连接", "还没连上");
  const shellReady = !loading && !error && !needsOnboarding;
  const chatSummary =
    unreadChatCount > 0
      ? "频道和私聊有新消息，会接着上次对话继续。"
      : channelCount > 0 || directMessageCount > 0
        ? `${channelCount} 个频道和 ${directMessageCount} 条私聊会接着上次状态继续。`
      : "从聊天开始，随时发起新讨论或叫智能体开工。";
  const directMessageSummary =
    directMessageCount > 0 ? `${directMessageCount} 条私聊会和频道一起续上。` : "还没有私聊，先从频道开始。";
  const agentSummary = agentCount > 0 ? `${agentCount} 位智能体已经在工作区里待命或执行。` : "接通工作区后，智能体会出现在这里。";
  const machineSummary =
    connectedMachineCount > 0
      ? `${connectedMachineCount} 台机器在线，任务可以直接接起来。`
      : "接上机器后，任务会直接在你的环境里执行。";
  const roomSummary = recentRoom ? recentRoom.summary : "还没有讨论间，先从聊天或任务板起一条新工作。";
  const runSummary = liveRun ? liveRun.nextAction : "需要时再从讨论间发起执行。";
  const pendingHref =
    continueTarget &&
    ["inbox", "approval-center", "mailbox", "pull-request", "room-blocked"].includes(continueTarget.source)
      ? continueTarget.href
      : actionableInbox[0]?.href ??
        (openMailbox[0] ? `/mailbox?handoffId=${openMailbox[0].id}&roomId=${openMailbox[0].roomId}` : undefined) ??
        (reviewPullRequests[0] ? `/rooms/${reviewPullRequests[0].roomId}?tab=pr` : undefined) ??
        "/inbox";
  const pendingTitle =
    actionableSignals.length > 0
      ? `${actionableSignals.length} 条待处理信号`
      : actionableInbox.length > 0
      ? `${actionableInbox.length} 条待处理`
      : openMailbox.length > 0
        ? `${openMailbox.length} 条交接待继续`
        : reviewPullRequests.length > 0
          ? `${reviewPullRequests.length} 个交付待看`
          : "当前很干净";
  const pendingSummary =
    actionableSignals.length > 0 && continueTarget
      ? continueTarget.summary
      : actionableInbox.length > 0
      ? `${actionableInbox.length} 条提醒会把你带回讨论、交接或执行。`
      : openMailbox.length > 0
        ? `${openMailbox.length} 条交接还在推进，先接住最靠前的一条。`
        : reviewPullRequests.length > 0
          ? `${reviewPullRequests.length} 个交付还没收口，先看当前评审或修改。`
          : "当前没有待处理事项，需要时再从聊天或讨论间开始。";

  return (
    <main className="min-h-screen overflow-y-auto bg-[radial-gradient(circle_at_top_left,rgba(255,213,0,0.28),transparent_34%),linear-gradient(180deg,#fff8e7_0%,#fff6dd_100%)] px-5 py-6 text-[var(--shock-ink)] sm:px-7">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
        {shellReady ? (
          <section
            data-testid="home-shell-surface"
            className="rounded-[30px] border-2 border-[var(--shock-ink)] bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.94)_100%)] p-5 shadow-[6px_6px_0_0_var(--shock-ink)] sm:p-7"
          >
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[rgba(24,20,14,0.58)]">OpenShock</p>
                <h1 className="mt-3 font-display text-[2rem] font-bold leading-none sm:text-[2.7rem]">
                  {continueTarget?.title ?? "回到当前工作"}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-[rgba(24,20,14,0.76)] sm:text-[15px]">
                  {primaryContinueReason}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Link
                    className={`rounded-full border-2 border-[var(--shock-ink)] px-4 py-2 text-sm font-semibold shadow-[3px_3px_0_0_rgba(24,20,14,0.2)] ${actionButtonTone()}`}
                    data-testid="home-primary-chat-cta"
                    href={primaryContinueHref}
                  >
                    {primaryContinueLabel}
                  </Link>
                  <Link
                    className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-2 text-sm font-semibold shadow-[3px_3px_0_0_var(--shock-ink)]"
                    data-testid="home-shell-spawn-agent-link"
                    href={agentCount > 0 ? "/board" : "/agents"}
                  >
                    派一个智能体开始处理
                  </Link>
                  <Link
                    className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-4 py-2 text-sm font-semibold shadow-[3px_3px_0_0_var(--shock-ink)]"
                    href={settingsHref}
                  >
                    {githubReady ? "检查设置" : "补齐设置"}
                  </Link>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <Link
                    className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[3px_3px_0_0_var(--shock-ink)]"
                    data-testid="home-shell-chat-link"
                    href={
                      continueTarget?.source === "channel" || continueTarget?.source === "direct-message" ? continueTarget.href : chatHref
                    }
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">频道 / 私聊</p>
                    <p className="mt-2 text-sm font-semibold">
                      {channelCount > 0 || directMessageCount > 0 ? `${channelCount} 个频道 · ${directMessageCount} 条私聊` : "从聊天开始"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{chatSummary}</p>
                  </Link>
                  <Link
                    className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[3px_3px_0_0_var(--shock-ink)]"
                    data-testid="home-shell-rooms-link"
                    href={continueTarget?.source?.startsWith("room-") ? continueTarget.href : roomHref}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">讨论间</p>
                    <p className="mt-2 text-sm font-semibold">{recentRoom?.title ?? "还没有讨论间"}</p>
                    <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{roomSummary}</p>
                  </Link>
                  <Link
                    className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4 shadow-[3px_3px_0_0_var(--shock-ink)]"
                    data-testid="home-shell-inbox-link"
                    href={pendingHref}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">待处理</p>
                    <p className="mt-2 text-sm font-semibold">{pendingTitle}</p>
                    <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{pendingSummary}</p>
                  </Link>
                </div>
              </div>

              <aside className="grid gap-3">
                <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">为什么先做这一步</p>
                  <p className="mt-2 text-sm font-semibold">{continueTarget?.title ?? journey.nextLabel}</p>
                  <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                    {continueTarget?.summary ?? journey.nextSummary}
                  </p>
                  <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[rgba(24,20,14,0.54)]">
                    {continueTarget?.reason ?? "当前工作区已经就绪。"}
                  </p>
                </div>
                <details
                  data-testid="home-shell-status-details"
                  className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4"
                >
                  <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">
                    查看工作区状态
                  </summary>
                  <div className="mt-4 grid gap-3">
                    <Link
                      className="rounded-[18px] border-2 border-[rgba(24,20,14,0.12)] bg-[var(--shock-paper)] px-4 py-4"
                      data-testid="home-shell-dm-link"
                      href={directMessageHref}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">直接联系</p>
                      <p className="mt-2 text-sm font-semibold">{directMessageCount > 0 ? `${directMessageCount} 条私聊在等你` : "随时可私聊智能体"}</p>
                      <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{directMessageSummary}</p>
                    </Link>
                    <Link
                      className="rounded-[18px] border-2 border-[rgba(24,20,14,0.12)] bg-[var(--shock-paper)] px-4 py-4"
                      data-testid="home-shell-agents-link"
                      href={agentHref}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">智能体</p>
                      <p className="mt-2 text-sm font-semibold">{`${agentCount} 位在场`}</p>
                      <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{agentSummary}</p>
                    </Link>
                    <Link
                      className="rounded-[18px] border-2 border-[rgba(24,20,14,0.12)] bg-[var(--shock-paper)] px-4 py-4"
                      data-testid="home-shell-machine-link"
                      href={machineHref}
                    >
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">机器</p>
                      <p className="mt-2 text-sm font-semibold">
                        {connectedMachineCount > 0 ? `${connectedMachineCount} 台在线` : runtimeStatus}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{machineSummary}</p>
                    </Link>
                    <div className="rounded-[18px] border-2 border-[rgba(24,20,14,0.12)] bg-[var(--shock-paper)] px-4 py-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.54)]">当前运行</p>
                      <p className="mt-2 text-sm font-semibold">{liveRun ? `${liveRun.status} · ${liveRun.owner}` : "没有进行中的运行"}</p>
                      <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{runSummary}</p>
                    </div>
                  </div>
                </details>
              </aside>
            </div>
          </section>
        ) : (
          <section className="rounded-[30px] border-2 border-[var(--shock-ink)] bg-[linear-gradient(135deg,rgba(255,255,255,0.72)_0%,rgba(255,255,255,0.94)_100%)] p-5 shadow-[6px_6px_0_0_var(--shock-ink)] sm:p-7">
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[rgba(24,20,14,0.58)]">OpenShock</p>
              <h1 className="mt-3 font-display text-[2rem] font-bold leading-none sm:text-[3rem]">{productHeadline}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[rgba(24,20,14,0.76)] sm:text-[15px]">
                {productSummary}
              </p>
              <p className="mt-3 max-w-2xl font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.52)]">
                {primaryContinueReason}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  className={`rounded-full border-2 border-[var(--shock-ink)] px-4 py-2 text-sm font-semibold shadow-[3px_3px_0_0_rgba(24,20,14,0.2)] ${actionButtonTone()}`}
                  data-testid="home-primary-chat-cta"
                  href={primaryContinueHref}
                >
                  {primaryContinueLabel}
                </Link>
              </div>
              <details className="mt-5 rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
                <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.68)]">
                  查看当前状态与补充入口
                </summary>
                <div
                  data-testid="home-status-strip"
                  className="mt-4 flex flex-wrap items-center gap-2 rounded-[20px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-3"
                >
                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                    记忆会续上
                  </span>
                  <span className="text-sm leading-6 text-[rgba(24,20,14,0.74)]">
                    上次讨论、交接和运行线索会继续接住。
                  </span>
                  <span className="hidden text-[rgba(24,20,14,0.34)] sm:inline">/</span>
                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                    频道和私聊是一条对话
                  </span>
                  <span className="text-sm leading-6 text-[rgba(24,20,14,0.74)]">
                    {loading ? "正在确认讨论入口。" : `${channelCount} 个频道和 ${directMessageCount} 条私聊都能继续工作。`}
                  </span>
                  <span className="hidden text-[rgba(24,20,14,0.34)] sm:inline">/</span>
                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em]">
                    你的电脑就是执行环境
                  </span>
                  <span className="text-sm leading-6 text-[rgba(24,20,14,0.74)]">
                    {loading
                      ? "正在确认机器连接。"
                      : connectedMachineCount > 0
                        ? `${connectedMachineCount} 台机器在线，随时可以接任务。`
                        : "接上机器后，任务就能直接在你的环境里执行。"}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[rgba(24,20,14,0.72)]" data-testid="home-support-actions">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.5)]">稍后再做</span>
                  <Link
                    className="underline decoration-[rgba(24,20,14,0.24)] underline-offset-4"
                    data-testid="home-support-dm-link"
                    href={directMessageHref}
                  >
                    私聊智能体
                  </Link>
                  <Link
                    className="underline decoration-[rgba(24,20,14,0.24)] underline-offset-4"
                    data-testid="home-support-agents-link"
                    href={agentHref}
                  >
                    查看智能体
                  </Link>
                  <Link
                    className="underline decoration-[rgba(24,20,14,0.24)] underline-offset-4"
                    data-testid="home-support-machine-link"
                    href={machineHref}
                  >
                    {runtimeReady ? "机器状态" : "连接机器"}
                  </Link>
                </div>
              </details>
            </div>
          </section>
        )}

        {loading ? (
          <section className="rounded-[26px] border-2 border-dashed border-[rgba(24,20,14,0.24)] bg-white/75 px-5 py-10 text-center shadow-[0_16px_36px_rgba(24,20,14,0.08)]">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">正在确认</p>
            <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">正在确认你可以从哪里继续。</p>
          </section>
        ) : error ? (
          <section className="rounded-[26px] border-2 border-[var(--shock-ink)] bg-white px-5 py-6 shadow-[4px_4px_0_0_var(--shock-ink)]">
            <p className="font-display text-2xl font-bold">暂时没连上工作区</p>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[rgba(24,20,14,0.76)]">
              先重试一次；如果还不行，就去设置页检查仓库、GitHub 和运行环境。
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-ink)] px-4 py-2 text-sm font-semibold text-[var(--shock-paper)] shadow-[3px_3px_0_0_rgba(24,20,14,0.22)]"
                onClick={() => void refresh()}
                type="button"
              >
                再试一次
              </button>
              <Link
                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-4 py-2 text-sm font-semibold text-[var(--shock-ink)] shadow-[3px_3px_0_0_var(--shock-ink)]"
                href="/setup"
              >
                去检查设置
              </Link>
              <Link
                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-4 py-2 text-sm font-semibold text-[var(--shock-ink)] shadow-[3px_3px_0_0_var(--shock-ink)]"
                href="/access"
              >
                去账号页
              </Link>
            </div>
          </section>
        ) : shellReady ? null : (
          <details className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-5 py-4 shadow-[4px_4px_0_0_var(--shock-ink)]">
            <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.68)]">
              查看继续线索与工作区概览
            </summary>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-[20px] border-2 border-[rgba(24,20,14,0.18)] bg-[var(--shock-paper)] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.5)]">当前继续</p>
                <p className="mt-2 text-sm font-semibold">{continueTarget?.title ?? journey.nextLabel}</p>
                <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                  {continueTarget?.summary ?? journey.nextSummary}
                </p>
              </div>
              <div className="rounded-[20px] border-2 border-[rgba(24,20,14,0.18)] bg-[var(--shock-paper)] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.5)]">最近讨论</p>
                <p className="mt-2 text-sm font-semibold">{recentRoom?.title || "还没有讨论间"}</p>
                <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                  {recentRoom ? recentRoom.summary : "先在聊天或设置里起一个新任务。"}
                </p>
              </div>
              <div className="rounded-[20px] border-2 border-[rgba(24,20,14,0.18)] bg-[var(--shock-paper)] px-4 py-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.5)]">当前运行</p>
                <p className="mt-2 text-sm font-semibold">{liveRun ? `${liveRun.status} · ${liveRun.owner}` : "没有进行中的运行"}</p>
                <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                  {liveRun ? liveRun.nextAction : "需要时再从讨论间或任务板发起。"}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Link
                className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm font-semibold shadow-[3px_3px_0_0_var(--shock-ink)]"
                href={actionableInbox[0]?.href || "/mailbox"}
              >
                {actionableInbox.length > 0 ? "处理待办交接" : "打开交接列表"}
              </Link>
              <Link
                className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 text-sm font-semibold shadow-[3px_3px_0_0_var(--shock-ink)]"
                href={githubReady ? "/settings" : "/setup"}
              >
                {githubReady ? "检查默认设置" : "补齐支撑设置"}
              </Link>
            </div>
          </details>
        )}
      </div>
    </main>
  );
}
