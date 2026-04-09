"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import type { AuthDevice, AuthSession, WorkspaceMember, WorkspaceRole } from "@/lib/phase-zero-types";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { buildFirstStartJourney, type FirstStartJourneyStepStatus } from "@/lib/first-start-journey";
import { usePhaseZeroState } from "@/lib/live-phase0";

const MEMBER_STATUS_OPTIONS = [
  { value: "active", label: "在线成员", summary: "成员已可正常登录并使用对应角色权限。" },
  { value: "invited", label: "待接受", summary: "邀请已发出，成员下次登录时会从 invited 进入 active。" },
  { value: "suspended", label: "已暂停", summary: "成员仍保留在 roster，但登录与活跃权限会被阻断。" },
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
      return "Owner";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
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
      return "链路正常";
    case "verification_required":
      return "等邮箱验证";
    case "device_approval_required":
      return "等设备授权";
    case "reset_pending":
      return "等密码重置";
    case "recovered":
      return "已恢复";
    default:
      return "未返回";
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
      {permission}
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">permission probe</p>
          <h3 className="mt-2 font-display text-2xl font-bold">{label}</h3>
        </div>
        <span
          data-testid={`access-probe-status-${probeID}`}
          className={cn(
            "rounded-full border-2 border-[var(--shock-ink)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]",
            allowed ? "bg-white" : "bg-[var(--shock-paper)]"
          )}
        >
          {allowed ? "allowed" : "blocked"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">{summary}</p>
      <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">required permission</p>
        <p className="mt-2 text-sm leading-6">{permission}</p>
      </div>
    </Link>
  );
}

