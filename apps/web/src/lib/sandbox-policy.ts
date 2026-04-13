import type {
  SandboxActionKind,
  SandboxDecision,
  SandboxDecisionStatus,
  SandboxPolicy,
  SandboxProfile,
} from "@/lib/phase-zero-types";

export function parseSandboxListInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function formatSandboxList(values?: string[]) {
  return (values ?? []).join(", ");
}

export function sandboxPolicyDraft(profile: SandboxProfile, fields: {
  allowedHosts: string;
  allowedCommands: string;
  allowedTools: string;
}): SandboxPolicy {
  return {
    profile,
    allowedHosts: parseSandboxListInput(fields.allowedHosts),
    allowedCommands: parseSandboxListInput(fields.allowedCommands),
    allowedTools: parseSandboxListInput(fields.allowedTools),
  };
}

export function sandboxProfileLabel(profile?: string) {
  switch (profile) {
    case "restricted":
      return "受限";
    case "trusted":
      return "宽松";
    default:
      return "待同步";
  }
}

export function sandboxDecisionLabel(status?: SandboxDecisionStatus | string) {
  switch (status) {
    case "allowed":
      return "允许";
    case "denied":
      return "拒绝";
    case "approval_required":
      return "需要批准";
    case "overridden":
      return "已人工放行";
    case "idle":
      return "待检查";
    default:
      return "待同步";
  }
}

export function sandboxDecisionTone(status?: SandboxDecisionStatus | string): "white" | "yellow" | "lime" | "pink" {
  switch (status) {
    case "allowed":
      return "lime";
    case "overridden":
      return "yellow";
    case "approval_required":
    case "denied":
      return "pink";
    default:
      return "white";
  }
}

export function sandboxActionKindLabel(kind?: SandboxActionKind | string) {
  switch (kind) {
    case "command":
      return "命令";
    case "network":
      return "网络";
    case "tool":
      return "工具";
    default:
      return "未声明";
  }
}

export function sandboxPolicySummary(policy: SandboxPolicy) {
  const parts = [sandboxProfileLabel(policy.profile)];
  if ((policy.allowedHosts ?? []).length > 0) {
    parts.push(`主机 ${(policy.allowedHosts ?? []).length}`);
  }
  if ((policy.allowedCommands ?? []).length > 0) {
    parts.push(`命令 ${(policy.allowedCommands ?? []).length}`);
  }
  if ((policy.allowedTools ?? []).length > 0) {
    parts.push(`工具 ${(policy.allowedTools ?? []).length}`);
  }
  return parts.join(" / ");
}

export function sandboxDecisionHeadline(decision: SandboxDecision) {
  const kind = sandboxActionKindLabel(decision.kind);
  const target = decision.target?.trim();
  if (!target) {
    return sandboxDecisionLabel(decision.status);
  }
  return `${sandboxDecisionLabel(decision.status)} · ${kind} / ${target}`;
}
