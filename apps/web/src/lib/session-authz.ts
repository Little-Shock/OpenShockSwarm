"use client";

import type { AuthSession } from "@/lib/mock-data";

export type PermissionStatus = "allowed" | "blocked" | "signed_out";

const permissionLabels: Record<string, string> = {
  "issue.create": "创建 Issue",
  "room.reply": "发送讨论间消息",
  "run.execute": "执行 Runtime 命令",
  "pull_request.review": "发起或同步 PR",
  "pull_request.merge": "合并 PR",
  "inbox.review": "处理 review 决策",
  "inbox.decide": "处理 approval / merge / resolve 决策",
  "repo.admin": "同步 Repo Binding",
  "runtime.manage": "配对或切换 Runtime",
  "members.manage": "管理工作区成员",
};

export function sessionIsActive(session: AuthSession | null | undefined) {
  return session?.status === "active";
}

export function hasSessionPermission(session: AuthSession | null | undefined, permission: string) {
  return sessionIsActive(session) && Boolean(session?.permissions.includes(permission));
}

export function permissionStatus(session: AuthSession | null | undefined, permission: string): PermissionStatus {
  if (!sessionIsActive(session)) {
    return "signed_out";
  }
  return hasSessionPermission(session, permission) ? "allowed" : "blocked";
}

export function permissionBoundaryCopy(session: AuthSession | null | undefined, permission: string) {
  const action = permissionLabels[permission] ?? permission;
  if (!sessionIsActive(session)) {
    return `当前未登录。先回 /access 建立 active session，再继续${action}。`;
  }
  return `当前 session 缺少 \`${permission}\`，不能直接${action}。`;
}
