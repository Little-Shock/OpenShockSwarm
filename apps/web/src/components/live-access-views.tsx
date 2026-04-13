"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import type { AuthDevice, AuthSession, WorkspaceMember, WorkspaceRole } from "@/lib/phase-zero-types";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { buildFirstStartJourney, type FirstStartJourneyStepStatus } from "@/lib/first-start-journey";
import { usePhaseZeroState } from "@/lib/live-phase0";
import { permissionLabel } from "@/lib/session-authz";

const MEMBER_STATUS_OPTIONS = [
  { value: "active", label: "在线成员", summary: "成员已可正常登录并使用对应角色权限。" },
  { value: "invited", label: "待接受", summary: "邀请已发出，成员接受后就会进入正常可用状态。" },
  { value: "suspended", label: "已暂停", summary: "成员会保留在列表中，但无法登录和继续使用。" },
] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function findAgentName(agentID: string | undefined, agentItems: Array<{ id: string; name: string }>) {
  if (!agentID) {
    return "未绑定";
  }
  return agentItems.find((agent) => agent.id === agentID)?.name ?? agentID;
}

function sessionIsActive(session: AuthSession) {
  return session.status === "active";
}

function hasPermission(session: AuthSession, permission: string) {
  return session.permissions.includes(permission);
}

function canManageMembers(session: AuthSession) {
  return sessionIsActive(session) && hasPermission(session, "members.manage");
}

function sessionStatusLabel(session: AuthSession) {
  return sessionIsActive(session) ? "已登录" : "未登录";
}

function sessionStatusTone(session: AuthSession) {
  return sessionIsActive(session) ? "lime" : "pink";
}

function roleLabel(role: string | undefined) {
  switch (role) {
    case "owner":
      return "所有者";
    case "member":
      return "成员";
    case "viewer":
      return "访客";
    default:
      return "未分配";
  }
}

function memberStatusLabel(status: string) {
  switch (status) {
    case "active":
      return "在线成员";
    case "invited":
      return "待接受";
    case "suspended":
      return "已暂停";
    default:
      return "未返回";
  }
}

function emailVerificationLabel(status: string | undefined) {
  switch (status) {
    case "verified":
      return "已验证";
    case "pending":
      return "待验证";
    default:
      return "未配置";
  }
}

function deviceAuthLabel(status: string | undefined) {
  switch (status) {
    case "authorized":
      return "已授权";
    case "pending":
      return "待授权";
    default:
      return "未返回";
  }
}

function recoveryStatusLabel(status: string | undefined) {
  switch (status) {
    case "ready":
      return "可用";
    case "verification_required":
      return "待邮箱验证";
    case "device_approval_required":
      return "待设备授权";
    case "reset_pending":
      return "待密码重置";
    case "recovered":
      return "已恢复";
    default:
      return "未返回";
  }
}

function onboardingStatusLabel(status?: string) {
  switch ((status ?? "").trim()) {
    case "done":
      return "已完成";
    case "in_progress":
      return "进行中";
    case "ready":
      return "待收口";
    case "not_started":
      return "未开始";
    default:
      return valueOrPlaceholder(status, "未开始");
  }
}

function defaultInviteRoleID(roles: WorkspaceRole[]) {
  return roles.find((role) => role.id === "viewer")?.id ?? roles[0]?.id ?? "viewer";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">{label}</p>
      <p className="mt-2 break-words font-display text-xl font-semibold">{value}</p>
    </div>
  );
}

function AccessStateNotice({
  title,
  message,
  tone = "white",
}: {
  title: string;
  message: string;
  tone?: "white" | "paper" | "yellow" | "lime" | "pink" | "ink";
}) {
  return (
    <Panel tone={tone}>
      <p className="font-display text-3xl font-bold">{title}</p>
      <p className="mt-3 max-w-3xl text-base leading-7 text-[color:rgba(24,20,14,0.76)]">{message}</p>
    </Panel>
  );
}

function PermissionChip({ permission }: { permission: string }) {
  return (
    <span className="rounded-full border border-[var(--shock-ink)] bg-white px-2 py-1 font-mono text-[10px]">
      {permissionLabel(permission)}
    </span>
  );
}

