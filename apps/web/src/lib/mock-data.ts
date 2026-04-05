export type AppTab = "chat" | "rooms" | "inbox" | "board";

export type Channel = {
  id: string;
  name: string;
  summary: string;
  unread: number;
  purpose: string;
};

export type Topic = {
  id: string;
  title: string;
  status: "running" | "blocked" | "review";
  owner: string;
  runId: string;
  branch: string;
  worktree: string;
  summary: string;
};

export type Room = {
  id: string;
  title: string;
  issueKey: string;
  unread: number;
  summary: string;
  boardCount: number;
  topic: Topic;
};

export type AgentStatus = {
  id: string;
  name: string;
  mood: string;
  state: "running" | "idle" | "blocked";
  lane: string;
};

export type MachineStatus = {
  id: string;
  name: string;
  state: "online" | "busy" | "offline";
  cli: string;
};

export type InboxItem = {
  id: string;
  title: string;
  kind: "blocked" | "approval" | "review" | "status";
  room: string;
  time: string;
  summary: string;
  action: string;
};

export type BoardColumn = {
  title: string;
  accent: string;
  cards: Array<{
    id: string;
    issueKey: string;
    title: string;
    owner: string;
    state: string;
  }>;
};

export const tabs: Array<{ id: AppTab; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "rooms", label: "Rooms" },
  { id: "inbox", label: "Inbox" },
  { id: "board", label: "Board" },
];

export const channels: Channel[] = [
  {
    id: "all",
    name: "#all",
    summary: "Lounge for signals, jokes, and quick coordination.",
    unread: 5,
    purpose: "Everything informal lands here first.",
  },
  {
    id: "roadmap",
    name: "#roadmap",
    summary: "Direction setting, tradeoffs, and release sequencing.",
    unread: 2,
    purpose: "Longer product discussion without task pressure.",
  },
  {
    id: "announcements",
    name: "#announcements",
    summary: "Ship notes, runtime changes, and policy updates.",
    unread: 0,
    purpose: "Broadcast only. Low noise by design.",
  },
];

export const rooms: Room[] = [
  {
    id: "room-runtime",
    title: "Open runtime heartbeat",
    issueKey: "OPS-12",
    unread: 3,
    summary: "Bring runtime status, recent runs, and unread inbox count into one room.",
    boardCount: 4,
    topic: {
      id: "topic-runtime",
      title: "Ship settings page with runtime state widgets",
      status: "running",
      owner: "Codex Dockmaster",
      runId: "run_02HT91",
      branch: "feat/runtime-status-shell",
      worktree: "wt-runtime-shell",
      summary: "UI shell is moving. Agent is wiring cards and left rail presence.",
    },
  },
  {
    id: "room-inbox",
    title: "Inbox decision center",
    issueKey: "OPS-19",
    unread: 1,
    summary: "Turn blocked, approval, and review prompts into one human intervention lane.",
    boardCount: 3,
    topic: {
      id: "topic-inbox",
      title: "Tighten approval cards and decision language",
      status: "review",
      owner: "Claude Review Runner",
      runId: "run_02HT87",
      branch: "feat/inbox-decision-cards",
      worktree: "wt-inbox-cards",
      summary: "Copy is ready. Waiting on final UX pass before merge.",
    },
  },
  {
    id: "room-memory",
    title: "Memory file writer",
    issueKey: "OPS-27",
    unread: 4,
    summary: "Make MEMORY.md and decisions usable without adding a heavy memory stack yet.",
    boardCount: 2,
    topic: {
      id: "topic-memory",
      title: "Blocked on writeback policy edge cases",
      status: "blocked",
      owner: "Memory Clerk",
      runId: "run_02HT93",
      branch: "feat/memory-writeback",
      worktree: "wt-memory-writeback",
      summary: "Agent needs a rule for when room-level notes outrank user preferences.",
    },
  },
];

