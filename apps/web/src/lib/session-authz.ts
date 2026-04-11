"use client";

import type { AuthSession } from "@/lib/phase-zero-types";

export type PermissionStatus = "allowed" | "blocked" | "signed_out";

const permissionLabels: Record<string, string> = {
  "issue.create": "创建事项",
  "room.reply": "发送讨论间消息",
  "run.execute": "执行运行环境命令",
  "pull_request.review": "发起或同步拉取请求",
  "pull_request.merge": "合并拉取请求",
  "inbox.review": "处理评审决策",
  "inbox.decide": "处理批准、合并或关闭决策",
  "repo.admin": "同步仓库绑定",
  "runtime.manage": "配对或切换运行环境",
  "members.manage": "管理工作区成员",
  "workspace.manage": "修改工作区治理配置",
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
    return `当前还没登录。先去“访问与身份”完成登录，再继续${action}。`;
  }
  return `当前账号还没有“${action}”权限。`;
}