function MutationFeedback({
  error,
  success,
  errorTestID,
  successTestID,
}: {
  error: string | null;
  success: string | null;
  errorTestID: string;
  successTestID: string;
}) {
  return (
    <>
      {error ? (
        <p
          data-testid={errorTestID}
          className="mt-4 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] text-white"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          data-testid={successTestID}
          className="mt-4 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px]"
        >
          {success}
        </p>
      ) : null}
    </>
  );
}

function journeyTone(status: FirstStartJourneyStepStatus) {
  switch (status) {
    case "ready":
      return "lime";
    case "active":
      return "yellow";
    default:
      return "paper";
  }
}

function PermissionProbe({
  label,
  permission,
  summary,
  href,
  session,
}: {
  label: string;
  permission: string;
  summary: string;
  href: string;
  session: AuthSession;
}) {
  const allowed = hasPermission(session, permission);
  const probeID = permission.replaceAll(".", "-");

  return (
    <Link
      data-testid={`access-probe-${probeID}`}
      href={href}
      className={cn(
        "block rounded-[24px] border-2 border-[var(--shock-ink)] p-4 shadow-[5px_5px_0_0_var(--shock-ink)] transition-transform hover:-translate-y-0.5",
        allowed ? "bg-[var(--shock-lime)]" : "bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">权限检查</p>
          
          <h3 className="mt-2 font-display text-2xl font-bold">{label}</h3>
        </div>
        <span
          data-testid={`access-probe-status-${probeID}`}
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            allowed ? "bg-white" : "bg-[var(--shock-paper)]"
          )}
        >
          {allowed ? "可进入" : "受限"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{summary}</p>
      <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">所需权限</p>
        <p className="mt-2 text-sm leading-6">{permissionLabel(permission)}</p>
      </div>
    </Link>
  );
}

function RoleCard({ role }: { role: WorkspaceRole }) {
  return (
    <div data-testid={`access-role-${role.id}`} className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">角色</p>
          <h3 className="mt-2 font-display text-2xl font-bold">{role.label}</h3>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {role.permissions.length} 项权限
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{role.summary}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {role.permissions.map((permission) => (
          <PermissionChip key={permission} permission={permission} />
        ))}
      </div>
    </div>
  );
}

function InviteMemberPanel({
  session,
  roles,
}: {
  session: AuthSession;
  roles: WorkspaceRole[];
}) {
  const { inviteWorkspaceMember } = usePhaseZeroState();
  const manageAllowed = canManageMembers(session);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(defaultInviteRoleID(roles));
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  useEffect(() => {
    setRole((currentRole) => (roles.some((item) => item.id === currentRole) ? currentRole : defaultInviteRoleID(roles)));
  }, [roles]);

  async function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await inviteWorkspaceMember({ email, name, role });
      setMutationSuccess(`已邀请 ${email.trim().toLowerCase()}，角色为 ${roleLabel(role)}`);
      setEmail("");
      setName("");
      setRole(defaultInviteRoleID(roles));
    } catch (error) {
        setMutationError(error instanceof Error ? error.message : "邀请失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone={manageAllowed ? "yellow" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">成员管理</p>
          <h2 className="mt-2 font-display text-3xl font-bold">邀请新成员</h2>
        </div>
        <span
          data-testid="access-members-manage-status"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {manageAllowed ? "可编辑" : "只读"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        在这里可以邀请成员，并调整角色和状态。
      </p>
      {!manageAllowed ? (
        <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p data-testid="access-members-manage-boundary" className="font-mono text-[11px] uppercase tracking-[0.16em]">
            当前账号没有成员管理权限，请切换到管理员账号后再操作。
          </p>
        </div>
      ) : null}
      <form onSubmit={handleInvite} className="mt-5 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px]">
          <input
            data-testid="access-invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={!manageAllowed || pending}
            className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
            placeholder="teammate@company.com"
            required
          />
          <input
            data-testid="access-invite-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!manageAllowed || pending}
            className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
            placeholder="显示名"
          />
          <select
            data-testid="access-invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            disabled={!manageAllowed || pending}
            className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
          >
            {roles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            data-testid="access-invite-submit"
            type="submit"
            disabled={!manageAllowed || pending}
            className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
          >
            {pending ? "邀请中..." : "邀请成员"}
          </button>
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">
            默认以访客身份发出邀请，后续可再调整角色和状态。
          </p>
        </div>
        <MutationFeedback
          error={mutationError}
          success={mutationSuccess}
          errorTestID="access-invite-error"
          successTestID="access-invite-success"
        />
      </form>
    </Panel>
  );
}

function MemberManagementControls({
  member,
  roles,
  visible,
}: {
  member: WorkspaceMember;
  roles: WorkspaceRole[];
  visible: boolean;
}) {
  const { updateWorkspaceMember } = usePhaseZeroState();
  const [role, setRole] = useState(member.role);
  const [status, setStatus] = useState(member.status);
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  useEffect(() => {
    setRole(member.role);
    setStatus(member.status);
  }, [member.role, member.status]);

  if (!visible) {
    return null;
  }

  const changed = role !== member.role || status !== member.status;

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await updateWorkspaceMember(member.id, { role, status });
      setMutationSuccess(`已更新为 ${roleLabel(role)} / ${memberStatusLabel(status)}`);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "成员更新失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleUpdate} className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">成员设置</p>
          <h4 className="mt-2 font-display text-xl font-bold">修改角色和状态</h4>
        </div>
        <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
          立即生效
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">角色</span>
          <select
            data-testid={`access-member-role-select-${member.id}`}
            value={role}
            onChange={(event) => setRole(event.target.value)}
            disabled={pending}
            className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
          >
            {roles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">状态</span>
          <select
            data-testid={`access-member-status-select-${member.id}`}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            disabled={pending}
            className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none disabled:opacity-60"
          >
            {MEMBER_STATUS_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          data-testid={`access-member-update-${member.id}`}
          type="submit"
          disabled={pending || !changed}
          className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
        >
          {pending ? "保存中..." : "保存修改"}
        </button>
        <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">
          成员状态会影响后续登录和可用权限。
        </p>
      </div>
      <MutationFeedback
        error={mutationError}
        success={mutationSuccess}
        errorTestID={`access-member-error-${member.id}`}
        successTestID={`access-member-success-${member.id}`}
      />
    </form>
  );
}

function MemberCard({
  member,
  currentSession,
  roles,
}: {
  member: WorkspaceMember;
  currentSession: AuthSession;
  roles: WorkspaceRole[];
}) {
  const activeSession = currentSession.memberId === member.id && sessionIsActive(currentSession);

  return (
    <div
      data-testid={`access-member-${member.id}`}
      className={cn(
        "rounded-[22px] border-2 border-[var(--shock-ink)] px-4 py-4",
        activeSession ? "bg-[var(--shock-lime)]" : "bg-white"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">成员</p>
          <h3 className="mt-2 font-display text-2xl font-bold">{member.name}</h3>
          <p className="mt-1 break-all font-mono text-[11px] text-[color:rgba(24,20,14,0.62)]">{member.email}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            data-testid={`access-member-role-${member.id}`}
            className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            {roleLabel(member.role)}
          </span>
          <span
            data-testid={`access-member-status-${member.id}`}
            className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]"
          >
            {memberStatusLabel(member.status)}
          </span>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">权限数</p>
          <p className="mt-2 text-sm leading-6">{member.permissions.length}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">来源</p>
          <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(member.source, "未返回")}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">加入时间</p>
          <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(member.addedAt, "初始成员")}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">最近在线</p>
          <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(member.lastSeenAt, "未返回")}</p>
        </div>
      </div>
      {activeSession ? (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">当前会话</p>
      ) : null}
      <MemberManagementControls member={member} roles={roles} visible={canManageMembers(currentSession)} />
    </div>
  );
}

function SessionActionPanel({
  session,
  members,
}: {
  session: AuthSession;
  members: WorkspaceMember[];
}) {
  const { loginAuthSession, logoutAuthSession } = usePhaseZeroState();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("当前浏览器");
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMutationError(null);
    try {
      await loginAuthSession({ email, name, deviceLabel });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  async function handleQuickLogin(member: WorkspaceMember) {
    setEmail(member.email);
    setName(member.name);
    setPending(true);
    setMutationError(null);
    try {
      await loginAuthSession({ email: member.email, name: member.name, deviceLabel });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  async function handleLogout() {
    setPending(true);
    setMutationError(null);
    try {
      await logoutAuthSession();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "退出失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone={sessionStatusTone(session)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">登录</p>
          <h2 className="mt-2 font-display text-4xl font-bold">进入或切换当前工作区</h2>
        </div>
        <span
          data-testid="access-session-status"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {sessionStatusLabel(session)}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="当前身份" value={valueOrPlaceholder(session.email, "未登录")} />
        <Metric label="当前角色" value={roleLabel(session.role)} />
        <Metric label="权限数" value={String(session.permissions.length)} />
        <Metric label="登录方式" value={valueOrPlaceholder(session.authMethod, "未登录")} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_0.9fr]">
        <form onSubmit={handleLogin} className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">邮箱登录</p>
          <h3 className="mt-2 font-display text-2xl font-bold">用邮箱进入工作区</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            输入邮箱就能进入工作区；如果只是换成员，也在这里完成。
          </p>
          <div className="mt-4 grid gap-3">
            <input
              data-testid="access-login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
              placeholder="mina@openshock.dev"
              required
            />
            <input
              data-testid="access-login-device-label"
              type="text"
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
              placeholder="当前浏览器"
            />
            <input
              data-testid="access-login-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
              placeholder="可选：显示名"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              data-testid="access-login-submit"
              type="submit"
              disabled={pending}
              className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
            >
              {pending ? "进入中..." : "进入工作区"}
            </button>
            <button
              data-testid="access-logout-submit"
              type="button"
              disabled={pending || !sessionIsActive(session)}
              onClick={() => void handleLogout()}
              className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
            >
              退出
            </button>
          </div>
          {mutationError ? (
            <p data-testid="access-auth-error" className="mt-4 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] text-white">
              {mutationError}
            </p>
          ) : null}
        </form>

        <div className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">快速切换</p>
          <h3 className="mt-2 font-display text-2xl font-bold">快速切换成员</h3>
          <div className="mt-4 grid gap-3">
            {members.map((member) => (
              <button
                key={member.id}
                data-testid={`access-quick-login-${member.id}`}
                type="button"
                disabled={pending}
                onClick={() => void handleQuickLogin(member)}
                className="flex items-center justify-between gap-3 rounded-[16px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3 text-left disabled:opacity-60"
              >
                <div>
                  <p className="font-display text-xl font-bold">{member.name}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                    {member.email}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {roleLabel(member.role)}
                  </span>
                  <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                    {memberStatusLabel(member.status)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">当前会话</p>
            <h3 className="mt-2 font-display text-2xl font-bold">当前登录态和权限清单</h3>
          </div>
          <span data-testid="access-session-role" className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {roleLabel(session.role)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">邮箱</p>
            <p data-testid="access-session-email" className="mt-2 break-all text-sm leading-6">
              {valueOrPlaceholder(session.email, "未登录")}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">登录时间</p>
            <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(session.signedInAt, "未登录")}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">最近在线</p>
            <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(session.lastSeenAt, "未返回")}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">设备</p>
            <p data-testid="access-session-device-label" className="mt-2 text-sm leading-6">
              {valueOrPlaceholder(session.deviceLabel, "当前浏览器")}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">设备认证</p>
            <p data-testid="access-session-device-auth" className="mt-2 text-sm leading-6">
              {deviceAuthLabel(session.deviceAuthStatus)}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">恢复方式</p>
            <p data-testid="access-session-recovery-status" className="mt-2 text-sm leading-6">
              {recoveryStatusLabel(session.recoveryStatus)}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {session.permissions.length > 0 ? (
            session.permissions.map((permission) => <PermissionChip key={permission} permission={permission} />)
          ) : (
            <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]">
              暂无权限
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function IdentityRecoveryPanel({
  session,
  members,
  devices,
}: {
  session: AuthSession;
  members: WorkspaceMember[];
  devices: AuthDevice[];
}) {
  const { verifyMemberEmail, authorizeAuthDevice, requestPasswordReset, completePasswordReset, bindExternalIdentity } = usePhaseZeroState();
  const currentMember = members.find((member) => member.id === session.memberId) ?? null;
  const memberDevices = currentMember ? devices.filter((device) => device.memberId === currentMember.id) : [];
  const [resetEmail, setResetEmail] = useState("");
  const [recoveryDeviceLabel, setRecoveryDeviceLabel] = useState("恢复用笔记本");
  const [identityProvider, setIdentityProvider] = useState("github");
  const [identityHandle, setIdentityHandle] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationSuccess, setMutationSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (currentMember?.email && !resetEmail) {
      setResetEmail(currentMember.email);
    }
  }, [currentMember?.email, resetEmail]);

  async function runMutation(action: string, task: () => Promise<void>, successMessage: string) {
    setPendingAction(action);
    setMutationError(null);
    setMutationSuccess(null);
    try {
      await task();
      setMutationSuccess(successMessage);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : `${action} 失败`);
    } finally {
      setPendingAction(null);
    }
  }

  const linkedIdentities = currentMember?.linkedIdentities ?? [];
  const devicePending = session.deviceAuthStatus !== "authorized";
  const verifyPending = session.emailVerificationStatus !== "verified";

  return (
    <Panel tone={sessionIsActive(session) ? "white" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">身份恢复</p>
          <h2 className="mt-2 font-display text-3xl font-bold">处理邮箱验证、设备授权和登录恢复</h2>
        </div>
        <span
          data-testid="access-recovery-status"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {recoveryStatusLabel(session.recoveryStatus)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">在这里可以完成邮箱验证、设备授权、密码重置和外部身份绑定。</p>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="邮箱验证" value={emailVerificationLabel(session.emailVerificationStatus)} />
        <Metric label="设备认证" value={deviceAuthLabel(session.deviceAuthStatus)} />
        <Metric label="重置状态" value={valueOrPlaceholder(session.passwordResetStatus, "空闲")} />
        <Metric label="已绑定身份" value={String(linkedIdentities.length)} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_0.96fr]">
        <div className="space-y-4">
          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">当前恢复动作</p>
                <h3 className="mt-2 font-display text-2xl font-bold">完成邮箱和设备确认</h3>
              </div>
              <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {sessionIsActive(session) ? "可操作" : "请先登录"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                data-testid="access-verify-email-submit"
                type="button"
                disabled={!sessionIsActive(session) || !verifyPending || pendingAction !== null}
                onClick={() =>
                  void runMutation(
                    "verify-email",
                    async () => {
                      await verifyMemberEmail();
                    },
                    "邮箱已验证"
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                验证邮箱
              </button>
              <button
                data-testid="access-authorize-device-submit"
                type="button"
                disabled={!sessionIsActive(session) || !devicePending || pendingAction !== null}
                onClick={() =>
                  void runMutation(
                    "authorize-device",
                    async () => {
                      await authorizeAuthDevice({ deviceId: session.deviceId, deviceLabel: session.deviceLabel });
                    },
                    `${valueOrPlaceholder(session.deviceLabel, "当前浏览器")} 已授权`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                授权当前设备
              </button>
            </div>
          </div>

          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">密码重置 / 会话恢复</p>
            <h3 className="mt-2 font-display text-2xl font-bold">在另一台设备上恢复登录</h3>
            <div className="mt-4 grid gap-3">
              <input
                data-testid="access-request-reset-email"
                type="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                placeholder="you@company.com"
              />
              <input
                data-testid="access-complete-reset-device-label"
                type="text"
                value={recoveryDeviceLabel}
                onChange={(event) => setRecoveryDeviceLabel(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                placeholder="恢复用笔记本"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                data-testid="access-request-reset-submit"
                type="button"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runMutation(
                    "request-reset",
                    async () => {
                      await requestPasswordReset({ email: resetEmail });
                    },
                    `${resetEmail.trim().toLowerCase()} 已进入待重置状态`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                发起重置
              </button>
              <button
                data-testid="access-complete-reset-submit"
                type="button"
                disabled={pendingAction !== null}
                onClick={() =>
                  void runMutation(
                    "complete-reset",
                    async () => {
                      await completePasswordReset({ email: resetEmail, deviceLabel: recoveryDeviceLabel });
                    },
                    `${recoveryDeviceLabel.trim() || "恢复用设备"} 已恢复登录`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white disabled:opacity-60"
              >
                在另一设备完成恢复
              </button>
            </div>
          </div>

          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">外部身份绑定</p>
            <h3 className="mt-2 font-display text-2xl font-bold">绑定外部身份</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <select
                data-testid="access-bind-identity-provider"
                value={identityProvider}
                onChange={(event) => setIdentityProvider(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none"
              >
                <option value="github">GitHub</option>
                <option value="google">Google</option>
                <option value="sso">工作区 SSO</option>
              </select>
              <input
                data-testid="access-bind-identity-handle"
                type="text"
                value={identityHandle}
                onChange={(event) => setIdentityHandle(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                placeholder="@openshock-member"
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                data-testid="access-bind-identity-submit"
                type="button"
                disabled={!sessionIsActive(session) || pendingAction !== null}
                onClick={() =>
                  void runMutation(
                    "bind-identity",
                    async () => {
                      await bindExternalIdentity({ provider: identityProvider, handle: identityHandle });
                    },
                    `${identityProvider} 身份已绑定到当前成员`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                绑定外部身份
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">恢复信息</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">恢复邮箱</p>
                <p data-testid="access-recovery-email" className="mt-2 break-all text-sm leading-6">
                  {valueOrPlaceholder(currentMember?.recoveryEmail, "未返回")}
                </p>
              </div>
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">邮箱验证</p>
                <p data-testid="access-recovery-email-status" className="mt-2 text-sm leading-6">
                  {emailVerificationLabel(currentMember?.emailVerificationStatus)}
                </p>
              </div>
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">密码重置</p>
                <p data-testid="access-recovery-reset-status" className="mt-2 text-sm leading-6">
                  {valueOrPlaceholder(currentMember?.passwordResetStatus, "空闲")}
                </p>
              </div>
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">已绑定身份</p>
                <p data-testid="access-recovery-identity-count" className="mt-2 text-sm leading-6">
                  {linkedIdentities.length}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">已授权设备</p>
            <div className="mt-4 grid gap-3">
              {memberDevices.length > 0 ? (
                memberDevices.map((device) => (
                  <div key={device.id} data-testid={`access-device-${device.id}`} className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-display text-xl font-bold">{device.label}</p>
                        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">
                          {valueOrPlaceholder(device.lastSeenAt, "未返回")}
                        </p>
                      </div>
                      <span
                        data-testid={`access-device-status-${device.id}`}
                        className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]"
                      >
                        {deviceAuthLabel(device.status)}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em]">当前成员还没有已授权设备。</p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {linkedIdentities.length > 0 ? (
                linkedIdentities.map((identity) => (
                  <span
                    key={`${identity.provider}:${identity.handle}`}
                    data-testid={`access-identity-${identity.provider}`}
                    className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]"
                  >
                    {identity.provider} · {identity.handle}
                  </span>
                ))
              ) : (
                <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em]">
                  暂无已绑定身份
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <MutationFeedback
        error={mutationError}
        success={mutationSuccess}
        errorTestID="access-recovery-error"
        successTestID="access-recovery-success"
      />
    </Panel>
  );
}

function DurableMemberPreferencePanel() {
  const { state } = usePhaseZeroState();
  const member =
    state.auth.members.find((item) => item.id === state.auth.session.memberId) ??
    state.auth.members.find((item) => item.role === "owner") ??
    null;

  if (!member) {
    return null;
  }

  return (
    <Panel tone="yellow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">成员偏好</p>
          <h2 className="mt-2 font-display text-3xl font-bold">当前成员的默认设置</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {member.email}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">这里会显示当前成员保存的默认智能体、起始页面和 GitHub 身份。</p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Metric label="默认智能体" value={findAgentName(member.preferences.preferredAgentId, state.agents)} />
        <p className="sr-only" data-testid="access-durable-preferred-agent">{findAgentName(member.preferences.preferredAgentId, state.agents)}</p>
        <Metric label="起始路由" value={valueOrPlaceholder(member.preferences.startRoute, "未声明")} />
        <p className="sr-only" data-testid="access-durable-start-route">{valueOrPlaceholder(member.preferences.startRoute, "未声明")}</p>
        <Metric label="GitHub 身份" value={valueOrPlaceholder(member.githubIdentity?.handle, "未绑定")} />
        <p className="sr-only" data-testid="access-durable-github-handle">{valueOrPlaceholder(member.githubIdentity?.handle, "未绑定")}</p>
      </div>
    </Panel>
  );
}

function AccessReadyPanel({
  title,
  summary,
  href,
  actionLabel,
}: {
  title: string;
  summary: string;
  href: string;
  actionLabel: string;
}) {
  return (
    <Panel tone="lime">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">已就绪</p>
          <h2 className="mt-2 font-display text-3xl font-bold">{title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">{summary}</p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-[44px] items-center rounded-[14px] border-2 border-[var(--shock-ink)] bg-white px-4 py-2 font-mono text-[11px] uppercase tracking-[0.16em] shadow-[var(--shock-shadow-sm)] transition-transform hover:-translate-y-0.5"
        >
          {actionLabel}
        </Link>
      </div>
    </Panel>
  );
}

function FirstStartJourneyPanel() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <AccessStateNotice
        title="正在读取当前登录状态"
        message="正在检查当前登录状态。"
        tone="yellow"
      />
    );
  }

  if (error) {
    return <AccessStateNotice title="暂时连不上登录信息" message={error} tone="pink" />;
  }

  const journey = buildFirstStartJourney(state.workspace, state.auth.session);
  const onboardingLabel = onboardingStatusLabel(state.workspace.onboarding.status);

  return (
    <Panel tone={journey.onboardingDone ? "lime" : journey.accessReady ? "yellow" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">下一步</p>
          <h2 className="mt-2 font-display text-3xl font-bold">登录后去哪里</h2>
        </div>
        <span
          data-testid="access-first-start-next-route"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {journey.nextHref}
        </span>
      </div>
      <p
        data-testid="access-first-start-summary"
        className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.78)]"
      >
        {journey.nextSummary}
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Metric label="现在做什么" value={journey.nextLabel} />
        <p className="sr-only" data-testid="access-first-start-next-label">{journey.nextLabel}</p>
        <Metric label="准备好后进入" value={journey.launchHref} />
        <p className="sr-only" data-testid="access-first-start-launch-route">{journey.launchHref}</p>
        <Metric label="当前进度" value={onboardingLabel} />
        <p className="sr-only" data-testid="access-first-start-onboarding-status">{onboardingLabel}</p>
      </div>
      <div className="mt-5 grid gap-3 xl:grid-cols-3">
        {journey.steps.map((step) => (
          <Panel
            key={step.id}
            tone={journeyTone(step.status)}
            className="!p-3.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-2xl font-bold">{step.label}</p>
                <p
                  data-testid={`access-first-start-step-${step.id}-summary`}
                  className="mt-2 text-sm leading-6 text-[color:rgba(24,20,14,0.74)]"
                >
                  {step.summary}
                </p>
              </div>
              <span
                data-testid={`access-first-start-step-${step.id}-status`}
                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                {step.status}
              </span>
            </div>
          </Panel>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          data-testid="access-first-start-next-link"
          href={journey.nextHref}
          className="rounded-2xl border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.18em] shadow-[4px_4px_0_0_var(--shock-ink)] transition-transform hover:-translate-y-0.5"
        >
          {journey.nextLabel}
        </Link>
        <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.72)]">
          登录页只负责带你回到正确的位置。
        </p>
      </div>
    </Panel>
  );
}

export function LiveAccessContextRail() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading || error) {
    return (
      <DetailRail
        label="登录检查"
        items={[
          { label: "登录", value: loading ? "同步中" : "同步失败" },
          { label: "角色", value: loading ? "同步中" : "同步失败" },
          { label: "成员", value: loading ? "同步中" : "同步失败" },
          { label: "权限", value: loading ? "同步中" : "同步失败" },
        ]}
      />
    );
  }

  const session = state.auth.session;
  const ownerCount = state.auth.members.filter((member) => member.role === "owner").length;
  const journey = buildFirstStartJourney(state.workspace, session);

  return (
    <DetailRail
      label="登录检查"
      items={[
        { label: "登录", value: `${sessionStatusLabel(session)} / ${valueOrPlaceholder(session.email, "未登录")}` },
        { label: "恢复", value: recoveryStatusLabel(session.recoveryStatus) },
        { label: "设备", value: deviceAuthLabel(session.deviceAuthStatus) },
        { label: "成员", value: `${state.auth.members.length} 人 / ${ownerCount} 位所有者` },
        { label: "模板", value: `${valueOrPlaceholder(state.workspace.onboarding.templateId, "未选模板")} / ${onboardingStatusLabel(state.workspace.onboarding.status)}` },
        { label: "下一步", value: `${journey.nextLabel} / ${journey.nextHref}` },
        { label: "权限", value: `${session.permissions.length} 项` },
      ]}
    />
  );
}

export function LiveAccessOverview() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <AccessStateNotice
        title="正在读取登录与成员信息"
        message="马上就好。我们先把当前成员、角色和可用操作载入出来。"
        tone="yellow"
      />
    );
  }

  if (error) {
    return <AccessStateNotice title="身份页同步失败" message={error} tone="pink" />;
  }

  const session = state.auth.session;
  const members = state.auth.members;
  const roles = state.auth.roles;
  const devices = state.auth.devices ?? [];
  const activeMembers = members.filter((member) => member.status === "active").length;
  const invitedMembers = members.filter((member) => member.status === "invited").length;
  const suspendedMembers = members.filter((member) => member.status === "suspended").length;
  const manageAllowed = canManageMembers(session);
  const journey = buildFirstStartJourney(state.workspace, session);
  const accessReady = journey.accessReady;
  const onboardingDone = journey.onboardingDone;

  return (
    <div className="space-y-4">
      {accessReady ? (
        <AccessReadyPanel
          title={onboardingDone ? "你已经进入工作区" : "你已经登录，可以继续了"}
          summary={
            onboardingDone
              ? "当前账号、邮箱和设备都没问题，不需要再做登录操作。直接回到聊天就行。"
              : "当前账号、邮箱和设备都已经确认完毕。现在只需要继续完成工作区配置。"
          }
          href={journey.nextHref}
          actionLabel={journey.nextLabel}
        />
      ) : null}

      {!accessReady ? <SessionActionPanel session={session} members={members} /> : null}
      {!accessReady || !onboardingDone ? <IdentityRecoveryPanel session={session} members={members} devices={devices} /> : null}
      <FirstStartJourneyPanel />

      <details data-testid="access-advanced-details" className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <summary
          data-testid="access-advanced-toggle"
          className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.72)]"
        >
          切换成员和更多设置
        </summary>
        <div className="mt-4 space-y-4">
          {accessReady ? <SessionActionPanel session={session} members={members} /> : null}
          <DurableMemberPreferencePanel />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
            <Panel tone="paper" className="shadow-[8px_8px_0_0_var(--shock-yellow)]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">权限</p>
                  <h2 className="mt-2 font-display text-3xl font-bold">当前身份能做什么</h2>
                </div>
                <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
                  {session.permissions.length} 项权限
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
                这里只放高级权限信息。大多数情况下，你不需要先看这些再开始使用工作区。
              </p>
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <PermissionProbe
                  label="事项 / 看板"
                  permission="issue.create"
                  summary="当前身份能不能新建事项并推进到执行。"
                  href="/board"
                  session={session}
                />
                <PermissionProbe
                  label="讨论间 / 执行"
                  permission="room.reply"
                  summary="当前身份能不能在房间里继续发言和驱动执行。"
                  href="/rooms"
                  session={session}
                />
                <PermissionProbe
                  label="收件箱 / 评审"
                  permission="inbox.review"
                  summary="当前身份能不能处理评审和阻塞事项。"
                  href="/inbox"
                  session={session}
                />
                <PermissionProbe
                  label="设置 / 运行环境"
                  permission="runtime.manage"
                  summary="当前身份能不能改仓库和运行环境。"
                  href="/setup"
                  session={session}
                />
              </div>
            </Panel>

            <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em]">团队快照</p>
              <div className="mt-5 grid gap-3">
                <Metric label="在线成员" value={String(activeMembers)} />
                <Metric label="待加入成员" value={String(invitedMembers)} />
                <Metric label="停用成员" value={String(suspendedMembers)} />
                <Metric label="成员管理" value={manageAllowed ? "所有者可管理" : "只读查看"} />
              </div>
            </Panel>
          </div>
        </div>
      </details>

      <details data-testid="access-member-admin-details" className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
        <summary
          data-testid="access-member-admin-toggle"
          className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.72)]"
        >
          邀请成员与角色管理
        </summary>
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_1.08fr]">
          <div className="space-y-4">
            <InviteMemberPanel session={session} roles={roles} />

            <Panel tone="yellow">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em]">工作区角色</p>
              <div className="mt-4 space-y-3">
                {roles.map((role) => (
                  <RoleCard key={role.id} role={role} />
                ))}
              </div>
            </Panel>
          </div>

          <Panel tone="paper">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">成员列表</p>
                <h2 className="mt-2 font-display text-3xl font-bold">当前工作区成员</h2>
              </div>
              <span
                data-testid="access-roster-mode"
                className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                {manageAllowed ? "可编辑" : "只读"}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
              只有需要管理成员时再展开这里。正常使用工作区时，你不需要先看这一层。
            </p>
            <div className="mt-5 space-y-3">
              {members.map((member) => (
                <MemberCard key={member.id} member={member} currentSession={session} roles={roles} />
              ))}
            </div>
          </Panel>
        </div>
      </details>
    </div>
  );
}