export const agents: AgentStatus[] = [
  {
    id: "agent-1",
    name: "Codex Dockmaster",
    mood: "Wiring runtime cards",
    state: "running",
    lane: "OPS-12",
  },
  {
    id: "agent-2",
    name: "Claude Review Runner",
    mood: "Waiting on product pass",
    state: "idle",
    lane: "OPS-19",
  },
  {
    id: "agent-3",
    name: "Memory Clerk",
    mood: "Needs policy input",
    state: "blocked",
    lane: "OPS-27",
  },
];

export const machines: MachineStatus[] = [
  { id: "machine-1", name: "shock-main", state: "busy", cli: "Codex + Claude Code" },
  { id: "machine-2", name: "shock-sidecar", state: "online", cli: "Codex" },
];

export const inboxItems: InboxItem[] = [
  {
    id: "inbox-1",
    title: "Approval required for destructive git cleanup",
    kind: "approval",
    room: "Open runtime heartbeat",
    time: "2m ago",
    summary: "Run asked to prune an obsolete branch and remove generated fixtures.",
    action: "Review approval",
  },
  {
    id: "inbox-2",
    title: "Memory Clerk is blocked on scope priority",
    kind: "blocked",
    room: "Memory file writer",
    time: "7m ago",
    summary: "Need product rule for topic, room, workspace, and user precedence.",
    action: "Resolve blocker",
  },
  {
    id: "inbox-3",
    title: "Inbox cards ready for review",
    kind: "review",
    room: "Inbox decision center",
    time: "12m ago",
    summary: "Agent prepared the final copy and status badge hierarchy.",
    action: "Open review",
  },
  {
    id: "inbox-4",
    title: "Runtime lane finished first shell pass",
    kind: "status",
    room: "Open runtime heartbeat",
    time: "18m ago",
    summary: "Left rail presence and context panel are synced with run metadata.",
    action: "Open room",
  },
];

export const boardColumns: BoardColumn[] = [
  {
    title: "Queued",
    accent: "var(--shock-paper)",
    cards: [
      {
        id: "queued-1",
        issueKey: "OPS-33",
        title: "Create browser push preference model",
        owner: "Claude Review Runner",
        state: "queued",
      },
    ],
  },
  {
    title: "Running",
    accent: "var(--shock-yellow)",
    cards: [
      {
        id: "run-1",
        issueKey: "OPS-12",
        title: "Runtime state settings page",
        owner: "Codex Dockmaster",
        state: "running",
      },
    ],
  },
  {
    title: "Blocked",
    accent: "var(--shock-pink)",
    cards: [
      {
        id: "blocked-1",
        issueKey: "OPS-27",
        title: "Memory writeback policy",
        owner: "Memory Clerk",
        state: "blocked",
      },
    ],
  },
  {
    title: "Review",
    accent: "var(--shock-lime)",
    cards: [
      {
        id: "review-1",
        issueKey: "OPS-19",
        title: "Inbox decision center",
        owner: "Claude Review Runner",
        state: "review",
      },
    ],
  },
];

export const feedMessages = [
  {
    id: "msg-1",
    speaker: "Mina",
    role: "Product",
    tone: "human",
    message:
      "Keep the shell light. Chat stays chat. The Issue Room is where serious work starts.",
    time: "09:12",
  },
  {
    id: "msg-2",
    speaker: "Codex Dockmaster",
    role: "Agent",
    tone: "agent",
    message:
      "Runtime cards are live in the shell. Next pass will tighten the status language and branch metadata.",
    time: "09:16",
  },
  {
    id: "msg-3",
    speaker: "Claude Review Runner",
    role: "Agent",
    tone: "agent",
    message:
      "Inbox copy is softer now. Approval cards no longer sound like a firewall alert.",
    time: "09:19",
  },
  {
    id: "msg-4",
    speaker: "Memory Clerk",
    role: "Agent",
    tone: "blocked",
    message:
      "Blocked: I need a rule for when room notes override user memory. Please decide before I write back.",
    time: "09:23",
  },
];
