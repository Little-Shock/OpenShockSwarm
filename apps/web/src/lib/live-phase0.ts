"use client";

import { createContext, createElement, startTransition, useContext, useEffect, useState, type ReactNode } from "react";

import type { AuthSession, PhaseZeroState } from "@/lib/mock-data";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";
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

type InboxDecision =
  | "approved"
  | "deferred"
  | "resolved"
  | "merged"
  | "changes_requested";

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
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loginAuthSession: (input: { email: string; name?: string }) => Promise<StateMutationResponse>;
  logoutAuthSession: () => Promise<StateMutationResponse>;
  inviteWorkspaceMember: (input: { email: string; name?: string; role: string }) => Promise<StateMutationResponse>;
  updateWorkspaceMember: (memberId: string, input: { role?: string; status?: string }) => Promise<StateMutationResponse>;
  createIssue: (input: CreateIssueInput) => Promise<StateMutationResponse>;
  postRoomMessage: (roomId: string, prompt: string, provider?: string) => Promise<StateMutationResponse>;
  streamRoomMessage: (
    roomId: string,
    prompt: string,
    provider?: string,
    onEvent?: (event: RoomStreamEvent) => void
  ) => Promise<RoomStreamEvent | null>;
  createPullRequest: (roomId: string) => Promise<StateMutationResponse>;
  updatePullRequest: (pullRequestId: string, input: UpdatePullRequestInput) => Promise<StateMutationResponse>;
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
  memory: [],
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function commitState(next: PhaseZeroState) {
    startTransition(() => {
      setState(next);
      setError(null);
      setLoading(false);
    });
  }

  function commitRequestError(nextError: unknown) {
    setError(nextError instanceof Error ? nextError.message : "state fetch failed");
    setLoading(false);
  }

  async function refresh() {
    try {
      const next = await readJSON<PhaseZeroState>("/v1/state");
      commitState(next);
    } catch (fetchError) {
      commitRequestError(fetchError);
      throw fetchError;
    }
  }

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;

    async function hydrateInitialState() {
      try {
        const next = await readJSON<PhaseZeroState>("/v1/state");
        if (cancelled) {
          return;
        }
        commitState(next);
      } catch (fetchError) {
        if (cancelled) {
          return;
        }
        commitRequestError(fetchError);
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
        commitState(payload.state);
      } catch {
        // Ignore malformed stream payloads and wait for the next reconnect/update.
      }
    });
    source.onerror = () => {
      if (cancelled) {
        return;
      }
      setLoading(false);
    };

    return () => {
      cancelled = true;
      source?.close();
    };
  }, []);

  async function loginAuthSession(input: { email: string; name?: string }) {
    const payload = await readJSON<StateMutationResponse>("/v1/auth/session", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitState(payload.state);
    }
    return payload;
  }

  async function logoutAuthSession() {
    const payload = await readJSON<StateMutationResponse>("/v1/auth/session", {
      method: "DELETE",
    });

    if (payload.state) {
      commitState(payload.state);
    }
    return payload;
  }

  async function inviteWorkspaceMember(input: { email: string; name?: string; role: string }) {
    const payload = await readJSON<StateMutationResponse>("/v1/workspace/members", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitState(payload.state);
    }
    return payload;
  }

  async function updateWorkspaceMember(memberId: string, input: { role?: string; status?: string }) {
    const payload = await readJSON<StateMutationResponse>(`/v1/workspace/members/${memberId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitState(payload.state);
    }
    return payload;
  }

  async function createIssue(input: CreateIssueInput) {
    const payload = await readJSON<StateMutationResponse>("/v1/issues", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) {
      commitState(payload.state);
    }
    return payload;
  }

  async function postRoomMessage(roomId: string, prompt: string, provider = "claude") {
    const payload = await readJSON<StateMutationResponse>(`/v1/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ prompt, provider }),
    });

    if (payload.state) {
      commitState(payload.state);
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
          commitState(event.state);
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
        commitState(event.state);
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
        commitState(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitState(mutationError.payload.state);
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
        commitState(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitState(mutationError.payload.state);
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
        commitState(payload.state);
      }
      return payload;
    } catch (mutationError) {
      if (mutationError instanceof StateMutationError && mutationError.payload.state) {
        commitState(mutationError.payload.state);
      }
      throw mutationError;
    }
  }

  return {
    state,
    loading,
    error,
    refresh,
    loginAuthSession,
    logoutAuthSession,
    inviteWorkspaceMember,
    updateWorkspaceMember,
    createIssue,
    postRoomMessage,
    streamRoomMessage,
    createPullRequest,
    updatePullRequest,
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
