"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";

import { StitchChannelsView } from "@/components/stitch-chat-room-views";
import { buildWorkspaceContinueTarget } from "@/lib/continue-target";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { useLiveRuntimeTruth } from "@/lib/live-runtime";
import type { AgentStatus, RuntimeRegistryRecord, RuntimeProviderStatus } from "@/lib/phase-zero-types";
import { runtimeProviderBlockingReason, runtimeProviderHealthLabel, runtimeProviderHealthStatus, runtimeProviderHealthSummary, runtimeProviderHealthTone } from "@/lib/runtime-provider-health";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";

type WizardStep = {
  id: "account" | "template" | "github" | "repo" | "runtime" | "agent" | "finish";
  label: string;
  summary: string;
  optional?: boolean;
};

const WIZARD_STEPS: readonly WizardStep[] = [
  {
    id: "account",
    label: "账号",
    summary: "创建当前工作区账号。",
  },
  {
    id: "template",
    label: "模板",
    summary: "确认推荐模板，之后随时能改。",
    optional: true,
  },
  {
    id: "github",
    label: "连接 GitHub",
    summary: "可选，之后也能再接。",
    optional: true,
  },
  {
    id: "repo",
    label: "仓库",
    summary: "确认当前仓库和分支。",
  },
  {
    id: "runtime",
    label: "运行环境",
    summary: "选择默认执行机器。",
  },
  {
    id: "agent",
    label: "智能体",
    summary: "默认已准备好，需要时再改。",
    optional: true,
  },
  {
    id: "finish",
    label: "完成",
    summary: "确认后进入工作区。",
  },
] as const;

const TEMPLATE_OPTIONS = [
  {
    id: "dev-team",
    label: "开发团队",
    eyebrow: "推荐",
    description: "适合产品、开发、评审和测试协作的标准交付流程。",
  },
  {
    id: "research-team",
    label: "研究团队",
    eyebrow: "研究",
    description: "适合资料收集、分析整理和结论沉淀。",
  },
  {
    id: "blank-custom",
    label: "空白开始",
    eyebrow: "自定义",
    description: "从最小配置开始，后续按需要逐步补充。",
  },
] as const;

const AVATAR_OPTIONS = [
  { id: "starter-spark", label: "启动火花" },
  { id: "builder-lantern", label: "构建提灯" },
  { id: "review-orbit", label: "评审轨道" },
  { id: "research-wave", label: "研究波纹" },
] as const;

type WizardStepID = WizardStep["id"];
const START_NOW_STEP_IDS = new Set<WizardStepID>(["account", "repo", "runtime"]);
const LATER_STEP_IDS = new Set<WizardStepID>(["template", "github", "agent"]);

type RepoBindingResponse = {
  repo: string;
  repoUrl: string;
  branch: string;
  bindingStatus: string;
  authMode: string;
  connectionMessage: string;
};

type GitHubConnectionResponse = {
  ready: boolean;
  appInstalled: boolean;
  installationUrl?: string;
  message: string;
};

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrFallback(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function friendlyUiError(message: string) {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("workspace member not found")) {
    return "还没有找到当前账号，请先完成创建账号。";
  }
  return message;
}

function stepIndex(stepID: WizardStepID) {
  return WIZARD_STEPS.findIndex((step) => step.id === stepID);
}

function stepTone(done: boolean, active: boolean) {
  if (done) {
    return "bg-[rgba(109,255,139,0.68)]";
  }
  if (active) {
    return "bg-[rgba(255,213,0,0.68)]";
  }
  return "bg-white/70";
}

function stepStatusLabel(done: boolean, active: boolean) {
  if (done) {
    return "已完成";
  }
  if (active) {
    return "进行中";
  }
  return "待开始";
}

function pairingReady(status: string | undefined) {
  return (status ?? "").trim() === "paired";
}

function sessionReady(status: string | undefined, emailStatus: string | undefined, deviceStatus: string | undefined) {
  return status === "active" && emailStatus === "verified" && deviceStatus === "authorized";
}

function findStarterAgent(agents: AgentStatus[]) {
  return agents[0] ?? null;
}

function preferredRuntimeLabel(runtime: RuntimeRegistryRecord | null) {
  if (!runtime) {
    return "等待识别";
  }
  return runtime.machine || runtime.id;
}

function runtimeStateLabel(state: string | undefined) {
  switch ((state ?? "").trim()) {
    case "online":
      return "在线";
    case "busy":
      return "忙碌";
    case "stale":
      return "心跳陈旧";
    case "offline":
      return "离线";
    default:
      return valueOrFallback(state, "等待识别");
  }
}

function providerCatalog(runtime: RuntimeRegistryRecord | null, agent: AgentStatus | null) {
  const providers = runtime?.providers ?? [];
  if (providers.length > 0) {
    return providers;
  }
  if (!agent) {
    return [];
  }
  return [
    {
      id: agent.providerPreference || "codex",
      label: agent.provider || agent.providerPreference || "默认模型服务",
      mode: "local",
      capabilities: [],
      models: agent.modelPreference ? [agent.modelPreference] : [],
      transport: "local",
    },
  ] satisfies RuntimeProviderStatus[];
}

function derivedCurrentStep({
  accessReady,
  templateReady,
  githubReady,
  repoReady,
  runtimeReady,
  agentReady,
}: {
  accessReady: boolean;
  templateReady: boolean;
  githubReady: boolean;
  repoReady: boolean;
  runtimeReady: boolean;
  agentReady: boolean;
}): WizardStepID {
  if (!accessReady) {
    return "account";
  }
  if (!templateReady) {
    return "template";
  }
  if (!githubReady) {
    return "github";
  }
  if (!repoReady) {
    return "repo";
  }
  if (!runtimeReady) {
    return "runtime";
  }
  if (!agentReady) {
    return "agent";
  }
  return "finish";
}

function mapLegacyOnboardingStep(currentStep: string | undefined): WizardStepID | null {
  switch ((currentStep ?? "").trim()) {
    case "account":
      return "account";
    case "template":
    case "template-selected":
      return "template";
    case "github":
    case "github-ready":
      return "github";
    case "repo":
    case "repo-bound":
      return "repo";
    case "runtime":
    case "runtime-paired":
      return "runtime";
    case "agent":
    case "agent-configured":
      return "agent";
    case "finish":
    case "bootstrap-finished":
      return "finish";
    default:
      return null;
  }
}

