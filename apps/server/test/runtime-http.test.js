import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { ServerCoordinator } from "../src/coordinator.js";
import { createHttpServer } from "../src/http-server.js";
import { DEFAULT_SAMPLE_FIXTURE } from "../src/runtime-fixtures.js";

async function requestJson({ port, method, path, body, headers }) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const requestHeaders = {
    ...(payload
      ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      : {}),
    ...(headers ?? {})
  };
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: requestHeaders
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const parsed = text.length > 0 ? JSON.parse(text) : null;
          resolve({
            statusCode: response.statusCode,
            body: parsed
          });
        });
      }
    );
    request.on("error", reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

async function withRuntimeServer(options, run) {
  const coordinatorOptions =
    options && typeof options === "object" && options.coordinatorOptions && typeof options.coordinatorOptions === "object"
      ? options.coordinatorOptions
      : {};
  const serverOptions =
    options && typeof options === "object"
      ? Object.fromEntries(Object.entries(options).filter(([key]) => key !== "coordinatorOptions"))
      : options;
  const coordinator = new ServerCoordinator({ escalationMs: 10_000, ...coordinatorOptions });
  const server = createHttpServer(coordinator, serverOptions);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to bind runtime test server");
  }

  try {
    await run({
      port: address.port,
      coordinator
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function renderContractPath(template, { topicId, runId }) {
  return template
    .replaceAll(":topicId", encodeURIComponent(topicId))
    .replaceAll(":runId", encodeURIComponent(runId));
}

test("runtime config + fixture seed expose integrated sample topic", async () => {
  await withRuntimeServer(
    {
      serverPort: 4310,
      shellUrl: "http://127.0.0.1:5173"
    },
    async ({ port }) => {
      const smokeBefore = await requestJson({
        port,
        method: "GET",
        path: "/runtime/smoke"
      });
      assert.equal(smokeBefore.statusCode, 200);
      assert.equal(smokeBefore.body.sampleTopicReady, false);
      assert.equal(smokeBefore.body.sampleTopicAgentCount, 0);

      const config = await requestJson({
        port,
        method: "GET",
        path: "/runtime/config"
      });
      assert.equal(config.statusCode, 200);
      assert.equal(config.body.serverPort, 4310);
      assert.equal(config.body.shellUrl, "http://127.0.0.1:5173");
      assert.equal(config.body.sampleFixture.topicId, DEFAULT_SAMPLE_FIXTURE.topicId);

      const seed = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seed.statusCode, 200);
      assert.equal(seed.body.topicCreated, true);
      assert.equal(seed.body.agentCount, 3);

      const smokeAfter = await requestJson({
        port,
        method: "GET",
        path: "/runtime/smoke"
      });
      assert.equal(smokeAfter.statusCode, 200);
      assert.equal(smokeAfter.body.sampleTopicReady, true);
      assert.equal(smokeAfter.body.sampleTopicAgentCount, 3);
      assert.equal(smokeAfter.body.sampleTopicId, DEFAULT_SAMPLE_FIXTURE.topicId);
    }
  );
});

test("runtime daemon event endpoint writes daemon-origin event into topic timeline", async () => {
  await withRuntimeServer(
    {
      daemonName: "daemon_integrated_01",
      fixture: {
        topicId: "topic_runtime_daemon"
      }
    },
    async ({ port }) => {
      const seed = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seed.statusCode, 200);
      assert.equal(seed.body.fixture.topicId, "topic_runtime_daemon");

      const daemonEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_runtime_daemon",
          type: "feedback_ingest",
          laneId: "lane_sample_01",
          runId: "run_sample_01",
          payload: {
            feedbackId: "feedback_runtime_01",
            summary: "daemon completed first run"
          }
        }
      });
      assert.equal(daemonEvent.statusCode, 200);
      assert.equal(daemonEvent.body.state, "accepted");
      assert.equal(daemonEvent.body.result.feedbackCount, 1);

      const messages = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_runtime_daemon/messages?route=topic"
      });
      assert.equal(messages.statusCode, 200);
      const feedbackMessage = messages.body.find((message) => message.type === "feedback_ingest");
      assert.ok(feedbackMessage);
      assert.equal(feedbackMessage.sourceAgentId, "daemon_integrated_01");
      assert.equal(feedbackMessage.sourceRole, "system");
      assert.equal(feedbackMessage.payload.summary, "daemon completed first run");
    }
  );
});

test("runtime daemon endpoint blocks shared truth write-through and keeps topic truth unchanged", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const seed = await requestJson({
      port,
      method: "POST",
      path: "/runtime/fixtures/seed",
      body: {}
    });
    assert.equal(seed.statusCode, 200);

    const blocked = await requestJson({
      port,
      method: "POST",
      path: "/runtime/daemon/events",
      body: {
        topicId: DEFAULT_SAMPLE_FIXTURE.topicId,
        type: "shared_truth_proposal",
        sourceAgentId: "daemon_runtime_fake",
        sourceRole: "system",
        truthRevision: 1,
        payload: {
          patch: {
            deliveryState: {
              state: "pr_ready",
              prUrl: "https://evil.example/pr"
            },
            decisions: [{ by: "daemon", note: "runtime backdoor write" }]
          }
        }
      }
    });
    assert.equal(blocked.statusCode, 400);
    assert.equal(blocked.body.error, "runtime_daemon_event_field_forbidden");

    const overview = await requestJson({
      port,
      method: "GET",
      path: `/topics/${DEFAULT_SAMPLE_FIXTURE.topicId}/overview`
    });
    assert.equal(overview.statusCode, 200);
    assert.equal(overview.body.revision, 1);
    assert.equal(overview.body.truth.deliveryState.state, "not_started");
    assert.equal(overview.body.truth.decisions.length, 0);
  });
});

test("runtime fixture seed rejects request override and remains deterministic", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const blockedOverride = await requestJson({
      port,
      method: "POST",
      path: "/runtime/fixtures/seed",
      body: {
        topicId: "topic_custom_backdoor",
        leadAgentId: "lead_custom"
      }
    });
    assert.equal(blockedOverride.statusCode, 400);
    assert.equal(blockedOverride.body.error, "runtime_fixture_override_forbidden");

    const smokeBefore = await requestJson({
      port,
      method: "GET",
      path: "/runtime/smoke"
    });
    assert.equal(smokeBefore.statusCode, 200);
    assert.equal(smokeBefore.body.sampleTopicReady, false);
    assert.equal(smokeBefore.body.sampleTopicId, DEFAULT_SAMPLE_FIXTURE.topicId);

    const seeded = await requestJson({
      port,
      method: "POST",
      path: "/runtime/fixtures/seed",
      body: {}
    });
    assert.equal(seeded.statusCode, 200);
    assert.equal(seeded.body.fixture.topicId, DEFAULT_SAMPLE_FIXTURE.topicId);
    assert.equal(seeded.body.fixture.leadAgentId, DEFAULT_SAMPLE_FIXTURE.leadAgentId);

    const smokeAfter = await requestJson({
      port,
      method: "GET",
      path: "/runtime/smoke"
    });
    assert.equal(smokeAfter.statusCode, 200);
    assert.equal(smokeAfter.body.sampleTopicReady, true);
    assert.equal(smokeAfter.body.sampleTopicId, DEFAULT_SAMPLE_FIXTURE.topicId);
  });
});