function RoleCard({ role }: { role: WorkspaceRole }) {
  return (
    <div data-testid={`access-role-${role.id}`} className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">workspace role</p>
          <h3 className="mt-2 font-display text-2xl font-bold">{role.label}</h3>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {role.permissions.length} perms
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
      setMutationSuccess(`${email.trim().toLowerCase()} invited as ${roleLabel(role)}`);
      setEmail("");
      setName("");
      setRole(defaultInviteRoleID(roles));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "invite failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone={manageAllowed ? "yellow" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">owner-side roster mutation</p>
          <h2 className="mt-2 font-display text-3xl font-bold">邀请成员，把 roster / role / status 真正做成可操作能力</h2>
        </div>
        <span
          data-testid="access-members-manage-status"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {manageAllowed ? "owner can mutate" : "read-only session"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        这层直接走 live `POST /v1/workspace/members` 和 `PATCH /v1/workspace/members/:id`。当前票只把 owner invite、member role/status
        变更和登录激活收平；完整 action-level authz matrix 继续留给 `TKT-09`。
      </p>
      {!manageAllowed ? (
        <div className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p data-testid="access-members-manage-boundary" className="font-mono text-[11px] uppercase tracking-[0.16em]">
            当前 session 没有 `members.manage`。切回 Owner 后才可 invite / update role / suspend。
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
            placeholder="reviewer@openshock.dev"
            required
          />
          <input
            data-testid="access-invite-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!manageAllowed || pending}
            className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none disabled:opacity-60"
            placeholder="Reviewer"
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
            {pending ? "inviting..." : "invite member"}
          </button>
          <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">
            默认以 Viewer 发邀请，后续可在 roster 中继续调 role / status。
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
      setMutationSuccess(`${roleLabel(role)} / ${memberStatusLabel(status)} 已同步到 live roster`);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "member update failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleUpdate} className="mt-4 rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">role / status mutation</p>
          <h4 className="mt-2 font-display text-xl font-bold">直接对齐 server roster 合同</h4>
        </div>
        <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
          live patch
        </span>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">role</span>
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
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">status</span>
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
          {pending ? "syncing..." : "save member"}
        </button>
        <p className="text-sm leading-6 text-[color:rgba(24,20,14,0.7)]">
          `active / invited / suspended` 会直接影响后续登录与 session 权限。
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">workspace member</p>
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
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">permissions</p>
          <p className="mt-2 text-sm leading-6">{member.permissions.length}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">source</p>
          <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(member.source, "未返回")}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">added at</p>
          <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(member.addedAt, "seed member")}</p>
        </div>
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">last seen</p>
          <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(member.lastSeenAt, "未返回")}</p>
        </div>
      </div>
      {activeSession ? (
        <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[color:rgba(24,20,14,0.62)]">current session</p>
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
  const [deviceLabel, setDeviceLabel] = useState("Current Browser");
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMutationError(null);
    try {
      await loginAuthSession({ email, name, deviceLabel });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "login failed");
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
      setMutationError(error instanceof Error ? error.message : "login failed");
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
      setMutationError(error instanceof Error ? error.message : "logout failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel tone={sessionStatusTone(session)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">session foundation</p>
          <h2 className="mt-2 font-display text-4xl font-bold">把 login / logout / session lifecycle 摆成真实 surface</h2>
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
        <Metric label="登录方式" value={valueOrPlaceholder(session.authMethod, "session not active")} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_0.9fr]">
        <form onSubmit={handleLogin} className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">email login</p>
          <h3 className="mt-2 font-display text-2xl font-bold">切换当前会话</h3>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
            这一步直接走 live `POST /v1/auth/session` / `DELETE /v1/auth/session`；当前 device label 也会一起写进 recovery truth。
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
              placeholder="Current Browser"
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
              {pending ? "signing in..." : "email login"}
            </button>
            <button
              data-testid="access-logout-submit"
              type="button"
              disabled={pending || !sessionIsActive(session)}
              onClick={() => void handleLogout()}
              className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
            >
              sign out
            </button>
          </div>
          {mutationError ? (
            <p data-testid="access-auth-error" className="mt-4 rounded-[14px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] text-white">
              {mutationError}
            </p>
          ) : null}
        </form>

        <div className="rounded-[24px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">quick login</p>
          <h3 className="mt-2 font-display text-2xl font-bold">用 roster 身份快速回放 invite / role / status 变化</h3>
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
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">current session truth</p>
            <h3 className="mt-2 font-display text-2xl font-bold">当前登录态和权限清单</h3>
          </div>
          <span data-testid="access-session-role" className="rounded-full border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {roleLabel(session.role)}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">email</p>
            <p data-testid="access-session-email" className="mt-2 break-all text-sm leading-6">
              {valueOrPlaceholder(session.email, "signed out")}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">signed in at</p>
            <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(session.signedInAt, "未登录")}</p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">last seen</p>
            <p className="mt-2 text-sm leading-6">{valueOrPlaceholder(session.lastSeenAt, "未返回")}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">device</p>
            <p data-testid="access-session-device-label" className="mt-2 text-sm leading-6">
              {valueOrPlaceholder(session.deviceLabel, "Current Browser")}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">device auth</p>
            <p data-testid="access-session-device-auth" className="mt-2 text-sm leading-6">
              {deviceAuthLabel(session.deviceAuthStatus)}
            </p>
          </div>
          <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">recovery</p>
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
              no permissions
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
  const [recoveryDeviceLabel, setRecoveryDeviceLabel] = useState("Recovery Laptop");
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
      setMutationError(error instanceof Error ? error.message : `${action} failed`);
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
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">identity recovery chain</p>
          <h2 className="mt-2 font-display text-3xl font-bold">把 device auth、verify、reset 和 session recovery 收成同一条产品流</h2>
        </div>
        <span
          data-testid="access-recovery-status"
          className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
        >
          {recoveryStatusLabel(session.recoveryStatus)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        当前票只收 `device authorization / email verify / reset / session recovery / external identity binding`。更大的 onboarding / durable config
        仍留在后续票，不在这里偷混。
      </p>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Metric label="email verify" value={emailVerificationLabel(session.emailVerificationStatus)} />
        <Metric label="device auth" value={deviceAuthLabel(session.deviceAuthStatus)} />
        <Metric label="reset status" value={valueOrPlaceholder(session.passwordResetStatus, "idle")} />
        <Metric label="linked identity" value={String(linkedIdentities.length)} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_0.96fr]">
        <div className="space-y-4">
          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">current recovery actions</p>
                <h3 className="mt-2 font-display text-2xl font-bold">先把当前 session 补齐 verify / device auth</h3>
              </div>
              <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                {sessionIsActive(session) ? "active session" : "sign in first"}
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
                    "当前成员邮箱已转成 verified"
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-lime)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                verify email
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
                    `${valueOrPlaceholder(session.deviceLabel, "Current Browser")} 已转成 authorized`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                authorize current device
              </button>
            </div>
          </div>

          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">password reset / session recovery</p>
            <h3 className="mt-2 font-display text-2xl font-bold">在另一设备上恢复登录并确认权限链</h3>
            <div className="mt-4 grid gap-3">
              <input
                data-testid="access-request-reset-email"
                type="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                placeholder="member@openshock.dev"
              />
              <input
                data-testid="access-complete-reset-device-label"
                type="text"
                value={recoveryDeviceLabel}
                onChange={(event) => setRecoveryDeviceLabel(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] px-3 py-3 text-sm outline-none"
                placeholder="Recovery Laptop"
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
                    `${resetEmail.trim().toLowerCase()} 已进入 reset pending`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                request reset
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
                    `${recoveryDeviceLabel.trim() || "Recovery Laptop"} 已恢复同一条 session / permission truth`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-pink)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-white disabled:opacity-60"
              >
                complete reset on another device
              </button>
            </div>
          </div>

          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">external identity binding</p>
            <h3 className="mt-2 font-display text-2xl font-bold">把外部身份挂到同一条成员真相上</h3>
            <div className="mt-4 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <select
                data-testid="access-bind-identity-provider"
                value={identityProvider}
                onChange={(event) => setIdentityProvider(event.target.value)}
                className="w-full rounded-[10px] border-2 border-[var(--shock-ink)] bg-white px-3 py-3 text-sm outline-none"
              >
                <option value="github">GitHub</option>
                <option value="google">Google</option>
                <option value="sso">Workspace SSO</option>
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
                    `${identityProvider} identity 已绑定到当前成员`
                  )
                }
                className="rounded-[10px] border-2 border-[var(--shock-ink)] bg-[var(--shock-yellow)] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] disabled:opacity-60"
              >
                bind external identity
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-[var(--shock-paper)] px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">member recovery truth</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">recovery email</p>
                <p data-testid="access-recovery-email" className="mt-2 break-all text-sm leading-6">
                  {valueOrPlaceholder(currentMember?.recoveryEmail, "未返回")}
                </p>
              </div>
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">email verification</p>
                <p data-testid="access-recovery-email-status" className="mt-2 text-sm leading-6">
                  {emailVerificationLabel(currentMember?.emailVerificationStatus)}
                </p>
              </div>
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">password reset</p>
                <p data-testid="access-recovery-reset-status" className="mt-2 text-sm leading-6">
                  {valueOrPlaceholder(currentMember?.passwordResetStatus, "idle")}
                </p>
              </div>
              <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">linked identity</p>
                <p data-testid="access-recovery-identity-count" className="mt-2 text-sm leading-6">
                  {linkedIdentities.length}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[22px] border-2 border-[var(--shock-ink)] bg-white px-4 py-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.62)]">authorized devices</p>
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
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em]">当前成员还没有 trusted device truth。</p>
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
                  no linked identity
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
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">durable member truth</p>
          <h2 className="mt-2 font-display text-3xl font-bold">当前身份页直接读取同一份 member preference / github identity snapshot</h2>
        </div>
        <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
          {member.email}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.78)]">
        这里不再自己攒一套 access 层默认值。`/settings` 写回的 preferred agent、start route 和 github identity，会在 `/access` 直接按 member truth 投影出来。
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Metric label="preferred agent" value={findAgentName(member.preferences.preferredAgentId, state.agents)} />
        <p className="sr-only" data-testid="access-durable-preferred-agent">{findAgentName(member.preferences.preferredAgentId, state.agents)}</p>
        <Metric label="start route" value={valueOrPlaceholder(member.preferences.startRoute, "未声明")} />
        <p className="sr-only" data-testid="access-durable-start-route">{valueOrPlaceholder(member.preferences.startRoute, "未声明")}</p>
        <Metric label="github identity" value={valueOrPlaceholder(member.githubIdentity?.handle, "未绑定")} />
        <p className="sr-only" data-testid="access-durable-github-handle">{valueOrPlaceholder(member.githubIdentity?.handle, "未绑定")}</p>
      </div>
    </Panel>
  );
}

