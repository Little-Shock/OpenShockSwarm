package api

import (
	"net/http"
	"path/filepath"
	"strconv"
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
	roomArtifact := findMemoryArtifactByPath(artifacts, filepath.ToSlash(filepath.Join("notes", "rooms", "room-memory.md")))
	if roomArtifact == nil {
		t.Fatalf("room artifact missing from /v1/memory: %#v", artifacts)
	}
	decisionArtifact := findMemoryArtifactByPath(artifacts, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing from /v1/memory: %#v", artifacts)
	}

	feedbackResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory/"+roomArtifact.ID+"/feedback",
		`{"sourceVersion":`+strconv.Itoa(roomArtifact.Version)+`,"summary":"Human Correction","note":"优先写 room note，再把冲突规则提升到 policy。"}`,
	)
	defer feedbackResp.Body.Close()
	if feedbackResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory/:id/feedback status = %d, want %d", feedbackResp.StatusCode, http.StatusOK)
	}

	var feedbackPayload struct {
		Detail store.MemoryArtifactDetail `json:"detail"`
		Center store.MemoryCenter         `json:"center"`
		State  store.State                `json:"state"`
	}
	decodeJSON(t, feedbackResp, &feedbackPayload)
	if feedbackPayload.Detail.Artifact.CorrectionCount != 1 || feedbackPayload.Detail.Artifact.LastCorrectionBy == "" {
		t.Fatalf("feedback detail = %#v, want correction metadata", feedbackPayload.Detail.Artifact)
	}
	if feedbackPayload.Detail.Artifact.LatestSource != "memory.feedback" {
		t.Fatalf("feedback latest source = %q, want memory.feedback", feedbackPayload.Detail.Artifact.LatestSource)
	}
	if !strings.Contains(feedbackPayload.Detail.Content, "优先写 room note") {
		t.Fatalf("feedback detail content missing correction note:\n%s", feedbackPayload.Detail.Content)
	}
	if preview := findPreviewBySession(feedbackPayload.Center.Previews, "session-memory"); preview == nil || !previewHasPath(preview.Items, roomArtifact.Path) {
		t.Fatalf("feedback preview missing corrected room artifact: %#v", preview)
	}

	forgetResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory/"+roomArtifact.ID+"/forget",
		`{"sourceVersion":`+strconv.Itoa(feedbackPayload.Detail.Artifact.Version)+`,"reason":"房间临时记忆已失效，避免继续注入错误上下文。"}`,
	)
	defer forgetResp.Body.Close()
	if forgetResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory/:id/forget status = %d, want %d", forgetResp.StatusCode, http.StatusOK)
	}

	var forgetPayload struct {
		Detail store.MemoryArtifactDetail `json:"detail"`
		Center store.MemoryCenter         `json:"center"`
		State  store.State                `json:"state"`
	}
	decodeJSON(t, forgetResp, &forgetPayload)
	if !forgetPayload.Detail.Artifact.Forgotten || forgetPayload.Detail.Artifact.ForgetReason == "" {
		t.Fatalf("forget detail = %#v, want forgotten artifact metadata", forgetPayload.Detail.Artifact)
	}
	if forgetPayload.Detail.Artifact.LatestSource != "memory.forget" {
		t.Fatalf("forget latest source = %q, want memory.forget", forgetPayload.Detail.Artifact.LatestSource)
	}
	if preview := findPreviewBySession(forgetPayload.Center.Previews, "session-memory"); preview == nil || previewHasPath(preview.Items, roomArtifact.Path) {
		t.Fatalf("forgotten room artifact still present in preview: %#v", preview)
	}
	if !strings.Contains(forgetPayload.Detail.Content, "房间临时记忆已失效") {
		t.Fatalf("forget detail content missing forget reason:\n%s", forgetPayload.Detail.Content)
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

func TestMemoryCenterCleanupRoutePrunesQueueAndKeepsPromotionFlowLive(t *testing.T) {
	root := t.TempDir()
	backingStore, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	snapshot := backingStore.Snapshot()
	decisionArtifact := findMemoryArtifactByPath(snapshot.Memory, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	roomArtifact := findMemoryArtifactByPath(snapshot.Memory, filepath.ToSlash(filepath.Join("notes", "rooms", "room-memory.md")))
	workspaceArtifact := findMemoryArtifactByPath(snapshot.Memory, "MEMORY.md")
	if decisionArtifact == nil || roomArtifact == nil || workspaceArtifact == nil {
		t.Fatalf("seeded artifacts missing: decision=%#v room=%#v workspace=%#v", decisionArtifact, roomArtifact, workspaceArtifact)
	}

	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "skill",
		Title:         "Room Conflict Triage",
		Rationale:     "older duplicate",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate older) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "skill",
		Title:         "Room Conflict Triage",
		Rationale:     "newer duplicate",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate newer) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      workspaceArtifact.ID,
		SourceVersion: workspaceArtifact.Version,
		Kind:          "policy",
		Title:         "Workspace Guardrail Policy",
		Rationale:     "becomes stale after feedback",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(stale pending) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      roomArtifact.ID,
		SourceVersion: roomArtifact.Version,
		Kind:          "skill",
		Title:         "Temporary Room Scratchpad",
		Rationale:     "removed once source is forgotten",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(forgotten pending) error = %v", err)
	}
	if _, _, _, err := backingStore.SubmitMemoryFeedback(workspaceArtifact.ID, store.MemoryFeedbackInput{
		SourceVersion: workspaceArtifact.Version,
		Summary:       "Workspace cleanup refresh",
		Note:          "advance artifact version so the old promotion request becomes stale",
		CorrectedBy:   "Larkspur",
	}); err != nil {
		t.Fatalf("SubmitMemoryFeedback(workspace) error = %v", err)
	}
	if _, _, _, err := backingStore.ForgetMemoryArtifact(roomArtifact.ID, store.MemoryForgetInput{
		SourceVersion: roomArtifact.Version,
		Reason:        "room scratchpad is obsolete and should leave the recall pack",
		ForgottenBy:   "Larkspur",
	}); err != nil {
		t.Fatalf("ForgetMemoryArtifact(room) error = %v", err)
	}

	cleanupResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/cleanup", "")
	defer cleanupResp.Body.Close()
	if cleanupResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/cleanup status = %d, want %d", cleanupResp.StatusCode, http.StatusOK)
	}

	var cleanupPayload struct {
		Cleanup store.MemoryCleanupRun `json:"cleanup"`
		Center  store.MemoryCenter     `json:"center"`
		State   store.State            `json:"state"`
	}
	decodeJSON(t, cleanupResp, &cleanupPayload)
	if cleanupPayload.Cleanup.Status != "cleaned" {
		t.Fatalf("cleanup payload = %#v, want cleaned status", cleanupPayload.Cleanup)
	}
	if cleanupPayload.Cleanup.Stats.DedupedPending != 1 ||
		cleanupPayload.Cleanup.Stats.SupersededPending != 1 ||
		cleanupPayload.Cleanup.Stats.ForgottenSourcePending != 1 {
		t.Fatalf("cleanup stats = %#v, want dedupe + superseded + forgotten pruning", cleanupPayload.Cleanup.Stats)
	}
	if cleanupPayload.Center.PendingCount != 1 || len(cleanupPayload.Center.Cleanup.Ledger) == 0 {
		t.Fatalf("cleanup center = %#v, want one live pending request + cleanup ledger", cleanupPayload.Center)
	}

	decisionArtifact = findMemoryArtifactByPath(cleanupPayload.State.Memory, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing after cleanup state")
	}

	promotionResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/promotions",
		`{"memoryId":"`+decisionArtifact.ID+`","sourceVersion":`+strconv.Itoa(decisionArtifact.Version)+`,"kind":"policy","title":"Room Recovery Priority","rationale":"cleanup should leave a healthy queue for fresh promotions"}`,
	)
	defer promotionResp.Body.Close()
	if promotionResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/memory-center/promotions after cleanup status = %d, want %d", promotionResp.StatusCode, http.StatusCreated)
	}

	var promotionPayload struct {
		Promotion store.MemoryPromotion `json:"promotion"`
		Center    store.MemoryCenter    `json:"center"`
	}
	decodeJSON(t, promotionResp, &promotionPayload)
	if promotionPayload.Promotion.Status != "pending_review" {
		t.Fatalf("promotion after cleanup = %#v, want pending review", promotionPayload.Promotion)
	}

	reviewResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/promotions/"+promotionPayload.Promotion.ID+"/review",
		`{"status":"approved","reviewNote":"cleanup preserved the promotion path"}`,
	)
	defer reviewResp.Body.Close()
	if reviewResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/promotions/:id/review after cleanup status = %d, want %d", reviewResp.StatusCode, http.StatusOK)
	}

	var reviewPayload struct {
		Promotion store.MemoryPromotion `json:"promotion"`
		Center    store.MemoryCenter    `json:"center"`
	}
	decodeJSON(t, reviewResp, &reviewPayload)
	if reviewPayload.Promotion.Status != "approved" || reviewPayload.Promotion.TargetMemoryID == "" {
		t.Fatalf("review after cleanup = %#v, want approved ledger target", reviewPayload.Promotion)
	}
	preview := findPreviewBySession(reviewPayload.Center.Previews, "session-memory")
	if preview == nil || !previewHasPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "policies.md"))) {
		t.Fatalf("preview after cleanup->promote flow missing policies ledger: %#v", preview)
	}
}

