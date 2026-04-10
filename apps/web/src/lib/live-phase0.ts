"use client";

import { createContext, createElement, startTransition, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import type {
  ApprovalCenterState,
  AuthSession,
  InboxDecision,
  PhaseZeroState,
  SandboxDecision,
  SandboxPolicy,
} from "@/lib/phase-zero-types";
import { sanitizePhaseZeroState } from "@/lib/phase-zero-helpers";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "/api/control";
const STATE_STREAM_PATH = "/v1/state/stream";

type CreateIssueInput = {
  title: string;
  summary: string;
  owner: string;
  priority: "critical" | "high" | "medium";
};

type StateMutationResponse = {
  state?: PhaseZeroState;
  error?: string;
  operation?: string;
  roomId?: string;
  output?: string;
  pullRequestId?: string;
  session?: AuthSession;
};

class StateMutationError extends Error {
  payload: StateMutationResponse;
  status: number;

  constructor(message: string, status: number, payload: StateMutationResponse) {
    super(message);
    this.name = "StateMutationError";
    this.payload = payload;
    this.status = status;
  }
}

export type RoomStreamEvent = {
  type: "start" | "stdout" | "stderr" | "done" | "state" | "error";
  provider?: string;
  command?: string[];
  delta?: string;
  output?: string;
  error?: string;
  duration?: string;
  timestamp?: string;
  state?: PhaseZeroState;
};

type UpdatePullRequestInput = {
  status: "draft" | "open" | "in_review" | "changes_requested" | "merged";
};

type RunControlInput = {
  action: "stop" | "resume" | "follow_thread";
  note?: string;
};

type AgentProfileUpdateInput = {
  role: string;
  avatar: string;
  prompt: string;
  operatingInstructions?: string;
  providerPreference: string;
  modelPreference: string;
  recallPolicy: string;
  runtimePreference: string;
  memorySpaces: string[];
  credentialProfileIds: string[];
  sandbox: SandboxPolicy;
};

type CredentialProfileCreateInput = {
  label: string;
  summary: string;
  secretKind: string;
  secretValue: string;
  workspaceDefault: boolean;
};

type CredentialProfileUpdateInput = CredentialProfileCreateInput;

type RunCredentialBindingInput = {
  credentialProfileIds: string[];
};

type WorkspaceConfigUpdateInput = {
  plan: string;
  browserPush: string;
  memoryMode: string;
  sandbox: SandboxPolicy;
  onboarding: {
    status: string;
    templateId: string;
    currentStep: string;
    completedSteps: string[];
    resumeUrl: string;
  };
};

type WorkspaceMemberPreferencesInput = {
  preferredAgentId: string;
  startRoute: string;
  githubHandle: string;
};

type UpdateTopicGuidanceInput = {
  summary: string;
};

type RunSandboxUpdateInput = SandboxPolicy;

type RunSandboxCheckInput = {
  kind: "command" | "network" | "tool";
  target: string;
  override?: boolean;
};

type CreateHandoffInput = {
  roomId: string;
  fromAgentId: string;
  toAgentId: string;
  title: string;
  summary: string;
};

type UpdateHandoffInput = {
  action: "acknowledged" | "blocked" | "completed";
  actingAgentId: string;
  note?: string;
};

type PhaseZeroStreamPresence = {
  onlineMachines: number;
  busyMachines: number;
  runningAgents: number;
  blockedAgents: number;
  activeRuns: number;
  unread: number;
};

type PhaseZeroSnapshotStreamEvent = {
  type: "snapshot";
  sequence: number;
  sentAt: string;
  presence: PhaseZeroStreamPresence;
  state: PhaseZeroState;
};

type PhaseZeroDeltaStreamEvent = {
  type: "delta";
  sequence: number;
  sentAt: string;
  presence: PhaseZeroStreamPresence;
  kinds: string[];
  events: string[];
  delta: Partial<PhaseZeroState>;
};

type PhaseZeroContextValue = {
  state: PhaseZeroState;
  approvalCenter: ApprovalCenterState;
  loading: boolean;
  error: string | null;
  approvalCenterLoading: boolean;
  approvalCenterError: string | null;
  refresh: () => Promise<void>;
  refreshApprovalCenter: () => Promise<void>;
  loginAuthSession: (input: { email: string; name?: string; deviceId?: string; deviceLabel?: string; authMethod?: string }) => Promise<StateMutationResponse>;
  logoutAuthSession: () => Promise<StateMutationResponse>;
  verifyMemberEmail: (input?: { email?: string; memberId?: string }) => Promise<StateMutationResponse>;
  authorizeAuthDevice: (input?: { deviceId?: string; deviceLabel?: string; memberId?: string }) => Promise<StateMutationResponse>;
  requestPasswordReset: (input?: { email?: string; memberId?: string }) => Promise<StateMutationResponse>;
  completePasswordReset: (input?: { email?: string; memberId?: string; deviceId?: string; deviceLabel?: string }) => Promise<StateMutationResponse>;
  bindExternalIdentity: (input: { provider: string; handle: string; email?: string; memberId?: string }) => Promise<StateMutationResponse>;
  inviteWorkspaceMember: (input: { email: string; name?: string; role: string }) => Promise<StateMutationResponse>;
  updateWorkspaceMember: (memberId: string, input: { role?: string; status?: string }) => Promise<StateMutationResponse>;
  updateWorkspaceConfig: (input: WorkspaceConfigUpdateInput) => Promise<StateMutationResponse>;
  updateWorkspaceMemberPreferences: (memberId: string, input: WorkspaceMemberPreferencesInput) => Promise<StateMutationResponse>;
  updateAgentProfile: (agentId: string, input: AgentProfileUpdateInput) => Promise<StateMutationResponse>;
  createCredentialProfile: (input: CredentialProfileCreateInput) => Promise<StateMutationResponse>;
  updateCredentialProfile: (credentialId: string, input: CredentialProfileUpdateInput) => Promise<StateMutationResponse>;
  updateRunCredentialBindings: (runId: string, input: RunCredentialBindingInput) => Promise<StateMutationResponse>;
  updateRunSandbox: (runId: string, input: RunSandboxUpdateInput) => Promise<StateMutationResponse>;
  checkRunSandbox: (runId: string, input: RunSandboxCheckInput) => Promise<StateMutationResponse & { decision?: SandboxDecision }>;
  createIssue: (input: CreateIssueInput) => Promise<StateMutationResponse>;
  postChannelMessage: (channelId: string, prompt: string) => Promise<StateMutationResponse>;
  postDirectMessage: (directMessageId: string, prompt: string) => Promise<StateMutationResponse>;
  updateMessageSurfaceCollection: (input: {
    kind: "followed" | "saved";
    channelId: string;
    messageId: string;
    enabled: boolean;
  }) => Promise<StateMutationResponse>;
  updateTopicGuidance: (topicId: string, input: UpdateTopicGuidanceInput) => Promise<StateMutationResponse>;
  postRoomMessage: (roomId: string, prompt: string, provider?: string) => Promise<StateMutationResponse>;
  streamRoomMessage: (
    roomId: string,
    prompt: string,
    provider?: string,
    onEvent?: (event: RoomStreamEvent) => void
  ) => Promise<RoomStreamEvent | null>;
  createPullRequest: (roomId: string) => Promise<StateMutationResponse>;
  updatePullRequest: (pullRequestId: string, input: UpdatePullRequestInput) => Promise<StateMutationResponse>;
  controlRun: (runId: string, input: RunControlInput) => Promise<StateMutationResponse>;
  applyInboxDecision: (inboxItemId: string, decision: InboxDecision) => Promise<StateMutationResponse>;
  createHandoff: (input: CreateHandoffInput) => Promise<StateMutationResponse>;
  updateHandoff: (handoffId: string, input: UpdateHandoffInput) => Promise<StateMutationResponse>;
};

const EMPTY_PHASE_ZERO_STATE: PhaseZeroState = {
  workspace: {
    name: "",
    repo: "",
    repoUrl: "",
    branch: "",
    repoProvider: "",
    repoBindingStatus: "",
    repoAuthMode: "",
    plan: "",
    quota: {
      usedMachines: 0,
      maxMachines: 0,
      usedAgents: 0,
      maxAgents: 0,
      usedChannels: 0,
      maxChannels: 0,
      usedRooms: 0,
      maxRooms: 0,
      messageHistoryDays: 0,
      runLogDays: 0,
      memoryDraftDays: 0,
      status: "",
      warning: "",
    },
    usage: {
      windowLabel: "",
      totalTokens: 0,
      runCount: 0,
      messageCount: 0,
      refreshedAt: "",
      warning: "",
    },
    pairedRuntime: "",
    pairedRuntimeUrl: "",
    pairingStatus: "",
    deviceAuth: "",
    lastPairedAt: "",
    browserPush: "",
    memoryMode: "",
    sandbox: {
      profile: "trusted",
      allowedHosts: [],
      allowedCommands: [],
      allowedTools: [],
    },
    repoBinding: {
      repo: "",
      repoUrl: "",
      branch: "",
      provider: "",
      bindingStatus: "",
      authMode: "",
    },
    githubInstallation: {
      provider: "",
      connectionReady: false,
      appConfigured: false,
      appInstalled: false,
    },
    onboarding: {
      status: "",
      completedSteps: [],
      materialization: {},
    },
    governance: {
      teamTopology: [],
      handoffRules: [],
      routingPolicy: {
        status: "",
        summary: "",
        defaultRoute: "",
        rules: [],
      },
      escalationSla: {
        status: "",
        summary: "",
        timeoutMinutes: 0,
        retryBudget: 0,
        activeEscalations: 0,
        breachedEscalations: 0,
        nextEscalation: "",
      },
      notificationPolicy: {
        status: "",
        summary: "",
        browserPush: "",
        targets: [],
        escalationChannel: "",
      },
      responseAggregation: {
        status: "",
        summary: "",
        sources: [],
        finalResponse: "",
        aggregator: "",
        decisionPath: [],
        overrideTrace: [],
        auditTrail: [],
      },
      humanOverride: {
        status: "",
        summary: "",
      },
      walkthrough: [],
      stats: {
        openHandoffs: 0,
        blockedEscalations: 0,
        reviewGates: 0,
        humanOverrideGates: 0,
        slaBreaches: 0,
        aggregationSources: 0,
      },
    },
  },
  auth: {
    session: {
      id: "auth-session-current",
      status: "signed_out",
      preferences: {},
      permissions: [],
    },
    roles: [],
    members: [],
  },
  channels: [],
  channelMessages: {},
  directMessages: [],
  directMessageMessages: {},
  followedThreads: [],
  savedLaterItems: [],
  quickSearchEntries: [],
  issues: [],
  rooms: [],
  roomMessages: {},
  runs: [],
  agents: [],
  machines: [],
  runtimes: [],
  inbox: [],
  mailbox: [],
  pullRequests: [],
  sessions: [],
  runtimeLeases: [],
  runtimeScheduler: {
    selectedRuntime: "",
    preferredRuntime: "",
    assignedRuntime: "",
    assignedMachine: "",
    strategy: "unavailable",
    summary: "",
    candidates: [],
  },
  guards: [],
  memory: [],
  credentials: [],
};

const EMPTY_APPROVAL_CENTER_STATE: ApprovalCenterState = {
  openCount: 0,
  approvalCount: 0,
  blockedCount: 0,
  reviewCount: 0,
  unreadCount: 0,
  recentCount: 0,
  signals: [],
  recent: [],
};

const PhaseZeroContext = createContext<PhaseZeroContextValue | null>(null);

async function readJSON<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new StateMutationError(payload.error || `request failed: ${response.status}`, response.status, payload as StateMutationResponse);
  }

  return payload;
}