test("v1 integration projection keeps projection ownership and stable pr_id contract", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_projection"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const dispatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_projection/messages",
        body: {
          type: "dispatch",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          payload: {
            workerAgentId: "worker_sample_01",
            task: "batch1 integration projection"
          }
        }
      });
      assert.equal(dispatch.statusCode, 200);

      const dispatchAccepted = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_projection/messages",
        body: {
          type: "status_report",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          payload: {
            event: "dispatch_accepted",
            dispatchId: dispatch.body.messageId
          }
        }
      });
      assert.equal(dispatchAccepted.statusCode, 200);

      const daemonFeedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_projection",
          type: "feedback_ingest",
          laneId: "lane_projection_01",
          runId: "run_projection_01",
          payload: {
            feedbackId: "feedback_projection_01",
            summary: "execution plane feedback",
            trace_id: "trace_projection_01"
          }
        }
      });
      assert.equal(daemonFeedback.statusCode, 200);

      const topicEventsPage1 = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_projection/events?limit=1"
      });
      assert.equal(topicEventsPage1.statusCode, 200);
      assert.equal(topicEventsPage1.body.projection, "control_plane_projection");
      assert.equal(topicEventsPage1.body.items.length, 1);
      assert.ok(typeof topicEventsPage1.body.next_cursor === "string");
      assert.equal(topicEventsPage1.body.items[0].topic_id, "topic_v1_projection");

      const topicEventsPage2 = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/topic_v1_projection/events?cursor=${encodeURIComponent(topicEventsPage1.body.next_cursor)}&limit=5`
      });
      assert.equal(topicEventsPage2.statusCode, 200);
      assert.ok(topicEventsPage2.body.items.length >= 1);

      const runTimeline = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_projection_01/timeline?topic_id=topic_v1_projection"
      });
      assert.equal(runTimeline.statusCode, 200);
      assert.equal(runTimeline.body.projection, "execution_plane_projection");
      assert.equal(runTimeline.body.items.length, 1);
      assert.equal(runTimeline.body.items[0].message_type, "feedback_ingest");

      const debugJoin = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/events?topic_id=topic_v1_projection&run_id=run_projection_01&limit=10"
      });
      assert.equal(debugJoin.statusCode, 200);
      assert.equal(debugJoin.body.projection, "cross_plane_debug_join");
      assert.equal(debugJoin.body.items.length, 1);
      assert.equal(debugJoin.body.items[0].projection_scope, "execution_projection");
      assert.equal(debugJoin.body.items[0].join_key.trace_id, "trace_projection_01");

      const repoBinding = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_projection/repo-binding",
        body: {
          provider_ref: {
            provider: "github",
            repo_ref: "little-shock/openshockswarm"
          },
          default_branch: "main",
          bound_by: "lead_sample_01"
        }
      });
      assert.equal(repoBinding.statusCode, 200);
      assert.equal(repoBinding.body.provider_ref.provider, "github");
      assert.equal(repoBinding.body.provider_ref.repo_ref, "little-shock/openshockswarm");
      assert.equal(repoBinding.body.projection_meta.resource, "repo_binding");
      assert.equal(repoBinding.body.projection_meta.server_owned_truth, false);

      const createdPr = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_projection/prs",
        body: {
          provider_ref: {
            provider: "github",
            repo_ref: "little-shock/openshockswarm",
            pr_number: 42,
            pr_node_id: "PR_node_42"
          },
          title: "Phase 2 batch1 integration projection",
          url: "https://github.com/little-shock/openshockswarm/pull/42"
        }
      });
      assert.equal(createdPr.statusCode, 201);
      assert.ok(typeof createdPr.body.pr_id === "string" && createdPr.body.pr_id.startsWith("pr_"));
      assert.equal(createdPr.body.provider_ref.pr_number, 42);
      assert.equal(createdPr.body.projection_meta.resource, "pr_projection");

      const updatedPr = await requestJson({
        port,
        method: "PATCH",
        path: `/v1/prs/${encodeURIComponent(createdPr.body.pr_id)}`,
        body: {
          status: "merged"
        }
      });
      assert.equal(updatedPr.statusCode, 200);
      assert.equal(updatedPr.body.pr_id, createdPr.body.pr_id);
      assert.equal(updatedPr.body.status, "merged");
      assert.equal(updatedPr.body.provider_ref.pr_node_id, "PR_node_42");
      assert.equal(updatedPr.body.projection_meta.resource, "pr_projection");

      const review = await requestJson({
        port,
        method: "POST",
        path: `/v1/prs/${encodeURIComponent(createdPr.body.pr_id)}/reviews`,
        body: {
          actor_id: "sample_reviewer_01",
          state: "approved",
          summary: "looks good"
        }
      });
      assert.equal(review.statusCode, 201);
      assert.equal(review.body.state, "approved");

      const check = await requestJson({
        port,
        method: "POST",
        path: `/v1/prs/${encodeURIComponent(createdPr.body.pr_id)}/checks`,
        body: {
          name: "ci/build",
          status: "completed",
          conclusion: "success"
        }
      });
      assert.equal(check.statusCode, 201);
      assert.equal(check.body.conclusion, "success");

      const queriedPr = await requestJson({
        port,
        method: "GET",
        path: `/v1/prs/${encodeURIComponent(createdPr.body.pr_id)}`
      });
      assert.equal(queriedPr.statusCode, 200);
      assert.equal(queriedPr.body.pr_id, createdPr.body.pr_id);
      assert.equal(queriedPr.body.provider_ref.provider, "github");
      assert.equal(queriedPr.body.provider_ref.repo_ref, "little-shock/openshockswarm");
      assert.equal(queriedPr.body.reviews.length, 1);
      assert.equal(queriedPr.body.checks.length, 1);
      assert.equal(queriedPr.body.projection_meta.resource, "pr_projection");
    }
  );
});

test("v1 batch2 integration surface exposes run-history/replay/notification/inbox and shell compatibility contract", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch2"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const humanActor = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch2/agents",
        body: {
          agentId: "human_sample_01",
          role: "human",
          status: "active"
        }
      });
      assert.equal(humanActor.statusCode, 200);

      const handoff = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch2/messages",
        body: {
          type: "handoff_package",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          targetScope: "lead",
          runId: "run_batch2_01",
          laneId: "lane_sample_01",
          referencedArtifacts: ["artifact://batch2-a"],
          payload: {
            summary: "batch2 handoff ready"
          }
        }
      });
      assert.equal(handoff.statusCode, 200);

      const ack = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch2/messages",
        body: {
          type: "status_report",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          runId: "run_batch2_01",
          payload: {
            event: "handoff_ack",
            handoffId: handoff.body.messageId,
            resolvedArtifacts: ["artifact://batch2-a"]
          }
        }
      });
      assert.equal(ack.statusCode, 200);

      const merge = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch2/messages",
        body: {
          type: "merge_request",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          runId: "run_batch2_01",
          laneId: "lane_sample_01",
          payload: {
            handoffId: handoff.body.messageId,
            prUrl: "https://example.com/batch2/pr/1"
          }
        }
      });
      assert.equal(merge.statusCode, 200);
      assert.equal(merge.body.state, "merge_candidate");
      assert.equal(merge.body.result.status, "merge_candidate_waiting_human_gate");

      const daemonFeedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch2",
          type: "feedback_ingest",
          runId: "run_batch2_01",
          laneId: "lane_sample_01",
          payload: {
            feedbackId: "feedback_batch2_01",
            summary: "batch2 execution feedback",
            trace_id: "trace_batch2_01"
          }
        }
      });
      assert.equal(daemonFeedback.statusCode, 200);

      const runHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch2/run-history?limit=10"
      });
      assert.equal(runHistory.statusCode, 200);
      assert.equal(runHistory.body.projection, "execution_plane_projection");
      assert.ok(runHistory.body.items.some((item) => item.run_id === "run_batch2_01"));
      const runHistoryItem = runHistory.body.items.find((item) => item.run_id === "run_batch2_01");
      assert.ok(runHistoryItem);
      assert.equal(runHistoryItem.closeout_projection.topic_ref.topic_id, "topic_v1_batch2");
      assert.ok(runHistoryItem.closeout_projection.actor_refs.length >= 1);
      assert.ok(runHistoryItem.closeout_projection.artifact_refs.includes("artifact://batch2-a"));

      const runDetail = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch2_01?topic_id=topic_v1_batch2"
      });
      assert.equal(runDetail.statusCode, 200);
      assert.equal(runDetail.body.projection_meta.resource, "run_projection");
      assert.equal(runDetail.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(runDetail.body.run_id, "run_batch2_01");
      assert.equal(runDetail.body.topic_id, "topic_v1_batch2");
      assert.equal(runDetail.body.links.replay, "/v1/runs/run_batch2_01/replay");

      const runTimeline = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch2_01/timeline?topic_id=topic_v1_batch2"
      });
      assert.equal(runTimeline.statusCode, 200);
      assert.equal(runTimeline.body.projection_meta.resource, "run_timeline_projection");
      assert.equal(runTimeline.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(runTimeline.body.projection_meta.run_id, "run_batch2_01");

      const replayPage1 = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch2_01/replay?topic_id=topic_v1_batch2&limit=1"
      });
      assert.equal(replayPage1.statusCode, 200);
      assert.equal(replayPage1.body.projection, "execution_plane_projection");
      assert.equal(replayPage1.body.items.length, 1);
      assert.equal(replayPage1.body.items[0].closeout_projection.topic_ref.topic_id, "topic_v1_batch2");
      assert.ok(typeof replayPage1.body.items[0].closeout_projection.actor_ref?.actor_id === "string");
      if (typeof replayPage1.body.next_cursor === "string") {
        const replayPage2 = await requestJson({
          port,
          method: "GET",
          path: `/v1/runs/run_batch2_01/replay?topic_id=topic_v1_batch2&cursor=${encodeURIComponent(replayPage1.body.next_cursor)}&limit=10`
        });
        assert.equal(replayPage2.statusCode, 200);
      }

      const notifications = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch2/notifications?limit=10"
      });
      assert.equal(notifications.statusCode, 200);
      assert.equal(notifications.body.projection_meta.resource, "notification_projection");
      assert.equal(notifications.body.projection_meta.source_plane, "control_plane_projection");
      assert.equal(notifications.body.projection, "control_plane_projection");
      assert.ok(notifications.body.items.length >= 1);
      assert.equal(notifications.body.items[0].debug_anchor.topic_id, "topic_v1_batch2");
      assert.equal(notifications.body.items[0].closeout_projection.topic_ref.topic_id, "topic_v1_batch2");

      const runFeedback = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch2_01/feedback?topic_id=topic_v1_batch2"
      });
      assert.equal(runFeedback.statusCode, 200);
      assert.equal(runFeedback.body.projection_meta.resource, "run_feedback_projection");
      assert.equal(runFeedback.body.projection_meta.source_plane, "execution_plane_projection");

      const runHolds = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch2_01/holds?topic_id=topic_v1_batch2"
      });
      assert.equal(runHolds.statusCode, 200);
      assert.equal(runHolds.body.projection_meta.resource, "run_hold_projection");
      assert.equal(runHolds.body.projection_meta.source_plane, "execution_plane_projection");

      const inbox = await requestJson({
        port,
        method: "GET",
        path: "/v1/inbox/human_sample_01?topic_id=topic_v1_batch2&limit=20"
      });
      assert.equal(inbox.statusCode, 200);
      assert.equal(inbox.body.projection_meta.resource, "inbox_projection");
      assert.equal(inbox.body.projection_meta.source_plane, "control_plane_projection");
      assert.equal(inbox.body.projection, "control_plane_projection");
      const pendingHold = inbox.body.items.find((item) => item.kind === "approval_hold_pending");
      assert.ok(pendingHold);
      assert.equal(pendingHold.acked, false);

      const ackInbox = await requestJson({
        port,
        method: "POST",
        path: "/v1/inbox/human_sample_01/acks",
        body: {
          items: [
            {
              topic_id: "topic_v1_batch2",
              item_id: pendingHold.item_id,
              note: "acknowledged in batch2 test"
            }
          ]
        }
      });
      assert.equal(ackInbox.statusCode, 200);
      assert.equal(ackInbox.body.projection_meta.resource, "inbox_ack_projection");
      assert.equal(ackInbox.body.projection_meta.source_plane, "control_plane_projection");
      assert.equal(ackInbox.body.acked_items.length, 1);
      assert.equal(ackInbox.body.acked_items[0].item_id, pendingHold.item_id);

      const inboxAfterAck = await requestJson({
        port,
        method: "GET",
        path: "/v1/inbox/human_sample_01?topic_id=topic_v1_batch2&limit=20"
      });
      assert.equal(inboxAfterAck.statusCode, 200);
      const ackedHold = inboxAfterAck.body.items.find((item) => item.item_id === pendingHold.item_id);
      assert.ok(ackedHold);
      assert.equal(ackedHold.acked, true);
      assert.ok(typeof ackedHold.acknowledged_at === "string");

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.projection_meta.resource, "shell_adapter_compatibility_projection");
      assert.equal(shellCompatibility.body.adapter, "shell_v0a_compatibility_layer");
      assert.equal(shellCompatibility.body.backend_contract_source, "/v1/*");
      assert.ok(shellCompatibility.body.adapter_routes.includes("/api/v0a/shell-state"));
    }
  );
});

test("v1 batch3 integration hardening exposes compatibility window and cross-plane debug history aggregation", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch3_integration"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const dispatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch3_integration/messages",
        body: {
          type: "dispatch",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          runId: "run_batch3_01",
          laneId: "lane_batch3_01",
          payload: {
            workerAgentId: "worker_sample_01",
            task: "batch3 integration hardening"
          }
        }
      });
      assert.equal(dispatch.statusCode, 200);

      const accepted = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch3_integration/messages",
        body: {
          type: "status_report",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          runId: "run_batch3_01",
          laneId: "lane_batch3_01",
          payload: {
            event: "dispatch_accepted",
            dispatchId: dispatch.body.messageId,
            trace_id: "trace_batch3_dispatch_01"
          }
        }
      });
      assert.equal(accepted.statusCode, 200);

      const feedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch3_integration",
          type: "feedback_ingest",
          runId: "run_batch3_01",
          laneId: "lane_batch3_01",
          payload: {
            feedbackId: "feedback_batch3_01",
            summary: "batch3 debug history check",
            trace_id: "trace_batch3_feedback_01"
          }
        }
      });
      assert.equal(feedback.statusCode, 200);

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.contract_version, "v1.1");
      assert.equal(shellCompatibility.body.compatibility_window.policy, "bounded_bridge_window");
      assert.equal(shellCompatibility.body.retirement.phase, "phase2_batch3_window_open");
      assert.equal(
        shellCompatibility.body.retirement.debug_anchors.cross_plane_debug_history,
        "/v1/debug/history"
      );
      assert.ok(shellCompatibility.body.retirement.retirement_path.length >= 3);

      const historyPage = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_batch3_integration&run_id=run_batch3_01&limit=20"
      });
      assert.equal(historyPage.statusCode, 200);
      assert.equal(historyPage.body.projection, "cross_plane_debug_history_aggregation");
      assert.ok(historyPage.body.items.length >= 2);
      assert.ok(historyPage.body.items.some((item) => item.source === "message_projection"));
      assert.ok(historyPage.body.items.some((item) => item.source === "topic_history"));
      assert.ok(historyPage.body.items.every((item) => item.topic_id === "topic_v1_batch3_integration"));
      assert.ok(historyPage.body.items.every((item) => item.run_id === "run_batch3_01"));

      const historyCursorPage1 = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_batch3_integration&run_id=run_batch3_01&limit=1"
      });
      assert.equal(historyCursorPage1.statusCode, 200);
      assert.equal(historyCursorPage1.body.items.length, 1);
      assert.ok(typeof historyCursorPage1.body.next_cursor === "string");

      const historyCursorPage2 = await requestJson({
        port,
        method: "GET",
        path: `/v1/debug/history?topic_id=topic_v1_batch3_integration&run_id=run_batch3_01&cursor=${encodeURIComponent(
          historyCursorPage1.body.next_cursor
        )}&limit=5`
      });
      assert.equal(historyCursorPage2.statusCode, 200);
      assert.ok(historyCursorPage2.body.items.length >= 1);

      const missingFilter = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?limit=5"
      });
      assert.equal(missingFilter.statusCode, 400);
      assert.equal(missingFilter.body.error, "debug_history_filter_required");
    }
  );
});

test("v1 governance/eval integration evidence packet stays replayable for external consumer regression", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_governance_eval_pack"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const dispatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_governance_eval_pack/messages",
        body: {
          type: "dispatch",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          runId: "run_eval_01",
          laneId: "lane_eval_01",
          payload: {
            workerAgentId: "worker_sample_01",
            task: "governance eval evidence packet"
          }
        }
      });
      assert.equal(dispatch.statusCode, 200);

      const accepted = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_governance_eval_pack/messages",
        body: {
          type: "status_report",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          runId: "run_eval_01",
          laneId: "lane_eval_01",
          payload: {
            event: "dispatch_accepted",
            dispatchId: dispatch.body.messageId
          }
        }
      });
      assert.equal(accepted.statusCode, 200);

      const feedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_governance_eval_pack",
          type: "feedback_ingest",
          runId: "run_eval_01",
          laneId: "lane_eval_01",
          payload: {
            feedbackId: "feedback_eval_01",
            summary: "evidence packet regression",
            trace_id: "trace_eval_01",
            checkpoint_id: "checkpoint://eval-01",
            artifact_refs: ["artifact://eval-01"]
          }
        }
      });
      assert.equal(feedback.statusCode, 200);

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter"
      });
      assert.equal(shellCompatibility.statusCode, 200);

      const runReplay = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_eval_01/replay?topic_id=topic_v1_governance_eval_pack&limit=20"
      });
      assert.equal(runReplay.statusCode, 200);
      assert.ok(runReplay.body.items.length >= 1);
      assert.equal(runReplay.body.items[0].closeout_projection.topic_ref.topic_id, "topic_v1_governance_eval_pack");
      assert.ok(runReplay.body.items[0].closeout_projection.checkpoint_refs.includes("checkpoint://eval-01"));
      assert.ok(runReplay.body.items[0].closeout_projection.artifact_refs.includes("artifact://eval-01"));

      const runHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_governance_eval_pack/run-history?limit=20"
      });
      assert.equal(runHistory.statusCode, 200);
      const evalRun = runHistory.body.items.find((item) => item.run_id === "run_eval_01");
      assert.ok(evalRun);
      assert.equal(evalRun.closeout_projection.topic_ref.topic_id, "topic_v1_governance_eval_pack");
      assert.ok(evalRun.closeout_projection.checkpoint_refs.includes("checkpoint://eval-01"));
      assert.ok(evalRun.closeout_projection.artifact_refs.includes("artifact://eval-01"));

      const notifications = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_governance_eval_pack/notifications?limit=20"
      });
      assert.equal(notifications.statusCode, 200);
      assert.ok(notifications.body.items.length >= 1);
      assert.equal(
        notifications.body.items[0].closeout_projection.topic_ref.topic_id,
        "topic_v1_governance_eval_pack"
      );

      const debugEvents = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/events?topic_id=topic_v1_governance_eval_pack&run_id=run_eval_01&limit=20"
      });
      assert.equal(debugEvents.statusCode, 200);

      const debugHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_governance_eval_pack&run_id=run_eval_01&limit=20"
      });
      assert.equal(debugHistory.statusCode, 200);

      const cursorInvalid = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_governance_eval_pack&run_id=run_eval_01&cursor=broken_cursor"
      });
      assert.equal(cursorInvalid.statusCode, 400);
      assert.equal(cursorInvalid.body.error, "debug_history_cursor_invalid");

      const sourceSet = new Set(debugHistory.body.items.map((item) => item.source));
      const scopeSet = new Set(debugEvents.body.items.map((item) => item.projection_scope));
      const traceIds = new Set(
        debugHistory.body.items
          .map((item) => item.debug_anchor?.trace_id)
          .filter((traceId) => typeof traceId === "string" && traceId.length > 0)
      );

      const evidencePacket = {
        packet_version: "phase2_governance_eval_integration_v1",
        external_consumer_contract: {
          adapter_contract_version: shellCompatibility.body.contract_version,
          adapter_backend_source: shellCompatibility.body.backend_contract_source,
          compatibility_policy: shellCompatibility.body.compatibility_window.policy,
          retirement_phase: shellCompatibility.body.retirement.phase,
          debug_history_anchor: shellCompatibility.body.retirement.debug_anchors.cross_plane_debug_history
        },
        replay_evidence: {
          projection: runReplay.body.projection,
          cursor_scope: runReplay.body.cursor_scope,
          item_count: runReplay.body.items.length
        },
        debug_evidence: {
          event_projection: debugEvents.body.projection,
          history_projection: debugHistory.body.projection,
          history_cursor_scope: debugHistory.body.cursor_scope,
          sources: Array.from(sourceSet.values()).sort(),
          projection_scopes: Array.from(scopeSet.values()).sort(),
          trace_ids: Array.from(traceIds.values()).sort()
        },
        bad_path_regression: {
          debug_history_cursor_invalid: cursorInvalid.body.error
        }
      };

      const normalizedPacket = {
        packet_version: evidencePacket.packet_version,
        external_consumer_contract: evidencePacket.external_consumer_contract,
        replay_evidence: {
          projection: evidencePacket.replay_evidence.projection,
          cursor_scope: evidencePacket.replay_evidence.cursor_scope,
          has_items: evidencePacket.replay_evidence.item_count > 0
        },
        debug_evidence: {
          event_projection: evidencePacket.debug_evidence.event_projection,
          history_projection: evidencePacket.debug_evidence.history_projection,
          history_cursor_scope: evidencePacket.debug_evidence.history_cursor_scope,
          sources: evidencePacket.debug_evidence.sources,
          projection_scopes: evidencePacket.debug_evidence.projection_scopes,
          has_trace_id: evidencePacket.debug_evidence.trace_ids.length > 0
        },
        bad_path_regression: evidencePacket.bad_path_regression
      };

      assert.deepEqual(normalizedPacket, {
        packet_version: "phase2_governance_eval_integration_v1",
        external_consumer_contract: {
          adapter_contract_version: "v1.1",
          adapter_backend_source: "/v1/*",
          compatibility_policy: "bounded_bridge_window",
          retirement_phase: "phase2_batch3_window_open",
          debug_history_anchor: "/v1/debug/history"
        },
        replay_evidence: {
          projection: "execution_plane_projection",
          cursor_scope: "run:topic_v1_governance_eval_pack:run_eval_01:replay",
          has_items: true
        },
        debug_evidence: {
          event_projection: "cross_plane_debug_join",
          history_projection: "cross_plane_debug_history_aggregation",
          history_cursor_scope: "debug_history:topic:topic_v1_governance_eval_pack:run:run_eval_01",
          sources: ["message_projection", "topic_history"],
          projection_scopes: ["control_projection", "execution_projection"],
          has_trace_id: true
        },
        bad_path_regression: {
          debug_history_cursor_invalid: "debug_history_cursor_invalid"
        }
      });
    }
  );
});

test("v1 batch5 integration projection derives github/branch/notification/compatibility from delivery closeout truth", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch5_integration"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const repoBinding = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_batch5_integration/repo-binding",
        body: {
          provider_ref: {
            provider: "github",
            repo_ref: "little-shock/openshockswarm"
          },
          default_branch: "main",
          bound_by: "lead_sample_01"
        }
      });
      assert.equal(repoBinding.statusCode, 200);

      const handoff = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch5_integration/messages",
        body: {
          type: "handoff_package",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          targetScope: "lead",
          runId: "run_batch5_01",
          laneId: "lane_sample_01",
          referencedArtifacts: ["artifact://batch5-handoff"],
          payload: {
            summary: "batch5 handoff ready"
          }
        }
      });
      assert.equal(handoff.statusCode, 200);

      const ack = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch5_integration/messages",
        body: {
          type: "status_report",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          runId: "run_batch5_01",
          payload: {
            event: "handoff_ack",
            handoffId: handoff.body.messageId,
            resolvedArtifacts: ["artifact://batch5-handoff"]
          }
        }
      });
      assert.equal(ack.statusCode, 200);

      const merge = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch5_integration/messages",
        body: {
          type: "merge_request",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          runId: "run_batch5_01",
          laneId: "lane_sample_01",
          payload: {
            handoffId: handoff.body.messageId,
            prUrl: "https://github.com/little-shock/openshockswarm/pull/205",
            provider_ref: {
              provider: "github",
              repo_ref: "little-shock/openshockswarm",
              pr_number: 205
            },
            base_branch: "main",
            checkpoint_id: "checkpoint://batch5-delivery",
            artifact_refs: ["artifact://batch5-delivery"]
          }
        }
      });
      assert.equal(merge.statusCode, 200);

      const feedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch5_integration",
          type: "feedback_ingest",
          runId: "run_batch5_01",
          laneId: "lane_sample_01",
          payload: {
            feedbackId: "feedback_batch5_01",
            summary: "batch5 delivery lineage evidence",
            trace_id: "trace_batch5_01",
            checkpoint_id: "checkpoint://batch5-feedback",
            artifact_refs: ["artifact://batch5-feedback"]
          }
        }
      });
      assert.equal(feedback.statusCode, 200);

      const createdPr = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_batch5_integration/prs",
        body: {
          provider_ref: {
            provider: "github",
            repo_ref: "little-shock/openshockswarm",
            pr_number: 205
          },
          title: "batch5 delivery closeout projection",
          url: "https://github.com/little-shock/openshockswarm/pull/205"
        }
      });
      assert.equal(createdPr.statusCode, 201);

      const prList = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch5_integration/prs"
      });
      assert.equal(prList.statusCode, 200);
      assert.ok(prList.body.items.length >= 1);
      assert.equal(prList.body.delivery_projection.topic_ref.topic_id, "topic_v1_batch5_integration");
      assert.equal(prList.body.delivery_projection.merge_lifecycle_state, "awaiting_merge_gate");
      assert.equal(prList.body.delivery_projection.pr_writeback_ref.run_id, "run_batch5_01");
      assert.equal(
        prList.body.delivery_projection.pr_writeback_ref.pr_url,
        "https://github.com/little-shock/openshockswarm/pull/205"
      );
      assert.equal(prList.body.delivery_projection.branch_ref.base_branch, "main");
      assert.ok(prList.body.delivery_projection.delivery_ready_lineage.checkpoint_refs.includes("checkpoint://batch5-feedback"));
      assert.ok(prList.body.delivery_projection.delivery_ready_lineage.artifact_refs.includes("artifact://batch5-handoff"));

      const prDetail = await requestJson({
        port,
        method: "GET",
        path: `/v1/prs/${encodeURIComponent(createdPr.body.pr_id)}`
      });
      assert.equal(prDetail.statusCode, 200);
      assert.equal(prDetail.body.delivery_projection.pr_writeback_ref.run_id, "run_batch5_01");
      assert.equal(prDetail.body.delivery_projection.pr_writeback_ref.provider_ref.provider, "github");

      const repoBindingRead = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch5_integration/repo-binding"
      });
      assert.equal(repoBindingRead.statusCode, 200);
      assert.equal(repoBindingRead.body.repo_binding.default_branch, "main");
      assert.equal(repoBindingRead.body.delivery_projection.pr_writeback_ref.run_id, "run_batch5_01");

      const notifications = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch5_integration/notifications?limit=20"
      });
      assert.equal(notifications.statusCode, 200);
      assert.ok(notifications.body.items.length >= 1);
      assert.equal(notifications.body.delivery_projection.pr_writeback_ref.run_id, "run_batch5_01");
      assert.equal(
        notifications.body.items[0].delivery_projection.pr_writeback_ref.pr_url,
        "https://github.com/little-shock/openshockswarm/pull/205"
      );

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter?topic_id=topic_v1_batch5_integration"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.backend_derived_projection.topic_id, "topic_v1_batch5_integration");
      assert.equal(
        shellCompatibility.body.backend_derived_projection.delivery_projection.pr_writeback_ref.run_id,
        "run_batch5_01"
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes("/v1/topics/:topicId/prs")
      );
    }
  );
});

test("v1 batch5 integration projection remains available from server-owned closeout truth without legacy writeback message", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch5_truth_only"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const topicOverview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch5_truth_only/overview"
      });
      assert.equal(topicOverview.statusCode, 200);

      const repoBinding = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_batch5_truth_only/repo-binding",
        body: {
          provider_ref: {
            provider: "github",
            repo_ref: "little-shock/openshockswarm"
          },
          default_branch: "main",
          bound_by: "lead_sample_01"
        }
      });
      assert.equal(repoBinding.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch5_truth_only/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: topicOverview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "pr_ready",
                run_id: "run_batch5_truth_only_01"
              },
              delivery_closeout: {
                run_id: "run_batch5_truth_only_01",
                lane_id: "lane_truth_only_01",
                checkpoint_refs: ["checkpoint://batch5-truth-only"],
                artifact_refs: ["artifact://batch5-truth-only"],
                actor_refs: [{ actor_id: "worker_sample_01" }],
                base_branch: "release/v5",
                pr_writeback: {
                  message_id: "writeback_truth_only_01",
                  pr_url: "https://github.com/little-shock/openshockswarm/pull/305",
                  provider_ref: {
                    provider: "github",
                    repo_ref: "little-shock/openshockswarm",
                    pr_number: 305
                  }
                }
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);
      assert.equal(truthPatch.body.state, "accepted");

      const repoBindingRead = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch5_truth_only/repo-binding"
      });
      assert.equal(repoBindingRead.statusCode, 200);
      assert.equal(repoBindingRead.body.delivery_projection.pr_writeback_ref.run_id, "run_batch5_truth_only_01");
      assert.equal(repoBindingRead.body.delivery_projection.pr_writeback_ref.message_id, "writeback_truth_only_01");
      assert.equal(repoBindingRead.body.delivery_projection.pr_writeback_ref.lane_id, "lane_truth_only_01");
      assert.equal(repoBindingRead.body.delivery_projection.branch_ref.base_branch, "release/v5");
      assert.ok(repoBindingRead.body.delivery_projection.delivery_ready_lineage.checkpoint_refs.includes("checkpoint://batch5-truth-only"));
      assert.ok(repoBindingRead.body.delivery_projection.delivery_ready_lineage.artifact_refs.includes("artifact://batch5-truth-only"));

      const notifications = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch5_truth_only/notifications?limit=20"
      });
      assert.equal(notifications.statusCode, 200);
      assert.ok(notifications.body.items.length >= 1);
      assert.equal(notifications.body.delivery_projection.pr_writeback_ref.run_id, "run_batch5_truth_only_01");
      assert.equal(notifications.body.items[0].delivery_projection.pr_writeback_ref.message_id, "writeback_truth_only_01");
      assert.ok(notifications.body.items[0].delivery_projection.delivery_ready_lineage.checkpoint_refs.includes("checkpoint://batch5-truth-only"));

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter?topic_id=topic_v1_batch5_truth_only"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.backend_derived_projection.topic_id, "topic_v1_batch5_truth_only");
      assert.equal(
        shellCompatibility.body.backend_derived_projection.delivery_projection.pr_writeback_ref.run_id,
        "run_batch5_truth_only_01"
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.delivery_projection.delivery_ready_lineage.artifact_refs.includes(
          "artifact://batch5-truth-only"
        )
      );
    }
  );
});

test("v1 batch6 integration replay/debug/run-history/compatibility surfaces expose one backend-derived explanation", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch6_surface"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const topicOverview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch6_surface/overview"
      });
      assert.equal(topicOverview.statusCode, 200);

      const evidenceTruth = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch6_surface/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: topicOverview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: "run_batch6_01"
              },
              delivery_closeout: {
                run_id: "run_batch6_01",
                checkpoint_refs: ["checkpoint://batch6-truth"],
                artifact_refs: ["artifact://batch6-truth"],
                base_branch: "release/batch6",
                pr_writeback: {
                  message_id: "writeback_batch6_01",
                  pr_url: "https://github.com/little-shock/openshockswarm/pull/406",
                  provider_ref: {
                    provider: "github",
                    repo_ref: "little-shock/openshockswarm",
                    pr_number: 406
                  }
                }
              },
              replay_debug_evidence: {
                run_id: "run_batch6_01",
                failure_reason: "approval_waiting",
                checkpoint_refs: ["checkpoint://batch6-truth"],
                artifact_refs: ["artifact://batch6-truth"]
              }
            }
          }
        }
      });
      assert.equal(evidenceTruth.statusCode, 200);

      const daemonFeedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch6_surface",
          type: "feedback_ingest",
          runId: "run_batch6_01",
          laneId: "lane_batch6_01",
          payload: {
            feedbackId: "feedback_batch6_01",
            summary: "batch6 execution evidence",
            trace_id: "trace_batch6_01"
          }
        }
      });
      assert.equal(daemonFeedback.statusCode, 200);

      const runHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch6_surface/run-history?limit=20"
      });
      assert.equal(runHistory.statusCode, 200);
      const batch6Run = runHistory.body.items.find((item) => item.run_id === "run_batch6_01");
      assert.ok(batch6Run);
      assert.equal(batch6Run.explanation_projection.outcome, "failure_or_blocked");
      assert.ok(batch6Run.explanation_projection.execution_evidence.checkpoint_refs.includes("checkpoint://batch6-truth"));

      const runReplay = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch6_01/replay?topic_id=topic_v1_batch6_surface&limit=20"
      });
      assert.equal(runReplay.statusCode, 200);
      assert.equal(runReplay.body.explanation_projection.outcome, "failure_or_blocked");
      assert.ok(runReplay.body.items.length >= 1);
      assert.equal(runReplay.body.items[0].explanation_projection.run_id, "run_batch6_01");

      const debugEvents = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/events?topic_id=topic_v1_batch6_surface&run_id=run_batch6_01&limit=20"
      });
      assert.equal(debugEvents.statusCode, 200);
      assert.equal(debugEvents.body.explanation_projection.outcome, "failure_or_blocked");
      assert.ok(debugEvents.body.items.length >= 1);

      const debugHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_batch6_surface&run_id=run_batch6_01&limit=20"
      });
      assert.equal(debugHistory.statusCode, 200);
      assert.ok(debugHistory.body.explanation_projection.execution_evidence.artifact_refs.includes("artifact://batch6-truth"));

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter?topic_id=topic_v1_batch6_surface"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.backend_derived_projection.explanation_projection.outcome, "failure_or_blocked");
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.debug_events,
        "/v1/debug/events?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.debug_history,
        "/v1/debug/history?topic_id=:topicId&run_id=:runId"
      );
    }
  );
});

test("batch6 control-plane closeout/debug truth exposes server-owned evidence anchors and failure/closeout explanation", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_batch6_control_truth"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const upsertHuman = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/actors/human_sample_01",
        body: {
          role: "human",
          status: "active"
        }
      });
      assert.equal(upsertHuman.statusCode, 200);

      const dispatchCreated = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/dispatches",
        headers: {
          "idempotency-key": "batch8-control-dispatch-01"
        },
        body: {
          source_actor_id: "lead_sample_01",
          worker_actor_id: "worker_sample_01",
          payload: {
            summary: "batch8 control status surface dispatch"
          }
        }
      });
      assert.equal(dispatchCreated.statusCode, 202);
      const dispatchId = dispatchCreated.body.dispatch.dispatch_id;
      assert.ok(typeof dispatchId === "string" && dispatchId.length > 0);
      assert.equal(dispatchCreated.body.dispatch.status, "pending_accept");

      const dispatchListPending = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/dispatches?status=pending_accept&limit=20"
      });
      assert.equal(dispatchListPending.statusCode, 200);
      assert.ok(dispatchListPending.body.items.some((item) => item.dispatch_id === dispatchId));

      const dispatchPending = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/topic_batch6_control_truth/dispatches/${encodeURIComponent(dispatchId)}`
      });
      assert.equal(dispatchPending.statusCode, 200);
      assert.equal(dispatchPending.body.dispatch.status, "pending_accept");

      const dispatchAccepted = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "status_report",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          payload: {
            event: "dispatch_accepted",
            dispatchId
          }
        }
      });
      assert.equal(dispatchAccepted.statusCode, 200);
      assert.equal(dispatchAccepted.body.result.status, "active");

      const dispatchActive = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/topic_batch6_control_truth/dispatches/${encodeURIComponent(dispatchId)}`
      });
      assert.equal(dispatchActive.statusCode, 200);
      assert.equal(dispatchActive.body.dispatch.status, "active");

      const topicBeforeTruthPatch = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth"
      });
      assert.equal(topicBeforeTruthPatch.statusCode, 200);

      const truthOnlyPatch = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: topicBeforeTruthPatch.body.topic.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: "run_batch6_control_01"
              },
              replay_debug_evidence: {
                run_id: "run_batch6_control_01",
                failure_reason: "approval_waiting",
                checkpoint_refs: ["checkpoint://batch6-control"],
                artifact_refs: ["artifact://batch6-control"]
              }
            }
          }
        }
      });
      assert.equal(truthOnlyPatch.statusCode, 200);
      assert.equal(truthOnlyPatch.body.state, "accepted");

      const conflictOpen = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "challenge",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          payload: {
            conflictId: "conflict_batch6_control_01",
            scopes: ["delivery"]
          }
        }
      });
      assert.equal(conflictOpen.statusCode, 200);
      assert.equal(conflictOpen.body.result.status, "unresolved");

      const overviewWithConflict = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth"
      });
      assert.equal(overviewWithConflict.statusCode, 200);
      assert.equal(overviewWithConflict.body.topic.open_conflicts.length, 1);
      assert.equal(overviewWithConflict.body.topic.open_conflicts[0].failure_reason, "unresolved_conflict");
      assert.equal(overviewWithConflict.body.topic.open_conflicts[0].evidence_anchor.source, "server_owned");
      assert.equal(overviewWithConflict.body.topic.merge_lifecycle.closeout_explanation.status, "waiting_gate");
      assert.equal(overviewWithConflict.body.topic.merge_lifecycle.closeout_explanation.reason_code, "unresolved_conflict");

      const statusWithConflict = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/status"
      });
      assert.equal(statusWithConflict.statusCode, 200);
      assert.equal(statusWithConflict.body.status.topic_id, "topic_batch6_control_truth");
      assert.equal(statusWithConflict.body.status.open_conflict_count, 1);
      assert.equal(statusWithConflict.body.status.pending_approval_count, 0);
      assert.equal(statusWithConflict.body.status.evidence_anchor.source, "server_owned");

      const resolveConflict = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "conflict_resolution",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          payload: {
            conflictId: "conflict_batch6_control_01",
            outcome: "accept_side",
            notes: "resolve batch6 control conflict"
          }
        }
      });
      assert.equal(resolveConflict.statusCode, 200);
      assert.equal(resolveConflict.body.result.status, "resolved");

      const handoff = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "handoff_package",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          targetScope: "lead",
          runId: "run_batch6_control_01",
          laneId: "lane_batch6_control_01",
          referencedArtifacts: ["artifact://batch6-control-handoff"],
          payload: {
            summary: "batch6 control handoff"
          }
        }
      });
      assert.equal(handoff.statusCode, 200);

      const handoffAck = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "status_report",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          runId: "run_batch6_control_01",
          payload: {
            event: "handoff_ack",
            handoffId: handoff.body.messageId,
            resolvedArtifacts: ["artifact://batch6-control-handoff"]
          }
        }
      });
      assert.equal(handoffAck.statusCode, 200);

      const mergeRequest = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "merge_request",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          runId: "run_batch6_control_01",
          laneId: "lane_batch6_control_01",
          payload: {
            handoffId: handoff.body.messageId
          }
        }
      });
      assert.equal(mergeRequest.statusCode, 200);
      const holdId = mergeRequest.body.result.holdIds[0];
      assert.ok(typeof holdId === "string" && holdId.length > 0);

      const overviewWithPendingGate = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth"
      });
      assert.equal(overviewWithPendingGate.statusCode, 200);
      assert.equal(overviewWithPendingGate.body.topic.pending_approvals.length, 1);
      assert.equal(overviewWithPendingGate.body.topic.pending_approvals[0].evidence_anchor.source, "server_owned");
      assert.equal(overviewWithPendingGate.body.topic.pending_approvals[0].failure_reason, null);
      assert.ok(
        overviewWithPendingGate.body.topic.merge_lifecycle.evidence_anchor.pending_approval_ids.includes(holdId)
      );

      const pendingApprovalHolds = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/approval-holds?status=pending&limit=20"
      });
      assert.equal(pendingApprovalHolds.statusCode, 200);
      assert.ok(pendingApprovalHolds.body.items.some((item) => item.hold_id === holdId));

      const holdDetail = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/topic_batch6_control_truth/approval-holds/${holdId}`
      });
      assert.equal(holdDetail.statusCode, 200);
      assert.equal(holdDetail.body.hold.hold_id, holdId);
      assert.equal(holdDetail.body.hold.evidence_anchor.source, "server_owned");

      const rejectDecision = await requestJson({
        port,
        method: "POST",
        path: `/v1/topics/topic_batch6_control_truth/approval-holds/${holdId}/decisions`,
        headers: {
          "idempotency-key": `decision-${holdId}`
        },
        body: {
          decider_actor_id: "human_sample_01",
          approve: false,
          intervention_point: holdId
        }
      });
      assert.equal(rejectDecision.statusCode, 200);
      assert.equal(rejectDecision.body.decision.status, "rejected");
      assert.equal(rejectDecision.body.decision.hold_id, holdId);

      const decisionList = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/topic_batch6_control_truth/approval-holds/${holdId}/decisions`
      });
      assert.equal(decisionList.statusCode, 200);
      assert.equal(decisionList.body.items.length, 1);
      assert.equal(decisionList.body.items[0].failure_reason, "approval_rejected");
      assert.equal(decisionList.body.items[0].evidence_anchor.source, "server_owned");

      const overviewAfterReject = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth"
      });
      assert.equal(overviewAfterReject.statusCode, 200);
      assert.equal(overviewAfterReject.body.topic.merge_lifecycle.closeout_explanation.status, "failed");
      assert.equal(overviewAfterReject.body.topic.merge_lifecycle.closeout_explanation.reason_code, "approval_rejected");
      assert.ok(
        overviewAfterReject.body.topic.merge_lifecycle.evidence_anchor.blocker_ids.includes(`approval_rejected:${holdId}`)
      );

      const repoBinding = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/repo-binding",
        body: {
          provider_ref: {
            provider: "github",
            repo_ref: "little-shock/openshockswarm"
          },
          default_branch: "main",
          bound_by: "lead_sample_01"
        }
      });
      assert.equal(repoBinding.statusCode, 200);
      assert.equal(repoBinding.body.delivery_projection.evidence_anchor.source, "server_owned");
      assert.equal(repoBinding.body.delivery_projection.closeout_explanation.reason_code, "truth_failure_reason");

      const invalidDeliveryWrite = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/delivery",
        headers: {
          "idempotency-key": "batch8-control-delivery-invalid"
        },
        body: {
          source_actor_id: "lead_sample_01",
          state: "pr_ready",
          run_id: "run_should_be_rejected"
        }
      });
      assert.equal(invalidDeliveryWrite.statusCode, 400);
      assert.equal(invalidDeliveryWrite.body.error.code, "invalid_delivery_server_owned_field");

      const deliveryWrite = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/delivery",
        headers: {
          "idempotency-key": "batch8-control-delivery-valid"
        },
        body: {
          source_actor_id: "lead_sample_01",
          state: "pr_ready",
          pr_url: "https://github.com/little-shock/openshockswarm/pull/508"
        }
      });
      assert.equal(deliveryWrite.statusCode, 200);
      assert.equal(deliveryWrite.body.delivery.state, "pr_ready");
      assert.equal(deliveryWrite.body.delivery.evidence_anchor.source, "server_owned");

      const deliveryRead = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/delivery"
      });
      assert.equal(deliveryRead.statusCode, 200);
      assert.equal(deliveryRead.body.delivery.state, "pr_ready");
      assert.equal(deliveryRead.body.delivery.evidence_anchor.source, "server_owned");

      const invalidPrWritebackWrite = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/pr-writeback",
        headers: {
          "idempotency-key": "batch8-control-pr-writeback-invalid"
        },
        body: {
          source_actor_id: "lead_sample_01",
          pr_url: "https://github.com/little-shock/openshockswarm/pull/508",
          run_id: "run_should_be_rejected"
        }
      });
      assert.equal(invalidPrWritebackWrite.statusCode, 400);
      assert.equal(invalidPrWritebackWrite.body.error.code, "invalid_pr_writeback_server_owned_field");

      const prWritebackWrite = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/pr-writeback",
        headers: {
          "idempotency-key": "batch8-control-pr-writeback-valid"
        },
        body: {
          source_actor_id: "lead_sample_01",
          state: "written",
          pr_url: "https://github.com/little-shock/openshockswarm/pull/508"
        }
      });
      assert.equal(prWritebackWrite.statusCode, 200);
      assert.equal(prWritebackWrite.body.pr_writeback.state, "written");
      assert.equal(prWritebackWrite.body.pr_writeback.evidence_anchor.source, "server_owned");

      const prWritebackRead = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/pr-writeback"
      });
      assert.equal(prWritebackRead.statusCode, 200);
      assert.equal(prWritebackRead.body.pr_writeback.pr_url, "https://github.com/little-shock/openshockswarm/pull/508");
      assert.equal(prWritebackRead.body.pr_writeback.evidence_anchor.source, "server_owned");

      const blockLead = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_batch6_control_truth/actors/lead_sample_01",
        body: {
          role: "lead",
          status: "blocked"
        }
      });
      assert.equal(blockLead.statusCode, 200);

      const blockedConflictOpen = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "challenge",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          payload: {
            conflictId: "conflict_batch6_control_blocked",
            scopes: ["delivery"]
          }
        }
      });
      assert.equal(blockedConflictOpen.statusCode, 200);

      const blockedResolution = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "conflict_resolution",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          payload: {
            conflictId: "conflict_batch6_control_blocked",
            outcome: "accept_side"
          }
        }
      });
      assert.equal(blockedResolution.statusCode, 422);
      assert.equal(blockedResolution.body.error.code, "source_actor_inactive");

      const blockedResolutionV1 = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/conflicts/conflict_batch6_control_blocked/resolutions",
        headers: {
          "idempotency-key": "batch8-control-blocked-resolution-v1"
        },
        body: {
          source_actor_id: "lead_sample_01",
          outcome: "accept_side"
        }
      });
      assert.equal(blockedResolutionV1.statusCode, 422);
      assert.equal(blockedResolutionV1.body.error.code, "write_actor_inactive");

      const debugRejections = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/debug/rejections?limit=20"
      });
      assert.equal(debugRejections.statusCode, 200);
      assert.equal(debugRejections.body.projection_meta.resource, "topic_debug_rejection_projection");
      assert.equal(debugRejections.body.projection_meta.source_plane, "control_plane_rejection_projection");
      assert.ok(
        debugRejections.body.items.some((item) =>
          ["source_actor_inactive", "write_actor_inactive"].includes(item.reason_code)
        )
      );

      const debugSnapshots = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_batch6_control_truth/debug/history?view=snapshot&limit=5"
      });
      assert.equal(debugSnapshots.statusCode, 200);
      assert.equal(debugSnapshots.body.projection_meta.resource, "topic_debug_history_projection");
      assert.equal(debugSnapshots.body.projection_meta.source_plane, "control_plane_debug_history_projection");
      assert.ok(Array.isArray(debugSnapshots.body.items));
      assert.ok(debugSnapshots.body.items.length >= 1);
    }
  );
});
test("v1 batch6 integration replay/debug/run-history/compatibility surfaces expose one backend-derived explanation", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch6_surface"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const topicOverview = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch6_surface"
      });
      assert.equal(topicOverview.statusCode, 200);

      const evidenceTruth = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_batch6_surface/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: topicOverview.body.topic.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: "run_batch6_01"
              },
              delivery_closeout: {
                run_id: "run_batch6_01",
                checkpoint_refs: ["checkpoint://batch6-truth"],
                artifact_refs: ["artifact://batch6-truth"],
                base_branch: "release/batch6",
                pr_writeback: {
                  message_id: "writeback_batch6_01",
                  pr_url: "https://github.com/little-shock/openshockswarm/pull/406",
                  provider_ref: {
                    provider: "github",
                    repo_ref: "little-shock/openshockswarm",
                    pr_number: 406
                  }
                }
              },
              replay_debug_evidence: {
                run_id: "run_batch6_01",
                failure_reason: "approval_waiting",
                checkpoint_refs: ["checkpoint://batch6-truth"],
                artifact_refs: ["artifact://batch6-truth"]
              }
            }
          }
        }
      });
      assert.equal(evidenceTruth.statusCode, 200);

      const daemonFeedback = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch6_surface",
          type: "feedback_ingest",
          runId: "run_batch6_01",
          laneId: "lane_batch6_01",
          payload: {
            feedbackId: "feedback_batch6_01",
            summary: "batch6 execution evidence",
            trace_id: "trace_batch6_01"
          }
        }
      });
      assert.equal(daemonFeedback.statusCode, 200);

      const runHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch6_surface/run-history?limit=20"
      });
      assert.equal(runHistory.statusCode, 200);
      const batch6Run = runHistory.body.items.find((item) => item.run_id === "run_batch6_01");
      assert.ok(batch6Run);
      assert.equal(batch6Run.explanation_projection.outcome, "failure_or_blocked");
      assert.ok(batch6Run.explanation_projection.execution_evidence.checkpoint_refs.includes("checkpoint://batch6-truth"));

      const runReplay = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch6_01/replay?topic_id=topic_v1_batch6_surface&limit=20"
      });
      assert.equal(runReplay.statusCode, 200);
      assert.equal(runReplay.body.explanation_projection.outcome, "failure_or_blocked");
      assert.ok(runReplay.body.items.length >= 1);
      assert.equal(runReplay.body.items[0].explanation_projection.run_id, "run_batch6_01");

      const debugEvents = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/events?topic_id=topic_v1_batch6_surface&run_id=run_batch6_01&limit=20"
      });
      assert.equal(debugEvents.statusCode, 200);
      assert.equal(debugEvents.body.explanation_projection.outcome, "failure_or_blocked");
      assert.ok(debugEvents.body.items.length >= 1);

      const debugHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_batch6_surface&run_id=run_batch6_01&limit=20"
      });
      assert.equal(debugHistory.statusCode, 200);
      assert.ok(debugHistory.body.explanation_projection.execution_evidence.artifact_refs.includes("artifact://batch6-truth"));

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter?topic_id=topic_v1_batch6_surface"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.backend_derived_projection.explanation_projection.outcome, "failure_or_blocked");
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.debug_events,
        "/v1/debug/events?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.debug_history,
        "/v1/debug/history?topic_id=:topicId&run_id=:runId"
      );
    }
  );
});

test("v1 batch6 execution debug evidence endpoint exposes failure anchor and replay contract", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch6_execution_failure"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const overview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch6_execution_failure/overview"
      });
      assert.equal(overview.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch6_execution_failure/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: overview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: "run_batch6_exec_failure_01"
              },
              delivery_closeout: {
                run_id: "run_batch6_exec_failure_01",
                checkpoint_refs: ["checkpoint://batch6-exec-failure"],
                artifact_refs: ["artifact://batch6-exec-failure"]
              },
              replay_debug_evidence: {
                run_id: "run_batch6_exec_failure_01",
                failure_reason: "approval_waiting",
                checkpoint_refs: ["checkpoint://batch6-exec-failure"],
                artifact_refs: ["artifact://batch6-exec-failure"]
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);

      const feedbackEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch6_execution_failure",
          type: "feedback_ingest",
          runId: "run_batch6_exec_failure_01",
          laneId: "lane_batch6_exec_failure_01",
          payload: {
            feedbackId: "feedback_batch6_exec_failure_01",
            summary: "execution debug evidence for failure",
            trace_id: "trace_batch6_exec_failure_01"
          }
        }
      });
      assert.equal(feedbackEvent.statusCode, 200);

      const blockerEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch6_execution_failure",
          type: "blocker_escalation",
          runId: "run_batch6_exec_failure_01",
          laneId: "lane_batch6_exec_failure_01",
          payload: {
            reason: "approval hold unresolved"
          }
        }
      });
      assert.equal(blockerEvent.statusCode, 200);

      const runDebug = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch6_exec_failure_01/debug?topic_id=topic_v1_batch6_execution_failure"
      });
      assert.equal(runDebug.statusCode, 200);
      assert.equal(runDebug.body.projection, "execution_replay_debug_evidence");
      assert.equal(runDebug.body.evidence_bundle.run.run_id, "run_batch6_exec_failure_01");
      assert.equal(runDebug.body.evidence_bundle.recovery.outcome, "failure_or_blocked");
      assert.equal(runDebug.body.evidence_bundle.recovery.failure_reason, "approval_waiting");
      assert.equal(
        runDebug.body.evidence_bundle.replay_contract.events_path,
        "/v1/execution/runs/run_batch6_exec_failure_01/events?topic_id=topic_v1_batch6_execution_failure"
      );
      assert.ok(runDebug.body.evidence_bundle.replay_contract.latest_sequence >= 2);
      assert.ok(runDebug.body.evidence_bundle.replay_contract.anchors.failure);
      assert.ok(runDebug.body.evidence_bundle.replay_contract.anchors.failure.after_sequence >= 0);
      assert.ok(
        runDebug.body.evidence_bundle.replay_contract.anchors.closeout.checkpoint_refs.includes(
          "checkpoint://batch6-exec-failure"
        )
      );
      assert.ok(
        runDebug.body.evidence_bundle.replay_contract.anchors.closeout.artifact_refs.includes(
          "artifact://batch6-exec-failure"
        )
      );

      const payload = JSON.stringify(runDebug.body);
      assert.equal(payload.includes("worktree_path"), false);
      assert.equal(payload.includes("lane_root_path"), false);
      assert.equal(payload.includes("lane_worktree_path"), false);
      assert.equal(payload.includes("run_path"), false);
      assert.equal(payload.includes("acked_sequence"), false);
      assert.equal(payload.includes("unacked_events"), false);
    }
  );
});

test("v1 batch7 execution events replay endpoint honors after_sequence contract", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch7_execution_events"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const overview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch7_execution_events/overview"
      });
      assert.equal(overview.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch7_execution_events/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: overview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: "run_batch7_events_01"
              },
              delivery_closeout: {
                run_id: "run_batch7_events_01",
                checkpoint_refs: ["checkpoint://batch7-events"],
                artifact_refs: ["artifact://batch7-events"]
              },
              replay_debug_evidence: {
                run_id: "run_batch7_events_01",
                failure_reason: "batch7_blocked",
                checkpoint_refs: ["checkpoint://batch7-events"],
                artifact_refs: ["artifact://batch7-events"]
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);

      const feedbackEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch7_execution_events",
          type: "feedback_ingest",
          runId: "run_batch7_events_01",
          laneId: "lane_batch7_events_01",
          payload: {
            feedbackId: "feedback_batch7_events_01",
            summary: "batch7 execution events replay evidence",
            trace_id: "trace_batch7_events_01"
          }
        }
      });
      assert.equal(feedbackEvent.statusCode, 200);

      const checkpointEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch7_execution_events",
          type: "status_report",
          runId: "run_batch7_events_01",
          laneId: "lane_batch7_events_01",
          payload: {
            event: "run_checkpoint_recorded",
            checkpoint_refs: ["checkpoint://batch7-events"]
          }
        }
      });
      assert.equal(checkpointEvent.statusCode, 200);

      const artifactEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch7_execution_events",
          type: "status_report",
          runId: "run_batch7_events_01",
          laneId: "lane_batch7_events_01",
          payload: {
            event: "run_artifact_linked",
            artifact_refs: ["artifact://batch7-events"]
          }
        }
      });
      assert.equal(artifactEvent.statusCode, 200);

      const runDebug = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch7_events_01/debug?topic_id=topic_v1_batch7_execution_events"
      });
      assert.equal(runDebug.statusCode, 200);
      assert.equal(runDebug.body.projection_meta.resource, "execution_run_debug_evidence_projection");
      assert.equal(runDebug.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(
        runDebug.body.evidence_bundle.replay_contract.events_path,
        "/v1/execution/runs/run_batch7_events_01/events?topic_id=topic_v1_batch7_execution_events"
      );

      const firstPage = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch7_events_01/events?topic_id=topic_v1_batch7_execution_events&after_sequence=0&limit=2"
      });
      assert.equal(firstPage.statusCode, 200);
      assert.equal(firstPage.body.projection_meta.resource, "execution_run_event_projection");
      assert.equal(firstPage.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(firstPage.body.projection, "execution_plane_projection");
      assert.equal(firstPage.body.start_after_sequence, 0);
      assert.ok(firstPage.body.latest_sequence >= 3);
      assert.equal(firstPage.body.items.length, 2);
      assert.equal(firstPage.body.items[0].sequence, 1);
      assert.equal(firstPage.body.items[1].sequence, 2);
      assert.equal(firstPage.body.next_after_sequence, 2);

      const secondPage = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch7_events_01/events?topic_id=topic_v1_batch7_execution_events&after_sequence=2&limit=20"
      });
      assert.equal(secondPage.statusCode, 200);
      assert.ok(secondPage.body.items.length >= 1);
      assert.equal(secondPage.body.items[0].sequence, 3);

      const replayedItems = [...firstPage.body.items, ...secondPage.body.items];
      const replayedEventTypes = new Set(replayedItems.map((item) => item.event_type));
      assert.ok(replayedEventTypes.has("run_checkpoint_recorded"));
      assert.ok(replayedEventTypes.has("run_artifact_linked"));
      assert.ok(
        replayedItems.some((item) => item.closeout_projection.checkpoint_refs.includes("checkpoint://batch7-events"))
      );
      assert.ok(
        replayedItems.some((item) => item.closeout_projection.artifact_refs.includes("artifact://batch7-events"))
      );

      const afterInvalid = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch7_events_01/events?topic_id=topic_v1_batch7_execution_events&after_sequence=-1"
      });
      assert.equal(afterInvalid.statusCode, 422);
      assert.equal(afterInvalid.body.error.code ?? afterInvalid.body.error, "run_events_after_sequence_invalid");

      const missingRun = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_missing_batch7/events?topic_id=topic_v1_batch7_execution_events"
      });
      assert.equal(missingRun.statusCode, 404);
      assert.equal(missingRun.body.error.code ?? missingRun.body.error, "run_not_found");

      const payload = JSON.stringify(firstPage.body);
      assert.equal(payload.includes("worktree_path"), false);
      assert.equal(payload.includes("lane_root_path"), false);
      assert.equal(payload.includes("lane_worktree_path"), false);
      assert.equal(payload.includes("run_path"), false);
      assert.equal(payload.includes("acked_sequence"), false);
      assert.equal(payload.includes("unacked_events"), false);
    }
  );
});

test("v1 batch6 execution debug evidence endpoint exposes closeout anchor for backend truth lineage", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch6_execution_closeout"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const overview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch6_execution_closeout/overview"
      });
      assert.equal(overview.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch6_execution_closeout/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: overview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "pr_ready",
                run_id: "run_batch6_exec_closeout_01"
              },
              delivery_closeout: {
                run_id: "run_batch6_exec_closeout_01",
                checkpoint_refs: ["checkpoint://batch6-exec-closeout"],
                artifact_refs: ["artifact://batch6-exec-closeout"]
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);

      const statusEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch6_execution_closeout",
          type: "status_report",
          runId: "run_batch6_exec_closeout_01",
          laneId: "lane_batch6_exec_closeout_01",
          payload: {
            event: "delivery_writeback_completed",
            checkpoint_refs: ["checkpoint://batch6-exec-closeout"],
            artifact_refs: ["artifact://batch6-exec-closeout"]
          }
        }
      });
      assert.equal(statusEvent.statusCode, 200);

      const runDebug = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch6_exec_closeout_01/debug?topic_id=topic_v1_batch6_execution_closeout"
      });
      assert.equal(runDebug.statusCode, 200);
      assert.equal(runDebug.body.projection, "execution_replay_debug_evidence");
      assert.equal(runDebug.body.evidence_bundle.recovery.outcome, "closeout_ready");
      assert.equal(runDebug.body.evidence_bundle.recovery.failure_reason, null);
      assert.ok(runDebug.body.evidence_bundle.replay_contract.anchors.closeout);
      assert.equal(runDebug.body.evidence_bundle.replay_contract.anchors.failure, null);
      assert.ok(
        runDebug.body.evidence_bundle.replay_contract.anchors.closeout.checkpoint_refs.includes(
          "checkpoint://batch6-exec-closeout"
        )
      );
      assert.ok(
        runDebug.body.evidence_bundle.replay_contract.anchors.closeout.artifact_refs.includes(
          "artifact://batch6-exec-closeout"
        )
      );
      assert.ok(runDebug.body.evidence_bundle.replay_contract.latest_sequence >= 1);
      assert.ok(runDebug.body.evidence_bundle.replay_contract.anchors.closeout.after_sequence >= 0);
      assert.ok(
        runDebug.body.evidence_bundle.replay_contract.anchors.closeout.after_sequence <=
          runDebug.body.evidence_bundle.replay_contract.latest_sequence
      );
    }
  );
});

test("v1 batch7 integration projection closure keeps projection meta and backend-derived anchors aligned", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch7_projection"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const overview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch7_projection/overview"
      });
      assert.equal(overview.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch7_projection/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: overview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: "run_batch7_01"
              },
              delivery_closeout: {
                run_id: "run_batch7_01",
                checkpoint_refs: ["checkpoint://batch7-truth"],
                artifact_refs: ["artifact://batch7-truth"]
              },
              replay_debug_evidence: {
                run_id: "run_batch7_01",
                failure_reason: "approval_waiting",
                checkpoint_refs: ["checkpoint://batch7-truth"],
                artifact_refs: ["artifact://batch7-truth"]
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);

      const feedbackEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch7_projection",
          type: "feedback_ingest",
          runId: "run_batch7_01",
          laneId: "lane_batch7_01",
          payload: {
            feedbackId: "feedback_batch7_01",
            summary: "batch7 projection edge evidence",
            trace_id: "trace_batch7_01"
          }
        }
      });
      assert.equal(feedbackEvent.statusCode, 200);

      const blockerEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId: "topic_v1_batch7_projection",
          type: "blocker_escalation",
          runId: "run_batch7_01",
          laneId: "lane_batch7_01",
          payload: {
            reason: "batch7 pending approval"
          }
        }
      });
      assert.equal(blockerEvent.statusCode, 200);

      const runHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch7_projection/run-history?limit=20"
      });
      assert.equal(runHistory.statusCode, 200);
      assert.equal(runHistory.body.projection_meta.resource, "run_history_projection");
      assert.equal(runHistory.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(runHistory.body.projection_meta.topic_id, "topic_v1_batch7_projection");
      assert.equal(runHistory.body.items[0].explanation_projection.run_id, "run_batch7_01");
      assert.equal(
        runHistory.body.items[0].explanation_projection.compatibility_anchor.run,
        "/v1/runs/run_batch7_01?topic_id=topic_v1_batch7_projection"
      );
      assert.equal(
        runHistory.body.items[0].explanation_projection.compatibility_anchor.timeline,
        "/v1/runs/run_batch7_01/timeline?topic_id=topic_v1_batch7_projection"
      );
      assert.equal(
        runHistory.body.items[0].explanation_projection.compatibility_anchor.feedback,
        "/v1/runs/run_batch7_01/feedback?topic_id=topic_v1_batch7_projection"
      );
      assert.equal(
        runHistory.body.items[0].explanation_projection.compatibility_anchor.holds,
        "/v1/runs/run_batch7_01/holds?topic_id=topic_v1_batch7_projection"
      );

      const runReplay = await requestJson({
        port,
        method: "GET",
        path: "/v1/runs/run_batch7_01/replay?topic_id=topic_v1_batch7_projection&limit=20"
      });
      assert.equal(runReplay.statusCode, 200);
      assert.equal(runReplay.body.projection_meta.resource, "run_replay_projection");
      assert.equal(runReplay.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(runReplay.body.projection_meta.topic_id, "topic_v1_batch7_projection");
      assert.equal(runReplay.body.projection_meta.run_id, "run_batch7_01");

      const debugEvents = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/events?topic_id=topic_v1_batch7_projection&run_id=run_batch7_01&limit=20"
      });
      assert.equal(debugEvents.statusCode, 200);
      assert.equal(debugEvents.body.projection_meta.resource, "debug_event_projection");
      assert.equal(debugEvents.body.projection_meta.source_plane, "cross_plane_debug_join");
      assert.equal(debugEvents.body.projection_meta.run_id, "run_batch7_01");

      const debugHistory = await requestJson({
        port,
        method: "GET",
        path: "/v1/debug/history?topic_id=topic_v1_batch7_projection&run_id=run_batch7_01&limit=20"
      });
      assert.equal(debugHistory.statusCode, 200);
      assert.equal(debugHistory.body.projection_meta.resource, "debug_history_projection");
      assert.equal(debugHistory.body.projection_meta.source_plane, "cross_plane_debug_history_aggregation");
      assert.equal(debugHistory.body.projection_meta.run_id, "run_batch7_01");

      const runDebug = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch7_01/debug?topic_id=topic_v1_batch7_projection"
      });
      assert.equal(runDebug.statusCode, 200);
      assert.equal(runDebug.body.projection_meta.resource, "execution_run_debug_evidence_projection");
      assert.equal(runDebug.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(runDebug.body.projection_meta.topic_id, "topic_v1_batch7_projection");
      assert.equal(runDebug.body.projection_meta.run_id, "run_batch7_01");

      const runEvents = await requestJson({
        port,
        method: "GET",
        path: "/v1/execution/runs/run_batch7_01/events?topic_id=topic_v1_batch7_projection&after_sequence=0&limit=20"
      });
      assert.equal(runEvents.statusCode, 200);
      assert.equal(runEvents.body.projection_meta.resource, "execution_run_event_projection");
      assert.equal(runEvents.body.projection_meta.source_plane, "execution_plane_projection");
      assert.equal(runEvents.body.projection_meta.topic_id, "topic_v1_batch7_projection");
      assert.equal(runEvents.body.projection_meta.run_id, "run_batch7_01");

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter?topic_id=topic_v1_batch7_projection"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.projection_meta.resource, "shell_adapter_compatibility_projection");
      assert.equal(shellCompatibility.body.projection_meta.topic_id, "topic_v1_batch7_projection");
      assert.equal(shellCompatibility.body.backend_derived_projection.explanation_projection.run_id, "run_batch7_01");
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes("/v1/topics/:topicId/run-history")
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/runs/:runId/replay?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/debug/events?topic_id=:topicId&run_id=:runId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/debug/history?topic_id=:topicId&run_id=:runId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/execution/runs/:runId/debug?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/execution/runs/:runId/events?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/runs/:runId?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/runs/:runId/timeline?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/runs/:runId/feedback?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/runs/:runId/holds?topic_id=:topicId"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/topics/:topicId/debug/rejections"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/topics/:topicId/debug/history?view=:view"
        )
      );
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/topics/:topicId/messages"
        )
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.execution_debug,
        "/v1/execution/runs/:runId/debug?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.execution_events,
        "/v1/execution/runs/:runId/events?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.run_detail,
        "/v1/runs/:runId?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.run_timeline,
        "/v1/runs/:runId/timeline?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.run_feedback,
        "/v1/runs/:runId/feedback?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.run_holds,
        "/v1/runs/:runId/holds?topic_id=:topicId"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.topic_debug_rejections,
        "/v1/topics/:topicId/debug/rejections"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.topic_debug_history,
        "/v1/topics/:topicId/debug/history?view=:view"
      );
    }
  );
});

test("v1 batch9 control-plane truth read surfaces expose topic-state/merge-lifecycle/task-allocation without write-gate regression", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_batch9_control_state"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const overview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_v1_batch9_control_state/overview"
      });
      assert.equal(overview.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/topics/topic_v1_batch9_control_state/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: overview.body.revision,
          payload: {
            patch: {
              taskAllocation: [
                {
                  task_id: "task_batch9_control_01",
                  summary: "close topic merge lifecycle read model",
                  worker_actor_id: "worker_sample_01",
                  status: "in_progress"
                },
                {
                  task_id: "task_batch9_control_02",
                  summary: "verify shared write-gate remains strict",
                  status: "pending"
                }
              ],
              mergeIntent: {
                stage: "awaiting_merge_gate",
                deliveryReadyLineage: {
                  run_id: "run_batch9_control_01",
                  checkpoint_ref: "checkpoint://batch9-control",
                  artifact_refs: ["artifact://batch9-control"]
                }
              },
              deliveryState: {
                state: "awaiting_merge_gate"
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);
      assert.equal(truthPatch.body.state, "accepted");

      const topicState = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch9_control_state/topic-state"
      });
      assert.equal(topicState.statusCode, 200);
      assert.equal(topicState.body.topic_state.revision, truthPatch.body.revision);
      assert.equal(topicState.body.topic_state.merge_stage, "awaiting_merge_gate");
      assert.equal(topicState.body.topic_state.pending_approval_count, 0);
      assert.equal(topicState.body.topic_state.open_conflict_count, 0);

      const mergeLifecycle = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch9_control_state/merge-lifecycle"
      });
      assert.equal(mergeLifecycle.statusCode, 200);
      assert.equal(mergeLifecycle.body.merge_lifecycle.stage, "awaiting_merge_gate");
      assert.equal(mergeLifecycle.body.merge_lifecycle.closeout_lineage.run_id, "run_batch9_control_01");
      assert.equal(
        mergeLifecycle.body.merge_lifecycle.closeout_lineage.checkpoint_ref,
        "checkpoint://batch9-control"
      );
      assert.ok(
        mergeLifecycle.body.merge_lifecycle.closeout_lineage.artifact_refs.includes("artifact://batch9-control")
      );
      assert.equal(mergeLifecycle.body.merge_lifecycle.closeout_explanation.status, "waiting_gate");
      assert.equal(mergeLifecycle.body.merge_lifecycle.evidence_anchor.source, "server_owned");

      const taskAllocation = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch9_control_state/task-allocation"
      });
      assert.equal(taskAllocation.statusCode, 200);
      assert.equal(taskAllocation.body.task_allocation.topic_id, "topic_v1_batch9_control_state");
      assert.equal(taskAllocation.body.task_allocation.items.length, 2);
      assert.equal(taskAllocation.body.task_allocation.summary.total_tasks, 2);
      assert.equal(taskAllocation.body.task_allocation.summary.assigned_tasks, 1);
      assert.equal(taskAllocation.body.task_allocation.summary.unassigned_tasks, 1);
      assert.equal(taskAllocation.body.task_allocation.evidence_anchor.source, "server_owned");

      const blockLead = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_batch9_control_state/actors/lead_sample_01",
        body: {
          role: "lead",
          status: "blocked"
        }
      });
      assert.equal(blockLead.statusCode, 200);

      const blockedDeliveryWrite = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_batch9_control_state/delivery",
        headers: {
          "idempotency-key": "batch9-control-delivery-blocked-actor"
        },
        body: {
          source_actor_id: "lead_sample_01",
          state: "pr_ready",
          note: "should be rejected by shared write-gate"
        }
      });
      assert.equal(blockedDeliveryWrite.statusCode, 422);
      assert.equal(blockedDeliveryWrite.body.error.code, "write_actor_inactive");

      const mergeLifecycleAfterReject = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_batch9_control_state/merge-lifecycle"
      });
      assert.equal(mergeLifecycleAfterReject.statusCode, 200);
      assert.equal(mergeLifecycleAfterReject.body.merge_lifecycle.stage, "awaiting_merge_gate");
      assert.equal(mergeLifecycleAfterReject.body.merge_lifecycle.delivery.state, "awaiting_merge_gate");
    }
  );
});

test("v1 phase3 batch1 execution/compatibility consumer verification keeps stable read surfaces", async () => {
  const topicId = "topic_v1_phase3_execution_consumer";
  const runId = "run_phase3_execution_01";

  await withRuntimeServer(
    {
      fixture: {
        topicId
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const registerHuman = await requestJson({
        port,
        method: "PUT",
        path: `/v1/topics/${encodeURIComponent(topicId)}/actors/human_sample_01`,
        body: {
          role: "human",
          status: "active"
        }
      });
      assert.equal(registerHuman.statusCode, 200);

      const overview = await requestJson({
        port,
        method: "GET",
        path: `/topics/${encodeURIComponent(topicId)}/overview`
      });
      assert.equal(overview.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: `/topics/${encodeURIComponent(topicId)}/messages`,
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: overview.body.revision,
          payload: {
            patch: {
              deliveryState: {
                state: "awaiting_merge_gate",
                run_id: runId
              },
              delivery_closeout: {
                run_id: runId,
                checkpoint_refs: ["checkpoint://phase3-execution"],
                artifact_refs: ["artifact://phase3-execution"]
              },
              replay_debug_evidence: {
                run_id: runId,
                failure_reason: "consumer_side_verification",
                checkpoint_refs: ["checkpoint://phase3-execution"],
                artifact_refs: ["artifact://phase3-execution"]
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);

      const feedbackEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId,
          type: "feedback_ingest",
          runId,
          laneId: "lane_phase3_execution_01",
          payload: {
            feedbackId: "feedback_phase3_execution_01",
            summary: "phase3 execution consumer contract verification",
            trace_id: "trace_phase3_execution_01"
          }
        }
      });
      assert.equal(feedbackEvent.statusCode, 200);

      const blockerEvent = await requestJson({
        port,
        method: "POST",
        path: "/runtime/daemon/events",
        body: {
          topicId,
          type: "blocker_escalation",
          runId,
          laneId: "lane_phase3_execution_01",
          payload: {
            reason: "phase3 gate pending"
          }
        }
      });
      assert.equal(blockerEvent.statusCode, 200);

      const runHistory = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/${encodeURIComponent(topicId)}/run-history?limit=20`
      });
      assert.equal(runHistory.statusCode, 200);
      const runItem = runHistory.body.items.find((item) => item.run_id === runId);
      assert.ok(runItem);
      assert.equal(runItem.explanation_projection.run_id, runId);
      assert.equal(runItem.explanation_projection.compatibility_anchor.run, `/v1/runs/${runId}?topic_id=${topicId}`);
      assert.equal(
        runItem.explanation_projection.compatibility_anchor.timeline,
        `/v1/runs/${runId}/timeline?topic_id=${topicId}`
      );
      assert.equal(
        runItem.explanation_projection.compatibility_anchor.feedback,
        `/v1/runs/${runId}/feedback?topic_id=${topicId}`
      );
      assert.equal(
        runItem.explanation_projection.compatibility_anchor.holds,
        `/v1/runs/${runId}/holds?topic_id=${topicId}`
      );
      assert.equal(
        runItem.explanation_projection.compatibility_anchor.execution_events,
        `/v1/execution/runs/${runId}/events?topic_id=${topicId}`
      );
      assert.equal(
        runItem.explanation_projection.compatibility_anchor.execution_debug,
        `/v1/execution/runs/${runId}/debug?topic_id=${topicId}`
      );

      const runDetail = await requestJson({
        port,
        method: "GET",
        path: runItem.explanation_projection.compatibility_anchor.run
      });
      assert.equal(runDetail.statusCode, 200);
      assert.equal(runDetail.body.projection_meta.resource, "run_projection");
      assert.equal(runDetail.body.projection_meta.topic_id, topicId);
      assert.equal(runDetail.body.projection_meta.run_id, runId);
      assert.equal(runDetail.body.topic_id, topicId);
      assert.equal(runDetail.body.run_id, runId);

      const runTimeline = await requestJson({
        port,
        method: "GET",
        path: runItem.explanation_projection.compatibility_anchor.timeline
      });
      assert.equal(runTimeline.statusCode, 200);
      assert.equal(runTimeline.body.projection_meta.resource, "run_timeline_projection");
      assert.equal(runTimeline.body.projection_meta.topic_id, topicId);
      assert.equal(runTimeline.body.projection_meta.run_id, runId);

      const runFeedback = await requestJson({
        port,
        method: "GET",
        path: runItem.explanation_projection.compatibility_anchor.feedback
      });
      assert.equal(runFeedback.statusCode, 200);
      assert.equal(runFeedback.body.projection_meta.resource, "run_feedback_projection");
      assert.equal(runFeedback.body.projection_meta.topic_id, topicId);
      assert.equal(runFeedback.body.projection_meta.run_id, runId);

      const runHolds = await requestJson({
        port,
        method: "GET",
        path: runItem.explanation_projection.compatibility_anchor.holds
      });
      assert.equal(runHolds.statusCode, 200);
      assert.equal(runHolds.body.projection_meta.resource, "run_hold_projection");
      assert.equal(runHolds.body.projection_meta.topic_id, topicId);
      assert.equal(runHolds.body.projection_meta.run_id, runId);

      const runDebug = await requestJson({
        port,
        method: "GET",
        path: runItem.explanation_projection.compatibility_anchor.execution_debug
      });
      assert.equal(runDebug.statusCode, 200);
      assert.equal(runDebug.body.projection_meta.resource, "execution_run_debug_evidence_projection");
      assert.equal(runDebug.body.projection_meta.topic_id, topicId);
      assert.equal(runDebug.body.projection_meta.run_id, runId);

      const runEvents = await requestJson({
        port,
        method: "GET",
        path: `${runItem.explanation_projection.compatibility_anchor.execution_events}&after_sequence=0&limit=20`
      });
      assert.equal(runEvents.statusCode, 200);
      assert.equal(runEvents.body.projection_meta.resource, "execution_run_event_projection");
      assert.equal(runEvents.body.projection_meta.topic_id, topicId);
      assert.equal(runEvents.body.projection_meta.run_id, runId);

      const executionInbox = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/${encodeURIComponent(topicId)}/execution-inbox?actor_id=human_sample_01&run_limit=20&inbox_limit=20`
      });
      assert.equal(executionInbox.statusCode, 200);
      assert.equal(executionInbox.body.projection, "execution_inbox_consumer_projection");
      assert.equal(executionInbox.body.contract_version, "v1.stage1");
      assert.equal(executionInbox.body.topic_id, topicId);
      assert.equal(executionInbox.body.actor_id, "human_sample_01");
      assert.equal(executionInbox.body.selected_run_id, runId);
      assert.equal(executionInbox.body.run_history.projection, "execution_plane_projection");
      assert.equal(executionInbox.body.run_history.topic_id, topicId);
      assert.equal(executionInbox.body.selected_run.summary.run_id, runId);
      assert.equal(executionInbox.body.selected_run.summary.topic_id, topicId);
      assert.equal(executionInbox.body.selected_run.timeline.projection, "execution_plane_projection");
      assert.equal(executionInbox.body.selected_run.feedback.projection, "execution_plane_projection");
      assert.equal(executionInbox.body.selected_run.holds.projection, "execution_plane_projection");
      assert.equal(executionInbox.body.inbox.projection, "control_plane_projection");
      assert.equal(executionInbox.body.inbox.topic_id, topicId);
      assert.equal(executionInbox.body.inbox.actor_id, "human_sample_01");
      assert.equal(
        executionInbox.body.compatibility_anchor.inbox,
        `/v1/inbox/human_sample_01?topic_id=${encodeURIComponent(topicId)}`
      );
      assert.equal(executionInbox.body.compatibility_anchor.inbox_acks, "/v1/inbox/human_sample_01/acks");
      assert.equal(executionInbox.body.compatibility_anchor.run, `/v1/runs/${runId}?topic_id=${topicId}`);
      assert.equal(
        executionInbox.body.compatibility_anchor.timeline,
        `/v1/runs/${runId}/timeline?topic_id=${topicId}`
      );
      assert.equal(
        executionInbox.body.compatibility_anchor.feedback,
        `/v1/runs/${runId}/feedback?topic_id=${topicId}`
      );
      assert.equal(
        executionInbox.body.compatibility_anchor.holds,
        `/v1/runs/${runId}/holds?topic_id=${topicId}`
      );
      assert.equal(executionInbox.body.closeout_clues.outcome, "failure_or_blocked");
      assert.equal(executionInbox.body.closeout_clues.blocker_count > 0, true);

      const missingActorId = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/${encodeURIComponent(topicId)}/execution-inbox`
      });
      assert.equal(missingActorId.statusCode, 400);
      assert.equal(missingActorId.body.error.code, "invalid_actor_id");

      const missingRun = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/${encodeURIComponent(topicId)}/execution-inbox?actor_id=human_sample_01&run_id=run_missing_phase3_execution_consumer`
      });
      assert.equal(missingRun.statusCode, 404);
      assert.equal(missingRun.body.error.code, "run_not_found");

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: `/v1/compatibility/shell-adapter?topic_id=${encodeURIComponent(topicId)}`
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.equal(shellCompatibility.body.projection_meta.resource, "shell_adapter_compatibility_projection");
      assert.equal(shellCompatibility.body.projection_meta.topic_id, topicId);
      const projectionSurfaces = shellCompatibility.body.backend_derived_projection.projection_surfaces;
      assert.ok(Array.isArray(projectionSurfaces));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/status"));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/topic-state"));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/merge-lifecycle"));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/task-allocation"));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/messages"));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/approval-holds?status=:status"));
      assert.ok(projectionSurfaces.includes("/v1/topics/:topicId/approval-holds/:holdId/decisions"));
      assert.ok(
        projectionSurfaces.includes("/v1/runs/:runId?topic_id=:topicId")
      );
      assert.ok(
        projectionSurfaces.includes("/v1/runs/:runId/timeline?topic_id=:topicId")
      );
      assert.ok(
        projectionSurfaces.includes("/v1/runs/:runId/feedback?topic_id=:topicId")
      );
      assert.ok(
        projectionSurfaces.includes("/v1/runs/:runId/holds?topic_id=:topicId")
      );
      assert.ok(
        projectionSurfaces.includes("/v1/execution/runs/:runId/debug?topic_id=:topicId")
      );
      assert.ok(
        projectionSurfaces.includes("/v1/execution/runs/:runId/events?topic_id=:topicId")
      );
      assert.ok(
        projectionSurfaces.includes("/v1/topics/:topicId/execution-inbox?actor_id=:actorId")
      );
      for (const surface of projectionSurfaces) {
        assert.ok(surface.startsWith("/v1/"), `legacy surface leaked: ${surface}`);
      }
      assert.equal(shellCompatibility.body.backend_derived_projection.lineage_anchors.topic_status, "/v1/topics/:topicId/status");
      assert.equal(shellCompatibility.body.backend_derived_projection.lineage_anchors.topic_state, "/v1/topics/:topicId/topic-state");
      assert.equal(shellCompatibility.body.backend_derived_projection.lineage_anchors.merge_lifecycle, "/v1/topics/:topicId/merge-lifecycle");
      assert.equal(shellCompatibility.body.backend_derived_projection.lineage_anchors.task_allocation, "/v1/topics/:topicId/task-allocation");
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.approval_holds,
        "/v1/topics/:topicId/approval-holds?status=:status"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.approval_decisions,
        "/v1/topics/:topicId/approval-holds/:holdId/decisions"
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.execution_inbox,
        "/v1/topics/:topicId/execution-inbox?actor_id=:actorId"
      );

      const runDetailViaTemplate = await requestJson({
        port,
        method: "GET",
        path: renderContractPath(
          shellCompatibility.body.backend_derived_projection.lineage_anchors.run_detail,
          { topicId, runId }
        )
      });
      assert.equal(runDetailViaTemplate.statusCode, 200);
      assert.equal(runDetailViaTemplate.body.projection_meta.topic_id, topicId);
      assert.equal(runDetailViaTemplate.body.projection_meta.run_id, runId);

      const runTimelineViaTemplate = await requestJson({
        port,
        method: "GET",
        path: renderContractPath(
          shellCompatibility.body.backend_derived_projection.lineage_anchors.run_timeline,
          { topicId, runId }
        )
      });
      assert.equal(runTimelineViaTemplate.statusCode, 200);
      assert.equal(runTimelineViaTemplate.body.projection_meta.topic_id, topicId);
      assert.equal(runTimelineViaTemplate.body.projection_meta.run_id, runId);

      const runFeedbackViaTemplate = await requestJson({
        port,
        method: "GET",
        path: renderContractPath(
          shellCompatibility.body.backend_derived_projection.lineage_anchors.run_feedback,
          { topicId, runId }
        )
      });
      assert.equal(runFeedbackViaTemplate.statusCode, 200);
      assert.equal(runFeedbackViaTemplate.body.projection_meta.topic_id, topicId);
      assert.equal(runFeedbackViaTemplate.body.projection_meta.run_id, runId);

      const runHoldsViaTemplate = await requestJson({
        port,
        method: "GET",
        path: renderContractPath(
          shellCompatibility.body.backend_derived_projection.lineage_anchors.run_holds,
          { topicId, runId }
        )
      });
      assert.equal(runHoldsViaTemplate.statusCode, 200);
      assert.equal(runHoldsViaTemplate.body.projection_meta.topic_id, topicId);
      assert.equal(runHoldsViaTemplate.body.projection_meta.run_id, runId);

      const runDebugViaTemplate = await requestJson({
        port,
        method: "GET",
        path: renderContractPath(
          shellCompatibility.body.backend_derived_projection.lineage_anchors.execution_debug,
          { topicId, runId }
        )
      });
      assert.equal(runDebugViaTemplate.statusCode, 200);
      assert.equal(runDebugViaTemplate.body.projection_meta.topic_id, topicId);
      assert.equal(runDebugViaTemplate.body.projection_meta.run_id, runId);

      const runEventsViaTemplate = await requestJson({
        port,
        method: "GET",
        path: `${renderContractPath(
          shellCompatibility.body.backend_derived_projection.lineage_anchors.execution_events,
          { topicId, runId }
        )}&after_sequence=0&limit=20`
      });
      assert.equal(runEventsViaTemplate.statusCode, 200);
      assert.equal(runEventsViaTemplate.body.projection_meta.topic_id, topicId);
      assert.equal(runEventsViaTemplate.body.projection_meta.run_id, runId);

      const payload = JSON.stringify({
        runDebug: runDebug.body,
        runEvents: runEvents.body,
        executionInbox: executionInbox.body,
        shellAdapter: shellCompatibility.body
      });
      assert.equal(payload.includes("worktree_path"), false);
      assert.equal(payload.includes("lane_root_path"), false);
      assert.equal(payload.includes("lane_worktree_path"), false);
      assert.equal(payload.includes("run_path"), false);

      const invalidEventsCursor = await requestJson({
        port,
        method: "GET",
        path: `/v1/execution/runs/${encodeURIComponent(runId)}/events?topic_id=${encodeURIComponent(topicId)}&after_sequence=-1`
      });
      assert.equal(invalidEventsCursor.statusCode, 422);
      assert.equal(invalidEventsCursor.body.error.code ?? invalidEventsCursor.body.error, "run_events_after_sequence_invalid");

      const wrongTopicBinding = await requestJson({
        port,
        method: "GET",
        path: `/v1/runs/${encodeURIComponent(runId)}?topic_id=topic_missing_phase3_execution_consumer`
      });
      assert.equal(wrongTopicBinding.statusCode, 404);
      assert.equal(wrongTopicBinding.body.error.code ?? wrongTopicBinding.body.error, "topic_not_found");
    }
  );
});

test("v1 phase3 batch1 control-plane consumer contract keeps topic-state/merge-lifecycle/task-allocation/messages/approval-decision stable", async () => {
  await withRuntimeServer(
    {
      fixture: {
        topicId: "topic_v1_phase3_batch1_control_contract"
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const upsertHuman = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/actors/human_sample_01",
        body: {
          role: "human",
          status: "active"
        }
      });
      assert.equal(upsertHuman.statusCode, 200);

      const topicStateBeforePatch = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/topic-state"
      });
      assert.equal(topicStateBeforePatch.statusCode, 200);

      const truthPatch = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: topicStateBeforePatch.body.topic_state.revision,
          payload: {
            patch: {
              taskAllocation: [
                {
                  task_id: "task_phase3_batch1_control_01",
                  summary: "validate consumer control read model contract",
                  worker_actor_id: "worker_sample_01",
                  status: "in_progress"
                },
                {
                  task_id: "task_phase3_batch1_control_02",
                  summary: "validate approval decision write/read stays in v1",
                  status: "pending"
                }
              ],
              mergeIntent: {
                stage: "awaiting_merge_gate",
                deliveryReadyLineage: {
                  run_id: "run_phase3_batch1_control_01",
                  checkpoint_ref: "checkpoint://phase3-batch1-control",
                  artifact_refs: ["artifact://phase3-batch1-control"]
                }
              },
              deliveryState: {
                state: "awaiting_merge_gate"
              }
            }
          }
        }
      });
      assert.equal(truthPatch.statusCode, 200);
      assert.equal(truthPatch.body.state, "accepted");

      const topicState = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/topic-state"
      });
      assert.equal(topicState.statusCode, 200);
      assert.equal(topicState.body.topic_state.revision, truthPatch.body.revision);
      assert.equal(topicState.body.topic_state.merge_stage, "awaiting_merge_gate");
      assert.equal(topicState.body.topic_state.pending_approval_count, 0);

      const mergeLifecycle = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/merge-lifecycle"
      });
      assert.equal(mergeLifecycle.statusCode, 200);
      assert.equal(mergeLifecycle.body.merge_lifecycle.stage, "awaiting_merge_gate");
      assert.equal(mergeLifecycle.body.merge_lifecycle.closeout_lineage.run_id, "run_phase3_batch1_control_01");
      assert.equal(mergeLifecycle.body.merge_lifecycle.evidence_anchor.source, "server_owned");

      const taskAllocation = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/task-allocation"
      });
      assert.equal(taskAllocation.statusCode, 200);
      assert.equal(taskAllocation.body.task_allocation.items.length, 2);
      assert.equal(taskAllocation.body.task_allocation.summary.total_tasks, 2);
      assert.equal(taskAllocation.body.task_allocation.summary.assigned_tasks, 1);
      assert.equal(taskAllocation.body.task_allocation.summary.unassigned_tasks, 1);
      assert.equal(taskAllocation.body.task_allocation.evidence_anchor.source, "server_owned");

      const controlConsumerBeforeHandoff = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/control-plane-consumer"
      });
      assert.equal(controlConsumerBeforeHandoff.statusCode, 200);
      assert.equal(controlConsumerBeforeHandoff.body.projection, "control_plane_consumer_projection");
      assert.equal(controlConsumerBeforeHandoff.body.contract_version, "v1.stage1");
      assert.equal(controlConsumerBeforeHandoff.body.topic_id, "topic_v1_phase3_batch1_control_contract");
      assert.equal(controlConsumerBeforeHandoff.body.topic_status.topic_id, "topic_v1_phase3_batch1_control_contract");
      assert.equal(controlConsumerBeforeHandoff.body.topic_state.revision, truthPatch.body.revision);
      assert.equal(controlConsumerBeforeHandoff.body.merge_lifecycle.stage, "awaiting_merge_gate");
      assert.equal(controlConsumerBeforeHandoff.body.task_allocation.summary.total_tasks, 2);
      assert.equal(controlConsumerBeforeHandoff.body.approval_holds.status, "pending");
      assert.equal(controlConsumerBeforeHandoff.body.approval_holds.items.length, 0);
      assert.equal(controlConsumerBeforeHandoff.body.approval_decisions.items.length, 0);
      assert.equal(controlConsumerBeforeHandoff.body.write_anchors.actor_upsert, "/v1/topics/topic_v1_phase3_batch1_control_contract/actors/:actorId");
      assert.equal(controlConsumerBeforeHandoff.body.write_anchors.topic_messages, "/v1/topics/topic_v1_phase3_batch1_control_contract/messages");
      assert.equal(
        controlConsumerBeforeHandoff.body.write_anchors.approval_decisions,
        "/v1/topics/topic_v1_phase3_batch1_control_contract/approval-holds/:holdId/decisions"
      );

      const handoff = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/messages",
        body: {
          type: "handoff_package",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          targetScope: "lead",
          runId: "run_phase3_batch1_control_01",
          laneId: "lane_phase3_batch1_control_01",
          referencedArtifacts: ["artifact://phase3-batch1-control-handoff"],
          payload: {
            summary: "phase3 batch1 control contract handoff"
          }
        }
      });
      assert.equal(handoff.statusCode, 200);

      const handoffAck = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/messages",
        body: {
          type: "status_report",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          runId: "run_phase3_batch1_control_01",
          payload: {
            event: "handoff_ack",
            handoffId: handoff.body.messageId,
            resolvedArtifacts: ["artifact://phase3-batch1-control-handoff"]
          }
        }
      });
      assert.equal(handoffAck.statusCode, 200);

      const mergeRequest = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/messages",
        body: {
          type: "merge_request",
          sourceAgentId: "worker_sample_01",
          sourceRole: "worker",
          runId: "run_phase3_batch1_control_01",
          laneId: "lane_phase3_batch1_control_01",
          payload: {
            handoffId: handoff.body.messageId
          }
        }
      });
      assert.equal(mergeRequest.statusCode, 200);
      assert.equal(mergeRequest.body.result.status, "merge_candidate_waiting_human_gate");
      const holdId = mergeRequest.body.result.holdIds[0];
      assert.ok(typeof holdId === "string" && holdId.length > 0);

      const messages = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/messages"
      });
      assert.equal(messages.statusCode, 200);
      assert.ok(messages.body.some((item) => item.messageId === handoff.body.messageId && item.type === "handoff_package"));
      assert.ok(messages.body.some((item) => item.messageId === mergeRequest.body.messageId && item.type === "merge_request"));

      const pendingApprovalHolds = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/approval-holds?status=pending&limit=20"
      });
      assert.equal(pendingApprovalHolds.statusCode, 200);
      assert.ok(pendingApprovalHolds.body.items.some((item) => item.hold_id === holdId));

      const approveDecision = await requestJson({
        port,
        method: "POST",
        path: `/v1/topics/topic_v1_phase3_batch1_control_contract/approval-holds/${holdId}/decisions`,
        headers: {
          "idempotency-key": `phase3-batch1-approve-${holdId}`
        },
        body: {
          decider_actor_id: "human_sample_01",
          approve: true,
          intervention_point: holdId
        }
      });
      assert.equal(approveDecision.statusCode, 200);
      assert.equal(approveDecision.body.decision.hold_id, holdId);
      assert.equal(approveDecision.body.decision.status, "approved");

      const decisionList = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/topic_v1_phase3_batch1_control_contract/approval-holds/${holdId}/decisions`
      });
      assert.equal(decisionList.statusCode, 200);
      assert.ok(decisionList.body.items.some((item) => item.hold_id === holdId && item.status === "approved"));
      assert.equal(decisionList.body.items[0].evidence_anchor.source, "server_owned");

      const controlConsumerAfterDecision = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/control-plane-consumer"
      });
      assert.equal(controlConsumerAfterDecision.statusCode, 200);
      assert.ok(
        controlConsumerAfterDecision.body.topic_messages.items.some(
          (item) => item.messageId === mergeRequest.body.messageId && item.type === "merge_request"
        )
      );
      assert.ok(
        controlConsumerAfterDecision.body.approval_holds.items.every((item) => item.status === "pending")
      );
      assert.ok(
        controlConsumerAfterDecision.body.approval_decisions.items.some(
          (item) => item.hold_id === holdId && item.status === "approved"
        )
      );
      assert.equal(controlConsumerAfterDecision.body.closeout_clues.status, "waiting_gate");
      assert.equal(controlConsumerAfterDecision.body.projection_meta.resource, "control_plane_consumer_projection");
      assert.equal(controlConsumerAfterDecision.body.projection_meta.topic_id, "topic_v1_phase3_batch1_control_contract");
      assert.equal(controlConsumerAfterDecision.body.projection_meta.source_plane, "control_plane_projection");

      const mergeLifecycleAfterApprove = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/merge-lifecycle"
      });
      assert.equal(mergeLifecycleAfterApprove.statusCode, 200);
      assert.equal(mergeLifecycleAfterApprove.body.merge_lifecycle.stage, "awaiting_merge_gate");
      assert.equal(mergeLifecycleAfterApprove.body.merge_lifecycle.delivery.state, "pr_ready");
      assert.equal(mergeLifecycleAfterApprove.body.merge_lifecycle.pending_approval_count, 0);

      const blockLead = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/actors/lead_sample_01",
        body: {
          role: "lead",
          status: "blocked"
        }
      });
      assert.equal(blockLead.statusCode, 200);

      const blockedDeliveryWrite = await requestJson({
        port,
        method: "PUT",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/delivery",
        headers: {
          "idempotency-key": "phase3-batch1-control-delivery-blocked"
        },
        body: {
          source_actor_id: "lead_sample_01",
          state: "merged",
          note: "must be rejected by shared write-gate"
        }
      });
      assert.equal(blockedDeliveryWrite.statusCode, 422);
      assert.equal(blockedDeliveryWrite.body.error.code, "write_actor_inactive");

      const mergeLifecycleAfterRejectedWrite = await requestJson({
        port,
        method: "GET",
        path: "/v1/topics/topic_v1_phase3_batch1_control_contract/merge-lifecycle"
      });
      assert.equal(mergeLifecycleAfterRejectedWrite.statusCode, 200);
      assert.equal(mergeLifecycleAfterRejectedWrite.body.merge_lifecycle.stage, "awaiting_merge_gate");
      assert.equal(mergeLifecycleAfterRejectedWrite.body.merge_lifecycle.delivery.state, "pr_ready");

      const shellCompatibility = await requestJson({
        port,
        method: "GET",
        path: "/v1/compatibility/shell-adapter?topic_id=topic_v1_phase3_batch1_control_contract"
      });
      assert.equal(shellCompatibility.statusCode, 200);
      assert.ok(
        shellCompatibility.body.backend_derived_projection.projection_surfaces.includes(
          "/v1/topics/:topicId/control-plane-consumer"
        )
      );
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.control_plane_consumer,
        "/v1/topics/:topicId/control-plane-consumer"
      );
    }
  );
});

