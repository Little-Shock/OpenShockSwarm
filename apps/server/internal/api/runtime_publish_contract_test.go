package api

import (
	"net/http"
	"testing"
)

func TestRuntimePublishRoutesExposeCursorDedupeAndReplayEvidence(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	firstResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runtime/publish",
		`{
			"runtimeId":"shock-main",
			"runId":"run_runtime_01",
			"sessionId":"session-runtime",
			"roomId":"room-runtime",
			"cursor":1,
			"phase":"stream",
			"status":"running",
			"summary":"daemon attached to live lane",
			"idempotencyKey":"pub-runtime-1",
			"evidenceLines":["daemon-stream","lane-ready"]
		}`,
	)
	defer firstResp.Body.Close()
	if firstResp.StatusCode != http.StatusAccepted {
		t.Fatalf("first POST /v1/runtime/publish status = %d, want %d", firstResp.StatusCode, http.StatusAccepted)
	}

	var firstPayload struct {
		Record struct {
			Sequence int    `json:"sequence"`
			Cursor   int    `json:"cursor"`
			Status   string `json:"status"`
		} `json:"record"`
		Replay struct {
			LastCursor int `json:"lastCursor"`
		} `json:"replay"`
	}
	decodeJSON(t, firstResp, &firstPayload)
	if firstPayload.Record.Sequence == 0 || firstPayload.Record.Cursor != 1 || firstPayload.Replay.LastCursor != 1 {
		t.Fatalf("first publish payload = %#v, want sequence/cursor=1", firstPayload)
	}

	closeoutResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runtime/publish",
		`{
			"runtimeId":"shock-main",
			"runId":"run_runtime_01",
			"sessionId":"session-runtime",
			"roomId":"room-runtime",
			"cursor":2,
			"phase":"closeout",
			"status":"done",
			"summary":"runtime closeout committed",
			"idempotencyKey":"pub-runtime-2",
			"closeoutReason":"verify complete and ready for human readback",
			"evidenceLines":["tests-green","delivery-ready"]
		}`,
	)
	defer closeoutResp.Body.Close()
	if closeoutResp.StatusCode != http.StatusAccepted {
		t.Fatalf("closeout POST /v1/runtime/publish status = %d, want %d", closeoutResp.StatusCode, http.StatusAccepted)
	}

	var closeoutPayload struct {
		Record struct {
			Sequence int    `json:"sequence"`
			Status   string `json:"status"`
		} `json:"record"`
		Replay struct {
			LastCursor     int    `json:"lastCursor"`
			Status         string `json:"status"`
			CloseoutReason string `json:"closeoutReason"`
			Events         []struct {
				Cursor int `json:"cursor"`
			} `json:"events"`
		} `json:"replay"`
	}
	decodeJSON(t, closeoutResp, &closeoutPayload)
	if closeoutPayload.Record.Sequence <= firstPayload.Record.Sequence {
		t.Fatalf("closeout sequence = %#v, want later sequence than first publish", closeoutPayload.Record)
	}
	if closeoutPayload.Replay.LastCursor != 2 || closeoutPayload.Replay.Status != "done" || closeoutPayload.Replay.CloseoutReason == "" {
		t.Fatalf("closeout replay = %#v, want cursor 2 and closeout reason", closeoutPayload.Replay)
	}
	if len(closeoutPayload.Replay.Events) != 2 {
		t.Fatalf("closeout replay events = %#v, want 2 events", closeoutPayload.Replay.Events)
	}

	dedupedResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runtime/publish",
		`{
			"runtimeId":"shock-main",
			"runId":"run_runtime_01",
			"sessionId":"session-runtime",
			"roomId":"room-runtime",
			"cursor":2,
			"phase":"closeout",
			"status":"done",
			"summary":"runtime closeout committed",
			"idempotencyKey":"pub-runtime-2",
			"closeoutReason":"verify complete and ready for human readback",
			"evidenceLines":["tests-green","delivery-ready"]
		}`,
	)
	defer dedupedResp.Body.Close()
	if dedupedResp.StatusCode != http.StatusOK {
		t.Fatalf("deduped POST /v1/runtime/publish status = %d, want %d", dedupedResp.StatusCode, http.StatusOK)
	}
	var dedupedPayload struct {
		Deduped bool `json:"deduped"`
		Record  struct {
			Sequence int `json:"sequence"`
		} `json:"record"`
	}
	decodeJSON(t, dedupedResp, &dedupedPayload)
	if !dedupedPayload.Deduped || dedupedPayload.Record.Sequence != closeoutPayload.Record.Sequence {
		t.Fatalf("deduped payload = %#v, want same sequence marked deduped", dedupedPayload)
	}

	listResp, err := http.Get(server.URL + "/v1/runtime/publish?cursor=0&limit=10&runId=run_runtime_01")
	if err != nil {
		t.Fatalf("GET /v1/runtime/publish error = %v", err)
	}
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runtime/publish status = %d, want %d", listResp.StatusCode, http.StatusOK)
	}
	var listPayload struct {
		Items []struct {
			Sequence int    `json:"sequence"`
			Cursor   int    `json:"cursor"`
			Phase    string `json:"phase"`
		} `json:"items"`
		NextSequence int `json:"nextSequence"`
	}
	decodeJSON(t, listResp, &listPayload)
	if len(listPayload.Items) != 2 || listPayload.Items[0].Cursor != 1 || listPayload.Items[1].Cursor != 2 {
		t.Fatalf("list payload = %#v, want ordered publish cursors 1 and 2", listPayload)
	}
	if listPayload.NextSequence != closeoutPayload.Record.Sequence {
		t.Fatalf("list nextSequence = %#v, want last sequence %d", listPayload, closeoutPayload.Record.Sequence)
	}

	replayResp, err := http.Get(server.URL + "/v1/runtime/publish/replay?runId=run_runtime_01")
	if err != nil {
		t.Fatalf("GET /v1/runtime/publish/replay error = %v", err)
	}
	defer replayResp.Body.Close()
	if replayResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/runtime/publish/replay status = %d, want %d", replayResp.StatusCode, http.StatusOK)
	}
	var replayPayload struct {
		Status         string `json:"status"`
		LastCursor     int    `json:"lastCursor"`
		CloseoutReason string `json:"closeoutReason"`
		ReplayAnchor   string `json:"replayAnchor"`
		Events         []struct {
			Cursor int `json:"cursor"`
		} `json:"events"`
	}
	decodeJSON(t, replayResp, &replayPayload)
	if replayPayload.Status != "done" || replayPayload.LastCursor != 2 || replayPayload.CloseoutReason == "" || replayPayload.ReplayAnchor == "" {
		t.Fatalf("replay payload = %#v, want done closeout with replay anchor", replayPayload)
	}

	conflictResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runtime/publish",
		`{
			"runtimeId":"shock-main",
			"runId":"run_runtime_01",
			"cursor":4,
			"phase":"stream",
			"status":"running",
			"summary":"out of order publish"
		}`,
	)
	defer conflictResp.Body.Close()
	if conflictResp.StatusCode != http.StatusConflict {
		t.Fatalf("conflict POST /v1/runtime/publish status = %d, want %d", conflictResp.StatusCode, http.StatusConflict)
	}
	var conflictPayload struct {
		Family string `json:"family"`
		Error  string `json:"error"`
	}
	decodeJSON(t, conflictResp, &conflictPayload)
	if conflictPayload.Family != "conflict" {
		t.Fatalf("conflict payload = %#v, want stable conflict family", conflictPayload)
	}
}
