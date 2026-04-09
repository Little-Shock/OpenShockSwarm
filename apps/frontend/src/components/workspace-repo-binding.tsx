"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOperator } from "@/components/operator-provider";
import { submitAction } from "@/lib/api";
import type { WorkspaceRepoBinding } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/info-hint";
import { Modal } from "@/components/ui/modal";

type WorkspaceRepoBindingProps = {
  workspaceId: string;
  bindings: WorkspaceRepoBinding[];
};

export function WorkspaceRepoBinding({
  workspaceId,
  bindings,
}: WorkspaceRepoBindingProps) {
  const router = useRouter();
  const { operatorName } = useCurrentOperator();
  const defaultBinding = bindings.find((binding) => binding.isDefault);
  const [repoPath, setRepoPath] = useState(defaultBinding?.repoPath ?? "");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    startTransition(async () => {
      try {
        const response = (await submitAction({
          actorType: "member",
          actorId: operatorName,
          actionType: "Workspace.bind_repo",
          targetType: "workspace",
          targetId: workspaceId,
          idempotencyKey: `workspace-bind-repo-${workspaceId}-${Date.now()}`,
          payload: {
            repoPath,
            makeDefault: true,
          },
        })) as { resultMessage?: string };

        setFeedback(response.resultMessage ?? "Workspace repo binding updated.");
        router.refresh();
        setOpen(false);
      } catch (error) {
        setFeedback(
          error instanceof Error
            ? error.message
            : "Failed to update workspace repo binding.",
        );
      }
    });
  }

  return (
    <>
      <div className="space-y-3">
        <div className="rounded-[16px] border border-[var(--border)] bg-[linear-gradient(180deg,rgba(247,248,250,0.96),rgba(255,255,255,0.98))] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="action-card-title">Workspace execution repo</div>
                <InfoHint label="统一 issue、run、merge 和 delivery 的仓库入口。" />
              </div>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="control-pill"
              onClick={() => {
                setRepoPath(defaultBinding?.repoPath ?? "");
                setOpen(true);
              }}
            >
              {defaultBinding ? "Update Repo" : "Bind Repo"}
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {bindings.length > 0 ? (
              bindings.map((binding) => (
                <div
                  key={binding.id}
                  className={binding.isDefault
                    ? "rounded-[12px] border border-[var(--accent-blue)]/16 bg-[var(--accent-blue-soft)]/55 px-3 py-2.5"
                    : "rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5"}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="action-card-value truncate">
                        {binding.label || "Workspace Repo"}
                      </div>
                      <div className="action-card-body mt-1 truncate">
                        {binding.repoPath}
                      </div>
                    </div>
                    <div
                      className={binding.isDefault
                        ? "rounded-full bg-white px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--accent-blue)]"
                        : "rounded-full bg-[var(--surface-muted)] px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em] text-black/45"}
                    >
                      {binding.isDefault ? "default" : binding.status}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="action-card-body rounded-[12px] border border-dashed border-[var(--border)] bg-white px-3 py-3">
                No repo is bound yet. Add one canonical workspace repo before execution.
              </div>
            )}
          </div>
        </div>
        {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={defaultBinding ? "Update Default Repo" : "Bind Default Repo"}
      >
        <form className="space-y-3" onSubmit={handleSubmit}>
          <input
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/absolute/path/to/local/repo"
            className="form-field"
          />
          <div className="flex items-center justify-end gap-2">
            <Button
              type="submit"
              disabled={isPending || repoPath.trim().length === 0}
              variant="primary"
              size="sm"
              className="control-pill"
            >
              {isPending ? "Updating..." : "Set Default Repo"}
            </Button>
          </div>
          {feedback ? <p className="text-xs text-black/60">{feedback}</p> : null}
        </form>
      </Modal>
    </>
  );
}
