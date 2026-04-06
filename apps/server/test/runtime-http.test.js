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
    ...(headers ?? {})
  };
  if (payload) {
    requestHeaders["Content-Type"] = requestHeaders["Content-Type"] ?? "application/json";
    requestHeaders["Content-Length"] =
      requestHeaders["Content-Length"] ?? Buffer.byteLength(payload);
  }
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

      const overview = await requestJson({
        port,
        method: "GET",
        path: "/topics/topic_runtime_daemon/overview"
      });
      assert.equal(overview.statusCode, 200);
      const daemonAgent = overview.body.agents.find((agent) => agent.agentId === "daemon_integrated_01");
      assert.ok(daemonAgent);
      assert.equal(daemonAgent.role, "system");
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

test("v1 control-plane command/event/debug contract exposes idempotency and rejection anchors", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: {
        "Idempotency-Key": "topic-v1-create-01"
      },
      body: {
        topic_id: "topic_v1_control",
        goal: "phase2 control-plane command/event split",
        constraints: ["backend-first", "api-first"]
      }
    });
    assert.equal(createTopic.statusCode, 201);
    assert.equal(createTopic.body.topic.topic_id, "topic_v1_control");

    const actorLead = await requestJson({
      port,
      method: "PUT",
      path: "/v1/topics/topic_v1_control/actors/lead_01",
      body: {
        role: "lead",
        status: "active"
      }
    });
    assert.equal(actorLead.statusCode, 200);

    const actorWorker = await requestJson({
      port,
      method: "PUT",
      path: "/v1/topics/topic_v1_control/actors/worker_01",
      body: {
        role: "worker",
        status: "active",
        lane_id: "lane_1"
      }
    });
    assert.equal(actorWorker.statusCode, 200);

    const actorHuman = await requestJson({
      port,
      method: "PUT",
      path: "/v1/topics/topic_v1_control/actors/human_01",
      body: {
        role: "human",
        status: "active"
      }
    });
    assert.equal(actorHuman.statusCode, 200);

    const commandBody = {
      command_type: "handoff_package",
      source_actor_id: "worker_01",
      target_scope: "lead",
      referenced_artifacts: ["artifact://handoff-v1-01"],
      payload: {
        summary: "handoff package for review"
      },
      correlation_id: "corr-v1-01"
    };

    const command = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics/topic_v1_control/commands",
      headers: {
        "Idempotency-Key": "cmd-v1-01"
      },
      body: commandBody
    });
    assert.equal(command.statusCode, 202);
    assert.equal(command.body.command_intent.topic_id, "topic_v1_control");
    const commandId = command.body.command_intent.command_id;
    assert.ok(typeof commandId === "string" && commandId.length > 0);

    const commandReplay = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics/topic_v1_control/commands",
      headers: {
        "Idempotency-Key": "cmd-v1-01"
      },
      body: commandBody
    });
    assert.equal(commandReplay.statusCode, 202);
    assert.equal(commandReplay.body.idempotent_replay, true);
    assert.equal(commandReplay.body.command_intent.command_id, commandId);

    const commandReplayConflict = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics/topic_v1_control/commands",
      headers: {
        "Idempotency-Key": "cmd-v1-01"
      },
      body: {
        ...commandBody,
        payload: {
          summary: "different payload"
        }
      }
    });
    assert.equal(commandReplayConflict.statusCode, 409);
    assert.equal(commandReplayConflict.body.error.code, "idempotency_key_conflict");
    assert.equal(commandReplayConflict.body.error.family, "state_conflict");

    const eventsPage1 = await requestJson({
      port,
      method: "GET",
      path: "/v1/topics/topic_v1_control/events?limit=2"
    });
    assert.equal(eventsPage1.statusCode, 200);
    assert.equal(eventsPage1.body.items.length, 2);
    assert.ok(eventsPage1.body.page.next_cursor);

    const wrongScopeCursor = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/topic_v1_control/debug/history?view=events&cursor=${encodeURIComponent(
        eventsPage1.body.page.next_cursor
      )}`
    });
    assert.equal(wrongScopeCursor.statusCode, 400);
    assert.equal(wrongScopeCursor.body.error.code, "invalid_cursor_scope");
    assert.equal(wrongScopeCursor.body.error.family, "invalid_input");

    const blockWorker = await requestJson({
      port,
      method: "PUT",
      path: "/v1/topics/topic_v1_control/actors/worker_01",
      body: {
        role: "worker",
        status: "blocked",
        lane_id: "lane_1"
      }
    });
    assert.equal(blockWorker.statusCode, 200);

    const rejectedCommand = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics/topic_v1_control/commands",
      headers: {
        "Idempotency-Key": "cmd-v1-02"
      },
      body: {
        ...commandBody,
        correlation_id: "corr-v1-02"
      }
    });
    assert.equal(rejectedCommand.statusCode, 422);
    assert.equal(rejectedCommand.body.error.code, "actor_inactive");
    assert.equal(rejectedCommand.body.error.family, "boundary_rejection");
    assert.ok(rejectedCommand.body.error.related_command_id);

    const rejectionDebug = await requestJson({
      port,
      method: "GET",
      path: "/v1/topics/topic_v1_control/debug/rejections?limit=50"
    });
    assert.equal(rejectionDebug.statusCode, 200);
    const rejection = rejectionDebug.body.items.find(
      (item) => item.related_command_id === rejectedCommand.body.error.related_command_id
    );
    assert.ok(rejection);
    assert.equal(rejection.reason_code, "actor_inactive");
    assert.equal(rejection.correlation_id, "corr-v1-02");
    assert.ok(typeof rejection.request_id === "string" && rejection.request_id.length > 0);
  });
});

test("v1 topic list supports cursor pagination", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const createOne = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: {
        "Idempotency-Key": "topic-list-1"
      },
      body: {
        topic_id: "topic_v1_page_1",
        goal: "page test one"
      }
    });
    assert.equal(createOne.statusCode, 201);

    const createTwo = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: {
        "Idempotency-Key": "topic-list-2"
      },
      body: {
        topic_id: "topic_v1_page_2",
        goal: "page test two"
      }
    });
    assert.equal(createTwo.statusCode, 201);

    const page1 = await requestJson({
      port,
      method: "GET",
      path: "/v1/topics?limit=1"
    });
    assert.equal(page1.statusCode, 200);
    assert.equal(page1.body.items.length, 1);
    assert.equal(page1.body.page.has_more, true);
    assert.ok(page1.body.page.next_cursor);

    const page2 = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics?limit=1&cursor=${encodeURIComponent(page1.body.page.next_cursor)}`
    });
    assert.equal(page2.statusCode, 200);
    assert.equal(page2.body.items.length, 1);
  });
});