function surfaceStepFromWorkspace(currentStep: string | undefined, fallback: WizardStepID) {
  return mapLegacyOnboardingStep(currentStep) ?? fallback;
}

function isFreshPlaceholderMember(source: string | undefined, onboardingStatus: string | undefined, sessionStatus: string | undefined) {
  return source === "fresh-bootstrap" && onboardingStatus === "not_started" && sessionStatus !== "active";
}

function WizardCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[rgba(24,20,14,0.14)] bg-white/72 px-5 py-5 shadow-[0_24px_60px_rgba(24,20,14,0.12)] backdrop-blur-xl sm:px-6">
      <div className="max-w-3xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[color:rgba(24,20,14,0.48)]">首次设置</p>
        <h2 className="mt-2 font-display text-[28px] font-bold leading-8 text-[var(--shock-ink)] sm:text-[34px] sm:leading-9">
          {title}
        </h2>
        <p className="mt-3 text-[15px] leading-7 text-[color:rgba(24,20,14,0.72)]">{description}</p>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function OnboardingExperience() {
  return (
    <div className="relative h-[100dvh] min-h-[100dvh] overflow-hidden bg-[var(--shock-paper)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 scale-[1.015] blur-[5px] saturate-[0.88] brightness-[0.95]"
      >
        <Suspense fallback={null}>
          <StitchChannelsView channelId="all" />
        </Suspense>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.38),rgba(255,248,230,0.8)_52%,rgba(24,20,14,0.16))]" />
      <div className="relative z-10 flex h-full min-h-0 items-center justify-center px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
        <OnboardingWizard />
      </div>
    </div>
  );
}

