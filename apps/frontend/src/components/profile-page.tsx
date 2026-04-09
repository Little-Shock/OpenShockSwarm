import { getBootstrap } from "@/lib/api";
import { OperatorProfilePanel } from "@/components/operator-profile-panel";
import { ShellFrame } from "@/components/shell-frame";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";

function ProfileFact({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-white px-4 py-3">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-black/42">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-semibold text-black/82">{value}</div>
    </div>
  );
}

export async function ProfilePage() {
  const bootstrap = await getBootstrap();
  const issueRoomCount = bootstrap.rooms.filter((room) => room.kind === "issue").length;
  const discussionRoomCount = bootstrap.rooms.filter(
    (room) => room.kind === "discussion",
  ).length;

  return (
    <ShellFrame
      workspaceId={bootstrap.workspace.id}
      workspaceName={bootstrap.workspace.name}
      rooms={bootstrap.rooms}
      agents={bootstrap.agents}
      activeRoute="/profile"
      title="Personal Info"
      subtitle="Manage the member identity used by human-triggered actions in this workspace."
      rightRail={
        <div className="space-y-3.5 p-3.5">
          <Card className="rounded-[18px] px-3.5 py-3.5">
            <Eyebrow>Workspace</Eyebrow>
            <div className="display-font mt-2 text-2xl font-black">
              {bootstrap.workspace.name}
            </div>
          </Card>
          <Card className="rounded-[18px] px-3.5 py-3.5">
            <Eyebrow>Identity Scope</Eyebrow>
            <div className="mt-3 space-y-2">
              <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] text-black/72">
                Room posts and new room creation
              </div>
              <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] text-black/72">
                Task decisions, approvals, and delivery actions
              </div>
              <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 text-[13px] text-black/72">
                Workspace repo updates from this browser
              </div>
            </div>
          </Card>
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <OperatorProfilePanel workspaceName={bootstrap.workspace.name} />

        <Card className="rounded-[18px] px-4 py-4">
          <Eyebrow className="mb-3">Workspace Footprint</Eyebrow>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ProfileFact label="Issue Rooms" value={String(issueRoomCount)} />
            <ProfileFact
              label="Discussion Rooms"
              value={String(discussionRoomCount)}
            />
            <ProfileFact
              label="Agents Visible"
              value={String(bootstrap.agents.length)}
            />
            <ProfileFact
              label="Repo Bindings"
              value={String(bootstrap.workspace.repoBindings.length)}
            />
          </div>
        </Card>
      </div>
    </ShellFrame>
  );
}