test("v1 approval decision keeps phase1 permission boundary", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_permission_boundary";

    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: {
        "Idempotency-Key": "topic-v1-perm-01"
      },
      body: {
        topic_id: topicId,
        goal: "permission boundary regression check"
      }
    });
    assert.equal(createTopic.statusCode, 201);

    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: {
        role: "lead",
        status: "active"
      }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: {
        role: "worker",
        status: "active"
      }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: {
        role: "human",
        status: "active"
      }
    });

    const handoff = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: {
        "Idempotency-Key": "perm-cmd-handoff"
      },
      body: {
        command_type: "handoff_package",
        source_actor_id: "worker_01",
        target_scope: "lead",
        referenced_artifacts: ["artifact://perm-01"],
        payload: {
          summary: "handoff for merge"
        }
      }
    });
    assert.equal(handoff.statusCode, 202);
    const handoffId = handoff.body.command_intent.command_id;

    const handoffAck = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: {
        "Idempotency-Key": "perm-cmd-ack"
      },
      body: {
        command_type: "status_report",
        source_actor_id: "lead_01",
        payload: {
          event: "handoff_ack",
          handoffId,
          resolvedArtifacts: ["artifact://perm-01"]
        }
      }
    });
    assert.equal(handoffAck.statusCode, 202);

    const mergeRequest = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: {
        "Idempotency-Key": "perm-cmd-merge"
      },
      body: {
        command_type: "merge_request",
        source_actor_id: "worker_01",
        payload: {
          handoffId,
          prUrl: "https://example.com/pr/v1-perm"
        }
      }
    });
    assert.equal(mergeRequest.statusCode, 202);
    const holdId = mergeRequest.body.outcome.result.holdIds[0];
    assert.ok(typeof holdId === "string" && holdId.length > 0);

    const freeStringDecision = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: {
        "Idempotency-Key": "perm-decision-free-string"
      },
      body: {
        decider_actor_id: "not_registered_human",
        intervention_point: "pr-merge",
        approve: true
      }
    });
    assert.equal(freeStringDecision.statusCode, 422);
    assert.equal(freeStringDecision.body.error.code, "decision_actor_not_registered");
    assert.equal(freeStringDecision.body.error.family, "boundary_rejection");
  });
});

