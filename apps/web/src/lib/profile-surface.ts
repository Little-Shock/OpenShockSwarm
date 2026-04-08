import type { AgentStatus, WorkspaceMember } from "@/lib/mock-data";

export type ProfileKind = "agent" | "machine" | "human";

export function isProfileKind(value: string): value is ProfileKind {
  return value === "agent" || value === "machine" || value === "human";
}

export function buildProfileHref(kind: ProfileKind, id: string) {
  return `/profiles/${kind}/${encodeURIComponent(id)}`;
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

export function findAgentByName(agents: AgentStatus[], name: string) {
  const needle = normalizeLabel(name);
  return agents.find((agent) => normalizeLabel(agent.name) === needle);
}

export function findMemberByName(members: WorkspaceMember[], name: string) {
  const needle = normalizeLabel(name);
  return members.find((member) => normalizeLabel(member.name) === needle);
}

export function buildNamedProfileHref(
  name: string,
  options: {
    agents: AgentStatus[];
    members: WorkspaceMember[];
    prefer?: ProfileKind;
  }
) {
  const { agents, members, prefer = "agent" } = options;
  const agent = findAgentByName(agents, name);
  const member = findMemberByName(members, name);

  if (prefer === "human" && member) {
    return buildProfileHref("human", member.id);
  }
  if (prefer === "agent" && agent) {
    return buildProfileHref("agent", agent.id);
  }

  if (agent) {
    return buildProfileHref("agent", agent.id);
  }
  if (member) {
    return buildProfileHref("human", member.id);
  }

  return null;
}
