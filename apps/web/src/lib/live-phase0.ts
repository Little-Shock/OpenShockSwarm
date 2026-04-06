"use client";

import { useEffect, useState } from "react";

import type { PhaseZeroState } from "@/lib/mock-data";

const API_BASE = process.env.NEXT_PUBLIC_OPENSHOCK_API_BASE ?? "http://127.0.0.1:8080";

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

export function usePhaseZeroState() {
  const [state, setState] = useState<PhaseZeroState>(EMPTY_PHASE_ZERO_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await readJSON<PhaseZeroState>("/v1/state");
      setState(next);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "state fetch failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  async function createIssue(input: CreateIssueInput) {
    const payload = await readJSON<StateMutationResponse>("/v1/issues", {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) setState(payload.state);
    return payload;
  }

  async function postRoomMessage(roomId: string, prompt: string, provider = "claude") {
    const payload = await readJSON<StateMutationResponse>(`/v1/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ prompt, provider }),
    });

    if (payload.state) setState(payload.state);
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
        if (payload.error) message = payload.error;
      } catch {
        // ignore json parse failure
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
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const event = JSON.parse(trimmed) as RoomStreamEvent;
        if (event.error && !streamError) {
          streamError = event.error;
        }
        if (event.state) {
          setState(event.state);
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
        setState(event.state);
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
    const payload = await readJSON<StateMutationResponse>(`/v1/rooms/${roomId}/pull-request`, {
      method: "POST",
    });

    if (payload.state) setState(payload.state);
    return payload;
  }

  async function updatePullRequest(pullRequestId: string, input: UpdatePullRequestInput) {
    const payload = await readJSON<StateMutationResponse>(`/v1/pull-requests/${pullRequestId}`, {
      method: "POST",
      body: JSON.stringify(input),
    });

    if (payload.state) setState(payload.state);
    return payload;
  }

  async function applyInboxDecision(inboxItemId: string, decision: InboxDecision) {
    try {
      const payload = await readJSON<StateMutationResponse>(`/v1/inbox/${inboxItemId}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });

      if (payload.state) setState(payload.state);
      return payload;
    } catch (error) {
      if (error instanceof StateMutationError && error.payload.state) {
        setState(error.payload.state);
      }
      throw error;
    }
  }

  return {
    state,
    loading,
    error,
    refresh,
    createIssue,
    postRoomMessage,
    streamRoomMessage,
    createPullRequest,
    updatePullRequest,
    applyInboxDecision,
  };
}