test("v1 batch2 control-plane resources expose addressable read/write, state graph, and rejection anchors", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_batch2_resources";

    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: {
        "Idempotency-Key": "batch2-topic-create"
      },
      body: {
        topic_id: topicId,
        goal: "batch2 resourceized control-plane"
      }
    });
    assert.equal(createTopic.statusCode, 201);

    const upsertLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    assert.equal(upsertLead.statusCode, 200);
    const upsertWorker = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: { role: "worker", status: "active", lane_id: "lane_1" }
    });
    assert.equal(upsertWorker.statusCode, 200);
    const upsertHuman = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "active" }
    });
    assert.equal(upsertHuman.statusCode, 200);
    const upsertInactiveWorker = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_02`,
      body: { role: "worker", status: "blocked", lane_id: "lane_2" }
    });
    assert.equal(upsertInactiveWorker.statusCode, 200);

    const rejectDispatchUnregisteredWorker = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "batch2-dispatch-unregistered" },
      body: {
        dispatch_id: "dispatch_batch2_bad_unregistered",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_missing",
        payload: {
          task: "should reject unregistered worker"
        }
      }
    });
    assert.equal(rejectDispatchUnregisteredWorker.statusCode, 422);
    assert.equal(rejectDispatchUnregisteredWorker.body.error.code, "dispatch_worker_not_registered");
    assert.equal(rejectDispatchUnregisteredWorker.body.error.family, "boundary_rejection");

    const rejectDispatchRoleMismatch = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "batch2-dispatch-role-mismatch" },
      body: {
        dispatch_id: "dispatch_batch2_bad_role",
        source_actor_id: "lead_01",
        worker_actor_id: "human_01",
        payload: {
          task: "should reject role mismatch"
        }
      }
    });
    assert.equal(rejectDispatchRoleMismatch.statusCode, 422);
    assert.equal(rejectDispatchRoleMismatch.body.error.code, "dispatch_worker_role_mismatch");
    assert.equal(rejectDispatchRoleMismatch.body.error.family, "boundary_rejection");

    const rejectDispatchInactiveWorker = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "batch2-dispatch-inactive" },
      body: {
        dispatch_id: "dispatch_batch2_bad_inactive",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_02",
        payload: {
          task: "should reject inactive worker"
        }
      }
    });
    assert.equal(rejectDispatchInactiveWorker.statusCode, 422);
    assert.equal(rejectDispatchInactiveWorker.body.error.code, "dispatch_worker_inactive");
    assert.equal(rejectDispatchInactiveWorker.body.error.family, "boundary_rejection");

    const rejectDispatchStaleRevision = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "batch2-dispatch-stale-revision" },
      body: {
        dispatch_id: "dispatch_batch2_bad_revision",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_01",
        truth_revision: 999,
        payload: {
          task: "should reject stale revision"
        }
      }
    });
    assert.equal(rejectDispatchStaleRevision.statusCode, 409);
    assert.equal(rejectDispatchStaleRevision.body.error.code, "stale_revision");
    assert.equal(rejectDispatchStaleRevision.body.error.family, "state_conflict");

    const createDispatch = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "batch2-dispatch-create" },
      body: {
        dispatch_id: "dispatch_batch2_01",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_01",
        truth_revision: 1,
        payload: {
          task: "build API resources"
        }
      }
    });
    assert.equal(createDispatch.statusCode, 202);
    assert.equal(createDispatch.body.dispatch.dispatch_id, "dispatch_batch2_01");
    assert.equal(createDispatch.body.dispatch.status, "pending_accept");

    const listDispatches = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/dispatches`
    });
    assert.equal(listDispatches.statusCode, 200);
    assert.ok(listDispatches.body.items.find((item) => item.dispatch_id === "dispatch_batch2_01"));

    const getDispatch = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/dispatches/dispatch_batch2_01`
    });
    assert.equal(getDispatch.statusCode, 200);
    assert.equal(getDispatch.body.dispatch.worker_actor_id, "worker_01");

    const createConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch2-conflict-create" },
      body: {
        command_type: "challenge",
        source_actor_id: "worker_01",
        payload: {
          conflictId: "conflict_batch2_01",
          scopes: ["delivery"]
        }
      }
    });
    assert.equal(createConflict.statusCode, 202);

    const listConflicts = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/conflicts?status=unresolved`
    });
    assert.equal(listConflicts.statusCode, 200);
    const listedConflict = listConflicts.body.items.find((item) => item.conflict_id === "conflict_batch2_01");
    assert.ok(listedConflict);
    assert.equal(listedConflict.related_command_id, createConflict.body.command_intent.command_id);
    assert.equal(Object.prototype.hasOwnProperty.call(listedConflict, "challenge_message_id"), false);

    const resolveConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/conflicts/conflict_batch2_01/resolutions`,
      headers: { "Idempotency-Key": "batch2-conflict-resolve" },
      body: {
        source_actor_id: "lead_01",
        outcome: "accept_side",
        notes: "resolved by lead"
      }
    });
    assert.equal(resolveConflict.statusCode, 200);
    assert.equal(resolveConflict.body.conflict.status, "resolved");

    const handoff = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch2-handoff" },
      body: {
        command_type: "handoff_package",
        source_actor_id: "worker_01",
        target_scope: "lead",
        referenced_artifacts: ["artifact://batch2-01"],
        payload: {
          summary: "handoff for merge"
        }
      }
    });
    assert.equal(handoff.statusCode, 202);
    const handoffId = handoff.body.command_intent.command_id;

    const handoffAck = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch2-handoff-ack" },
      body: {
        command_type: "status_report",
        source_actor_id: "lead_01",
        payload: {
          event: "handoff_ack",
          handoffId,
          resolvedArtifacts: ["artifact://batch2-01"]
        }
      }
    });
    assert.equal(handoffAck.statusCode, 202);

    const mergeRequest = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch2-merge-request" },
      body: {
        command_type: "merge_request",
        source_actor_id: "worker_01",
        payload: {
          handoffId,
          prUrl: "https://example.com/pr/batch2"
        }
      }
    });
    assert.equal(mergeRequest.statusCode, 202);
    const holdId = mergeRequest.body.outcome.result.holdIds[0];

    const listHolds = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds`
    });
    assert.equal(listHolds.statusCode, 200);
    const listedHold = listHolds.body.items.find((item) => item.hold_id === holdId);
    assert.ok(listedHold);
    assert.equal(listedHold.related_command_id, mergeRequest.body.command_intent.command_id);
    assert.equal(Object.prototype.hasOwnProperty.call(listedHold, "message_id"), false);

    const getHold = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}`
    });
    assert.equal(getHold.statusCode, 200);
    assert.equal(getHold.body.hold.status, "pending");

    const decideHold = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "batch2-hold-decision" },
      body: {
        decider_actor_id: "human_01",
        intervention_point: "pr-merge",
        approve: true
      }
    });
    assert.equal(decideHold.statusCode, 200);
    assert.equal(decideHold.body.decision.status, "approved");

    const getDecisions = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`
    });
    assert.equal(getDecisions.statusCode, 200);
    assert.equal(getDecisions.body.items.length, 1);
    assert.equal(getDecisions.body.items[0].status, "approved");

    const stateGraph = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/state-graph`
    });
    assert.equal(stateGraph.statusCode, 200);
    assert.ok(Array.isArray(stateGraph.body.state_graph.dispatch.states));
    assert.ok(Array.isArray(stateGraph.body.state_graph.delivery.transitions));

    const deliveryWrite = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch2-delivery-write" },
      body: {
        source_actor_id: "lead_01",
        state: "merged",
        note: "post-merge writeback"
      }
    });
    assert.equal(deliveryWrite.statusCode, 200);
    assert.equal(deliveryWrite.body.delivery.state, "merged");

    const deliveryWriteStaleRevision = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch2-delivery-stale-revision" },
      body: {
        source_actor_id: "lead_01",
        state: "failed",
        truth_revision: 999
      }
    });
    assert.equal(deliveryWriteStaleRevision.statusCode, 409);
    assert.equal(deliveryWriteStaleRevision.body.error.code, "stale_revision");
    assert.equal(deliveryWriteStaleRevision.body.error.family, "state_conflict");

    const deliveryRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/delivery`
    });
    assert.equal(deliveryRead.statusCode, 200);
    assert.equal(deliveryRead.body.delivery.state, "merged");

    const prWriteback = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/pr-writeback`,
      headers: { "Idempotency-Key": "batch2-pr-writeback" },
      body: {
        source_actor_id: "human_01",
        pr_url: "https://example.com/pr/final",
        state: "failed",
        note: "pr merged and written back"
      }
    });
    assert.equal(prWriteback.statusCode, 200);
    assert.equal(prWriteback.body.pr_writeback.pr_url, "https://example.com/pr/final");

    const prRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/pr-writeback`
    });
    assert.equal(prRead.statusCode, 200);
    assert.equal(prRead.body.pr_writeback.state, "failed");
    assert.equal(prRead.body.pr_writeback.pr_url, "https://example.com/pr/final");

    const deliveryReadAfterPrWriteback = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/delivery`
    });
    assert.equal(deliveryReadAfterPrWriteback.statusCode, 200);
    assert.equal(deliveryReadAfterPrWriteback.body.delivery.state, "merged");
    assert.equal(deliveryReadAfterPrWriteback.body.delivery.pr_url, null);

    const blockLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: {
        role: "lead",
        status: "blocked"
      }
    });
    assert.equal(blockLead.statusCode, 200);

    const rejectedDelivery = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch2-delivery-reject" },
      body: {
        source_actor_id: "lead_01",
        state: "failed"
      }
    });
    assert.equal(rejectedDelivery.statusCode, 422);
    assert.equal(rejectedDelivery.body.error.code, "delivery_actor_inactive");
    assert.equal(rejectedDelivery.body.error.family, "boundary_rejection");

    const debugRejections = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/debug/rejections`
    });
    assert.equal(debugRejections.statusCode, 200);
    const deliveryRejection = debugRejections.body.items.find(
      (item) =>
        item.event_type === "delivery_update_rejected" &&
        item.reason_code === "delivery_actor_inactive"
    );
    assert.ok(deliveryRejection);
    assert.equal(deliveryRejection.reason_code, "delivery_actor_inactive");
    assert.equal(deliveryRejection.related_resource_type, "delivery");
    assert.ok(typeof deliveryRejection.request_id === "string" && deliveryRejection.request_id.length > 0);

    const dispatchRejection = debugRejections.body.items.find(
      (item) =>
        item.event_type === "dispatch_rejected" &&
        item.reason_code === "dispatch_worker_not_registered"
    );
    assert.ok(dispatchRejection);
    assert.equal(dispatchRejection.related_resource_type, "dispatch");
    assert.ok(typeof dispatchRejection.request_id === "string" && dispatchRejection.request_id.length > 0);
  });
});