function FirstStartJourneyPanel() {
  const { state } = usePhaseZeroState();
  const journey = buildFirstStartJourney(state.workspace, state.auth.session);
  const onboardingLabel = valueOrPlaceholder(state.workspace.onboarding.status, "not_started");

  return (
    <Panel tone={journey.onboardingDone ? "lime" : journey.accessReady ? "yellow" : "paper"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">first-start journey</p>
          <h2 className="mt-2 font-display text-3xl font-bold">首次启动不再要求你自己猜是回 `/access` 还是继续 `/setup`</h2>
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
        <Metric label="next action" value={journey.nextLabel} />
        <p className="sr-only" data-testid="access-first-start-next-label">{journey.nextLabel}</p>
        <Metric label="launch route" value={journey.launchHref} />
        <p className="sr-only" data-testid="access-first-start-launch-route">{journey.launchHref}</p>
        <Metric label="onboarding" value={onboardingLabel} />
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
          当身份链已接通时，这里直接把下一跳压成单值；完成 onboarding 后会把 launch route 切回主工作面。
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
        label="身份检查点"
        items={[
          { label: "Session", value: loading ? "同步中" : "同步失败" },
          { label: "Role", value: loading ? "同步中" : "同步失败" },
          { label: "Members", value: loading ? "同步中" : "同步失败" },
          { label: "Permissions", value: loading ? "同步中" : "同步失败" },
        ]}
      />
    );
  }

  const session = state.auth.session;
  const ownerCount = state.auth.members.filter((member) => member.role === "owner").length;
  const journey = buildFirstStartJourney(state.workspace, session);

  return (
    <DetailRail
      label="身份检查点"
      items={[
        { label: "Session", value: `${sessionStatusLabel(session)} / ${valueOrPlaceholder(session.email, "signed out")}` },
        { label: "Recovery", value: recoveryStatusLabel(session.recoveryStatus) },
        { label: "Device", value: deviceAuthLabel(session.deviceAuthStatus) },
        { label: "Members", value: `${state.auth.members.length} roster / ${ownerCount} owner` },
        { label: "Onboarding", value: `${valueOrPlaceholder(state.workspace.onboarding.templateId, "未选模板")} / ${valueOrPlaceholder(state.workspace.onboarding.status, "未声明")}` },
        { label: "Next", value: `${journey.nextLabel} / ${journey.nextHref}` },
        { label: "Permissions", value: `${session.permissions.length} live permissions` },
      ]}
    />
  );
}