function mergePhaseZeroState(current: PhaseZeroState, delta: Partial<PhaseZeroState>): PhaseZeroState {
  return sanitizePhaseZeroState({
    ...current,
    ...delta,
  } as PhaseZeroState);
}

function useProvidePhaseZeroState(): PhaseZeroContextValue {
  const [state, setState] = useState<PhaseZeroState>(EMPTY_PHASE_ZERO_STATE);
  const [approvalCenter, setApprovalCenter] = useState<ApprovalCenterState>(EMPTY_APPROVAL_CENTER_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalCenterLoading, setApprovalCenterLoading] = useState(true);
  const [approvalCenterError, setApprovalCenterError] = useState<string | null>(null);

  const commitState = useCallback((next: PhaseZeroState) => {
    const sanitized = sanitizePhaseZeroState(next);
    startTransition(() => {
      setState(sanitized);
      setError(null);
      setLoading(false);
    });
  }, []);

  const commitApprovalCenter = useCallback((next: ApprovalCenterState) => {
    startTransition(() => {
      setApprovalCenter(next);
      setApprovalCenterError(null);
      setApprovalCenterLoading(false);
    });
  }, []);

  const commitRequestError = useCallback((nextError: unknown) => {
    setError(nextError instanceof Error ? nextError.message : "state fetch failed");
    setLoading(false);
  }, []);

  const commitApprovalCenterError = useCallback((nextError: unknown) => {
    setApprovalCenterError(nextError instanceof Error ? nextError.message : "approval center fetch failed");
    setApprovalCenterLoading(false);
  }, []);

  const commitStateDelta = useCallback((delta: Partial<PhaseZeroState>) => {
    startTransition(() => {
      setState((current) => mergePhaseZeroState(current, delta));
      setError(null);
      setLoading(false);
    });
  }, []);

  const refresh = useCallback(async () => {
    const [stateResult, approvalCenterResult] = await Promise.allSettled([
      readJSON<PhaseZeroState>("/v1/state"),
      readJSON<ApprovalCenterState>("/v1/approval-center"),
    ]);

    if (approvalCenterResult.status === "fulfilled") {
      commitApprovalCenter(approvalCenterResult.value);
    } else {
      commitApprovalCenterError(approvalCenterResult.reason);
    }

    if (stateResult.status === "fulfilled") {
      commitState(stateResult.value);
      return;
    }

    commitRequestError(stateResult.reason);
    throw stateResult.reason;
  }, [commitApprovalCenter, commitApprovalCenterError, commitRequestError, commitState]);

  const refreshApprovalCenter = useCallback(async () => {
    try {
      const next = await readJSON<ApprovalCenterState>("/v1/approval-center");
      commitApprovalCenter(next);
    } catch (fetchError) {
      commitApprovalCenterError(fetchError);
      throw fetchError;
    }
  }, [commitApprovalCenter, commitApprovalCenterError]);

  const commitStateAndRefreshApprovalCenter = useCallback((next: PhaseZeroState) => {
    commitState(next);
    void refreshApprovalCenter().catch(() => {});
  }, [commitState, refreshApprovalCenter]);

  const commitStateDeltaAndRefreshApprovalCenter = useCallback((delta: Partial<PhaseZeroState>) => {
    commitStateDelta(delta);
    void refreshApprovalCenter().catch(() => {});
  }, [commitStateDelta, refreshApprovalCenter]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRetry = (delayMs = 2000) => {
      if (cancelled || retryTimer) {
        return;
      }
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void refresh().catch(() => {});
      }, delayMs);
    };

    async function hydrateInitialState() {
      try {
        await refresh();
      } catch {
        if (!cancelled) {
          scheduleRetry();
        }
      }
    }

    void hydrateInitialState();

    if (typeof EventSource === "undefined") {
      return () => {
        cancelled = true;
      };
    }

    source = new EventSource(`${API_BASE}${STATE_STREAM_PATH}`);
    source.addEventListener("snapshot", (event) => {
      if (cancelled) {
        return;
      }
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as PhaseZeroSnapshotStreamEvent;
        commitStateAndRefreshApprovalCenter(payload.state);
      } catch {
        // Ignore malformed stream payloads and wait for the next reconnect/update.
      }
    });
    source.addEventListener("delta", (event) => {
      if (cancelled) {
        return;
      }
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as PhaseZeroDeltaStreamEvent;
        commitStateDeltaAndRefreshApprovalCenter(payload.delta);
      } catch {
        // Ignore malformed stream payloads and wait for the next reconnect/update.
      }
    });
    source.onerror = () => {
      if (cancelled) {
        return;
      }
      setLoading(false);
      scheduleRetry();
    };

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      source?.close();
    };
  }, [commitStateAndRefreshApprovalCenter, commitStateDeltaAndRefreshApprovalCenter, refresh]);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 5000);

    return () => {
      window.clearInterval(poll);
    };
  }, [refresh]);

  async function loginAuthSession(input: { email: string; name?: string; deviceId?: string; deviceLabel?: string; authMethod?: string }) {
    const payload = await readJSON<StateMutationResponse>("/v1/auth/session", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function runAuthRecovery(input: Record<string, string | undefined>) {
    const payload = await readJSON<StateMutationResponse>("/v1/auth/recovery", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function logoutAuthSession() {
    const payload = await readJSON<StateMutationResponse>("/v1/auth/session", {
      method: "DELETE",
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function verifyMemberEmail(input: { email?: string; memberId?: string } = {}) {
    return runAuthRecovery({
      action: "verify_email",
      email: input.email,
      memberId: input.memberId,
    });
  }

  async function authorizeAuthDevice(input: { deviceId?: string; deviceLabel?: string; memberId?: string } = {}) {
    return runAuthRecovery({
      action: "authorize_device",
      deviceId: input.deviceId,
      deviceLabel: input.deviceLabel,
      memberId: input.memberId,
    });
  }

  async function requestPasswordReset(input: { email?: string; memberId?: string } = {}) {
    return runAuthRecovery({
      action: "request_password_reset",
      email: input.email,
      memberId: input.memberId,
    });
  }

  async function completePasswordReset(input: { email?: string; memberId?: string; deviceId?: string; deviceLabel?: string } = {}) {
    return runAuthRecovery({
      action: "complete_password_reset",
      email: input.email,
      memberId: input.memberId,
      deviceId: input.deviceId,
      deviceLabel: input.deviceLabel,
    });
  }

  async function bindExternalIdentity(input: { provider: string; handle: string; email?: string; memberId?: string }) {
    return runAuthRecovery({
      action: "bind_external_identity",
      provider: input.provider,
      handle: input.handle,
      email: input.email,
      memberId: input.memberId,
    });
  }

  async function inviteWorkspaceMember(input: { email: string; name?: string; role: string }) {
    const payload = await readJSON<StateMutationResponse>("/v1/workspace/members", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateWorkspaceMember(memberId: string, input: { role?: string; status?: string }) {
    const payload = await readJSON<StateMutationResponse>(`/v1/workspace/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateWorkspaceConfig(input: WorkspaceConfigUpdateInput) {
    const payload = await readJSON<StateMutationResponse>("/v1/workspace", {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateWorkspaceMemberPreferences(memberId: string, input: WorkspaceMemberPreferencesInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/workspace/members/${memberId}/preferences`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateAgentProfile(agentId: string, input: AgentProfileUpdateInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function createCredentialProfile(input: CredentialProfileCreateInput) {
    const payload = await readJSON<StateMutationResponse>("/v1/credentials", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateCredentialProfile(credentialId: string, input: CredentialProfileUpdateInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/credentials/${credentialId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateRunCredentialBindings(runId: string, input: RunCredentialBindingInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/runs/${runId}/credentials`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateRunSandbox(runId: string, input: RunSandboxUpdateInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/runs/${runId}/sandbox`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function checkRunSandbox(runId: string, input: RunSandboxCheckInput) {
    try {
      const payload = await readJSON<StateMutationResponse & { decision?: SandboxDecision }>(`/v1/runs/${runId}/sandbox`, {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (payload.state) {
        commitStateAndRefreshApprovalCenter(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitStateAndRefreshApprovalCenter(mutationError.payload.state);
      }
      if (mutationError instanceof StateMutationError && "decision" in mutationError.payload) {
        return mutationError.payload as StateMutationResponse & { decision?: SandboxDecision };
      }
      throw mutationError;
    }
  }

  async function createIssue(input: CreateIssueInput) {
    const payload = await readJSON<StateMutationResponse>("/v1/issues", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function postChannelMessage(channelId: string, prompt: string) {
    try {
      const payload = await readJSON<StateMutationResponse>(`/v1/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });

      if (payload.state) {
        commitStateAndRefreshApprovalCenter(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitStateAndRefreshApprovalCenter(mutationError.payload.state);
      }
      throw mutationError;
    }
  }

  async function postDirectMessage(directMessageId: string, prompt: string) {
    const payload = await readJSON<StateMutationResponse>(`/v1/direct-messages/${directMessageId}/messages`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateMessageSurfaceCollection(input: {
    kind: "followed" | "saved";
    channelId: string;
    messageId: string;
    enabled: boolean;
  }) {
    const payload = await readJSON<StateMutationResponse>("/v1/message-surface/collections", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateTopicGuidance(topicId: string, input: UpdateTopicGuidanceInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/topics/${topicId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function postRoomMessage(roomId: string, prompt: string, provider = "claude") {
    const payload = await readJSON<StateMutationResponse>(`/v1/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ prompt, provider }),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function streamRoomMessage(
    roomId: string,
    prompt: string,
    provider = "claude",
    onEvent?: (event: RoomStreamEvent) => void
  ) {
    const response = await fetch(`${API_BASE}/v1/rooms/${roomId}/messages/stream`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt, provider }),
    });

    if (!response.ok) {
      let message = `request failed: ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        if (payload.error) {
          message = payload.error;
        }
      } catch {
        // Ignore json parse failures and keep the status-derived message.
      }
      throw new Error(message);
    }

    if (!response.body) {
      throw new Error("stream body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload: RoomStreamEvent | null = null;
    let streamError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        const event = JSON.parse(trimmed) as RoomStreamEvent;
        if (event.error && !streamError) {
          streamError = event.error;
        }
        if (event.state) {
          commitStateAndRefreshApprovalCenter(event.state);
          finalPayload = event;
        }
        onEvent?.(event);
      }
    }

    const tail = buffer.trim();
    if (tail) {
      const event = JSON.parse(tail) as RoomStreamEvent;
      if (event.error && !streamError) {
        streamError = event.error;
      }
      if (event.state) {
        commitStateAndRefreshApprovalCenter(event.state);
        finalPayload = event;
      }
      onEvent?.(event);
    }

    if (finalPayload?.error || streamError) {
      throw new Error(finalPayload?.error || streamError || "stream failed");
    }
    return finalPayload;
  }

  async function createPullRequest(roomId: string) {
    try {
      const payload = await readJSON<StateMutationResponse>(`/v1/rooms/${roomId}/pull-request`, {
        method: "POST",
      });

      if (payload.state) {
        commitStateAndRefreshApprovalCenter(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitStateAndRefreshApprovalCenter(mutationError.payload.state);
      }
      throw mutationError;
    }
  }

  async function updatePullRequest(pullRequestId: string, input: UpdatePullRequestInput) {
    try {
      const payload = await readJSON<StateMutationResponse>(`/v1/pull-requests/${pullRequestId}`, {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (payload.state) {
        commitStateAndRefreshApprovalCenter(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitStateAndRefreshApprovalCenter(mutationError.payload.state);
      }
      throw mutationError;
    }
  }

  async function controlRun(runId: string, input: RunControlInput) {
    try {
      const payload = await readJSON<StateMutationResponse>(`/v1/runs/${runId}/control`, {
        method: "POST",
        body: JSON.stringify(input),
      });

      if (payload.state) {
        commitStateAndRefreshApprovalCenter(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitStateAndRefreshApprovalCenter(mutationError.payload.state);
      }
      throw mutationError;
    }
  }

  async function applyInboxDecision(inboxItemId: string, decision: InboxDecision) {
    try {
      const payload = await readJSON<StateMutationResponse>(`/v1/inbox/${inboxItemId}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });

      if (payload.state) {
        commitStateAndRefreshApprovalCenter(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitStateAndRefreshApprovalCenter(mutationError.payload.state);
      }
      throw mutationError;
    }
  }

  async function createHandoff(input: CreateHandoffInput) {
    const payload = await readJSON<StateMutationResponse>("/v1/mailbox", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  async function updateHandoff(handoffId: string, input: UpdateHandoffInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/mailbox/${handoffId}`, {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitStateAndRefreshApprovalCenter(payload.state);
    }
    return payload;
  }

  return {
    state,
    approvalCenter,
    loading,
    error,
    approvalCenterLoading,
    approvalCenterError,
    refresh,
    refreshApprovalCenter,
    loginAuthSession,
    logoutAuthSession,
    verifyMemberEmail,
    authorizeAuthDevice,
    requestPasswordReset,
    completePasswordReset,
    bindExternalIdentity,
    inviteWorkspaceMember,
    updateWorkspaceMember,
    updateWorkspaceConfig,
    updateWorkspaceMemberPreferences,
    updateAgentProfile,
    createCredentialProfile,
    updateCredentialProfile,
    updateRunCredentialBindings,
    updateRunSandbox,
    checkRunSandbox,
    createIssue,
    postChannelMessage,
    postDirectMessage,
    updateMessageSurfaceCollection,
    updateTopicGuidance,
    postRoomMessage,
    streamRoomMessage,
    createPullRequest,
    updatePullRequest,
    controlRun,
    applyInboxDecision,
    createHandoff,
    updateHandoff,
  };
}

export function LivePhaseZeroProvider({ children }: { children: ReactNode }) {
  const value = useProvidePhaseZeroState();
  return createElement(PhaseZeroContext.Provider, { value }, children);
}

export function usePhaseZeroState() {
  const value = useContext(PhaseZeroContext);
  if (!value) {
    throw new Error("usePhaseZeroState must be used within LivePhaseZeroProvider");
  }
  return value;
}
