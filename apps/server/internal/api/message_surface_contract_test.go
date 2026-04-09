package api

import (
	"bytes"
	"net/http"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestDirectMessageRoutesExposeLiveTruthAndPersistReplies(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	listResp, err := http.Get(server.URL + "/v1/direct-messages")
	if err != nil {
		t.Fatalf("GET /v1/direct-messages error = %v", err)
	}
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/direct-messages status = %d, want %d", listResp.StatusCode, http.StatusOK)
	}

	var directMessages []store.DirectMessage
	decodeJSON(t, listResp, &directMessages)
	if len(directMessages) == 0 || directMessages[0].ID == "" {
		t.Fatalf("direct messages = %#v, want seeded DM list", directMessages)
	}

	postResp, err := http.Post(server.URL+"/v1/direct-messages/dm-mina/messages", "application/json", bytes.NewReader([]byte(`{"prompt":"先保留这条 DM，不升级成 room。"}`)))
	if err != nil {
		t.Fatalf("POST /v1/direct-messages/:id/messages error = %v", err)
	}
	if postResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/direct-messages/:id/messages status = %d, want %d", postResp.StatusCode, http.StatusOK)
	}

	var postPayload struct {
		State store.State `json:"state"`
	}
	decodeJSON(t, postResp, &postPayload)
	messages := postPayload.State.DirectMessageMessages["dm-mina"]
	if len(messages) < 4 || messages[len(messages)-1].Speaker != "Mina" {
		t.Fatalf("dm-mina messages = %#v, want appended Mina reply", messages)
	}
}

func TestMessageSurfaceCollectionRouteWritesFollowedAndSavedTruth(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Post(server.URL+"/v1/message-surface/collections", "application/json", bytes.NewReader([]byte(`{
		"kind":"followed",
		"channelId":"roadmap",
		"messageId":"msg-roadmap-1",
		"enabled":true
	}`)))
	if err != nil {
		t.Fatalf("POST /v1/message-surface/collections error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/message-surface/collections status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var payload struct {
		Entry store.MessageSurfaceEntry `json:"entry"`
		State store.State               `json:"state"`
	}
	decodeJSON(t, resp, &payload)
	if payload.Entry.ChannelID != "roadmap" || payload.Entry.MessageID != "msg-roadmap-1" {
		t.Fatalf("entry = %#v, want roadmap/msg-roadmap-1", payload.Entry)
	}
	if !containsFollowedEntry(payload.State.FollowedThreads, payload.Entry.ID) {
		t.Fatalf("followed threads = %#v, want inserted roadmap entry", payload.State.FollowedThreads)
	}
}

func containsFollowedEntry(items []store.MessageSurfaceEntry, entryID string) bool {
	for _, item := range items {
		if item.ID == entryID {
			return true
		}
	}
	return false
}