function OnboardingWizard() {
  const router = useRouter();
  const {
    state,
    approvalCenter,
    refresh,
    loginAuthSession,
    verifyMemberEmail,
    authorizeAuthDevice,
    updateWorkspaceConfig,
    updateWorkspaceMemberPreferences,
    updateAgentProfile,
  } = usePhaseZeroState();
  const {
    runtimes,
    selectedRuntimeName,
    selectedRuntimeRecord,
    pairing,
    pairRuntime,
    selectRuntime,
    runtimeActionLoading,
    refreshing: runtimeRefreshing,
  } = useLiveRuntimeTruth();

  const starterAgent = findStarterAgent(state.agents);
  const currentMember =
    state.auth.members.find((member) => member.id === state.auth.session.memberId) ?? state.auth.members[0] ?? null;
  const workspaceContinue = buildWorkspaceContinueTarget(state, {
    approvalSignals: approvalCenter.signals,
    preferLaunchWhenIdle: true,
  });
  const journey = workspaceContinue.journey;
  const continueTarget = workspaceContinue.target;
  const finishDestination = continueTarget.source === "journey" ? journey.launchHref : continueTarget.href;
  const completedSteps = useMemo(
    () => new Set((state.workspace.onboarding.completedSteps ?? []).map((item) => item.trim()).filter(Boolean)),
    [state.workspace.onboarding.completedSteps]
  );

  const accessReady = sessionReady(
    state.auth.session.status,
    state.auth.session.emailVerificationStatus,
    state.auth.session.deviceAuthStatus
  );
  const templateReady = completedSteps.has("template-selected");
  const githubReady = completedSteps.has("github-choice") || state.workspace.githubInstallation.connectionReady;
  const repoReady = state.workspace.repoBindingStatus === "bound";
  const runtimeReady = pairingReady(state.workspace.pairingStatus);
  const agentReady = completedSteps.has("agent-configured");
  const naturalStep = derivedCurrentStep({
    accessReady,
    templateReady,
    githubReady,
    repoReady,
    runtimeReady,
    agentReady,
  });
  const blankFreshIdentity = isFreshPlaceholderMember(
    currentMember?.source,
    state.workspace.onboarding.status,
    state.auth.session.status
  );

  const [currentStep, setCurrentStep] = useState<WizardStepID>(() =>
    surfaceStepFromWorkspace(state.workspace.onboarding.currentStep, naturalStep)
  );
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState(
    state.auth.session.email ?? (blankFreshIdentity ? "" : currentMember?.email ?? "")
  );
  const [accountName, setAccountName] = useState(
    state.auth.session.name ?? (blankFreshIdentity ? "" : currentMember?.name ?? "")
  );
  const [deviceLabel, setDeviceLabel] = useState(state.auth.session.deviceLabel ?? "当前浏览器");
  const [selectedTemplate, setSelectedTemplate] = useState(
    valueOrFallback(state.workspace.onboarding.templateId, "blank-custom")
  );
  const [repoNameDraft, setRepoNameDraft] = useState(state.workspace.repo || "");
  const [repoUrlDraft, setRepoUrlDraft] = useState(state.workspace.repoUrl || "");
  const [repoBranchDraft, setRepoBranchDraft] = useState(state.workspace.branch || "main");
  const [runtimeChoice, setRuntimeChoice] = useState(valueOrFallback(selectedRuntimeName, runtimes[0]?.id ?? ""));
  const [daemonUrl, setDaemonUrl] = useState(
    valueOrFallback(pairing?.daemonUrl, selectedRuntimeRecord?.daemonUrl || "http://127.0.0.1:8090")
  );
  const [agentName, setAgentName] = useState(starterAgent?.name ?? "启动智能体");
  const [agentRole, setAgentRole] = useState(starterAgent?.role ?? "工作区搭建");
  const [agentAvatar, setAgentAvatar] = useState(starterAgent?.avatar ?? AVATAR_OPTIONS[0].id);
  const [agentPrompt, setAgentPrompt] = useState(
    starterAgent?.prompt ?? "先理解当前工作区，再按频道和房间的上下文推进任务。"
  );
  const [providerPreference, setProviderPreference] = useState(starterAgent?.providerPreference ?? "codex");
  const [modelPreference, setModelPreference] = useState(starterAgent?.modelPreference ?? "");

  const runtimeOptions = useMemo(() => {
    return (runtimes.length > 0 ? runtimes : state.runtimes).filter((runtime) => runtime.daemonUrl || runtime.machine || runtime.id);
  }, [runtimes, state.runtimes]);

  const chosenRuntime =
    runtimeOptions.find((runtime) => runtime.id === runtimeChoice || runtime.machine === runtimeChoice) ??
    selectedRuntimeRecord ??
    runtimeOptions[0] ??
    null;
  const providerOptions = useMemo(
    () => providerCatalog(chosenRuntime, starterAgent),
    [chosenRuntime, starterAgent]
  );
  const runtimeProviderBoundary = useMemo(
    () => runtimeProviderBlockingReason(chosenRuntime?.providers ?? []),
    [chosenRuntime?.providers]
  );
  const selectedProvider =
    providerOptions.find((provider) => provider.id === providerPreference) ?? providerOptions[0] ?? null;
  const selectedProviderModels = useMemo(() => selectedProvider?.models ?? [], [selectedProvider]);

  useEffect(() => {
    if (!state.auth.session.email && currentMember?.email && !blankFreshIdentity) {
      setAccountEmail(currentMember.email);
    }
  }, [blankFreshIdentity, currentMember?.email, state.auth.session.email]);

  useEffect(() => {
    if (!state.auth.session.name && currentMember?.name && !blankFreshIdentity) {
      setAccountName(currentMember.name);
    }
  }, [blankFreshIdentity, currentMember?.name, state.auth.session.name]);

  useEffect(() => {
    setSelectedTemplate(valueOrFallback(state.workspace.onboarding.templateId, "blank-custom"));
  }, [state.workspace.onboarding.templateId]);

  useEffect(() => {
    if (state.workspace.repo) {
      setRepoNameDraft(state.workspace.repo);
    }
    if (state.workspace.repoUrl) {
      setRepoUrlDraft(state.workspace.repoUrl);
    }
    if (state.workspace.branch) {
      setRepoBranchDraft(state.workspace.branch);
    }
  }, [state.workspace.branch, state.workspace.repo, state.workspace.repoUrl]);

  useEffect(() => {
    setRuntimeChoice((current) => {
      if (current && runtimeOptions.some((runtime) => runtime.id === current || runtime.machine === current)) {
        return current;
      }
      return valueOrFallback(selectedRuntimeName, runtimeOptions[0]?.id ?? "");
    });
  }, [runtimeOptions, selectedRuntimeName]);

  useEffect(() => {
    const nextURL = pairing?.daemonUrl || chosenRuntime?.daemonUrl || "http://127.0.0.1:8090";
    setDaemonUrl(nextURL);
  }, [chosenRuntime?.daemonUrl, pairing?.daemonUrl]);

  useEffect(() => {
    if (!starterAgent) {
      return;
    }
    setAgentName(starterAgent.name);
    setAgentRole(starterAgent.role);
    setAgentAvatar(starterAgent.avatar);
    setAgentPrompt(starterAgent.prompt);
  }, [starterAgent]);

  useEffect(() => {
    if (providerOptions.length === 0) {
      return;
    }
    if (!providerOptions.some((provider) => provider.id === providerPreference)) {
      setProviderPreference(providerOptions[0].id);
    }
  }, [providerOptions, providerPreference]);

  useEffect(() => {
    if (selectedProviderModels.length === 0) {
      if (!modelPreference && starterAgent?.modelPreference) {
        setModelPreference(starterAgent.modelPreference);
      }
      return;
    }
    if (!selectedProviderModels.includes(modelPreference)) {
      setModelPreference(selectedProviderModels[0]);
    }
  }, [modelPreference, selectedProviderModels, starterAgent?.modelPreference]);

  useEffect(() => {
    const resumeTarget = surfaceStepFromWorkspace(state.workspace.onboarding.currentStep, naturalStep);
    setCurrentStep((current) => {
      return stepIndex(current) < stepIndex(resumeTarget) ? resumeTarget : current;
    });
  }, [naturalStep, state.workspace.onboarding.currentStep]);

  useEffect(() => {
    if (state.workspace.onboarding.status === "done") {
      router.replace(finishDestination);
    }
  }, [finishDestination, router, state.workspace.onboarding.status]);

  async function persistOnboardingProgress({
    nextStep,
    addCompleted,
    status = "in_progress",
    done = false,
  }: {
    nextStep: WizardStepID;
    addCompleted?: string[];
    status?: string;
    done?: boolean;
  }) {
    const mergedCompletedSteps = uniqueStrings([
      ...(state.workspace.onboarding.completedSteps ?? []),
      ...(addCompleted ?? []),
    ]);

    await updateWorkspaceConfig({
      plan: state.workspace.plan,
      browserPush: state.workspace.browserPush,
      memoryMode: state.workspace.memoryMode,
      sandbox: state.workspace.sandbox,
      onboarding: {
        status: done ? "done" : status,
        templateId: selectedTemplate,
        currentStep: nextStep,
        completedSteps: done ? uniqueStrings([...mergedCompletedSteps, "bootstrap-finished"]) : mergedCompletedSteps,
        resumeUrl: done ? finishDestination : "/setup",
      },
    });
  }

  async function withMutation(task: () => Promise<void>, successMessage?: string) {
    setBusy(true);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await task();
      if (successMessage) {
        setMutationSuccess(successMessage);
      }
    } catch (error) {
      setMutationError(error instanceof Error ? friendlyUiError(error.message) : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withMutation(async () => {
      const email = accountEmail.trim();
      if (!accessReady) {
        await loginAuthSession({
          email,
          name: accountName.trim(),
          deviceLabel: deviceLabel.trim() || "当前浏览器",
        });
        await verifyMemberEmail({ email });
        await authorizeAuthDevice({ deviceLabel: deviceLabel.trim() || "当前浏览器" });
      }
      const nextStep = derivedCurrentStep({
        accessReady: true,
        templateReady,
        githubReady,
        repoReady,
        runtimeReady,
        agentReady,
      });
      await persistOnboardingProgress({
        nextStep,
        addCompleted: ["account-ready"],
      });
      setCurrentStep(nextStep);
    }, "账号已创建。");
  }

  async function handleTemplateSelect(templateID: string) {
    await withMutation(async () => {
      setSelectedTemplate(templateID);
      await updateWorkspaceConfig({
        plan: state.workspace.plan,
        browserPush: state.workspace.browserPush,
        memoryMode: state.workspace.memoryMode,
        sandbox: state.workspace.sandbox,
        onboarding: {
          status: "in_progress",
          templateId: templateID,
          currentStep: "github",
          completedSteps: uniqueStrings([
            ...(state.workspace.onboarding.completedSteps ?? []),
            "account-ready",
            "template-selected",
          ]),
          resumeUrl: "/setup",
        },
      });
      setCurrentStep("github");
    }, "模板已保存。");
  }

  async function handleRefreshGitHub() {
    await withMutation(async () => {
      const response = await fetch(`${API_BASE}/v1/github/connection`, { cache: "no-store" });
      const payload = (await response.json()) as GitHubConnectionResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `GitHub 连接失败：${response.status}`);
      }
      await refresh();
      if (payload.ready) {
        await persistOnboardingProgress({
          nextStep: "repo",
          addCompleted: ["github-choice"],
        });
        setCurrentStep("repo");
      }
    }, state.workspace.githubInstallation.connectionReady ? "GitHub 已连接。" : "GitHub 状态已刷新。");
  }

  async function handleSkipGitHub() {
    await withMutation(async () => {
      await persistOnboardingProgress({
        nextStep: "repo",
        addCompleted: ["github-choice"],
      });
      setCurrentStep("repo");
    }, "GitHub 已跳过。");
  }

  async function submitRepoBinding(input?: { repo?: string; repoUrl?: string; branch?: string }) {
    const response = await fetch(`${API_BASE}/v1/repo/binding`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input ?? {}),
    });

    const payload = (await response.json()) as {
      error?: string;
      binding?: RepoBindingResponse;
      state?: unknown;
    };

    if (!response.ok) {
      throw new Error(payload.error || `仓库识别失败：${response.status}`);
    }

    await refresh();
  }

  async function handleDetectCurrentRepo() {
    await withMutation(async () => {
      await submitRepoBinding();
      await persistOnboardingProgress({
        nextStep: "runtime",
        addCompleted: ["repo-bound"],
      });
      setCurrentStep("runtime");
    }, "仓库已识别。");
  }

  async function handleManualRepoBinding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withMutation(async () => {
      await submitRepoBinding({
        repo: repoNameDraft.trim(),
        repoUrl: repoUrlDraft.trim(),
        branch: repoBranchDraft.trim() || "main",
      });
      await persistOnboardingProgress({
        nextStep: "runtime",
        addCompleted: ["repo-bound"],
      });
      setCurrentStep("runtime");
    }, "仓库信息已保存。");
  }

  async function handlePairRuntime() {
    await withMutation(async () => {
      if (chosenRuntime?.machine && chosenRuntime.machine !== selectedRuntimeName && chosenRuntime.id !== selectedRuntimeName) {
        await selectRuntime(chosenRuntime.machine);
      }
      await pairRuntime(daemonUrl.trim() || chosenRuntime?.daemonUrl || "http://127.0.0.1:8090", chosenRuntime?.id);
      const nextStep: WizardStepID = starterAgent ? "finish" : "agent";
      await persistOnboardingProgress({
        nextStep,
        addCompleted: starterAgent ? ["runtime-paired", "agent-configured"] : ["runtime-paired"],
      });
      setCurrentStep(nextStep);
    }, starterAgent ? "运行环境已连接，默认智能体已就绪。" : "运行环境已连接。");
  }

  async function handleSaveAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withMutation(async () => {
      if (!starterAgent) {
        throw new Error("未找到可配置的默认智能体。");
      }
      await updateAgentProfile(starterAgent.id, {
        name: agentName.trim(),
        role: agentRole.trim(),
        avatar: agentAvatar,
        prompt: agentPrompt.trim(),
        operatingInstructions: starterAgent.operatingInstructions,
        providerPreference,
        modelPreference,
        recallPolicy: starterAgent.recallPolicy,
        runtimePreference: chosenRuntime?.machine || chosenRuntime?.id || starterAgent.runtimePreference,
        memorySpaces: starterAgent.memorySpaces,
        credentialProfileIds: starterAgent.credentialProfileIds ?? [],
        sandbox: starterAgent.sandbox,
      });
      await persistOnboardingProgress({
        nextStep: "finish",
        addCompleted: ["agent-configured"],
      });
      setCurrentStep("finish");
    }, "智能体配置已保存。");
  }

  async function handleFinish() {
    await withMutation(async () => {
      if (!accessReady) {
        setCurrentStep("account");
        throw new Error("先完成账号创建，再进入工作区。");
      }
      if (!repoReady) {
        setCurrentStep("repo");
        throw new Error("先绑定当前仓库，再进入工作区。");
      }
      if (!runtimeReady) {
        setCurrentStep("runtime");
        throw new Error("先连接运行环境，再进入工作区。");
      }
      if (currentMember) {
        await updateWorkspaceMemberPreferences(currentMember.id, {
          preferredAgentId: starterAgent?.id ?? currentMember.preferences.preferredAgentId ?? "",
          startRoute: currentMember.preferences.startRoute?.trim() || journey.launchHref,
          githubHandle: currentMember.githubIdentity?.handle ?? "",
        });
      }
      await persistOnboardingProgress({
        nextStep: "finish",
        addCompleted: ["account-ready", "template-selected", "github-choice", "repo-bound", "runtime-paired", "agent-configured"],
        done: true,
      });
      router.push(finishDestination);
    }, "设置完成，正在进入工作区。");
  }

  function goBack() {
    const previousIndex = Math.max(0, stepIndex(currentStep) - 1);
    setCurrentStep(WIZARD_STEPS[previousIndex].id);
  }

  const canGoBack = stepIndex(currentStep) > 0;
  const canOpenGitHubInstall = Boolean(state.workspace.githubInstallation.installationUrl?.trim());
  const backgroundWorkspaceRoot = valueOrFallback(chosenRuntime?.workspaceRoot, "当前目录将在运行环境接通后显示");
  const startNowSteps = WIZARD_STEPS.filter((step) => START_NOW_STEP_IDS.has(step.id));
  const laterSteps = WIZARD_STEPS.filter((step) => LATER_STEP_IDS.has(step.id));
  const finishStep = WIZARD_STEPS.find((step) => step.id === "finish") ?? WIZARD_STEPS[WIZARD_STEPS.length - 1];
  const finishReady = accessReady && repoReady && runtimeReady;
  const onboardingDone = state.workspace.onboarding.status === "done";

  function canOpenStep(stepID: WizardStepID) {
    if (stepID === "finish") {
      return finishReady || state.workspace.onboarding.status === "done";
    }
    return stepIndex(stepID) <= stepIndex(naturalStep);
  }

  function openStep(stepID: WizardStepID) {
    if (!canOpenStep(stepID)) {
      return;
    }
    setCurrentStep(stepID);
  }

  let content: React.ReactNode = null;

  if (currentStep === "account") {
    content = (
      <WizardCard title="创建账号" description="填写邮箱、显示名和设备名称，然后进入下一步。">
        <form onSubmit={handleAccountSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">邮箱</span>
              <input
                data-testid="onboarding-account-email"
                type="email"
                value={accountEmail}
                onChange={(event) => setAccountEmail(event.target.value)}
                className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                placeholder="例如：你的邮箱@公司域名"
                required
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">显示名（可选）</span>
              <input
                data-testid="onboarding-account-name"
                type="text"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                placeholder="比如：Lark"
              />
            </label>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">设备名称（可选）</span>
            <input
              data-testid="onboarding-account-device"
              type="text"
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
              placeholder="比如：办公电脑"
            />
          </label>
          <div className="grid gap-3 rounded-[20px] border border-[rgba(24,20,14,0.1)] bg-[rgba(255,248,230,0.76)] p-4 md:grid-cols-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">当前状态</p>
              <p className="mt-2 text-sm leading-6">{accessReady ? "已准备好" : "等待创建"}</p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">邮箱确认</p>
              <p className="mt-2 text-sm leading-6">
                {state.auth.session.emailVerificationStatus === "verified" ? "已确认" : "将自动确认"}
              </p>
            </div>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">当前设备</p>
              <p className="mt-2 text-sm leading-6">
                {state.auth.session.deviceAuthStatus === "authorized" ? "已授权" : "将自动授权"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              data-testid="onboarding-account-submit"
              type="submit"
              disabled={busy}
              className="min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 font-mono text-[11px] uppercase tracking-[0.18em] shadow-[var(--shock-shadow-sm)] disabled:opacity-60"
            >
              {busy ? "准备中..." : accessReady ? "继续下一步" : "创建并进入"}
            </button>
            <p className="text-sm leading-6 text-[rgba(24,20,14,0.62)]">
              系统会先给你一个推荐模板，确认后随时都能回来修改。
            </p>
          </div>
        </form>
      </WizardCard>
    );
  } else if (currentStep === "template") {
    content = (
      <WizardCard title="确认模板" description="系统会先推荐开发团队，你也可以改成研究或空白。">
        <div className="grid gap-4 lg:grid-cols-3">
          {TEMPLATE_OPTIONS.map((template) => {
            const selected = selectedTemplate === template.id;
            return (
              <button
                key={template.id}
                data-testid={`onboarding-template-${template.id}`}
                type="button"
                onClick={() => void handleTemplateSelect(template.id)}
                disabled={busy}
                className={cn(
                  "rounded-[24px] border px-5 py-5 text-left shadow-[0_16px_32px_rgba(24,20,14,0.08)] transition-transform hover:-translate-y-0.5 disabled:opacity-60",
                  selected
                    ? "border-[var(--shock-ink)] bg-[rgba(255,213,0,0.5)]"
                    : "border-[rgba(24,20,14,0.12)] bg-white/86"
                )}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">
                  {template.eyebrow}
                </p>
                <h3 className="mt-2 font-display text-[24px] font-bold leading-7">{template.label}</h3>
                <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">{template.description}</p>
              </button>
            );
          })}
        </div>
      </WizardCard>
    );
  } else if (currentStep === "github") {
    content = (
      <WizardCard title="连接 GitHub" description="这是可选步骤。连接后可同步仓库和拉取请求，也可以稍后再设置。">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-white/86 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">GitHub 状态</p>
                <h3 className="mt-2 font-display text-[24px] font-bold leading-7">
                  {state.workspace.githubInstallation.connectionReady ? "已连接" : "未连接"}
                </h3>
              </div>
              <span className="rounded-full border border-[rgba(24,20,14,0.14)] bg-[rgba(255,248,230,0.76)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em]">
                {state.workspace.githubInstallation.appInstalled ? "已安装" : "可跳过"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
              {valueOrFallback(state.workspace.githubInstallation.connectionMessage, "可以先跳过，之后再补 GitHub 配置。")}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                data-testid="onboarding-github-refresh"
                type="button"
                onClick={() => void handleRefreshGitHub()}
                disabled={busy}
                className="min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-white px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
              >
                {busy ? "刷新中..." : "刷新 GitHub 状态"}
              </button>
              {canOpenGitHubInstall ? (
                <button
                  data-testid="onboarding-github-open-install"
                  type="button"
                  disabled={busy}
                  onClick={() => window.open(state.workspace.githubInstallation.installationUrl, "_blank", "noopener,noreferrer")}
                  className="min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
                >
                  GitHub 安装页
                </button>
              ) : null}
            </div>
          </div>
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-[rgba(255,248,230,0.76)] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">跳过此步</p>
            <h3 className="mt-2 font-display text-[22px] font-bold leading-7">稍后再连接 GitHub</h3>
            <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
              可以先跳过，之后再到设置页补 GitHub 配置。
            </p>
            <button
              data-testid="onboarding-github-skip"
              type="button"
              onClick={() => void handleSkipGitHub()}
              disabled={busy}
              className="mt-5 min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-white px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              跳过这一步
            </button>
          </div>
        </div>
      </WizardCard>
    );
  } else if (currentStep === "repo") {
    content = (
      <WizardCard title="确认仓库" description="在目标目录中直接读取，否则手动填写仓库地址和分支。">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-white/86 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">当前项目</p>
                  <h3 className="mt-2 font-display text-[24px] font-bold leading-7">
                    {repoReady ? valueOrFallback(state.workspace.repo, "当前仓库") : "自动识别当前仓库"}
                  </h3>
                </div>
                <span className="rounded-full border border-[rgba(24,20,14,0.14)] bg-[rgba(255,248,230,0.76)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em]">
                  {repoReady ? "已绑定" : "待识别"}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                {repoReady
                  ? `当前已绑定 ${valueOrFallback(state.workspace.repoUrl, "仓库地址未返回")}，分支 ${valueOrFallback(state.workspace.branch, "未返回")}。`
                  : "点击后会读取当前目录中的仓库信息。"}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  data-testid="onboarding-repo-detect"
                  type="button"
                  onClick={() => void handleDetectCurrentRepo()}
                  disabled={busy}
                  className="min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
                >
                  {busy ? "读取中..." : "识别当前仓库"}
                </button>
                <p className="text-sm leading-6 text-[rgba(24,20,14,0.62)]">
                  当前目录：{backgroundWorkspaceRoot}
                </p>
              </div>
            </div>
            <form onSubmit={handleManualRepoBinding} className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-white/86 p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">手动填写</p>
              <div className="mt-4 grid gap-3">
                <input
                  data-testid="onboarding-repo-name"
                  type="text"
                  value={repoNameDraft}
                  onChange={(event) => setRepoNameDraft(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                  placeholder="例如：组织名/仓库名"
                  required
                />
                <input
                  data-testid="onboarding-repo-url"
                  type="url"
                  value={repoUrlDraft}
                  onChange={(event) => setRepoUrlDraft(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                  placeholder="例如：https://github.com/组织名/仓库名"
                  required
                />
                <input
                  data-testid="onboarding-repo-branch"
                  type="text"
                  value={repoBranchDraft}
                  onChange={(event) => setRepoBranchDraft(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                  placeholder="例如：main"
                />
              </div>
              <button
                data-testid="onboarding-repo-manual-submit"
                type="submit"
                disabled={busy}
                className="mt-4 min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-white px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
              >
                使用这组仓库信息
              </button>
            </form>
          </div>
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-[rgba(255,248,230,0.76)] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">保存内容</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
              <p>仓库地址、分支和认证方式会写入当前工作区。</p>
              <p>后续从聊天发起任务、执行命令和处理 PR 时，都会使用这组仓库信息。</p>
              <p>如需更换目录或调整绑定规则，可在设置页修改。</p>
            </div>
          </div>
        </div>
      </WizardCard>
    );
  } else if (currentStep === "runtime") {
    content = (
      <WizardCard title="连接运行环境" description="先选一台要默认执行任务的机器，连上后就可以开始。">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-white/86 p-5">
            <div className="grid gap-3">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">选择运行环境</span>
                <select
                  data-testid="onboarding-runtime-select"
                  value={runtimeChoice}
                  onChange={(event) => setRuntimeChoice(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                >
                  {runtimeOptions.map((runtime) => (
                    <option key={runtime.id} value={runtime.machine || runtime.id}>
                      {preferredRuntimeLabel(runtime)} · {runtimeStateLabel(runtime.state)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border border-[rgba(24,20,14,0.1)] bg-[rgba(255,248,230,0.76)] px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">当前选择</p>
                <p className="mt-2 text-sm leading-6">{preferredRuntimeLabel(chosenRuntime)}</p>
              </div>
              <div className="rounded-[18px] border border-[rgba(24,20,14,0.1)] bg-[rgba(255,248,230,0.76)] px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">状态</p>
                <p className="mt-2 text-sm leading-6">{runtimeStateLabel(chosenRuntime?.state)}</p>
              </div>
              <div className="rounded-[18px] border border-[rgba(24,20,14,0.1)] bg-[rgba(255,248,230,0.76)] px-4 py-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">连上后</p>
                <p className="mt-2 text-sm leading-6">任务会默认在这台机器上继续执行。</p>
              </div>
            </div>
            <button
              data-testid="onboarding-runtime-pair"
              type="button"
              onClick={() => void handlePairRuntime()}
              disabled={busy || runtimeActionLoading || runtimeRefreshing || !chosenRuntime}
              className="mt-5 min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busy || runtimeActionLoading ? "连接中..." : "连接这台运行环境"}
            </button>
            <details
              data-testid="onboarding-runtime-advanced"
              className="mt-5 rounded-[18px] border border-[rgba(24,20,14,0.1)] bg-[rgba(255,248,230,0.76)] px-4 py-4"
            >
              <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">
                高级连接信息
              </summary>
              <div className="mt-4 grid gap-3">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">连接地址</span>
                  <input
                    data-testid="onboarding-runtime-daemon-url"
                    type="text"
                    value={daemonUrl}
                    onChange={(event) => setDaemonUrl(event.target.value)}
                    className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                  />
                </label>
                <div className="rounded-[16px] border border-[rgba(24,20,14,0.1)] bg-white/80 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">执行目录</p>
                  <p className="mt-2 break-all text-sm leading-6 text-[rgba(24,20,14,0.72)]">{backgroundWorkspaceRoot}</p>
                </div>
                <div className="rounded-[16px] border border-[rgba(24,20,14,0.1)] bg-white/80 px-4 py-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">模型服务状态</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(chosenRuntime?.providers ?? []).map((provider) => (
                      <span
                        key={`runtime-provider-${provider.id}`}
                        className={cn(
                          "rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                          runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "lime" &&
                            "border-[var(--shock-ink)] bg-[var(--shock-lime)]",
                          runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "yellow" &&
                            "border-[var(--shock-ink)] bg-[var(--shock-yellow)]",
                          runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "pink" &&
                            "border-[var(--shock-ink)] bg-[var(--shock-pink)] text-white",
                          runtimeProviderHealthTone(runtimeProviderHealthStatus(provider)) === "paper" &&
                            "border-[var(--shock-ink)] bg-white"
                        )}
                      >
                        {provider.label} · {runtimeProviderHealthLabel(runtimeProviderHealthStatus(provider))}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                    {(chosenRuntime?.providers ?? []).map((provider) => (
                      <p key={`runtime-provider-summary-${provider.id}`}>{runtimeProviderHealthSummary(provider)}</p>
                    ))}
                  </div>
                  {runtimeProviderBoundary ? (
                    <p className="mt-3 text-sm leading-6 text-[var(--shock-pink)]">{runtimeProviderBoundary}</p>
                  ) : null}
                </div>
              </div>
            </details>
          </div>
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-[rgba(255,248,230,0.76)] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">连接后</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
              <p>创建任务、执行命令和运行智能体时，都会优先使用这台机器。</p>
              <p>如需切换机器或调整调度策略，可在设置页修改。</p>
              <p>先完成默认连接即可。</p>
            </div>
          </div>
        </div>
      </WizardCard>
    );
  } else if (currentStep === "agent") {
    content = (
      <WizardCard title="设置默认智能体" description="设置名称、角色、头像和模型，之后也可以再改。">
        <form onSubmit={handleSaveAgent} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">智能体名称</span>
                <input
                  data-testid="onboarding-agent-name"
                  type="text"
                  value={agentName}
                  onChange={(event) => setAgentName(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                  placeholder="比如：开发搭档"
                  required
                />
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">角色</span>
                <input
                  data-testid="onboarding-agent-role"
                  type="text"
                  value={agentRole}
                  onChange={(event) => setAgentRole(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                  placeholder="比如：开发搭档"
                  required
                />
              </label>
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">工作说明</span>
              <textarea
                data-testid="onboarding-agent-prompt"
                value={agentPrompt}
                onChange={(event) => setAgentPrompt(event.target.value)}
                className="min-h-[180px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 py-3 text-[15px] leading-7 outline-none"
                placeholder="例如：先理解当前讨论目标，再用简洁中文给出下一步动作。"
                required
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
              <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">模型服务</span>
                <select
                  data-testid="onboarding-agent-provider"
                  value={providerPreference}
                  onChange={(event) => setProviderPreference(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                >
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label} · {runtimeProviderHealthLabel(runtimeProviderHealthStatus(provider))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-[rgba(24,20,14,0.72)]">模型</span>
                <select
                  data-testid="onboarding-agent-model"
                  value={modelPreference}
                  onChange={(event) => setModelPreference(event.target.value)}
                  className="min-h-[48px] rounded-[16px] border border-[rgba(24,20,14,0.16)] bg-white/90 px-4 text-[15px] outline-none"
                >
                  {(selectedProviderModels.length > 0 ? selectedProviderModels : [valueOrFallback(modelPreference, "默认模型")]).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedProvider ? (
              <p className="text-sm leading-6 text-[rgba(24,20,14,0.72)]">
                {runtimeProviderHealthSummary(selectedProvider)}
              </p>
            ) : null}
            <button
              data-testid="onboarding-agent-submit"
              type="submit"
              disabled={busy}
              className="min-h-[48px] rounded-[16px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busy ? "保存中..." : "保存并继续"}
            </button>
          </div>
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-[rgba(255,248,230,0.76)] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">头像风格</p>
            <div className="mt-4 grid gap-3">
              {AVATAR_OPTIONS.map((avatar) => {
                const selected = agentAvatar === avatar.id;
                return (
                  <button
                    key={avatar.id}
                    data-testid={`onboarding-agent-avatar-${avatar.id}`}
                    type="button"
                    onClick={() => setAgentAvatar(avatar.id)}
                    className={cn(
                      "rounded-[18px] border px-4 py-3 text-left transition-transform hover:-translate-y-0.5",
                      selected
                        ? "border-[var(--shock-ink)] bg-white"
                        : "border-[rgba(24,20,14,0.12)] bg-white/72"
                    )}
                  >
                    <p className="font-display text-lg font-bold">{avatar.label}</p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.16em] text-[rgba(24,20,14,0.48)]">
                      {avatar.id}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </form>
      </WizardCard>
    );
  } else {
    content = (
      <WizardCard title="确认并进入" description="检查刚才的设置，确认后进入工作区。">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[20px] border border-[rgba(24,20,14,0.12)] bg-white/86 px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">账号</p>
              <p className="mt-2 text-sm leading-6">{valueOrFallback(state.auth.session.email, "未填写")}</p>
            </div>
            <div className="rounded-[20px] border border-[rgba(24,20,14,0.12)] bg-white/86 px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">模板</p>
              <p className="mt-2 text-sm leading-6">
                {TEMPLATE_OPTIONS.find((template) => template.id === selectedTemplate)?.label ?? selectedTemplate}
              </p>
            </div>
            <div className="rounded-[20px] border border-[rgba(24,20,14,0.12)] bg-white/86 px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">仓库</p>
              <p className="mt-2 text-sm leading-6">{valueOrFallback(state.workspace.repo, repoNameDraft || "未填写")}</p>
            </div>
            <div className="rounded-[20px] border border-[rgba(24,20,14,0.12)] bg-white/86 px-4 py-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">运行环境</p>
              <p className="mt-2 text-sm leading-6">{preferredRuntimeLabel(chosenRuntime)}</p>
            </div>
            <div className="rounded-[20px] border border-[rgba(24,20,14,0.12)] bg-white/86 px-4 py-4 md:col-span-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">智能体</p>
              <p className="mt-2 text-sm leading-6">
                {agentName} · {agentRole}
              </p>
            </div>
          </div>
          <div className="rounded-[24px] border border-[rgba(24,20,14,0.12)] bg-[rgba(255,248,230,0.76)] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">进入后</p>
            <div className="mt-4 space-y-3 text-sm leading-6 text-[rgba(24,20,14,0.72)]">
              <p>完成后进入聊天。</p>
              <p>仓库、GitHub、运行环境和智能体配置之后都可以修改。</p>
              <p>首次使用只完成最基本的设置。</p>
            </div>
            <button
              data-testid="onboarding-finish-submit"
              type="button"
              onClick={() => void handleFinish()}
              disabled={busy || onboardingDone || !finishReady}
              className="mt-5 min-h-[48px] w-full rounded-[16px] border border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-5 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-60"
            >
              {busy || onboardingDone ? "正在进入工作区..." : "进入工作区"}
            </button>
          </div>
        </div>
      </WizardCard>
    );
  }

  return (
    <section
      data-testid="onboarding-overlay"
      className="relative z-10 flex h-full min-h-0 w-full max-w-[1180px] flex-col overflow-hidden rounded-[36px] border border-[rgba(24,20,14,0.14)] bg-[rgba(255,251,243,0.58)] shadow-[0_40px_120px_rgba(24,20,14,0.22)] backdrop-blur-2xl"
    >
      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[286px_minmax(0,1fr)]">
        <aside className="border-b border-[rgba(24,20,14,0.1)] bg-[linear-gradient(180deg,rgba(255,255,255,0.54),rgba(255,248,230,0.9))] px-5 py-5 lg:min-h-0 lg:border-b-0 lg:border-r">
          <div className="max-w-[240px]">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[rgba(24,20,14,0.48)]">首次使用</p>
            <h1 className="mt-2 font-display text-[34px] font-bold leading-9 text-[var(--shock-ink)]">
              进入 OpenShock
            </h1>
            <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.68)]">
              通常只要账号、仓库和机器就能开始；GitHub 与更多设置可以稍后补。
            </p>
          </div>
          <div data-testid="onboarding-start-now" className="mt-6 rounded-[20px] border border-[rgba(24,20,14,0.1)] bg-white/72 px-4 py-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.48)]">现在开始只看 3 步</p>
            <p className="mt-2 text-sm leading-6 text-[rgba(24,20,14,0.66)]">先完成账号、仓库和机器，其他配置之后都能再补。</p>
          </div>
          <nav className="mt-4 grid gap-2">
            {startNowSteps.map((step, index) => {
              const done = stepIndex(step.id) < stepIndex(naturalStep) || (step.id === "finish" && state.workspace.onboarding.status === "done");
              const active = currentStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => openStep(step.id)}
                  disabled={!canOpenStep(step.id)}
                  className={cn(
                    "rounded-[20px] border border-[rgba(24,20,14,0.1)] px-4 py-3 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0",
                    stepTone(done, active)
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(24,20,14,0.12)] bg-white/88 font-mono text-[11px] uppercase tracking-[0.1em]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-display text-[18px] font-bold leading-6 text-[var(--shock-ink)]">{step.label}</p>
                        <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(24,20,14,0.56)]">
                          {stepStatusLabel(done, active)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-[rgba(24,20,14,0.62)]">{step.summary}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </nav>
          <details
            data-testid="onboarding-optional-steps"
            className="mt-4 rounded-[20px] border border-[rgba(24,20,14,0.1)] bg-white/72 px-4 py-4"
            open={LATER_STEP_IDS.has(currentStep) || currentStep === "finish"}
          >
            <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.56)]">
              稍后可补
            </summary>
            <p className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.66)]">
              模板、GitHub 和默认智能体不会挡住开始，用到时再回来调整。
            </p>
            <div className="mt-4 grid gap-2">
              {laterSteps.map((step) => {
                const done = stepIndex(step.id) < stepIndex(naturalStep);
                const active = currentStep === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => openStep(step.id)}
                    disabled={!canOpenStep(step.id)}
                    className={cn(
                      "rounded-[18px] border border-[rgba(24,20,14,0.1)] px-4 py-3 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0",
                      stepTone(done, active)
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-display text-[18px] font-bold leading-6 text-[var(--shock-ink)]">{step.label}</p>
                          <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(24,20,14,0.56)]">
                            可选
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-[rgba(24,20,14,0.62)]">{step.summary}</p>
                      </div>
                      <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(24,20,14,0.56)]">
                        {stepStatusLabel(done, active)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </details>
          <button
            type="button"
            onClick={() => openStep(finishStep.id)}
            disabled={!canOpenStep(finishStep.id)}
            className={cn(
              "mt-4 w-full rounded-[20px] border border-[rgba(24,20,14,0.1)] px-4 py-3 text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0",
              stepTone(
                stepIndex(finishStep.id) < stepIndex(naturalStep) || state.workspace.onboarding.status === "done",
                currentStep === finishStep.id
              )
            )}
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[rgba(24,20,14,0.12)] bg-white/88 font-mono text-[11px] uppercase tracking-[0.1em]">
                04
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-display text-[18px] font-bold leading-6 text-[var(--shock-ink)]">{finishStep.label}</p>
                  <span className="rounded-full bg-white/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[rgba(24,20,14,0.56)]">
                    {stepStatusLabel(
                      stepIndex(finishStep.id) < stepIndex(naturalStep) || state.workspace.onboarding.status === "done",
                      currentStep === finishStep.id
                    )}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-5 text-[rgba(24,20,14,0.62)]">确认当前默认值，然后进入工作区。</p>
              </div>
            </div>
          </button>
        </aside>

        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">{content}</div>
          <footer className="border-t border-[rgba(24,20,14,0.1)] bg-white/56 px-4 py-4 backdrop-blur-xl sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  data-testid="onboarding-go-back"
                  type="button"
                  onClick={goBack}
                  disabled={!canGoBack || busy}
                  className="min-h-[44px] rounded-[14px] border border-[var(--shock-ink)] bg-white px-4 font-mono text-[11px] uppercase tracking-[0.18em] disabled:opacity-40"
                >
                  上一步
                </button>
                <Link
                  href="/setup"
                  className="inline-flex min-h-[44px] items-center rounded-[14px] border border-[rgba(24,20,14,0.14)] bg-[rgba(255,248,230,0.76)] px-4 font-mono text-[11px] uppercase tracking-[0.18em]"
                >
                  设置
                </Link>
              </div>
              <details className="max-w-[520px] rounded-[14px] border border-[rgba(24,20,14,0.1)] bg-white/72 px-4 py-2">
                <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.18em] text-[rgba(24,20,14,0.56)]">
                  高级选项
                </summary>
                <div className="mt-3 text-sm leading-6 text-[rgba(24,20,14,0.68)]">
                  包含 GitHub、仓库、运行环境和诊断设置，按需展开即可。
                </div>
              </details>
            </div>
            {mutationError ? (
              <p
                data-testid="onboarding-error"
                className="mt-3 rounded-[14px] border border-[rgba(24,20,14,0.12)] bg-[var(--shock-pink)] px-4 py-3 text-sm text-white"
              >
                {mutationError}
              </p>
            ) : null}
            {mutationSuccess ? (
              <p
                data-testid="onboarding-success"
                className="mt-3 rounded-[14px] border border-[rgba(24,20,14,0.12)] bg-[rgba(109,255,139,0.32)] px-4 py-3 text-sm text-[var(--shock-ink)]"
              >
                {mutationSuccess}
              </p>
            ) : null}
          </footer>
        </div>
      </div>
    </section>
  );
}
