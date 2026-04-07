package api

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestMemoryCenterRoutesExposePolicyPreviewAndPromotionLifecycle(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}

	var initialCenter store.MemoryCenter
	decodeJSON(t, centerResp, &initialCenter)
	if initialCenter.Policy.Mode != "governed-first" || len(initialCenter.Previews) == 0 {
		t.Fatalf("initial center = %#v, want governed-first previews", initialCenter)
	}

	policyResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/policy",
		`{"mode":"governed-first","includeRoomNotes":true,"includeDecisionLedger":true,"includeAgentMemory":true,"includePromotedArtifacts":true,"maxItems":8}`,
	)
	defer policyResp.Body.Close()
	if policyResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/policy status = %d, want %d", policyResp.StatusCode, http.StatusOK)
	}

	var policyPayload struct {
		Policy store.MemoryInjectionPolicy `json:"policy"`
		Center store.MemoryCenter          `json:"center"`
		State  store.State                 `json:"state"`
	}
	decodeJSON(t, policyResp, &policyPayload)
	if !policyPayload.Policy.IncludeAgentMemory || policyPayload.Policy.MaxItems != 8 {
		t.Fatalf("policy payload = %#v, want agent memory + maxItems=8", policyPayload.Policy)
	}
	if !strings.Contains(policyPayload.State.Workspace.MemoryMode, "governed-first") {
		t.Fatalf("workspace memory mode = %q, want governed-first label", policyPayload.State.Workspace.MemoryMode)
	}
	if preview := findPreviewBySession(policyPayload.Center.Previews, "session-memory"); preview == nil || !previewHasPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "MEMORY.md"))) {
		t.Fatalf("updated preview missing owner agent memory: %#v", preview)
	}

	memoryResp, err := http.Get(server.URL + "/v1/memory")
	if err != nil {
		t.Fatalf("GET /v1/memory error = %v", err)
	}
	if memoryResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory status = %d, want %d", memoryResp.StatusCode, http.StatusOK)
	}

	var artifacts []store.MemoryArtifact
	decodeJSON(t, memoryResp, &artifacts)
	decisionArtifact := findMemoryArtifactByPath(artifacts, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing from /v1/memory: %#v", artifacts)
	}

	promotionResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/promotions",
		`{"memoryId":"`+decisionArtifact.ID+`","kind":"policy","title":"Room Over User Priority","rationale":"把阻塞时的优先级冲突收成治理规则。"}`,
	)
	defer promotionResp.Body.Close()
	if promotionResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/memory-center/promotions status = %d, want %d", promotionResp.StatusCode, http.StatusCreated)
	}

	var promotionPayload struct {
		Promotion store.MemoryPromotion `json:"promotion"`
		Center    store.MemoryCenter    `json:"center"`
	}
	decodeJSON(t, promotionResp, &promotionPayload)
	if promotionPayload.Promotion.Status != "pending_review" || promotionPayload.Promotion.Kind != "policy" {
		t.Fatalf("promotion payload = %#v, want pending policy", promotionPayload.Promotion)
	}

	reviewResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/promotions/"+promotionPayload.Promotion.ID+"/review",
		`{"status":"approved","reviewNote":"这条规则进入团队 policy ledger。"}`,
	)
	defer reviewResp.Body.Close()
	if reviewResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/promotions/:id/review status = %d, want %d", reviewResp.StatusCode, http.StatusOK)
	}

	var reviewPayload struct {
		Promotion store.MemoryPromotion `json:"promotion"`
		Center    store.MemoryCenter    `json:"center"`
		State     store.State           `json:"state"`
	}
	decodeJSON(t, reviewResp, &reviewPayload)
	if reviewPayload.Promotion.Status != "approved" || reviewPayload.Promotion.TargetMemoryID == "" {
		t.Fatalf("review payload = %#v, want approved target ledger", reviewPayload.Promotion)
	}
	if reviewPayload.Center.PendingCount != 0 || reviewPayload.Center.ApprovedCount == 0 {
		t.Fatalf("review center counts = %#v, want approved promotion", reviewPayload.Center)
	}
	preview := findPreviewBySession(reviewPayload.Center.Previews, "session-memory")
	if preview == nil || !previewHasPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "policies.md"))) {
		t.Fatalf("review preview missing policies ledger: %#v", preview)
	}

	policiesArtifact := findMemoryArtifactByPath(reviewPayload.State.Memory, filepath.ToSlash(filepath.Join("notes", "policies.md")))
	if policiesArtifact == nil || policiesArtifact.Version < 2 || !strings.Contains(policiesArtifact.LatestWrite, "Promoted policy") {
		t.Fatalf("policies artifact = %#v, want promoted policy writeback", policiesArtifact)
	}

	detailResp, err := http.Get(server.URL + "/v1/memory/" + reviewPayload.Promotion.TargetMemoryID)
	if err != nil {
		t.Fatalf("GET /v1/memory/%s error = %v", reviewPayload.Promotion.TargetMemoryID, err)
	}
	if detailResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory/%s status = %d, want %d", reviewPayload.Promotion.TargetMemoryID, detailResp.StatusCode, http.StatusOK)
	}

	var detail store.MemoryArtifactDetail
	decodeJSON(t, detailResp, &detail)
	if !strings.Contains(detail.Content, "Room Over User Priority") {
		t.Fatalf("policy ledger content missing approved promotion:\n%s", detail.Content)
	}
}

func findPreviewBySession(previews []store.MemoryInjectionPreview, sessionID string) *store.MemoryInjectionPreview {
	for index := range previews {
		if previews[index].SessionID == sessionID {
			return &previews[index]
		}
	}
	return nil
}

func previewHasPath(items []store.MemoryInjectionPreviewItem, want string) bool {
	for _, item := range items {
		if item.Path == want {
			return true
		}
	}
	return false
}