func TestMemoryCenterProviderRoutesExposeDurableProviderBindings(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	providersResp, err := http.Get(server.URL + "/v1/memory-center/providers")
	if err != nil {
		t.Fatalf("GET /v1/memory-center/providers error = %v", err)
	}
	if providersResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center/providers status = %d, want %d", providersResp.StatusCode, http.StatusOK)
	}

	var initialProviders []store.MemoryProviderBinding
	decodeJSON(t, providersResp, &initialProviders)
	workspaceProvider := findProviderByKind(initialProviders, "workspace-file")
	if workspaceProvider == nil || !workspaceProvider.Enabled || workspaceProvider.Status != "healthy" {
		t.Fatalf("workspace provider = %#v, want enabled healthy", workspaceProvider)
	}

	updateResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/providers",
		`{"providers":[
			{"id":"workspace-file","kind":"workspace-file","label":"Workspace File Memory","enabled":true,"readScopes":["workspace","issue-room","room-notes","decision-ledger","agent","promoted-ledger"],"writeScopes":["workspace","issue-room","room-notes","decision-ledger","agent"],"recallPolicy":"governed-first","retentionPolicy":"保留版本、人工纠偏和提升 ledger。","sharingPolicy":"workspace-governed","summary":"Primary file-backed memory."},
			{"id":"search-sidecar","kind":"search-sidecar","label":"Search Sidecar","enabled":true,"readScopes":["workspace","issue-room","decision-ledger","promoted-ledger"],"writeScopes":[],"recallPolicy":"search-on-demand","retentionPolicy":"短期 query cache。","sharingPolicy":"workspace-query-only","summary":"Use local recall index before full scan."},
			{"id":"external-persistent","kind":"external-persistent","label":"External Persistent Memory","enabled":true,"readScopes":["workspace","agent","user"],"writeScopes":["agent","user"],"recallPolicy":"promote-approved-only","retentionPolicy":"长期保留审核通过的 durable memory。","sharingPolicy":"explicit-share-only","summary":"Forward approved memories to an external durable sink."}
		]}`,
	)
	defer updateResp.Body.Close()
	if updateResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers status = %d, want %d", updateResp.StatusCode, http.StatusOK)
	}

	var updatePayload struct {
		Providers []store.MemoryProviderBinding `json:"providers"`
		Center    store.MemoryCenter            `json:"center"`
		State     store.State                   `json:"state"`
	}
	decodeJSON(t, updateResp, &updatePayload)
	searchProvider := findProviderByKind(updatePayload.Providers, "search-sidecar")
	if searchProvider == nil || !searchProvider.Enabled || searchProvider.Status != "healthy" {
		t.Fatalf("search provider = %#v, want enabled healthy", searchProvider)
	}
	externalProvider := findProviderByKind(updatePayload.Providers, "external-persistent")
	if externalProvider == nil || !externalProvider.Enabled || externalProvider.Status != "degraded" || externalProvider.LastError == "" {
		t.Fatalf("external provider = %#v, want enabled degraded with error", externalProvider)
	}
	if !strings.Contains(updatePayload.State.Workspace.MemoryMode, "workspace-file + search-sidecar + external-persistent(degraded)") {
		t.Fatalf("workspace memory mode = %q, want provider summary", updatePayload.State.Workspace.MemoryMode)
	}

	preview := findPreviewBySession(updatePayload.Center.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing from updated center")
	}
	if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "healthy" {
		t.Fatalf("preview search provider = %#v, want healthy", got)
	}
	if !strings.Contains(preview.PromptSummary, "Memory providers active for this run:") ||
		!strings.Contains(preview.PromptSummary, "External durable adapter is not configured yet") {
		t.Fatalf("prompt summary missing provider failure note:\n%s", preview.PromptSummary)
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

func findProviderByKind(providers []store.MemoryProviderBinding, kind string) *store.MemoryProviderBinding {
	for index := range providers {
		if providers[index].Kind == kind {
			return &providers[index]
		}
	}
	return nil
}