test("v1 write-gate applies shared actor validation across dispatch/handoff/approval/writeback", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_write_gate_shared";

    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: { "Idempotency-Key": "write-gate-topic-create" },
      body: {
        topic_id: topicId,
        goal: "shared write-gate validation"
      }
    });
    assert.equal(createTopic.statusCode, 201);

    const upsertLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    assert.equal(upsertLead.statusCode, 200);
    const upsertWorker = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: { role: "worker", status: "active", lane_id: "lane_1" }
    });
    assert.equal(upsertWorker.statusCode, 200);
    const upsertBlockedWorker = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_02`,
      body: { role: "worker", status: "blocked", lane_id: "lane_2" }
    });
    assert.equal(upsertBlockedWorker.statusCode, 200);
    const upsertHuman = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "active" }
    });
    assert.equal(upsertHuman.statusCode, 200);

    const blockLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "blocked" }
    });
    assert.equal(blockLead.statusCode, 200);
    const dispatchRejectedByInactiveSource = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "write-gate-dispatch-inactive-source" },
      body: {
        dispatch_id: "dispatch_write_gate_01",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_01",
        payload: { task: "should reject inactive lead" }
      }
    });
    assert.equal(dispatchRejectedByInactiveSource.statusCode, 422);
    assert.equal(dispatchRejectedByInactiveSource.body.error.code, "actor_inactive");

    const restoreLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    assert.equal(restoreLead.statusCode, 200);

    const handoffRejectedByInactiveSource = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "write-gate-handoff-inactive-source" },
      body: {
        command_type: "handoff_package",
        source_actor_id: "worker_02",
        target_scope: "lead",
        referenced_artifacts: ["artifact://write-gate-01"],
        payload: {
          summary: "blocked worker should be rejected"
        }
      }
    });
    assert.equal(handoffRejectedByInactiveSource.statusCode, 422);
    assert.equal(handoffRejectedByInactiveSource.body.error.code, "actor_inactive");

    const handoff = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "write-gate-handoff-ok" },
      body: {
        command_type: "handoff_package",
        source_actor_id: "worker_01",
        target_scope: "lead",
        referenced_artifacts: ["artifact://write-gate-02"],
        payload: {
          summary: "ready for merge"
        }
      }
    });
    assert.equal(handoff.statusCode, 202);
    const handoffId = handoff.body.command_intent.command_id;

    const handoffAck = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "write-gate-handoff-ack" },
      body: {
        command_type: "status_report",
        source_actor_id: "lead_01",
        payload: {
          event: "handoff_ack",
          handoffId,
          resolvedArtifacts: ["artifact://write-gate-02"]
        }
      }
    });
    assert.equal(handoffAck.statusCode, 202);

    const mergeRequest = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "write-gate-merge-request" },
      body: {
        command_type: "merge_request",
        source_actor_id: "worker_01",
        payload: {
          handoffId,
          prUrl: "https://example.com/pr/write-gate"
        }
      }
    });
    assert.equal(mergeRequest.statusCode, 202);
    const holdId = mergeRequest.body.outcome.result.holdIds[0];
    assert.ok(typeof holdId === "string" && holdId.length > 0);

    const decisionRoleMismatch = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "write-gate-decision-role-mismatch" },
      body: {
        decider_actor_id: "worker_01",
        intervention_point: "pr-merge",
        approve: true
      }
    });
    assert.equal(decisionRoleMismatch.statusCode, 422);
    assert.equal(decisionRoleMismatch.body.error.code, "decision_actor_role_mismatch");

    const deliveryRoleMismatch = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "write-gate-delivery-role-mismatch" },
      body: {
        source_actor_id: "worker_01",
        state: "pr_ready"
      }
    });
    assert.equal(deliveryRoleMismatch.statusCode, 422);
    assert.equal(deliveryRoleMismatch.body.error.code, "delivery_actor_role_mismatch");

    const blockHuman = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "blocked" }
    });
    assert.equal(blockHuman.statusCode, 200);

    const prWritebackInactive = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/pr-writeback`,
      headers: { "Idempotency-Key": "write-gate-pr-writeback-inactive" },
      body: {
        source_actor_id: "human_01",
        pr_url: "https://example.com/pr/write-gate-final",
        state: "failed"
      }
    });
    assert.equal(prWritebackInactive.statusCode, 422);
    assert.equal(prWritebackInactive.body.error.code, "pr_writeback_actor_inactive");

    const debugRejections = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/debug/rejections`
    });
    assert.equal(debugRejections.statusCode, 200);

    const dispatchRejection = debugRejections.body.items.find(
      (item) => item.event_type === "dispatch_rejected" && item.reason_code === "actor_inactive"
    );
    assert.ok(dispatchRejection);

    const commandRejection = debugRejections.body.items.find(
      (item) => item.event_type === "command_rejected" && item.reason_code === "actor_inactive"
    );
    assert.ok(commandRejection);

    const decisionRejection = debugRejections.body.items.find(
      (item) => item.event_type === "hold_decision_rejected" && item.reason_code === "decision_actor_role_mismatch"
    );
    assert.ok(decisionRejection);

    const deliveryRejection = debugRejections.body.items.find(
      (item) => item.event_type === "delivery_update_rejected" && item.reason_code === "delivery_actor_role_mismatch"
    );
    assert.ok(deliveryRejection);

    const prWritebackRejection = debugRejections.body.items.find(
      (item) => item.event_type === "pr_writeback_rejected" && item.reason_code === "pr_writeback_actor_inactive"
    );
    assert.ok(prWritebackRejection);
  });
});

test("v1 governance eval control-plane contract pack covers happy/bad path, state conflict, replay and write-gate", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_governance_eval_control";

    const createTopicBody = {
      topic_id: topicId,
      goal: "governance eval control-plane contract pack"
    };
    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: { "Idempotency-Key": "gov-topic-create-01" },
      body: createTopicBody
    });
    assert.equal(createTopic.statusCode, 201);
    assert.equal(createTopic.body.topic.topic_id, topicId);

    const createTopicReplay = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: { "Idempotency-Key": "gov-topic-create-01" },
      body: createTopicBody
    });
    assert.equal(createTopicReplay.statusCode, 201);
    assert.equal(createTopicReplay.body.idempotent_replay, true);

    const actorLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    assert.equal(actorLead.statusCode, 200);
    const actorWorker = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: { role: "worker", status: "active", lane_id: "lane_1" }
    });
    assert.equal(actorWorker.statusCode, 200);
    const actorHuman = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "active" }
    });
    assert.equal(actorHuman.statusCode, 200);

    const dispatchBody = {
      dispatch_id: "dispatch_gov_01",
      source_actor_id: "lead_01",
      worker_actor_id: "worker_01",
      truth_revision: 1,
      payload: {
        task: "governance control-plane smoke dispatch"
      }
    };
    const dispatch = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "gov-dispatch-01" },
      body: dispatchBody
    });
    assert.equal(dispatch.statusCode, 202);
    assert.equal(dispatch.body.dispatch.dispatch_id, "dispatch_gov_01");
    assert.equal(dispatch.body.revision, 1);

    const dispatchReplay = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "gov-dispatch-01" },
      body: dispatchBody
    });
    assert.equal(dispatchReplay.statusCode, 202);
    assert.equal(dispatchReplay.body.idempotent_replay, true);
    assert.equal(dispatchReplay.body.revision, 1);

    const dispatchReplayConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "gov-dispatch-01" },
      body: {
        ...dispatchBody,
        payload: { task: "different payload" }
      }
    });
    assert.equal(dispatchReplayConflict.statusCode, 409);
    assert.equal(dispatchReplayConflict.body.error.code, "idempotency_key_conflict");
    assert.equal(dispatchReplayConflict.body.error.family, "state_conflict");

    const dispatchStaleRevision = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "gov-dispatch-stale" },
      body: {
        ...dispatchBody,
        dispatch_id: "dispatch_gov_stale",
        truth_revision: 999
      }
    });
    assert.equal(dispatchStaleRevision.statusCode, 409);
    assert.equal(dispatchStaleRevision.body.error.code, "stale_revision");
    assert.equal(dispatchStaleRevision.body.error.family, "state_conflict");
    assert.equal(dispatchStaleRevision.body.error.details.expectedRevision, 1);
    assert.equal(dispatchStaleRevision.body.error.details.gotRevision, 999);

    const commandHandoffBody = {
      command_type: "handoff_package",
      source_actor_id: "worker_01",
      target_scope: "lead",
      truth_revision: 1,
      referenced_artifacts: ["artifact://gov-01"],
      payload: {
        summary: "handoff for governance eval pack"
      }
    };
    const commandHandoff = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "gov-command-handoff-01" },
      body: commandHandoffBody
    });
    assert.equal(commandHandoff.statusCode, 202);
    const handoffId = commandHandoff.body.command_intent.command_id;
    assert.ok(typeof handoffId === "string" && handoffId.length > 0);

    const commandHandoffReplay = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "gov-command-handoff-01" },
      body: commandHandoffBody
    });
    assert.equal(commandHandoffReplay.statusCode, 202);
    assert.equal(commandHandoffReplay.body.idempotent_replay, true);
    assert.equal(commandHandoffReplay.body.command_intent.command_id, handoffId);

    const commandHandoffReplayConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "gov-command-handoff-01" },
      body: {
        ...commandHandoffBody,
        payload: {
          summary: "changed summary"
        }
      }
    });
    assert.equal(commandHandoffReplayConflict.statusCode, 409);
    assert.equal(commandHandoffReplayConflict.body.error.code, "idempotency_key_conflict");

    const commandAck = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "gov-command-ack-01" },
      body: {
        command_type: "status_report",
        source_actor_id: "lead_01",
        truth_revision: 1,
        payload: {
          event: "handoff_ack",
          handoffId,
          resolvedArtifacts: ["artifact://gov-01"]
        }
      }
    });
    assert.equal(commandAck.statusCode, 202);

    const mergeRequest = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "gov-command-merge-01" },
      body: {
        command_type: "merge_request",
        source_actor_id: "worker_01",
        truth_revision: 1,
        payload: {
          handoffId,
          prUrl: "https://example.com/pr/governance-pack"
        }
      }
    });
    assert.equal(mergeRequest.statusCode, 202);
    const holdId = mergeRequest.body.outcome.result.holdIds[0];
    assert.ok(typeof holdId === "string" && holdId.length > 0);

    const holds = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds`
    });
    assert.equal(holds.statusCode, 200);
    const listedHold = holds.body.items.find((item) => item.hold_id === holdId);
    assert.ok(listedHold);
    assert.equal(Object.prototype.hasOwnProperty.call(listedHold, "message_id"), false);
    assert.equal(typeof listedHold.related_command_id, "string");

    const decisionBody = {
      decider_actor_id: "human_01",
      intervention_point: "pr-merge",
      approve: true,
      truth_revision: 1
    };
    const decision = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "gov-decision-01" },
      body: decisionBody
    });
    assert.equal(decision.statusCode, 200);
    assert.equal(decision.body.decision.status, "approved");
    assert.equal(decision.body.revision, 1);

    const decisionReplay = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "gov-decision-01" },
      body: decisionBody
    });
    assert.equal(decisionReplay.statusCode, 200);
    assert.equal(decisionReplay.body.idempotent_replay, true);
    assert.equal(decisionReplay.body.revision, 1);

    const decisionReplayConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "gov-decision-01" },
      body: {
        ...decisionBody,
        approve: false
      }
    });
    assert.equal(decisionReplayConflict.statusCode, 409);
    assert.equal(decisionReplayConflict.body.error.code, "idempotency_key_conflict");

    const decisionStale = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "gov-decision-stale" },
      body: {
        ...decisionBody,
        truth_revision: 999
      }
    });
    assert.equal(decisionStale.statusCode, 409);
    assert.equal(decisionStale.body.error.code, "stale_revision");

    const deliveryBody = {
      source_actor_id: "lead_01",
      state: "pr_ready",
      truth_revision: 1
    };
    const delivery = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "gov-delivery-01" },
      body: deliveryBody
    });
    assert.equal(delivery.statusCode, 200);
    assert.equal(delivery.body.delivery.state, "pr_ready");
    assert.equal(delivery.body.revision, 1);

    const deliveryReplay = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "gov-delivery-01" },
      body: deliveryBody
    });
    assert.equal(deliveryReplay.statusCode, 200);
    assert.equal(deliveryReplay.body.idempotent_replay, true);

    const prWriteback = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/pr-writeback`,
      headers: { "Idempotency-Key": "gov-pr-writeback-01" },
      body: {
        source_actor_id: "human_01",
        pr_url: "https://example.com/pr/governance-pack-final",
        state: "pr_ready",
        truth_revision: 1
      }
    });
    assert.equal(prWriteback.statusCode, 200);
    assert.equal(prWriteback.body.pr_writeback.state, "pr_ready");
    assert.equal(prWriteback.body.revision, 1);

    const blockLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "blocked" }
    });
    assert.equal(blockLead.statusCode, 200);

    const dispatchBlockedByWriteGate = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "gov-dispatch-write-gate-blocked" },
      body: {
        dispatch_id: "dispatch_gov_blocked",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_01",
        truth_revision: 1,
        payload: {
          task: "should be rejected by shared write-gate"
        }
      }
    });
    assert.equal(dispatchBlockedByWriteGate.statusCode, 422);
    assert.equal(dispatchBlockedByWriteGate.body.error.code, "actor_inactive");
    assert.equal(dispatchBlockedByWriteGate.body.error.family, "boundary_rejection");

    const events = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/events?limit=100`
    });
    assert.equal(events.statusCode, 200);
    assert.ok(Array.isArray(events.body.stable_event_types));
    assert.ok(events.body.stable_event_types.includes("dispatch_rejected"));

    const debugRejections = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/debug/rejections?limit=200`
    });
    assert.equal(debugRejections.statusCode, 200);

    const staleRevisionRejection = debugRejections.body.items.find(
      (item) => item.event_type === "dispatch_rejected" && item.reason_code === "stale_revision"
    );
    assert.ok(staleRevisionRejection);
    assert.ok(typeof staleRevisionRejection.request_id === "string" && staleRevisionRejection.request_id.length > 0);

    const blockedActorRejection = debugRejections.body.items.find(
      (item) => item.event_type === "dispatch_rejected" && item.reason_code === "actor_inactive"
    );
    assert.ok(blockedActorRejection);
    assert.ok(typeof blockedActorRejection.request_id === "string" && blockedActorRejection.request_id.length > 0);
  });
});

test("v1 batch4 control-plane collaboration truth exposes topic/actor read model with allocation and merge lifecycle", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_batch4_collab_truth";

    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: { "Idempotency-Key": "batch4-topic-create-01" },
      body: {
        topic_id: topicId,
        goal: "batch4 control-plane collaboration truth"
      }
    });
    assert.equal(createTopic.statusCode, 201);

    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: { role: "worker", status: "active", lane_id: "lane_batch4_1" }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "active" }
    });

    const allocationPatchBody = {
      command_type: "shared_truth_proposal",
      source_actor_id: "lead_01",
      truth_revision: 1,
      payload: {
        patch: {
          taskAllocation: [
            {
              task_id: "task_batch4_01",
              owner_actor_id: "worker_01",
              status: "assigned",
              summary: "implement collaboration truth read model"
            }
          ],
          mergeIntent: {
            stage: "allocation_published",
            owner_actor_id: "lead_01",
            last_transition_at: "2026-04-06T14:29:01.000Z"
          }
        }
      }
    };

    const allocationPatch = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch4-collab-truth-01" },
      body: allocationPatchBody
    });
    assert.equal(allocationPatch.statusCode, 202);
    assert.equal(allocationPatch.body.outcome.state, "accepted");
    assert.equal(allocationPatch.body.outcome.revision, 2);

    const allocationPatchReplay = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch4-collab-truth-01" },
      body: allocationPatchBody
    });
    assert.equal(allocationPatchReplay.statusCode, 202);
    assert.equal(allocationPatchReplay.body.idempotent_replay, true);

    const topicRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}`
    });
    assert.equal(topicRead.statusCode, 200);
    assert.equal(topicRead.body.topic.topic_state.revision, 2);
    assert.equal(topicRead.body.topic.topic_state.merge_stage, "allocation_published");
    assert.equal(topicRead.body.topic.task_allocation.length, 1);
    assert.equal(topicRead.body.topic.task_allocation[0].owner_actor_id, "worker_01");
    assert.equal(topicRead.body.topic.merge_lifecycle.stage, "allocation_published");
    assert.equal(topicRead.body.topic.merge_lifecycle.merge_intent.owner_actor_id, "lead_01");
    assert.equal(topicRead.body.topic.actor_registry.length, 3);

    const actorList = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/actors`
    });
    assert.equal(actorList.statusCode, 200);
    assert.equal(actorList.body.items.length, 3);
    const listedWorker = actorList.body.items.find((item) => item.actor_id === "worker_01");
    assert.ok(listedWorker);
    assert.equal(listedWorker.role, "worker");
    assert.equal(listedWorker.status, "active");

    const actorRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/actors/worker_01`
    });
    assert.equal(actorRead.statusCode, 200);
    assert.equal(actorRead.body.actor.actor_id, "worker_01");
    assert.equal(actorRead.body.actor.role, "worker");
    assert.equal(actorRead.body.actor.status, "active");

    const missingActor = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/actors/worker_missing`
    });
    assert.equal(missingActor.statusCode, 404);
    assert.equal(missingActor.body.error.code, "actor_not_found");
    assert.equal(missingActor.body.error.family, "not_found");

    const topicList = await requestJson({
      port,
      method: "GET",
      path: "/v1/topics?limit=50"
    });
    assert.equal(topicList.statusCode, 200);
    const listedTopic = topicList.body.items.find((item) => item.topic_id === topicId);
    assert.ok(listedTopic);
    assert.equal(listedTopic.topic_state.merge_stage, "allocation_published");
    assert.equal(listedTopic.task_allocation_count, 1);
    assert.equal(listedTopic.merge_lifecycle.stage, "allocation_published");

    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "blocked" }
    });

    const dispatchRejected = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/dispatches`,
      headers: { "Idempotency-Key": "batch4-dispatch-write-gate-blocked" },
      body: {
        dispatch_id: "dispatch_batch4_blocked",
        source_actor_id: "lead_01",
        worker_actor_id: "worker_01",
        truth_revision: 2,
        payload: {
          task: "should be blocked by shared write-gate"
        }
      }
    });
    assert.equal(dispatchRejected.statusCode, 422);
    assert.equal(dispatchRejected.body.error.code, "actor_inactive");
    assert.equal(dispatchRejected.body.error.family, "boundary_rejection");
    assert.ok(typeof dispatchRejected.body.error.request_id === "string" && dispatchRejected.body.error.request_id.length > 0);

    const debugRejections = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/debug/rejections?limit=100`
    });
    assert.equal(debugRejections.statusCode, 200);
    const writeGateRejection = debugRejections.body.items.find(
      (item) => item.event_type === "dispatch_rejected" && item.reason_code === "actor_inactive"
    );
    assert.ok(writeGateRejection);
    assert.ok(typeof writeGateRejection.request_id === "string" && writeGateRejection.request_id.length > 0);
  });
});

test("v1 batch5 control-plane delivery closeout truth binds lifecycle with server-owned lineage refs", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_batch5_delivery_closeout_truth";

    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: { "Idempotency-Key": "batch5-topic-create-01" },
      body: {
        topic_id: topicId,
        goal: "batch5 control-plane delivery closeout truth"
      }
    });
    assert.equal(createTopic.statusCode, 201);

    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: { role: "worker", status: "active", lane_id: "lane_batch5_01" }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "active" }
    });

    const lineagePatch = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch5-lineage-patch-01" },
      body: {
        command_type: "shared_truth_proposal",
        source_actor_id: "lead_01",
        truth_revision: 1,
        payload: {
          patch: {
            mergeIntent: {
              stage: "delivery_ready",
              runId: "run_batch5_01",
              checkpointRef: "checkpoint://batch5/ready",
              artifactRefs: ["artifact://bundle/batch5-01", "artifact://bundle/batch5-02"]
            },
            stableArtifacts: ["artifact://bundle/batch5-01", "artifact://bundle/batch5-02"]
          }
        }
      }
    });
    assert.equal(lineagePatch.statusCode, 202);
    assert.equal(lineagePatch.body.outcome.state, "accepted");
    assert.equal(lineagePatch.body.outcome.revision, 2);

    const deliveryWrite = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch5-delivery-write-01" },
      body: {
        source_actor_id: "lead_01",
        state: "pr_ready",
        truth_revision: 2
      }
    });
    assert.equal(deliveryWrite.statusCode, 200);
    assert.equal(deliveryWrite.body.delivery.state, "pr_ready");
    assert.equal(deliveryWrite.body.delivery.merge_lifecycle_stage, "pr_ready");
    assert.equal(deliveryWrite.body.delivery.closeout_lineage.run_id, "run_batch5_01");
    assert.equal(deliveryWrite.body.delivery.closeout_lineage.checkpoint_ref, "checkpoint://batch5/ready");
    assert.deepEqual(deliveryWrite.body.delivery.closeout_lineage.artifact_refs, [
      "artifact://bundle/batch5-01",
      "artifact://bundle/batch5-02"
    ]);

    const deliveryServerOwnedWrite = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch5-delivery-server-owned-field" },
      body: {
        source_actor_id: "lead_01",
        state: "pr_ready",
        truth_revision: 2,
        run_id: "client-side-run-should-be-rejected"
      }
    });
    assert.equal(deliveryServerOwnedWrite.statusCode, 400);
    assert.equal(deliveryServerOwnedWrite.body.error.code, "invalid_delivery_server_owned_field");
    assert.equal(deliveryServerOwnedWrite.body.error.family, "invalid_input");

    const prWritebackWrite = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/pr-writeback`,
      headers: { "Idempotency-Key": "batch5-pr-writeback-write-01" },
      body: {
        source_actor_id: "human_01",
        pr_url: "https://example.com/pr/batch5-closeout",
        state: "failed",
        truth_revision: 2
      }
    });
    assert.equal(prWritebackWrite.statusCode, 200);
    assert.equal(prWritebackWrite.body.pr_writeback.state, "failed");
    assert.equal(prWritebackWrite.body.pr_writeback.merge_lifecycle_stage, "pr_ready");
    assert.equal(prWritebackWrite.body.pr_writeback.closeout_lineage.run_id, "run_batch5_01");

    const prWritebackServerOwnedWrite = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/pr-writeback`,
      headers: { "Idempotency-Key": "batch5-pr-writeback-server-owned-field" },
      body: {
        source_actor_id: "human_01",
        pr_url: "https://example.com/pr/batch5-closeout-2",
        state: "failed",
        truth_revision: 2,
        checkpoint_ref: "checkpoint://client-side-override"
      }
    });
    assert.equal(prWritebackServerOwnedWrite.statusCode, 400);
    assert.equal(prWritebackServerOwnedWrite.body.error.code, "invalid_pr_writeback_server_owned_field");
    assert.equal(prWritebackServerOwnedWrite.body.error.family, "invalid_input");

    const topicRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}`
    });
    assert.equal(topicRead.statusCode, 200);
    assert.equal(topicRead.body.topic.merge_lifecycle.stage, "pr_ready");
    assert.equal(topicRead.body.topic.merge_lifecycle.delivery.state, "pr_ready");
    assert.equal(topicRead.body.topic.merge_lifecycle.pr_writeback.state, "failed");
    assert.equal(topicRead.body.topic.merge_lifecycle.closeout_lineage.run_id, "run_batch5_01");
    assert.equal(topicRead.body.topic.merge_lifecycle.closeout_lineage.checkpoint_ref, "checkpoint://batch5/ready");
    assert.deepEqual(topicRead.body.topic.merge_lifecycle.closeout_lineage.artifact_refs, [
      "artifact://bundle/batch5-01",
      "artifact://bundle/batch5-02"
    ]);

    const topicList = await requestJson({
      port,
      method: "GET",
      path: "/v1/topics?limit=50"
    });
    assert.equal(topicList.statusCode, 200);
    const listedTopic = topicList.body.items.find((item) => item.topic_id === topicId);
    assert.ok(listedTopic);
    assert.equal(listedTopic.merge_lifecycle.stage, "pr_ready");
    assert.equal(listedTopic.merge_lifecycle.closeout_lineage.run_id, "run_batch5_01");

    const blockLead = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "blocked" }
    });
    assert.equal(blockLead.statusCode, 200);

    const writeGateReject = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch5-delivery-write-gate-reject" },
      body: {
        source_actor_id: "lead_01",
        state: "failed",
        truth_revision: 2
      }
    });
    assert.equal(writeGateReject.statusCode, 422);
    assert.equal(writeGateReject.body.error.code, "delivery_actor_inactive");
    assert.equal(writeGateReject.body.error.family, "boundary_rejection");

    const debugRejections = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/debug/rejections?limit=100`
    });
    assert.equal(debugRejections.statusCode, 200);
    const deliveryRejection = debugRejections.body.items.find(
      (item) => item.event_type === "delivery_update_rejected" && item.reason_code === "delivery_actor_inactive"
    );
    assert.ok(deliveryRejection);
    assert.ok(typeof deliveryRejection.request_id === "string" && deliveryRejection.request_id.length > 0);
  });
});

test("v1 batch6 control-plane closeout debug truth exposes server-owned evidence anchors and closeout explanation", async () => {
  await withRuntimeServer({}, async ({ port }) => {
    const topicId = "topic_v1_batch6_closeout_debug_truth";

    const createTopic = await requestJson({
      port,
      method: "POST",
      path: "/v1/topics",
      headers: { "Idempotency-Key": "batch6-topic-create-01" },
      body: {
        topic_id: topicId,
        goal: "batch6 control-plane closeout debug truth"
      }
    });
    assert.equal(createTopic.statusCode, 201);

    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "active" }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/worker_01`,
      body: { role: "worker", status: "active", lane_id: "lane_batch6_01" }
    });
    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/human_01`,
      body: { role: "human", status: "active" }
    });

    const createConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch6-conflict-create-01" },
      body: {
        command_type: "challenge",
        source_actor_id: "worker_01",
        payload: {
          conflictId: "conflict_batch6_01",
          scopes: ["delivery"]
        }
      }
    });
    assert.equal(createConflict.statusCode, 202);

    const conflictRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/conflicts/conflict_batch6_01`
    });
    assert.equal(conflictRead.statusCode, 200);
    assert.equal(conflictRead.body.conflict.status, "unresolved");
    assert.equal(conflictRead.body.conflict.failure_reason, "unresolved_conflict");
    assert.equal(conflictRead.body.conflict.evidence_anchor.source, "server_owned");
    assert.equal(
      conflictRead.body.conflict.evidence_anchor.opened_by_command_id,
      createConflict.body.command_intent.command_id
    );

    const resolveConflict = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/conflicts/conflict_batch6_01/resolutions`,
      headers: { "Idempotency-Key": "batch6-conflict-resolve-01" },
      body: {
        source_actor_id: "lead_01",
        outcome: "accept_side",
        notes: "batch6 resolve conflict"
      }
    });
    assert.equal(resolveConflict.statusCode, 200);
    assert.equal(resolveConflict.body.conflict.status, "resolved");
    assert.equal(resolveConflict.body.conflict.evidence_anchor.source, "server_owned");
    assert.equal(resolveConflict.body.conflict.evidence_anchor.resolution_outcome, "accept_side");
    assert.ok(
      typeof resolveConflict.body.conflict.evidence_anchor.resolution_command_id === "string" &&
        resolveConflict.body.conflict.evidence_anchor.resolution_command_id.length > 0
    );

    const handoff = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch6-handoff-01" },
      body: {
        command_type: "handoff_package",
        source_actor_id: "worker_01",
        target_scope: "lead",
        referenced_artifacts: ["artifact://batch6-01"],
        payload: {
          summary: "batch6 handoff package"
        }
      }
    });
    assert.equal(handoff.statusCode, 202);
    const handoffId = handoff.body.command_intent.command_id;

    const handoffAck = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch6-handoff-ack-01" },
      body: {
        command_type: "status_report",
        source_actor_id: "lead_01",
        payload: {
          event: "handoff_ack",
          handoffId,
          resolvedArtifacts: ["artifact://batch6-01"]
        }
      }
    });
    assert.equal(handoffAck.statusCode, 202);

    const mergeRequest = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/commands`,
      headers: { "Idempotency-Key": "batch6-merge-request-01" },
      body: {
        command_type: "merge_request",
        source_actor_id: "worker_01",
        payload: {
          handoffId,
          prUrl: "https://example.com/pr/batch6"
        }
      }
    });
    assert.equal(mergeRequest.statusCode, 202);
    const holdId = mergeRequest.body.outcome.result.holdIds[0];

    const holdRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}`
    });
    assert.equal(holdRead.statusCode, 200);
    assert.equal(holdRead.body.hold.status, "pending");
    assert.equal(holdRead.body.hold.evidence_anchor.source, "server_owned");
    assert.equal(holdRead.body.hold.evidence_anchor.opened_by_command_id, mergeRequest.body.command_intent.command_id);

    const topicBeforeDecision = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}`
    });
    assert.equal(topicBeforeDecision.statusCode, 200);
    assert.equal(topicBeforeDecision.body.topic.merge_lifecycle.closeout_explanation.status, "waiting_gate");
    assert.equal(topicBeforeDecision.body.topic.merge_lifecycle.closeout_explanation.reason_code, "pending_approval_gate");
    assert.ok(
      topicBeforeDecision.body.topic.merge_lifecycle.closeout_explanation.evidence_anchor.pending_approval_ids.includes(holdId)
    );

    const rejectDecision = await requestJson({
      port,
      method: "POST",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`,
      headers: { "Idempotency-Key": "batch6-hold-reject-01" },
      body: {
        decider_actor_id: "human_01",
        intervention_point: "pr-merge",
        approve: false
      }
    });
    assert.equal(rejectDecision.statusCode, 200);
    assert.equal(rejectDecision.body.decision.status, "rejected");

    const decisionsRead = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}/decisions`
    });
    assert.equal(decisionsRead.statusCode, 200);
    assert.equal(decisionsRead.body.items.length, 1);
    assert.equal(decisionsRead.body.items[0].status, "rejected");
    assert.equal(decisionsRead.body.items[0].failure_reason, "approval_rejected");
    assert.equal(decisionsRead.body.items[0].evidence_anchor.source, "server_owned");

    const holdAfterDecision = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/approval-holds/${holdId}`
    });
    assert.equal(holdAfterDecision.statusCode, 200);
    assert.equal(holdAfterDecision.body.hold.status, "rejected");
    assert.equal(holdAfterDecision.body.hold.failure_reason, "approval_rejected");

    const topicAfterDecision = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}`
    });
    assert.equal(topicAfterDecision.statusCode, 200);
    assert.equal(topicAfterDecision.body.topic.merge_lifecycle.closeout_explanation.status, "failed");
    assert.equal(topicAfterDecision.body.topic.merge_lifecycle.closeout_explanation.reason_code, "approval_rejected");
    assert.ok(
      topicAfterDecision.body.topic.merge_lifecycle.closeout_explanation.evidence_anchor.blocker_ids.includes(
        `approval_rejected:${holdId}`
      )
    );

    const deliveryFailed = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch6-delivery-failed-01" },
      body: {
        source_actor_id: "lead_01",
        state: "failed"
      }
    });
    assert.equal(deliveryFailed.statusCode, 200);
    assert.equal(deliveryFailed.body.delivery.state, "failed");
    assert.equal(deliveryFailed.body.delivery.evidence_anchor.source, "server_owned");
    assert.equal(deliveryFailed.body.delivery.closeout_explanation.status, "failed");
    assert.equal(deliveryFailed.body.delivery.closeout_explanation.reason_code, "delivery_failed");

    await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/actors/lead_01`,
      body: { role: "lead", status: "blocked" }
    });

    const writeGateReject = await requestJson({
      port,
      method: "PUT",
      path: `/v1/topics/${topicId}/delivery`,
      headers: { "Idempotency-Key": "batch6-delivery-write-gate-reject-01" },
      body: {
        source_actor_id: "lead_01",
        state: "failed"
      }
    });
    assert.equal(writeGateReject.statusCode, 422);
    assert.equal(writeGateReject.body.error.code, "delivery_actor_inactive");

    const debugRejections = await requestJson({
      port,
      method: "GET",
      path: `/v1/topics/${topicId}/debug/rejections?limit=100`
    });
    assert.equal(debugRejections.statusCode, 200);
    const deliveryRejection = debugRejections.body.items.find(
      (item) => item.event_type === "delivery_update_rejected" && item.reason_code === "delivery_actor_inactive"
    );
    assert.ok(deliveryRejection);
    assert.ok(typeof deliveryRejection.request_id === "string" && deliveryRejection.request_id.length > 0);
  });
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
