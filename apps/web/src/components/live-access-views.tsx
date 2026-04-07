"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import type { AuthSession, WorkspaceMember, WorkspaceRole } from "@/lib/mock-data";
import { DetailRail, Panel } from "@/components/phase-zero-views";
import { usePhaseZeroState } from "@/lib/live-phase0";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function valueOrPlaceholder(value: string | undefined, fallback: string) {
  return value && value.trim() ? value : fallback;
}

function sessionIsActive(session: AuthSession) {
  return session.status === "active";
}

function hasPermission(session: AuthSession, permission: string) {
  return session.permissions.includes(permission);
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

function MemberCard({
  member,
  currentSession,
}: {
  member: WorkspaceMember;
  currentSession: AuthSession;
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
          <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
            {roleLabel(member.role)}
          </span>
          <span className="rounded-full border border-[var(--shock-ink)] bg-[var(--shock-paper)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em]">
            {memberStatusLabel(member.status)}
          </span>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[18px] border-2 border-[var(--shock-ink)] bg-white px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:rgba(24,20,14,0.6)]">permissions</p>
          <p className="mt-2 text-sm leading-6">{member.permissions.length}</p>
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
  const [pending, setPending] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMutationError(null);
    try {
      await loginAuthSession({ email, name });
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
      await loginAuthSession({ email: member.email, name: member.name });
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
            这一步直接走 live `POST /v1/auth/session` / `DELETE /v1/auth/session`，不再只展示“还缺合同”的占位说明。
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
          <h3 className="mt-2 font-display text-2xl font-bold">用 seed 身份快速切角色</h3>
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
                <span className="rounded-full border border-[var(--shock-ink)] bg-white px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em]">
                  {roleLabel(member.role)}
                </span>
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

  return (
    <DetailRail
      label="身份检查点"
      items={[
        { label: "Session", value: `${sessionStatusLabel(session)} / ${valueOrPlaceholder(session.email, "signed out")}` },
        { label: "Role", value: roleLabel(session.role) },
        { label: "Members", value: `${state.auth.members.length} roster / ${ownerCount} owner` },
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
        title="正在同步 login / session 真值"
        message="等待 server 返回当前 auth session、workspace members 和 role truth；这页不会再退回假壳。"
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
  const activeMembers = members.filter((member) => member.status === "active").length;
  const invitedMembers = members.filter((member) => member.status === "invited").length;

  return (
    <div className="space-y-4">
      <SessionActionPanel session={session} members={members} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_0.95fr]">
        <Panel tone="paper" className="shadow-[8px_8px_0_0_var(--shock-yellow)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">permission boundary</p>
              <h2 className="mt-2 font-display text-3xl font-bold">登录态和未登录态现在能被明确区分</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              {session.permissions.length} active permissions
            </span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            这层直接按当前 session permissions 读，不再把 auth/session/member 继续当成“下一拍才有”的占位说明。完整 invite / role mutation
            留给 `TKT-08`，action-level authz matrix 留给 `TKT-09`。
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
            <li>1. `TKT-07` 先收 login / logout / session persistence 和 access live truth。</li>
            <li>2. `TKT-08` 再补 invite、member mutation 和 role management UI。</li>
            <li>3. `TKT-09` 再把 issue / room / run / inbox / repo / runtime 动作全部接上 action-level authz matrix。</li>
          </ol>
          <div className="mt-5 grid gap-3">
            <Metric label="active members" value={String(activeMembers)} />
            <Metric label="invited members" value={String(invitedMembers)} />
            <Metric label="role definitions" value={String(roles.length)} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_1.08fr]">
        <Panel tone="yellow">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em]">workspace roles</p>
          <div className="mt-4 space-y-3">
            {roles.map((role) => (
              <RoleCard key={role.id} role={role} />
            ))}
          </div>
        </Panel>

        <Panel tone="paper">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[color:rgba(24,20,14,0.62)]">member roster</p>
              <h2 className="mt-2 font-display text-3xl font-bold">当前 workspace 成员真值</h2>
            </div>
            <span className="rounded-full border-2 border-[var(--shock-ink)] bg-white px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              read-live / mutate-later
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[color:rgba(24,20,14,0.76)]">
            roster / role / permissions 已经能从 live state 读到；invite / suspend / role change 仍留给后续票，不在 `TKT-07` 里提前扩 scope。
          </p>
          <div className="mt-5 space-y-3">
            {members.map((member) => (
              <MemberCard key={member.id} member={member} currentSession={session} />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
