package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestRunControlRoutesExposeStopResumeAndFollowThreadLifecycle(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	stopResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runs/run_runtime_01/control",
		`{"action":"stop","note":"先暂停，补一条人类纠偏说明。"}`,
	)
	defer stopResp.Body.Close()
	if stopResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/runs/run_runtime_01/control stop status = %d, want %d", stopResp.StatusCode, http.StatusOK)
	}

	var stopPayload struct {
		Action  string         `json:"action"`
		Run     *store.Run     `json:"run"`
		Session *store.Session `json:"session"`
		State   store.State    `json:"state"`
	}
	decodeJSON(t, stopResp, &stopPayload)
	if stopPayload.Action != "stop" || stopPayload.Run == nil || stopPayload.Run.Status != "paused" {
		t.Fatalf("stop payload = %#v, want paused run", stopPayload)
	}
	if stopPayload.Session == nil || stopPayload.Session.Status != "paused" {
		t.Fatalf("stop session = %#v, want paused", stopPayload.Session)
	}
	room := findRoomByID(stopPayload.State, "room-runtime")
	issue := findIssueByKey(stopPayload.State, "OPS-12")
	if room == nil || issue == nil || room.Topic.Status != "paused" || issue.State != "paused" {
		t.Fatalf("stop state missing paused room/issue: room=%#v issue=%#v", room, issue)
	}
	if item, ok := findInboxByTitle(stopPayload.State.Inbox, "Run 已暂停"); !ok || item.Kind != "status" {
		t.Fatalf("stop inbox item missing from %#v", stopPayload.State.Inbox)
	}

	followResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runs/run_runtime_01/control",
		`{"action":"follow_thread","note":"恢复后继续沿当前 thread 收口。"}`,
	)
	defer followResp.Body.Close()
	if followResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/runs/run_runtime_01/control follow_thread status = %d, want %d", followResp.StatusCode, http.StatusOK)
	}

	var followPayload struct {
		Run     *store.Run     `json:"run"`
		Session *store.Session `json:"session"`
		State   store.State    `json:"state"`
	}
	decodeJSON(t, followResp, &followPayload)
	if followPayload.Run == nil || !followPayload.Run.FollowThread || !strings.Contains(followPayload.Run.NextAction, "follow-thread") {
		t.Fatalf("follow payload run = %#v, want follow-thread next action", followPayload.Run)
	}
	if followPayload.Session == nil || !followPayload.Session.FollowThread {
		t.Fatalf("follow payload session = %#v, want follow-thread true", followPayload.Session)
	}
	if item, ok := findInboxByTitle(followPayload.State.Inbox, "已锁定当前线程"); !ok || item.Kind != "status" {
		t.Fatalf("follow-thread inbox item missing from %#v", followPayload.State.Inbox)
	}

	resumeResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/runs/run_runtime_01/control",
		`{"action":"resume","note":"按当前线程说明继续执行。"}`,
	)
	defer resumeResp.Body.Close()
	if resumeResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/runs/run_runtime_01/control resume status = %d, want %d", resumeResp.StatusCode, http.StatusOK)
	}

	var resumePayload struct {
		Run     *store.Run     `json:"run"`
		Session *store.Session `json:"session"`
		State   store.State    `json:"state"`
	}
	decodeJSON(t, resumeResp, &resumePayload)
	if resumePayload.Run == nil || resumePayload.Run.Status != "running" || !resumePayload.Run.FollowThread {
		t.Fatalf("resume payload run = %#v, want running + follow-thread", resumePayload.Run)
	}
	if resumePayload.Session == nil || resumePayload.Session.Status != "running" || !resumePayload.Session.FollowThread {
		t.Fatalf("resume payload session = %#v, want running + follow-thread", resumePayload.Session)
	}
	if item, ok := findInboxByTitle(resumePayload.State.Inbox, "Run 已恢复"); !ok || item.Kind != "status" {
		t.Fatalf("resume inbox item missing from %#v", resumePayload.State.Inbox)
	}

	decisionBody, err := os.ReadFile(filepath.Join(root, "decisions", "ops-12.md"))
	if err != nil {
		t.Fatalf("read decision record: %v", err)
	}
	if !strings.Contains(string(decisionBody), "- status: paused") || !strings.Contains(string(decisionBody), "- status: follow_thread") || !strings.Contains(string(decisionBody), "- status: running") {
		t.Fatalf("decision record missing control lifecycle:\n%s", string(decisionBody))
	}
}

func findIssueByKey(state store.State, issueKey string) *store.Issue {
	for index := range state.Issues {
		if state.Issues[index].Key == issueKey {
			return &state.Issues[index]
		}
	}
	return nil
}