test("v1 stage2 runtime registration/pairing/liveness and worktree isolation stay single-human multi-agent", async () => {
  const operatorId = "human_operator_stage2";
  const channelId = "channel_open_shock";
  const threadId = "thread_runtime_stage2";
  const workitemId = "issue_runtime_001";
  await withRuntimeServer(
    {
      coordinatorOptions: {
        runtimeLivenessMs: 1000
      }
    },
    async ({ port }) => {
      const machine = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/machines/machine_local_stage2",
        body: {
          runtime_id: "runtime_local_stage2",
          status: "online",
          capabilities: ["node", "git"]
        }
      });
      assert.equal(machine.statusCode, 200);
      assert.equal(machine.body.machine.machine_id, "machine_local_stage2");
      assert.equal(machine.body.machine.runtime_id, "runtime_local_stage2");
      assert.equal(machine.body.machine.liveness, "online");

      const agentAlpha = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_alpha_stage2",
        body: {
          machine_id: "machine_local_stage2",
          status: "idle",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(agentAlpha.statusCode, 200);
      assert.equal(agentAlpha.body.agent.machine_id, "machine_local_stage2");
      assert.equal(agentAlpha.body.agent.runtime_id, "runtime_local_stage2");
      assert.equal(agentAlpha.body.agent.owner_operator_id, operatorId);
      assert.equal(agentAlpha.body.agent.assigned_channel_id, channelId);
      assert.equal(agentAlpha.body.agent.assigned_thread_id, threadId);
      assert.equal(agentAlpha.body.agent.assigned_workitem_id, workitemId);
      assert.equal(agentAlpha.body.agent.pairing_state, "paired");
      assert.equal(agentAlpha.body.agent.liveness, "online");

      const agentBeta = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_beta_stage2",
        body: {
          machine_id: "machine_local_stage2",
          status: "idle",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(agentBeta.statusCode, 200);

      const pairBeta = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_beta_stage2/pairing",
        body: {
          machine_id: "machine_local_stage2",
          status: "ready",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(pairBeta.statusCode, 200);
      assert.equal(pairBeta.body.pairing.agent.agent_id, "agent_beta_stage2");
      assert.equal(pairBeta.body.pairing.agent.status, "ready");
      assert.equal(pairBeta.body.pairing.agent.machine_id, "machine_local_stage2");

      const heartbeatAlpha = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_alpha_stage2/heartbeat",
        body: {
          status: "running",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(heartbeatAlpha.statusCode, 200);
      assert.equal(heartbeatAlpha.body.heartbeat.agent.agent_id, "agent_alpha_stage2");
      assert.equal(heartbeatAlpha.body.heartbeat.agent.status, "running");
      assert.equal(heartbeatAlpha.body.heartbeat.agent.liveness, "online");

      const firstClaim = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_stage2_main",
        body: {
          agent_id: "agent_alpha_stage2",
          repo_ref: "Little-Shock/OpenShockSwarm",
          branch: "feat/initial-implementation",
          lane_id: "lane_stage2_alpha",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(firstClaim.statusCode, 200);
      assert.equal(firstClaim.body.claim.claim_key, "topic_stage2_main");
      assert.equal(firstClaim.body.claim.agent_id, "agent_alpha_stage2");
      assert.equal(firstClaim.body.claim.owner_operator_id, operatorId);
      assert.equal(firstClaim.body.claim.assigned_channel_id, channelId);
      assert.equal(firstClaim.body.claim.assigned_thread_id, threadId);
      assert.equal(firstClaim.body.claim.reclaimed_from_agent_id, null);
      assert.equal(firstClaim.body.claim.claim_status, "active");

      const conflictClaim = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_stage2_main",
        body: {
          agent_id: "agent_beta_stage2",
          repo_ref: "Little-Shock/OpenShockSwarm",
          branch: "feat/initial-implementation",
          lane_id: "lane_stage2_beta",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(conflictClaim.statusCode, 409);
      assert.equal(conflictClaim.body.error.code, "worktree_isolation_conflict");

      const ownershipMismatch = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_alpha_stage2/heartbeat",
        body: {
          status: "running",
          operator_id: "human_operator_other",
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(ownershipMismatch.statusCode, 422);
      assert.equal(ownershipMismatch.body.error.code, "agent_operator_mismatch");

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const staleRegistry = await requestJson({
        port,
        method: "GET",
        path: "/v1/runtime/registry"
      });
      assert.equal(staleRegistry.statusCode, 200);
      assert.equal(
        staleRegistry.body.agents.some((item) => item.agent_id === "agent_alpha_stage2" && item.liveness === "offline"),
        true
      );

      const heartbeatBeta = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_stage2/heartbeat",
        body: {
          status: "running",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(heartbeatBeta.statusCode, 200);
      assert.equal(heartbeatBeta.body.heartbeat.agent.liveness, "online");

      const scopeMismatch = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_stage2_scope_mismatch",
        body: {
          agent_id: "agent_beta_stage2",
          repo_ref: "Little-Shock/OpenShockSwarm",
          branch: "feat/initial-implementation",
          lane_id: "lane_stage2_beta",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: "thread_runtime_stage2_other",
          workitem_id: workitemId
        }
      });
      assert.equal(scopeMismatch.statusCode, 422);
      assert.equal(scopeMismatch.body.error.code, "agent_response_scope_mismatch");

      const reclaimedClaim = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_stage2_main",
        body: {
          agent_id: "agent_beta_stage2",
          repo_ref: "Little-Shock/OpenShockSwarm",
          branch: "feat/initial-implementation",
          lane_id: "lane_stage2_beta",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(reclaimedClaim.statusCode, 200);
      assert.equal(reclaimedClaim.body.claim.agent_id, "agent_beta_stage2");
      assert.equal(reclaimedClaim.body.claim.reclaimed_from_agent_id, "agent_alpha_stage2");

      const worktreeClaims = await requestJson({
        port,
        method: "GET",
        path: "/v1/runtime/worktree-claims?limit=20"
      });
      assert.equal(worktreeClaims.statusCode, 200);
      assert.equal(worktreeClaims.body.items.length, 1);
      assert.equal(worktreeClaims.body.items[0].claim_key, "topic_stage2_main");
      assert.equal(worktreeClaims.body.items[0].agent_id, "agent_beta_stage2");

      const badClaim = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_stage2_invalid",
        body: {
          agent_id: "agent_beta_stage2",
          branch: "feat/initial-implementation",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(badClaim.statusCode, 400);
      assert.equal(badClaim.body.error.code, "invalid_repo_ref");

      const releaseClaim = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/worktree-claims/topic_stage2_main/release",
        body: {
          agent_id: "agent_beta_stage2"
        }
      });
      assert.equal(releaseClaim.statusCode, 200);
      assert.equal(releaseClaim.body.release.claim_key, "topic_stage2_main");
      assert.equal(releaseClaim.body.release.released_by, "agent_beta_stage2");

      const unknownHeartbeat = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_unknown_stage2/heartbeat",
        body: {
          status: "running",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(unknownHeartbeat.statusCode, 404);
      assert.equal(unknownHeartbeat.body.error.code, "runtime_agent_not_found");

      const finalRegistry = await requestJson({
        port,
        method: "GET",
        path: "/v1/runtime/registry"
      });
      assert.equal(finalRegistry.statusCode, 200);
      assert.equal(finalRegistry.body.mode, "single_human_multi_agent");
      assert.equal(finalRegistry.body.summary.machine_count, 1);
      assert.equal(finalRegistry.body.summary.agent_count, 2);
      assert.equal(finalRegistry.body.summary.active_worktree_claim_count, 0);
      assert.equal(
        finalRegistry.body.agents.some(
          (item) =>
            item.agent_id === "agent_beta_stage2" &&
            item.owner_operator_id === operatorId &&
            item.assigned_channel_id === channelId &&
            item.assigned_thread_id === threadId
        ),
        true
      );
      assert.equal(finalRegistry.body.projection_meta.resource, "runtime_registry_projection");
      const registryPayload = JSON.stringify(finalRegistry.body);
      assert.equal(registryPayload.includes("worktree_path"), false);
      assert.equal(registryPayload.includes("lane_worktree_path"), false);
      assert.equal(registryPayload.includes("file://"), false);
    }
  );
});

test("v1 stage2 control-plane channel context contract keeps single-operator repo binding and audit trail", async () => {
  const channelId = "channel_open_shock_stage2";
  const topicId = "topic_stage2_control_plane_contract";
  const operatorId = "human_operator_stage2";

  await withRuntimeServer(
    {
      fixture: {
        topicId
      }
    },
    async ({ port }) => {
      const seeded = await requestJson({
        port,
        method: "POST",
        path: "/runtime/fixtures/seed",
        body: {}
      });
      assert.equal(seeded.statusCode, 200);

      const missingContext = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/context`
      });
      assert.equal(missingContext.statusCode, 404);
      assert.equal(missingContext.body.error.code, "channel_not_found");

      const upsertContext = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/context`,
        body: {
          operator_id: operatorId,
          workspace_id: "workspace_default",
          workspace_root: "/Users/atou/.slock/agents",
          baseline_ref: "feat/initial-implementation@3058687",
          fixed_directory: "/Users/atou/OpenShockSwarm",
          doc_paths: [
            "/Users/atou/OpenShockSwarm/docs/open-shock-roadmap.md",
            "/Users/atou/OpenShockSwarm/docs/open-shock-test-cases.md"
          ],
          runtime_entries: ["/runtime/config", "/v1/runtime/registry"],
          rule_entries: ["/Users/atou/.slock/agents/AGENTS.md"],
          policy_snapshot: {
            mode: "single_human_multi_agent",
            boundary: "channel_aligned_entry"
          }
        }
      });
      assert.equal(upsertContext.statusCode, 200);
      assert.equal(upsertContext.body.context.channel_id, channelId);
      assert.equal(upsertContext.body.context.owner_operator_id, operatorId);
      assert.equal(upsertContext.body.context.project_aligned_entry, true);
      assert.equal(upsertContext.body.context.workspace.root_path, "/Users/atou/.slock/agents");
      assert.equal(upsertContext.body.context.context.fixed_directory, "/Users/atou/OpenShockSwarm");
      assert.equal(upsertContext.body.context.context.doc_paths.length, 2);
      assert.equal(
        upsertContext.body.context.write_anchors.repo_binding_upsert,
        `/v1/channels/${encodeURIComponent(channelId)}/repo-binding`
      );

      const upsertRepoBinding = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/repo-binding`,
        body: {
          operator_id: operatorId,
          topic_id: topicId,
          provider_ref: {
            provider: "github",
            repo_ref: "Little-Shock/OpenShockSwarm"
          },
          default_branch: "feat/initial-implementation",
          fixed_directory: "/Users/atou/OpenShockSwarm",
          policy_snapshot: {
            mode: "single_human_multi_agent",
            action: "repo_binding_upsert"
          }
        }
      });
      assert.equal(upsertRepoBinding.statusCode, 200);
      assert.equal(upsertRepoBinding.body.repo_binding.channel_id, channelId);
      assert.equal(upsertRepoBinding.body.repo_binding.owner_operator_id, operatorId);
      assert.equal(upsertRepoBinding.body.repo_binding.repo_binding.topic_id, topicId);
      assert.equal(upsertRepoBinding.body.repo_binding.repo_binding.provider_ref.repo_ref, "Little-Shock/OpenShockSwarm");
      assert.equal(upsertRepoBinding.body.repo_binding.repo_binding.default_branch, "feat/initial-implementation");

      const topicRepoBinding = await requestJson({
        port,
        method: "GET",
        path: `/v1/topics/${encodeURIComponent(topicId)}/repo-binding`
      });
      assert.equal(topicRepoBinding.statusCode, 200);
      assert.equal(topicRepoBinding.body.repo_binding.topic_id, topicId);
      assert.equal(topicRepoBinding.body.repo_binding.provider_ref.repo_ref, "Little-Shock/OpenShockSwarm");

      const channelContext = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/context`
      });
      assert.equal(channelContext.statusCode, 200);
      assert.equal(channelContext.body.context.repo_binding.topic_id, topicId);
      assert.equal(channelContext.body.context.context.baseline_ref, "feat/initial-implementation@3058687");
      assert.equal(channelContext.body.context.context.runtime_entries.includes("/v1/runtime/registry"), true);
      assert.equal(channelContext.body.context.context.rule_entries.includes("/Users/atou/.slock/agents/AGENTS.md"), true);

      const auditTrail = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/audit-trail?limit=20`
      });
      assert.equal(auditTrail.statusCode, 200);
      assert.equal(auditTrail.body.projection, "control_plane_audit_projection");
      assert.equal(auditTrail.body.channel_id, channelId);
      assert.equal(
        auditTrail.body.items.some(
          (item) => item.action === "channel_context_upsert" && item.actor_id === operatorId
        ),
        true
      );
      assert.equal(
        auditTrail.body.items.some(
          (item) => item.action === "channel_repo_binding_upsert" && item.actor_id === operatorId
        ),
        true
      );
      assert.equal(
        auditTrail.body.items.every(
          (item) =>
            Object.prototype.hasOwnProperty.call(item, "policy_snapshot") &&
            Object.prototype.hasOwnProperty.call(item, "target")
        ),
        true
      );

      const wrongOperator = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/context`,
        body: {
          operator_id: "human_operator_other",
          workspace_root: "/Users/atou/.slock/agents"
        }
      });
      assert.equal(wrongOperator.statusCode, 422);
      assert.equal(wrongOperator.body.error.code, "channel_operator_mismatch");

      const invalidField = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/context`,
        body: {
          operator_id: operatorId,
          workspace_root: "/Users/atou/.slock/agents",
          project_id: "project_should_not_exist"
        }
      });
      assert.equal(invalidField.statusCode, 400);
      assert.equal(invalidField.body.error.code, "invalid_channel_context_field");

      const payload = JSON.stringify({
        context: channelContext.body.context,
        repoBinding: upsertRepoBinding.body.repo_binding,
        auditTrail: auditTrail.body
      });
      assert.equal(payload.includes("\"project_id\""), false);
      assert.equal(payload.includes("\"workspace_invite\""), false);
    }
  );
});

test("v1 stage2 batch2 runtime recovery contract supports assignment enforcement and operator-triggered recoveries", async () => {
  const operatorId = "human_operator_stage2_batch2";
  const channelId = "channel_open_shock_batch2";
  const threadId = "thread_batch2_main";
  const workitemId = "issue_batch2_001";

  await withRuntimeServer(
    {
      coordinatorOptions: {
        runtimeLivenessMs: 1000
      }
    },
    async ({ port }) => {
      const machine = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/machines/machine_local_batch2",
        body: {
          runtime_id: "runtime_local_batch2",
          status: "online",
          capabilities: ["node", "git"]
        }
      });
      assert.equal(machine.statusCode, 200);

      const agentAlpha = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_alpha_batch2",
        body: {
          machine_id: "machine_local_batch2",
          status: "idle",
          operator_id: operatorId
        }
      });
      assert.equal(agentAlpha.statusCode, 200);

      const agentBeta = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_beta_batch2",
        body: {
          machine_id: "machine_local_batch2",
          status: "idle",
          operator_id: operatorId
        }
      });
      assert.equal(agentBeta.statusCode, 200);

      const unassignedResume = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_batch2/recovery-actions",
        body: {
          action: "resume",
          operator_id: operatorId
        }
      });
      assert.equal(unassignedResume.statusCode, 400);
      assert.equal(unassignedResume.body.error.code, "invalid_channel_id");

      const assignAlpha = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_alpha_batch2/assignment",
        body: {
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(assignAlpha.statusCode, 200);
      assert.equal(assignAlpha.body.assignment.agent.assigned_channel_id, channelId);
      assert.equal(assignAlpha.body.assignment.agent.assigned_thread_id, threadId);

      const assignBeta = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_beta_batch2/assignment",
        body: {
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(assignBeta.statusCode, 200);

      const assignmentMismatch = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_alpha_batch2/assignment",
        body: {
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: "thread_batch2_other",
          workitem_id: workitemId
        }
      });
      assert.equal(assignmentMismatch.statusCode, 422);
      assert.equal(assignmentMismatch.body.error.code, "agent_response_scope_mismatch");

      const alphaClaim = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_batch2_recover",
        body: {
          agent_id: "agent_alpha_batch2",
          repo_ref: "Little-Shock/OpenShockSwarm",
          branch: "feat/initial-implementation",
          lane_id: "lane_batch2_alpha",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(alphaClaim.statusCode, 200);
      assert.equal(alphaClaim.body.claim.agent_id, "agent_alpha_batch2");

      const conflictingClaim = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/worktree-claims/topic_batch2_recover",
        body: {
          agent_id: "agent_beta_batch2",
          repo_ref: "Little-Shock/OpenShockSwarm",
          branch: "feat/initial-implementation",
          lane_id: "lane_batch2_beta",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(conflictingClaim.statusCode, 409);
      assert.equal(conflictingClaim.body.error.code, "worktree_isolation_conflict");

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const heartbeatBeta = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_batch2/heartbeat",
        body: {
          status: "running",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId
        }
      });
      assert.equal(heartbeatBeta.statusCode, 200);

      const rebindAlpha = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_alpha_batch2/recovery-actions",
        body: {
          action: "rebind",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: "thread_batch2_rebound",
          workitem_id: "issue_batch2_rebound",
          reason: "operator_reassign_after_scope_change"
        }
      });
      assert.equal(rebindAlpha.statusCode, 200);
      assert.equal(rebindAlpha.body.recovery_action.action, "rebind");
      assert.equal(rebindAlpha.body.recovery_action.result.agent.assigned_thread_id, "thread_batch2_rebound");
      assert.equal(rebindAlpha.body.recovery_action.result.agent.assigned_workitem_id, "issue_batch2_rebound");

      const reclaimByBeta = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_batch2/recovery-actions",
        body: {
          action: "reclaim_worktree",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId,
          claim_key: "topic_batch2_recover",
          reason: "reclaim_stuck_worktree"
        }
      });
      assert.equal(reclaimByBeta.statusCode, 200);
      assert.equal(reclaimByBeta.body.recovery_action.action, "reclaim_worktree");
      assert.equal(reclaimByBeta.body.recovery_action.result.claim.agent_id, "agent_beta_batch2");
      assert.equal(reclaimByBeta.body.recovery_action.result.claim.reclaimed_from_agent_id, "agent_alpha_batch2");

      const resumeBeta = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_batch2/recovery-actions",
        body: {
          action: "resume",
          operator_id: operatorId,
          channel_id: channelId,
          thread_id: threadId,
          workitem_id: workitemId,
          status: "running",
          reason: "operator_resume_after_reclaim"
        }
      });
      assert.equal(resumeBeta.statusCode, 200);
      assert.equal(resumeBeta.body.recovery_action.action, "resume");
      assert.equal(resumeBeta.body.recovery_action.result.agent.status, "running");
      assert.equal(resumeBeta.body.recovery_action.result.agent.assigned_channel_id, channelId);

      const recoveryActions = await requestJson({
        port,
        method: "GET",
        path: `/v1/runtime/recovery-actions?channel_id=${encodeURIComponent(channelId)}&limit=20`
      });
      assert.equal(recoveryActions.statusCode, 200);
      assert.equal(recoveryActions.body.projection, "runtime_recovery_actions_projection");
      assert.equal(recoveryActions.body.mode, "single_human_multi_agent");
      assert.equal(recoveryActions.body.channel_id, channelId);
      assert.equal(
        recoveryActions.body.items.some((item) => item.action === "rebind" && item.agent_id === "agent_alpha_batch2"),
        true
      );
      assert.equal(
        recoveryActions.body.items.some((item) => item.action === "reclaim_worktree" && item.agent_id === "agent_beta_batch2"),
        true
      );
      assert.equal(
        recoveryActions.body.items.some((item) => item.action === "resume" && item.agent_id === "agent_beta_batch2"),
        true
      );

      const invalidRecoveryAction = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_batch2/recovery-actions",
        body: {
          action: "reboot_cluster",
          operator_id: operatorId
        }
      });
      assert.equal(invalidRecoveryAction.statusCode, 400);
      assert.equal(invalidRecoveryAction.body.error.code, "invalid_runtime_recovery_action");

      const wrongOperatorRecovery = await requestJson({
        port,
        method: "POST",
        path: "/v1/runtime/agents/agent_beta_batch2/recovery-actions",
        body: {
          action: "resume",
          operator_id: "human_operator_other"
        }
      });
      assert.equal(wrongOperatorRecovery.statusCode, 422);
      assert.equal(wrongOperatorRecovery.body.error.code, "agent_operator_mismatch");
    }
  );
});

test("v1 stage2 batch2 control-plane work assignment/operator action/recent actions stay channel-aligned", async () => {
  const channelId = "channel_open_shock_stage2_batch2";
  const operatorId = "human_operator_stage2_batch2";

  await withRuntimeServer(
    {
      coordinatorOptions: {
        runtimeLivenessMs: 1000
      }
    },
    async ({ port }) => {
      const upsertContext = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/context`,
        body: {
          operator_id: operatorId,
          workspace_id: "workspace_default",
          workspace_root: "/Users/atou/.slock/agents",
          baseline_ref: "feat/initial-implementation@05473fd",
          fixed_directory: "/Users/atou/OpenShockSwarm",
          doc_paths: ["/Users/atou/OpenShockSwarm/docs/open-shock-roadmap.md"],
          runtime_entries: ["/v1/runtime/registry"],
          rule_entries: ["/Users/atou/.slock/agents/AGENTS.md"]
        }
      });
      assert.equal(upsertContext.statusCode, 200);

      const machine = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/machines/machine_stage2_batch2",
        body: {
          runtime_id: "runtime_stage2_batch2",
          status: "online",
          capabilities: ["node", "git"]
        }
      });
      assert.equal(machine.statusCode, 200);

      const upsertAgent = await requestJson({
        port,
        method: "PUT",
        path: "/v1/runtime/agents/agent_stage2_batch2_alpha",
        body: {
          machine_id: "machine_stage2_batch2",
          status: "idle",
          operator_id: operatorId,
          channel_id: channelId
        }
      });
      assert.equal(upsertAgent.statusCode, 200);
      assert.equal(upsertAgent.body.agent.assigned_channel_id, channelId);
      assert.equal(upsertAgent.body.agent.assigned_thread_id, null);

      const assignment = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/work-assignments/agent_stage2_batch2_alpha`,
        body: {
          operator_id: operatorId,
          thread_id: "thread_stage2_batch2",
          workitem_id: "workitem_stage2_batch2",
          default_duty: "triage",
          note: "assign from channel entry"
        }
      });
      assert.equal(assignment.statusCode, 200);
      assert.equal(assignment.body.work_assignment.channel_id, channelId);
      assert.equal(assignment.body.work_assignment.agent_id, "agent_stage2_batch2_alpha");
      assert.equal(assignment.body.work_assignment.assigned_thread_id, "thread_stage2_batch2");
      assert.equal(assignment.body.work_assignment.assigned_workitem_id, "workitem_stage2_batch2");
      assert.equal(assignment.body.work_assignment.default_duty, "triage");

      const assignmentProjection = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/work-assignments?limit=20`
      });
      assert.equal(assignmentProjection.statusCode, 200);
      assert.equal(assignmentProjection.body.projection, "channel_work_assignment_projection");
      assert.equal(assignmentProjection.body.summary.total_assignments, 1);
      assert.equal(assignmentProjection.body.summary.assigned_count, 1);
      assert.equal(assignmentProjection.body.items[0].agent_id, "agent_stage2_batch2_alpha");

      const requestReport = await requestJson({
        port,
        method: "POST",
        path: `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
        body: {
          operator_id: operatorId,
          action_type: "request_report",
          agent_id: "agent_stage2_batch2_alpha",
          thread_id: "thread_stage2_batch2",
          workitem_id: "workitem_stage2_batch2",
          note: "ask for update",
          payload: {
            report_scope: "recent_progress"
          }
        }
      });
      assert.equal(requestReport.statusCode, 200);
      assert.equal(requestReport.body.action.action_type, "request_report");
      assert.equal(requestReport.body.action.agent_id, "agent_stage2_batch2_alpha");

      const recovery = await requestJson({
        port,
        method: "POST",
        path: `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
        body: {
          operator_id: operatorId,
          action_type: "recovery",
          agent_id: "agent_stage2_batch2_alpha",
          thread_id: "thread_stage2_batch2",
          workitem_id: "workitem_stage2_batch2",
          note: "recover loop"
        }
      });
      assert.equal(recovery.statusCode, 200);
      assert.equal(recovery.body.action.action_type, "recovery");

      const operatorActions = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/operator-actions?limit=20`
      });
      assert.equal(operatorActions.statusCode, 200);
      assert.equal(operatorActions.body.projection, "channel_operator_action_projection");
      assert.equal(operatorActions.body.items.length >= 2, true);
      assert.equal(
        operatorActions.body.items.some((item) => item.action_type === "request_report" && item.agent_id === "agent_stage2_batch2_alpha"),
        true
      );
      assert.equal(
        operatorActions.body.items.some((item) => item.action_type === "recovery"),
        true
      );

      const recentActions = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/recent-actions?limit=30`
      });
      assert.equal(recentActions.statusCode, 200);
      assert.equal(recentActions.body.projection, "channel_recent_actions_projection");
      assert.equal(recentActions.body.summary.operator_action_count >= 2, true);
      assert.equal(recentActions.body.summary.work_assignment_count >= 1, true);
      const workAssignmentRecent = recentActions.body.items.find(
        (item) => item.action_family === "work_assignment" && item.operator_scope.agent_id === "agent_stage2_batch2_alpha"
      );
      assert.ok(workAssignmentRecent);
      assert.equal(workAssignmentRecent.operator_scope.thread_id, "thread_stage2_batch2");
      assert.equal(workAssignmentRecent.operator_scope.workitem_id, "workitem_stage2_batch2");

      const invalidActionType = await requestJson({
        port,
        method: "POST",
        path: `/v1/channels/${encodeURIComponent(channelId)}/operator-actions`,
        body: {
          operator_id: operatorId,
          action_type: "scheduler_override"
        }
      });
      assert.equal(invalidActionType.statusCode, 400);
      assert.equal(invalidActionType.body.error.code, "invalid_operator_action_type");

      const assignmentScopeMismatch = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/work-assignments/agent_stage2_batch2_alpha`,
        body: {
          operator_id: operatorId,
          thread_id: "thread_stage2_batch2_other",
          workitem_id: "workitem_stage2_batch2"
        }
      });
      assert.equal(assignmentScopeMismatch.statusCode, 422);
      assert.equal(assignmentScopeMismatch.body.error.code, "agent_response_scope_mismatch");

      const assignmentWrongOperator = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/work-assignments/agent_stage2_batch2_alpha`,
        body: {
          operator_id: "human_operator_other",
          thread_id: "thread_stage2_batch2",
          workitem_id: "workitem_stage2_batch2"
        }
      });
      assert.equal(assignmentWrongOperator.statusCode, 422);
      assert.equal(assignmentWrongOperator.body.error.code, "channel_operator_mismatch");

      const assignmentInvalidField = await requestJson({
        port,
        method: "PUT",
        path: `/v1/channels/${encodeURIComponent(channelId)}/work-assignments/agent_stage2_batch2_alpha`,
        body: {
          operator_id: operatorId,
          thread_id: "thread_stage2_batch2",
          workitem_id: "workitem_stage2_batch2",
          project_id: "project_should_not_exist"
        }
      });
      assert.equal(assignmentInvalidField.statusCode, 400);
      assert.equal(assignmentInvalidField.body.error.code, "invalid_work_assignment_field");

      const auditTrail = await requestJson({
        port,
        method: "GET",
        path: `/v1/channels/${encodeURIComponent(channelId)}/audit-trail?limit=40`
      });
      assert.equal(auditTrail.statusCode, 200);
      assert.equal(
        auditTrail.body.items.some(
          (item) => item.action === "channel_work_assignment_upsert" && item.details.agent_id === "agent_stage2_batch2_alpha"
        ),
        true
      );
      assert.equal(
        auditTrail.body.items.some((item) => item.action === "channel_operator_action_request_report"),
        true
      );
      assert.equal(
        auditTrail.body.items.some((item) => item.action === "channel_operator_action_recovery"),
        true
      );

      const payload = JSON.stringify({
        assignments: assignmentProjection.body,
        operatorActions: operatorActions.body,
        recentActions: recentActions.body
      });
      assert.equal(payload.includes("\"project_id\""), false);
      assert.equal(payload.includes("\"workspace_invite\""), false);
    }
  );
});
