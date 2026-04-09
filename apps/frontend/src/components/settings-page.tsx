import { getBootstrap } from "@/lib/api";
import { ShellFrame } from "@/components/shell-frame";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { WorkspaceRepoBinding } from "@/components/workspace-repo-binding";

function statusTone(status: string) {
  switch (status) {
    case "online":
    case "ready":
      return "green";
    case "busy":
    case "running":
      return "blue";
    default:
      return "neutral";
  }
}

export async function SettingsPage() {
  const bootstrap = await getBootstrap();
  const defaultRepo = bootstrap.workspace.repoBindings.find((binding) => binding.isDefault);
  const onlineRuntimes = bootstrap.runtimes.filter((runtime) => runtime.status === "online");
  const busyRuntimes = bootstrap.runtimes.filter((runtime) => runtime.status === "busy");

  return (
    <ShellFrame
      workspaceId={bootstrap.workspace.id}
      workspaceName={bootstrap.workspace.name}
      rooms={bootstrap.rooms}
      agents={bootstrap.agents}
      activeRoute="/settings"
      title="System Config"
      subtitle="Configure the workspace execution repo and inspect runtime readiness."
      rightRail={
        <div className="space-y-3.5 p-3.5">
          <Card className="rounded-[18px] px-3.5 py-3.5">
            <Eyebrow>Default Repo</Eyebrow>
            <div className="display-font mt-2 text-lg font-black">
              {defaultRepo?.label || "Missing"}
            </div>
            <p className="mt-2 text-[13px] leading-6 text-black/72">
              {defaultRepo?.repoPath || "Bind one repo so issue runs and delivery steps share the same execution root."}
            </p>
          </Card>
          <Card className="rounded-[18px] px-3.5 py-3.5">
            <Eyebrow>Runtime Readiness</Eyebrow>
            <div className="mt-3 grid gap-2">
              <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5">
                <div className="action-card-label">Online</div>
                <div className="action-card-value mt-1">{onlineRuntimes.length}</div>
              </div>
              <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5">
                <div className="action-card-label">Busy</div>
                <div className="action-card-value mt-1">{busyRuntimes.length}</div>
              </div>
              <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5">
                <div className="action-card-label">Total</div>
                <div className="action-card-value mt-1">{bootstrap.runtimes.length}</div>
              </div>
            </div>
          </Card>
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <WorkspaceRepoBinding
          workspaceId={bootstrap.workspace.id}
          bindings={bootstrap.workspace.repoBindings}
        />

        <Card className="rounded-[18px] px-4 py-4">
          <Eyebrow className="mb-3">Registered Runtimes</Eyebrow>
          <div className="space-y-2">
            {bootstrap.runtimes.map((runtime) => (
              <div
                key={runtime.id}
                className="flex items-center justify-between rounded-[14px] border border-[var(--border)] bg-white px-3 py-3"
              >
                <div>
                  <div className="text-[14px] font-semibold text-black/82">{runtime.name}</div>
                  <div className="mt-1 text-[12px] text-black/55">
                    {runtime.provider} · {runtime.id}
                  </div>
                </div>
                <Badge tone={statusTone(runtime.status)}>{runtime.status}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </ShellFrame>
  );
}
