"use client";

import { useEffect, useState } from "react";

import { fallbackState, type PhaseZeroState } from "@/lib/mock-data";

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
  roomId?: string;
  output?: string;
  pullRequestId?: string;
};

type UpdatePullRequestInput = {
  status: "draft" | "open" | "in_review" | "changes_requested" | "merged";
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
    throw new Error(payload.error || `request failed: ${response.status}`);
  }

  return payload;
}

export function usePhaseZeroState() {
  const [state, setState] = useState<PhaseZeroState>(fallbackState);
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

  return { state, loading, error, refresh, createIssue, postRoomMessage, createPullRequest, updatePullRequest };
}
