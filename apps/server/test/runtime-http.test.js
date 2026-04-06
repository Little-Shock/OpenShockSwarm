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
  const coordinator = new ServerCoordinator({ escalationMs: 10_000 });
  const server = createHttpServer(coordinator, options);
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
      assert.equal(runDetail.body.run_id, "run_batch2_01");
      assert.equal(runDetail.body.topic_id, "topic_v1_batch2");
      assert.equal(runDetail.body.links.replay, "/v1/runs/run_batch2_01/replay");

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
      assert.equal(notifications.body.projection, "control_plane_projection");
      assert.ok(notifications.body.items.length >= 1);
      assert.equal(notifications.body.items[0].debug_anchor.topic_id, "topic_v1_batch2");
      assert.equal(notifications.body.items[0].closeout_projection.topic_ref.topic_id, "topic_v1_batch2");

      const inbox = await requestJson({
        port,
        method: "GET",
        path: "/v1/inbox/human_sample_01?topic_id=topic_v1_batch2&limit=20"
      });
      assert.equal(inbox.statusCode, 200);
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

      const truthOnlyPatch = await requestJson({
        port,
        method: "POST",
        path: "/v1/topics/topic_batch6_control_truth/messages",
        body: {
          type: "shared_truth_proposal",
          sourceAgentId: "lead_sample_01",
          sourceRole: "lead",
          truthRevision: 1,
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
        "/v1/runs/run_batch6_exec_failure_01/replay?topic_id=topic_v1_batch6_execution_failure"
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
      assert.equal(
        shellCompatibility.body.backend_derived_projection.lineage_anchors.execution_debug,
        "/v1/execution/runs/:runId/debug?topic_id=:topicId"
      );
    }
  );
});
