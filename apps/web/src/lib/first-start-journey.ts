import type { AuthSession, WorkspaceSnapshot } from "@/lib/phase-zero-types";

export type FirstStartJourneyStepStatus = "pending" | "active" | "ready";

export type FirstStartJourneyStep = {
  id: "session" | "identity" | "setup";
  label: string;
  status: FirstStartJourneyStepStatus;
  summary: string;
  href: string;
};

export type FirstStartJourney = {
  accessReady: boolean;
  onboardingDone: boolean;
  onboardingStarted: boolean;
  nextHref: string;
  nextLabel: string;
  nextSummary: string;
  launchHref: string;
  steps: FirstStartJourneyStep[];
};

function normalized(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function sessionIsActive(session: AuthSession) {
  return normalized(session.status) === "active";
}

function emailVerificationReady(session: AuthSession) {
  return normalized(session.emailVerificationStatus) !== "pending";
}

function deviceAuthorizationReady(session: AuthSession) {
  return normalized(session.deviceAuthStatus) !== "pending";
}

function onboardingIsDone(workspace: WorkspaceSnapshot) {
  if (normalized(workspace.onboarding.status) === "done") {
    return true;
  }
  if (workspace.onboarding.currentStep?.trim() === "bootstrap-finished") {
    return true;
  }
  return (workspace.onboarding.completedSteps ?? []).some((step) => step.trim() === "bootstrap-finished");
}

function onboardingIsStarted(workspace: WorkspaceSnapshot) {
  return normalized(workspace.onboarding.status) !== "not_started";
}

function onboardingStatusLabel(workspace: WorkspaceSnapshot) {
  switch (normalized(workspace.onboarding.status)) {
    case "done":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "not_started":
      return "未开始";
    default:
      return workspace.onboarding.status?.trim() || "未开始";
  }
}

function setupResumeHref(workspace: WorkspaceSnapshot) {
  const resume = workspace.onboarding.resumeUrl?.trim();
  if (resume) {
    return resume;
  }
  const template = workspace.onboarding.templateId?.trim();
  if (template) {
    return `/onboarding?template=${template}`;
  }
  return "/onboarding";
}

function onboardingTemplateLabel(workspace: WorkspaceSnapshot) {
  switch (normalized(workspace.onboarding.templateId)) {
    case "dev-team":
      return "开发团队";
    case "research-team":
      return "研究团队";
    case "blank-custom":
      return "空白开始";
    default:
      return workspace.onboarding.templateId?.trim() || "未选模板";
  }
}

function launchHref(session: AuthSession) {
  const preferred = session.preferences.startRoute?.trim();
  if (preferred && preferred !== "/access" && preferred !== "/setup" && preferred !== "/onboarding") {
    return preferred;
  }
  return "/chat/all";
}

function accessSummary(session: AuthSession) {
  if (!sessionIsActive(session)) {
    return "先输入邮箱进入工作区。";
  }
  return `你已经以 ${session.email?.trim() || "当前成员"} 身份进入工作区。`;
}

function identitySummary(session: AuthSession) {
  if (!sessionIsActive(session)) {
    return "先进入工作区，再确认邮箱和当前设备。";
  }
  if (!emailVerificationReady(session)) {
    return "先确认邮箱，再继续配置工作区。";
  }
  if (!deviceAuthorizationReady(session)) {
    return "先确认这台设备，再继续配置工作区。";
  }
  return "邮箱和当前设备都已确认，可以继续。";
}

function setupSummary(workspace: WorkspaceSnapshot) {
  if (onboardingIsDone(workspace)) {
    return `工作区已经准备好，下一步会进入 ${setupResumeHref(workspace)}。`;
  }

  const template = onboardingTemplateLabel(workspace);
  return `当前模板为 ${template}，进度为 ${onboardingStatusLabel(workspace)}。完成模板、仓库和运行环境设置后即可进入工作区。`;
}

export function buildFirstStartJourney(workspace: WorkspaceSnapshot, session: AuthSession): FirstStartJourney {
  const activeSession = sessionIsActive(session);
  const identityReady = activeSession && emailVerificationReady(session) && deviceAuthorizationReady(session);
  const onboardingDone = onboardingIsDone(workspace);
  const onboardingStarted = onboardingIsStarted(workspace);
  const resumeHref = setupResumeHref(workspace);
  const finalLaunchHref = launchHref(session);

  let nextHref = resumeHref;
  let nextLabel = onboardingStarted ? "继续引导" : "开始引导";
  let nextSummary = "向导会先帮你进入工作区，再完成模板、仓库、运行环境和智能体设置。";

  if (!activeSession) {
    nextHref = "/access";
    nextLabel = "先登录";
    nextSummary = "先在账号页进入工作区，再继续模板、仓库、运行环境和智能体设置。";
  } else if (!emailVerificationReady(session) || !deviceAuthorizationReady(session)) {
    nextHref = "/access";
    nextLabel = "确认邮箱和设备";
    nextSummary = "先在账号页确认邮箱和这台设备，再继续工作区设置。";
  } else if (onboardingDone) {
    nextHref = finalLaunchHref;
    nextLabel = "进入聊天";
    nextSummary = `工作区已经准备好，直接进入 ${finalLaunchHref}。`;
  } else {
    nextHref = resumeHref;
    nextLabel = onboardingStarted ? "继续引导" : "开始引导";
    nextSummary = "下一步在向导里完成模板、仓库、运行环境和智能体设置，然后即可进入工作区。";
  }

  const steps: FirstStartJourneyStep[] = [
    {
      id: "session",
      label: "进入工作区",
      status: activeSession ? "ready" : "active",
      summary: accessSummary(session),
      href: "/access",
    },
    {
      id: "identity",
      label: "确认邮箱和设备",
      status: identityReady ? "ready" : activeSession ? "active" : "pending",
      summary: identitySummary(session),
      href: "/access",
    },
    {
      id: "setup",
      label: "配置工作区",
      status: onboardingDone ? "ready" : identityReady ? "active" : "pending",
      summary: setupSummary(workspace),
      href: onboardingDone ? finalLaunchHref : resumeHref,
    },
  ];

  return {
    accessReady: identityReady,
    onboardingDone,
    onboardingStarted,
    nextHref,
    nextLabel,
    nextSummary,
    launchHref: finalLaunchHref,
    steps,
  };
}
