import type {
  ActionRequest,
  AgentDetailResponse,
  AgentDeleteResponse,
  AgentMutationResponse,
  AgentsResponse,
  AuthLogoutResponse,
  AuthProfileResponse,
  AuthSessionStateResponse,
  AuthTokenResponse,
  BootstrapResponse,
  InboxResponse,
  IssueDetailResponse,
  RoomDetailResponse,
  RoomReadResponse,
  TaskBoardResponse,
  WorkspaceResponse,
  WorkspacesResponse,
} from "@/lib/types";
import {
  SESSION_TOKEN_COOKIE,
  SESSION_TOKEN_STORAGE_KEY,
} from "@/lib/operator";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080"
).replace(/\/$/, "");

export type APIRequestOptions = RequestInit & {
  sessionToken?: string;
};

function createRequestHeaders(options?: APIRequestOptions) {
  const headers = new Headers(options?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const sessionToken = options?.sessionToken?.trim() || readClientSessionToken();
  if (sessionToken) {
    headers.set("X-OpenShock-Session", sessionToken);
  }
  return headers;
}

function readClientSessionToken() {
  if (typeof document === "undefined") {
    return "";
  }

  const tokenCookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${SESSION_TOKEN_COOKIE}=`));
  if (tokenCookie) {
    return decodeURIComponent(tokenCookie.slice(`${SESSION_TOKEN_COOKIE}=`.length));
  }

  if (typeof window !== "undefined") {
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)?.trim() ?? "";
  }

  return "";
}

async function request<T>(path: string, options?: APIRequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    ...options,
    headers: createRequestHeaders(options),
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error?.trim()) {
        message = payload.error.trim();
      }
    } catch {
      // Ignore JSON parse errors for non-JSON responses.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

function normalizeRoomDetailResponse(room: RoomDetailResponse): RoomDetailResponse {
  return {
    ...room,
    workspace: {
      ...room.workspace,
      repoBindings: room.workspace?.repoBindings ?? [],
    },
    messages: room.messages ?? [],
    agentSessions: room.agentSessions ?? [],
    agentTurns: room.agentTurns ?? [],
    agentTurnOutputChunks: room.agentTurnOutputChunks ?? [],
    agentTurnToolCalls: room.agentTurnToolCalls ?? [],
    handoffRecords: room.handoffRecords ?? [],
    tasks: room.tasks ?? [],
    runs: room.runs ?? [],
    runOutputChunks: room.runOutputChunks ?? [],
    toolCalls: room.toolCalls ?? [],
    mergeAttempts: room.mergeAttempts ?? [],
  };
}

function normalizeAgentDetailResponse(detail: AgentDetailResponse): AgentDetailResponse {
  return {
    ...detail,
    workspace: {
      ...detail.workspace,
      repoBindings: detail.workspace?.repoBindings ?? [],
    },
    rooms: detail.rooms ?? [],
    messages: detail.messages ?? [],
    agentSessions: detail.agentSessions ?? [],
    agentTurns: detail.agentTurns ?? [],
    agentTurnOutputChunks: detail.agentTurnOutputChunks ?? [],
    agentTurnToolCalls: detail.agentTurnToolCalls ?? [],
    handoffRecords: detail.handoffRecords ?? [],
  };
}

export function getBootstrap(options?: APIRequestOptions) {
  return request<BootstrapResponse>("/api/v1/bootstrap", options).then((bootstrap) => ({
    ...bootstrap,
    workspace: {
      ...bootstrap.workspace,
      repoBindings: bootstrap.workspace?.repoBindings ?? [],
    },
    rooms: bootstrap.rooms ?? [],
    directRooms: bootstrap.directRooms ?? [],
  }));
}

export function getWorkspaces(options?: APIRequestOptions) {
  return request<WorkspacesResponse>("/api/v1/workspaces", options).then((response) => ({
    ...response,
    workspaces: (response.workspaces ?? []).map((workspace) => ({
      ...workspace,
      repoBindings: workspace.repoBindings ?? [],
    })),
  }));
}

export function createWorkspace(
  payload: { name: string },
  options?: APIRequestOptions,
) {
  return request<WorkspaceResponse>("/api/v1/workspaces", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function switchWorkspace(
  payload: { workspaceId: string },
  options?: APIRequestOptions,
) {
  return request<WorkspaceResponse>("/api/v1/workspaces/current", {
    ...options,
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getAgents(options?: APIRequestOptions) {
  return request<AgentsResponse>("/api/v1/agents", options);
}

export function createAgent(
  payload: {
    name: string;
    prompt: string;
  },
  options?: APIRequestOptions,
) {
  return request<AgentMutationResponse>("/api/v1/agents", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAgent(
  agentId: string,
  payload: { name: string; prompt: string },
  options?: APIRequestOptions,
) {
  return request<AgentMutationResponse>(`/api/v1/agents/${agentId}`, {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getAgentDetail(agentId: string, options?: APIRequestOptions) {
  return request<AgentDetailResponse>(`/api/v1/agents/${agentId}`, options).then(
    normalizeAgentDetailResponse,
  );
}

export function deleteAgent(agentId: string, options?: APIRequestOptions) {
  return request<AgentDeleteResponse>(`/api/v1/agents/${agentId}`, {
    ...options,
    method: "DELETE",
  });
}

export function getIssue(issueId: string, options?: APIRequestOptions) {
  return request<IssueDetailResponse>(`/api/v1/issues/${issueId}`, options).then((detail) => ({
    ...detail,
    workspace: {
      ...detail.workspace,
      repoBindings: detail.workspace?.repoBindings ?? [],
    },
    agentTurnOutputChunks: detail.agentTurnOutputChunks ?? [],
    agentTurnToolCalls: detail.agentTurnToolCalls ?? [],
  }));
}

export function getRoom(roomId: string, options?: APIRequestOptions) {
  return request<RoomDetailResponse>(`/api/v1/rooms/${roomId}`, options).then(normalizeRoomDetailResponse);
}

export function markRoomRead(
  roomId: string,
  payload: { messageId: string },
  options?: APIRequestOptions,
) {
  return request<RoomReadResponse>(`/api/v1/rooms/${roomId}/read`, {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getTaskBoard(options?: APIRequestOptions) {
  return request<TaskBoardResponse>("/api/v1/task-board", options);
}

export function getInbox(options?: APIRequestOptions) {
  return request<InboxResponse>("/api/v1/inbox", options);
}

export function submitAction(payload: ActionRequest, options?: APIRequestOptions) {
  return request("/api/v1/actions", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function registerMember(
  payload: { username: string; displayName: string; password: string },
  options?: APIRequestOptions,
) {
  return request<AuthTokenResponse>("/api/v1/auth/register", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function loginMember(
  payload: { username: string; password: string },
  options?: APIRequestOptions,
) {
  return request<AuthTokenResponse>("/api/v1/auth/login", {
    ...options,
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getAuthSession(options?: APIRequestOptions) {
  return request<AuthSessionStateResponse>("/api/v1/auth/session", options);
}

export function logoutMember(options?: APIRequestOptions) {
  return request<AuthLogoutResponse>("/api/v1/auth/logout", {
    ...options,
    method: "POST",
  });
}

export function getAuthProfile(options?: APIRequestOptions) {
  return request<AuthProfileResponse>("/api/v1/auth/profile", options);
}

export function updateAuthProfile(
  payload: { displayName: string },
  options?: APIRequestOptions,
) {
  return request<AuthProfileResponse>("/api/v1/auth/profile", {
    ...options,
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getRealtimeEventsUrl(scopes: string[] = [], sessionToken?: string) {
  const params = new URLSearchParams();

  for (const scope of scopes) {
    const value = scope.trim();
    if (value) {
      params.append("scope", value);
    }
  }
  if (sessionToken?.trim()) {
    params.set("sessionToken", sessionToken.trim());
  }

  const query = params.toString();
  return `${API_BASE_URL}/api/v1/realtime/events${query ? `?${query}` : ""}`;
}
