"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createAgent, deleteAgent, updateAgent } from "@/lib/api";
import type { Agent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/cn";

type AgentManagementPanelProps = {
  agents: Agent[];
};

type AgentFormState = {
  name: string;
  prompt: string;
};

const EMPTY_FORM: AgentFormState = {
  name: "",
  prompt: "",
};

function toFormState(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    prompt: agent.prompt,
  };
}

function AgentFormFields({
  form,
  isEditing,
  onChange,
}: {
  form: AgentFormState;
  isEditing: boolean;
  onChange: (field: keyof AgentFormState, value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black/48">
          Agent Name
        </span>
        <input
          value={form.name}
          onChange={(event) => onChange("name", event.target.value)}
          placeholder="research_partner"
          disabled={isEditing}
          autoCapitalize="off"
          spellCheck={false}
          className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--accent-blue)] disabled:bg-[var(--surface-muted)] disabled:text-black/45"
        />
      </label>

      <label className="grid gap-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black/48">
          Agent Prompt
        </span>
        <textarea
          value={form.prompt}
          onChange={(event) => onChange("prompt", event.target.value)}
          placeholder="定义这个 agent 的系统提示词：工作方式、擅长领域、沟通风格、边界、判断原则和偏好。"
          className="min-h-[132px] rounded-[12px] border border-[var(--border)] bg-white px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-[var(--accent-blue)]"
        />
      </label>

    </div>
  );
}

export function AgentManagementPanel({ agents }: AgentManagementPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM);
  const orderedAgents = [...agents].sort((a, b) => a.name.localeCompare(b.name));
  const focusedAgentId = searchParams.get("focus")?.trim() ?? "";

  const editingAgent =
    (editingAgentId
      ? orderedAgents.find((agent) => agent.id === editingAgentId)
      : null) ?? null;

  useEffect(() => {
    if (!focusedAgentId) {
      return;
    }

    const element = document.querySelector<HTMLElement>(`[data-agent-id="${focusedAgentId}"]`);
    element?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedAgentId]);

  function updateForm(field: keyof AgentFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateModal() {
    setFeedback(null);
    setEditingAgentId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEditModal(agent: Agent) {
    setFeedback(null);
    setEditingAgentId(agent.id);
    setForm(toFormState(agent));
    setModalOpen(true);
  }

  function closeModal() {
    if (isPending) {
      return;
    }
    resetModalState();
  }

  function resetModalState() {
    setModalOpen(false);
    setEditingAgentId(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit() {
    const payload = {
      name: form.name.trim(),
      prompt: form.prompt.trim(),
    };

    startTransition(async () => {
      try {
        setFeedback(null);
        if (editingAgent) {
          await updateAgent(editingAgent.id, {
            name: payload.name,
            prompt: payload.prompt,
          });
        } else {
          await createAgent(payload);
        }
        resetModalState();
        router.refresh();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "保存 agent 失败。");
      }
    });
  }

  function handleDelete(agent: Agent) {
    const confirmed = window.confirm(`确认删除 ${agent.name} 吗？`);
    if (!confirmed) {
      return;
    }

    startTransition(async () => {
      try {
        setFeedback(null);
        await deleteAgent(agent.id);
        router.refresh();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "删除 agent 失败。");
      }
    });
  }

  return (
    <>
      <Card className="rounded-[12px] px-4 py-4 shadow-[0_4px_12px_rgba(31,35,41,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Eyebrow>Agents</Eyebrow>
          <Button type="button" variant="primary" size="md" onClick={openCreateModal}>
            新建 Agent
          </Button>
        </div>

        {feedback ? (
          <div className="mb-3 rounded-[10px] border border-orange-200 bg-orange-50 px-3 py-2 text-[12px] text-orange-900">
            {feedback}
          </div>
        ) : null}

        <div className="hidden overflow-hidden rounded-[12px] border border-[var(--border)] bg-white md:block">
          <div className="grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.65fr)_auto] gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-black/45">
            <div>Agent</div>
            <div>Agent Prompt</div>
            <div className="text-right">Actions</div>
          </div>

          {orderedAgents.length === 0 ? (
            <div className="px-3 py-6 text-[13px] text-black/52">还没有 agent。</div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {orderedAgents.map((agent) => (
                <div
                  key={agent.id}
                  data-agent-id={agent.id}
                  className={cn(
                    "grid grid-cols-[minmax(0,0.95fr)_minmax(0,1.65fr)_auto] items-center gap-3 px-3 py-2.5",
                    focusedAgentId === agent.id && "bg-[var(--accent-blue-soft)]/70",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-black/84">
                      {agent.name}
                    </div>
                  </div>
                  <div className="min-w-0">
                    {agent.prompt ? (
                      <div className="line-clamp-2 text-[11px] leading-4.5 text-black/56">
                        {agent.prompt}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      onClick={() => openEditModal(agent)}
                    >
                      编辑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isPending}
                      className="text-orange-700 hover:bg-orange-50"
                      onClick={() => handleDelete(agent)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 md:hidden">
          {orderedAgents.length === 0 ? (
            <div className="rounded-[12px] border border-[var(--border)] bg-white px-3 py-4 text-[13px] text-black/52">
              还没有 agent。
            </div>
          ) : (
            orderedAgents.map((agent) => (
              <div
                key={agent.id}
                data-agent-id={agent.id}
                className={cn(
                  "rounded-[12px] border border-[var(--border)] bg-white px-3 py-3",
                  focusedAgentId === agent.id &&
                    "border-[var(--accent-blue)] bg-[var(--accent-blue-soft)]/60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold text-black/84">
                      {agent.name}
                    </div>
                  </div>
                </div>
                {agent.prompt ? (
                  <div className="mt-2 text-[12px] leading-5 text-black/58">
                    {agent.prompt}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => openEditModal(agent)}
                  >
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    className="text-orange-700 hover:bg-orange-50"
                    onClick={() => handleDelete(agent)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingAgent ? "编辑 Agent" : "创建 Agent"}
      >
        <div className="space-y-3">
          <AgentFormFields
            form={form}
            isEditing={editingAgent !== null}
            onChange={updateForm}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] leading-5 text-black/50">
              Agent 名称会用于页面展示，以及房间里像 <code>@agent_name</code> 这样的直接提及。
              名称创建后不可修改，且只能使用字母、数字和下划线。
              Agent Prompt 会注入到运行时指令中，作为这个 agent 的核心系统提示。
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={closeModal}>
                取消
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={
                  isPending ||
                  form.name.trim().length === 0 ||
                  form.prompt.trim().length === 0
                }
                onClick={handleSubmit}
              >
                {isPending ? "保存中..." : editingAgent ? "保存" : "创建"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