export function LiveAccessOverview() {
  const { state, loading, error } = usePhaseZeroState();

  if (loading) {
    return (
      <AccessStateNotice
        title="正在同步 invite / member / role 真值"
        message="等待 server 返回当前 auth session、workspace members 和 role truth；这页现在会直接显示 live roster，也会把 owner-side member mutation 摆出来。"
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

  return (
    <div className="space-y-4">
      <SessionActionPanel session={session} members={members} />
      <IdentityRecoveryPanel session={session} members={members} devices={devices} />
      <FirstStartJourneyPanel />
      <DurableMemberPreferencePanel />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
        <Panel tone="paper" className="shadow-[8px_8px_0_0_var(--shock-yellow)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">permission boundary</p>
              <h2 className="mt-2 font-display text-3xl font-bold">登录态、成员管理态和未登录态现在能被明确区分</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {session.permissions.length} active permissions
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            `TKT-08` 把 owner-side member mutation 接到 live API，当前 session 是否具备 `members.manage` 会直接决定 roster 是否可变更。更大范围的
            issue / room / run / inbox / repo / runtime 动作矩阵，继续留给 `TKT-09`。
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <PermissionProbe
              label="Issues / Board"
              permission="issue.create"
              summary="决定当前身份能否真正发起新 issue，并把 lane 推进到 room / run / session。"
              href="/board"
              session={session}
            />
            <PermissionProbe
              label="Rooms / Runs"
              permission="room.reply"
              summary="区分当前 session 是不是只能看房间，还是可以继续发言和驱动执行。"
              href="/rooms"
              session={session}
            />
            <PermissionProbe
              label="Inbox / Review"
              permission="inbox.review"
              summary="显示当前身份能否参与 review / blocked 收口，而不只是围观状态对象。"
              href="/inbox"
              session={session}
            />
            <PermissionProbe
              label="Setup / Runtime"
              permission="runtime.manage"
              summary="区分谁能改 runtime pairing / repo-level control plane，避免默认把所有人都当 owner。"
              href="/setup"
              session={session}
            />
          </div>
        </Panel>

        <Panel tone="ink" className="shadow-[6px_6px_0_0_var(--shock-pink)]">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">current scope boundary</p>
          <ol className="mt-4 space-y-3 text-sm leading-6 text-white/78">
            <li>1. `TKT-07` 已收住 login / logout / session persistence 和 access live truth。</li>
            <li>2. `TKT-08` 当前收 invite、member roster mutation、role/status management。</li>
            <li>3. `TKT-29` 当前把 device auth / verify / reset / recovery 补成同一条身份链。</li>
            <li>4. `TKT-09` 再把 issue / room / run / inbox / repo / runtime 动作全部接上 action-level authz matrix。</li>
          </ol>
          <div className="mt-5 grid gap-3">
            <Metric label="active members" value={String(activeMembers)} />
            <Metric label="invited members" value={String(invitedMembers)} />
            <Metric label="suspended members" value={String(suspendedMembers)} />
            <Metric label="member management" value={manageAllowed ? "owner active" : "read only"} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_1.08fr]">
        <div className="space-y-4">
          <InviteMemberPanel session={session} roles={roles} />

          <Panel tone="yellow">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em]">workspace roles</p>
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
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">member roster</p>
              <h2 className="mt-2 font-display text-3xl font-bold">当前 workspace 成员真值</h2>
            </div>
            <span
              data-testid="access-roster-mode"
              className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]"
            >
              {manageAllowed ? "owner-mutate-live" : "read-live"}
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            roster / role / status 现在直接走 live state + live member mutation。invite / role change / suspend 的 exact evidence 会在这张票里收平；
            完整 action-level authz matrix 仍不在当前 scope。
          </p>
          <div className="mt-5 space-y-3">
            {members.map((member) => (
              <MemberCard key={member.id} member={member} currentSession={session} roles={roles} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
