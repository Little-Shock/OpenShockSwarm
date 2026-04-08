"use client";

import { createContext, createElement, startTransition, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import type {
  ApprovalCenterState,
  AuthSession,
  InboxDecision,
  PhaseZeroState,
} from "@/lib/mock-data";

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
};

type PhaseZeroStreamPresence = {
  onlineMachines: number;
  busyMachines: number;
  runningAgents: number;
  blockedAgents: number;
  activeRuns: number;
  unread: number;
};

type PhaseZeroStreamEvent = {
  type: "snapshot";
  sequence: number;
  sentAt: string;
  presence: PhaseZeroStreamPresence;
  state: PhaseZeroState;
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
  updateAgentProfile: (agentId: string, input: AgentProfileUpdateInput) => Promise<StateMutationResponse>;
  createIssue: (input: CreateIssueInput) => Promise<StateMutationResponse>;
  postChannelMessage: (channelId: string, prompt: string) => Promise<StateMutationResponse>;
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
    pairedRuntime: "",
    pairedRuntimeUrl: "",
    pairingStatus: "",
    deviceAuth: "",
    lastPairedAt: "",
    browserPush: "",
    memoryMode: "",
  },
  auth: {
    session: {
      id: "auth-session-current",
      status: "signed_out",
      permissions: [],
    },
    roles: [],
    members: [],
  },
  channels: [],
  channelMessages: {},
  issues: [],
  rooms: [],
  roomMessages: {},
  runs: [],
  agents: [],
  machines: [],
  runtimes: [],
  inbox: [],
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

function useProvidePhaseZeroState(): PhaseZeroContextValue {
  const [state, setState] = useState<PhaseZeroState>(EMPTY_PHASE_ZERO_STATE);
  const [approvalCenter, setApprovalCenter] = useState<ApprovalCenterState>(EMPTY_APPROVAL_CENTER_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvalCenterLoading, setApprovalCenterLoading] = useState(true);
  const [approvalCenterError, setApprovalCenterError] = useState<string | null>(null);

  const commitState = useCallback((next: PhaseZeroState) => {
    startTransition(() => {
      setState(next);
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
        const payload = JSON.parse((event as MessageEvent<string>).data) as PhaseZeroStreamEvent;
        commitStateAndRefreshApprovalCenter(payload.state);
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
  }, [commitStateAndRefreshApprovalCenter, refresh]);

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
    updateAgentProfile,
    createIssue,
    postChannelMessage,
    postRoomMessage,
    streamRoomMessage,
    createPullRequest,
    updatePullRequest,
    controlRun,
    applyInboxDecision,
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
