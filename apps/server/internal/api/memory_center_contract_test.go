package api

import (
	"net/http"
	"net/http/httptest"
	"os"
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

func TestMemoryCenterCleanupRouteSupportsDueModeAndSchedule(t *testing.T) {
	root := t.TempDir()
	backingStore, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	snapshot := backingStore.Snapshot()
	decisionArtifact := findMemoryArtifactByPath(snapshot.Memory, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing from seeded snapshot")
	}

	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "policy",
		Title:         "Future Rejected Policy",
		Rationale:     "remains live until the rejected TTL window closes",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(rejected future) error = %v", err)
	}

	center := backingStore.MemoryCenter()
	rejectedFuture := center.Promotions[0]
	if _, _, _, err := backingStore.ReviewMemoryPromotion(rejectedFuture.ID, store.MemoryPromotionReviewInput{
		Status:     "rejected",
		ReviewNote: "keep around until TTL expires",
		ReviewedBy: "Anne",
	}); err != nil {
		t.Fatalf("ReviewMemoryPromotion(rejected future) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "skill",
		Title:         "Room Conflict Triage",
		Rationale:     "older duplicate should be pruned when due cleanup runs",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate older) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "skill",
		Title:         "Room Conflict Triage",
		Rationale:     "newest duplicate should stay live",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate newer) error = %v", err)
	}

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}

	var beforeCenter store.MemoryCenter
	decodeJSON(t, centerResp, &beforeCenter)
	if !beforeCenter.Cleanup.Due || beforeCenter.Cleanup.DueCount != 1 {
		t.Fatalf("before cleanup schedule = %#v, want due=true dueCount=1", beforeCenter.Cleanup)
	}
	if strings.TrimSpace(beforeCenter.Cleanup.NextRunAt) == "" {
		t.Fatalf("before cleanup schedule = %#v, want nextRunAt for remaining rejected item", beforeCenter.Cleanup)
	}

	cleanupResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/cleanup?mode=due", "")
	defer cleanupResp.Body.Close()
	if cleanupResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/cleanup?mode=due status = %d, want %d", cleanupResp.StatusCode, http.StatusOK)
	}

	var cleanupPayload struct {
		Executed bool                    `json:"executed"`
		Cleanup  *store.MemoryCleanupRun `json:"cleanup"`
		Center   store.MemoryCenter      `json:"center"`
		State    store.State             `json:"state"`
	}
	decodeJSON(t, cleanupResp, &cleanupPayload)
	if !cleanupPayload.Executed || cleanupPayload.Cleanup == nil {
		t.Fatalf("cleanup payload = %#v, want executed cleanup run", cleanupPayload)
	}
	if cleanupPayload.Cleanup.Stats.DedupedPending != 1 || cleanupPayload.Cleanup.Stats.TotalRemoved != 1 {
		t.Fatalf("cleanup stats = %#v, want one deduped removal", cleanupPayload.Cleanup.Stats)
	}
	if cleanupPayload.Center.Cleanup.Due || cleanupPayload.Center.Cleanup.DueCount != 0 {
		t.Fatalf("center after due cleanup = %#v, want queue no longer due", cleanupPayload.Center.Cleanup)
	}
	if strings.TrimSpace(cleanupPayload.Center.Cleanup.NextRunAt) == "" {
		t.Fatalf("center after due cleanup = %#v, want nextRunAt for remaining rejected item", cleanupPayload.Center.Cleanup)
	}

	noopResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/cleanup?mode=due", "")
	defer noopResp.Body.Close()
	if noopResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/cleanup?mode=due noop status = %d, want %d", noopResp.StatusCode, http.StatusOK)
	}

	var noopPayload struct {
		Executed bool                    `json:"executed"`
		Cleanup  *store.MemoryCleanupRun `json:"cleanup"`
		Center   store.MemoryCenter      `json:"center"`
	}
	decodeJSON(t, noopResp, &noopPayload)
	if noopPayload.Executed || noopPayload.Cleanup != nil {
		t.Fatalf("noop payload = %#v, want no execution", noopPayload)
	}
	if noopPayload.Center.Cleanup.Due || noopPayload.Center.Cleanup.DueCount != 0 {
		t.Fatalf("noop center cleanup schedule = %#v, want queue still not due", noopPayload.Center.Cleanup)
	}
	if strings.TrimSpace(noopPayload.Center.Cleanup.NextRunAt) == "" {
		t.Fatalf("noop center = %#v, want nextRunAt to remain visible", noopPayload.Center.Cleanup)
	}
}

func TestMemoryCenterCleanupRouteSupportsDryRunWithoutMutatingDurableState(t *testing.T) {
	root := t.TempDir()
	backingStore, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	snapshot := backingStore.Snapshot()
	decisionArtifact := findMemoryArtifactByPath(snapshot.Memory, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing from seeded snapshot")
	}

	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "policy",
		Title:         "Future Rejected Policy",
		Rationale:     "remains live until the rejected TTL window closes",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(rejected future) error = %v", err)
	}
	center := backingStore.MemoryCenter()
	rejectedFuture := center.Promotions[0]
	if _, _, _, err := backingStore.ReviewMemoryPromotion(rejectedFuture.ID, store.MemoryPromotionReviewInput{
		Status:     "rejected",
		ReviewNote: "keep around until TTL expires",
		ReviewedBy: "Anne",
	}); err != nil {
		t.Fatalf("ReviewMemoryPromotion(rejected future) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "skill",
		Title:         "Room Conflict Triage",
		Rationale:     "duplicate should be reported by preview",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate older) error = %v", err)
	}
	if _, _, _, err := backingStore.RequestMemoryPromotion(store.MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          "skill",
		Title:         "Room Conflict Triage",
		Rationale:     "newest duplicate should stay live",
		ProposedBy:    "Larkspur",
	}); err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate newer) error = %v", err)
	}

	beforeResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center before dry-run error = %v", err)
	}
	defer beforeResp.Body.Close()
	if beforeResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center before dry-run status = %d, want %d", beforeResp.StatusCode, http.StatusOK)
	}

	var beforeCenter store.MemoryCenter
	decodeJSON(t, beforeResp, &beforeCenter)
	if !beforeCenter.Cleanup.Due || beforeCenter.Cleanup.DueCount != 1 || strings.TrimSpace(beforeCenter.Cleanup.NextRunAt) == "" {
		t.Fatalf("before cleanup schedule = %#v, want dry-run due item and nextRunAt", beforeCenter.Cleanup)
	}
	beforePromotionCount := len(beforeCenter.Promotions)
	beforeLedgerCount := len(beforeCenter.Cleanup.Ledger)

	cleanupResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/cleanup?mode=dry-run", "")
	defer cleanupResp.Body.Close()
	if cleanupResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/cleanup?mode=dry-run status = %d, want %d", cleanupResp.StatusCode, http.StatusOK)
	}

	var cleanupPayload struct {
		DryRun    bool                             `json:"dryRun"`
		Executed  bool                             `json:"executed"`
		DueCount  int                              `json:"dueCount"`
		NextRunAt string                           `json:"nextRunAt"`
		Items     []store.MemoryCleanupPreviewItem `json:"items"`
		Preview   store.MemoryCleanupPreview       `json:"preview"`
		Center    store.MemoryCenter               `json:"center"`
		State     store.State                      `json:"state"`
	}
	decodeJSON(t, cleanupResp, &cleanupPayload)
	if !cleanupPayload.DryRun || cleanupPayload.Executed {
		t.Fatalf("dry-run flags = dryRun:%v executed:%v, want dryRun true and executed false", cleanupPayload.DryRun, cleanupPayload.Executed)
	}
	if cleanupPayload.DueCount != 1 || cleanupPayload.Preview.DueCount != 1 || cleanupPayload.Preview.Stats.DedupedPending != 1 {
		t.Fatalf("dry-run preview = %#v, want one duplicate due item", cleanupPayload.Preview)
	}
	if strings.TrimSpace(cleanupPayload.NextRunAt) == "" || strings.TrimSpace(cleanupPayload.Preview.NextRunAt) == "" {
		t.Fatalf("dry-run nextRunAt missing: payload=%#v preview=%#v", cleanupPayload.NextRunAt, cleanupPayload.Preview.NextRunAt)
	}
	if len(cleanupPayload.Items) != 1 || len(cleanupPayload.Preview.Items) != 1 {
		t.Fatalf("dry-run items = payload:%#v preview:%#v, want one review item", cleanupPayload.Items, cleanupPayload.Preview.Items)
	}
	if item := cleanupPayload.Preview.Items[0]; item.ID == "" || item.Title == "" || item.SourceSummary == "" || item.Reason == "" {
		t.Fatalf("dry-run item = %#v, want identifiers and review summary", item)
	}
	if cleanupPayload.Center.PendingCount != beforeCenter.PendingCount || len(cleanupPayload.Center.Cleanup.Ledger) != beforeLedgerCount {
		t.Fatalf("dry-run center = %#v, want no cleanup ledger mutation from %#v", cleanupPayload.Center, beforeCenter)
	}

	afterResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after dry-run error = %v", err)
	}
	defer afterResp.Body.Close()
	if afterResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after dry-run status = %d, want %d", afterResp.StatusCode, http.StatusOK)
	}

	var afterCenter store.MemoryCenter
	decodeJSON(t, afterResp, &afterCenter)
	if len(afterCenter.Promotions) != beforePromotionCount || len(afterCenter.Cleanup.Ledger) != beforeLedgerCount {
		t.Fatalf("dry-run mutated durable memory center: before=%#v after=%#v", beforeCenter, afterCenter)
	}
	if !afterCenter.Cleanup.Due || afterCenter.Cleanup.DueCount != 1 {
		t.Fatalf("after dry-run cleanup schedule = %#v, want still due", afterCenter.Cleanup)
	}
}

func TestMemoryCenterCompactionRoutesReviewDurableQueue(t *testing.T) {
	root := t.TempDir()
	backingStore, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	snapshot := backingStore.Snapshot()
	decisionArtifact := findMemoryArtifactByPath(snapshot.Memory, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	workspaceArtifact := findMemoryArtifactByPath(snapshot.Memory, "MEMORY.md")
	if decisionArtifact == nil || workspaceArtifact == nil {
		t.Fatalf("seeded artifacts missing: decision=%#v workspace=%#v", decisionArtifact, workspaceArtifact)
	}

	createResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/compaction",
		`{"sourceArtifactId":"`+decisionArtifact.ID+`","reason":"merge repeated decision notes into compact memory"}`,
	)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/memory-center/compaction status = %d, want %d", createResp.StatusCode, http.StatusCreated)
	}

	var createPayload struct {
		Candidate store.MemoryCompactionCandidate `json:"candidate"`
		Center    store.MemoryCenter              `json:"center"`
		State     store.State                     `json:"state"`
	}
	decodeJSON(t, createResp, &createPayload)
	if createPayload.Candidate.ID == "" || createPayload.Candidate.SourceArtifactID != decisionArtifact.ID || createPayload.Candidate.Status != "candidate" {
		t.Fatalf("created compaction candidate = %#v, want candidate for decision artifact", createPayload.Candidate)
	}
	if len(createPayload.Center.CompactionQueue) != 1 || createPayload.Center.CompactionQueue[0].Reason == "" {
		t.Fatalf("center compaction queue = %#v, want created candidate", createPayload.Center.CompactionQueue)
	}

	listResp, err := http.Get(server.URL + "/v1/memory-center/compaction")
	if err != nil {
		t.Fatalf("GET /v1/memory-center/compaction error = %v", err)
	}
	defer listResp.Body.Close()
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center/compaction status = %d, want %d", listResp.StatusCode, http.StatusOK)
	}
	var listPayload []store.MemoryCompactionCandidate
	decodeJSON(t, listResp, &listPayload)
	if len(listPayload) != 1 || listPayload[0].ID != createPayload.Candidate.ID {
		t.Fatalf("compaction list = %#v, want created candidate", listPayload)
	}

	approveResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/compaction/"+createPayload.Candidate.ID+"/review",
		`{"status":"approved"}`,
	)
	defer approveResp.Body.Close()
	if approveResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/compaction/:id/review approve status = %d, want %d", approveResp.StatusCode, http.StatusOK)
	}
	var approvePayload struct {
		Candidate store.MemoryCompactionCandidate `json:"candidate"`
		Center    store.MemoryCenter              `json:"center"`
	}
	decodeJSON(t, approveResp, &approvePayload)
	if approvePayload.Candidate.Status != "approved" || approvePayload.Candidate.UpdatedAt == "" {
		t.Fatalf("approved compaction candidate = %#v, want approved status", approvePayload.Candidate)
	}

	secondResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/compaction",
		`{"sourceArtifactId":"`+workspaceArtifact.ID+`","reason":"keep audit but dismiss this compaction candidate"}`,
	)
	defer secondResp.Body.Close()
	if secondResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /v1/memory-center/compaction second status = %d, want %d", secondResp.StatusCode, http.StatusCreated)
	}
	var secondPayload struct {
		Candidate store.MemoryCompactionCandidate `json:"candidate"`
	}
	decodeJSON(t, secondResp, &secondPayload)

	dismissResp := doJSONRequest(
		t,
		http.DefaultClient,
		http.MethodPost,
		server.URL+"/v1/memory-center/compaction/"+secondPayload.Candidate.ID+"/review",
		`{"status":"dismissed"}`,
	)
	defer dismissResp.Body.Close()
	if dismissResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/compaction/:id/review dismiss status = %d, want %d", dismissResp.StatusCode, http.StatusOK)
	}
	var dismissPayload struct {
		Candidate store.MemoryCompactionCandidate `json:"candidate"`
		Center    store.MemoryCenter              `json:"center"`
	}
	decodeJSON(t, dismissResp, &dismissPayload)
	if dismissPayload.Candidate.Status != "dismissed" || len(dismissPayload.Center.CompactionQueue) != 2 {
		t.Fatalf("dismissed compaction payload = %#v, want dismissed candidate plus durable queue", dismissPayload)
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
	if searchProvider == nil || !searchProvider.Enabled || searchProvider.Status != "degraded" || searchProvider.NextAction == "" {
		t.Fatalf("search provider = %#v, want enabled degraded with next action", searchProvider)
	}
	externalProvider := findProviderByKind(updatePayload.Providers, "external-persistent")
	if externalProvider == nil || !externalProvider.Enabled || externalProvider.Status != "degraded" || externalProvider.LastError == "" || externalProvider.NextAction == "" {
		t.Fatalf("external provider = %#v, want enabled degraded with error", externalProvider)
	}
	if !strings.Contains(updatePayload.State.Workspace.MemoryMode, "workspace-file + search-sidecar(degraded) + external-persistent(degraded)") {
		t.Fatalf("workspace memory mode = %q, want provider summary", updatePayload.State.Workspace.MemoryMode)
	}

	preview := findPreviewBySession(updatePayload.Center.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing from updated center")
	}
	if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "degraded" {
		t.Fatalf("preview search provider = %#v, want degraded before recovery", got)
	}
	if !strings.Contains(preview.PromptSummary, "Memory providers active for this run:") ||
		!strings.Contains(preview.PromptSummary, "Local recall index is missing.") ||
		!strings.Contains(preview.PromptSummary, "External persistent memory is not configured.") {
		t.Fatalf("prompt summary missing provider failure note:\n%s", preview.PromptSummary)
	}
}

func TestMemoryCenterProviderHealthRoutesRecoverDurableBindings(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

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

	checkResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/check", `{"providerId":"search-sidecar"}`)
	defer checkResp.Body.Close()
	if checkResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/check status = %d, want %d", checkResp.StatusCode, http.StatusOK)
	}

	var checkPayload struct {
		Providers []store.MemoryProviderBinding `json:"providers"`
		Center    store.MemoryCenter            `json:"center"`
		State     store.State                   `json:"state"`
	}
	decodeJSON(t, checkResp, &checkPayload)
	searchChecked := findProviderByKind(checkPayload.Providers, "search-sidecar")
	if searchChecked == nil || searchChecked.LastCheckSource != "manual-check" || searchChecked.FailureCount != 1 || len(searchChecked.Activity) == 0 {
		t.Fatalf("search checked provider = %#v, want manual-check activity", searchChecked)
	}

	recoverSearchResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/search-sidecar/recover", "")
	defer recoverSearchResp.Body.Close()
	if recoverSearchResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/search-sidecar/recover status = %d, want %d", recoverSearchResp.StatusCode, http.StatusOK)
	}

	var recoverSearchPayload struct {
		Provider store.MemoryProviderBinding `json:"provider"`
		Center   store.MemoryCenter          `json:"center"`
		State    store.State                 `json:"state"`
	}
	decodeJSON(t, recoverSearchResp, &recoverSearchPayload)
	if recoverSearchPayload.Provider.Status != "healthy" || recoverSearchPayload.Provider.LastRecoverySummary == "" || recoverSearchPayload.Provider.LastCheckSource != "recovery-verify" {
		t.Fatalf("recovered search provider = %#v, want healthy recovery-verified provider", recoverSearchPayload.Provider)
	}
	if !strings.Contains(recoverSearchPayload.State.Workspace.MemoryMode, "workspace-file + search-sidecar + external-persistent(degraded)") {
		t.Fatalf("workspace memory mode after search recovery = %q, want external still degraded", recoverSearchPayload.State.Workspace.MemoryMode)
	}

	realExternalRecoverResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/external-persistent/recover", "")
	defer realExternalRecoverResp.Body.Close()
	if realExternalRecoverResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/external-persistent/recover real status = %d, want %d", realExternalRecoverResp.StatusCode, http.StatusOK)
	}
	var realExternalRecoverPayload struct {
		Provider store.MemoryProviderBinding `json:"provider"`
		State    store.State                 `json:"state"`
	}
	decodeJSON(t, realExternalRecoverResp, &realExternalRecoverPayload)
	if realExternalRecoverPayload.Provider.Status != "degraded" ||
		!strings.Contains(realExternalRecoverPayload.Provider.LastSummary, "not configured") ||
		!strings.Contains(realExternalRecoverPayload.State.Workspace.MemoryMode, "external-persistent(degraded)") {
		t.Fatalf("real external recovery = %#v, want not-configured degraded provider", realExternalRecoverPayload)
	}

	writeFakeExternalMemoryProviderAdapter(t, root, "degraded")
	recoverExternalResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/external-persistent/recover", "")
	defer recoverExternalResp.Body.Close()
	if recoverExternalResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/external-persistent/recover fake status = %d, want %d", recoverExternalResp.StatusCode, http.StatusOK)
	}

	var recoverExternalPayload struct {
		Provider store.MemoryProviderBinding `json:"provider"`
		Center   store.MemoryCenter          `json:"center"`
		State    store.State                 `json:"state"`
	}
	decodeJSON(t, recoverExternalResp, &recoverExternalPayload)
	if recoverExternalPayload.Provider.Status != "healthy" ||
		recoverExternalPayload.Provider.LastRecoverySummary == "" ||
		!strings.Contains(recoverExternalPayload.Provider.LastSummary, "Fake external memory provider recovered") {
		t.Fatalf("recovered fake external provider = %#v, want healthy fake adapter", recoverExternalPayload.Provider)
	}
	if !strings.Contains(recoverExternalPayload.State.Workspace.MemoryMode, "workspace-file + search-sidecar + external-persistent") ||
		strings.Contains(recoverExternalPayload.State.Workspace.MemoryMode, "(degraded)") {
		t.Fatalf("workspace memory mode after full recovery = %q, want healthy providers", recoverExternalPayload.State.Workspace.MemoryMode)
	}

	preview := findPreviewBySession(recoverExternalPayload.Center.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing after recovery")
	}
	if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "healthy" {
		t.Fatalf("preview search provider after recovery = %#v, want healthy", got)
	}
	if got := findProviderByKind(preview.Providers, "external-persistent"); got == nil || got.Status != "healthy" {
		t.Fatalf("preview external provider after recovery = %#v, want healthy", got)
	}
	if !strings.Contains(preview.PromptSummary, "Search sidecar index ready") ||
		!strings.Contains(preview.PromptSummary, "Fake external memory provider recovered") {
		t.Fatalf("prompt summary missing recovery truth:\n%s", preview.PromptSummary)
	}
}

func TestMemoryCenterProviderPreviewTracksCurrentOwnerAcrossHandoffReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")

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

	if _, _, err := s.CreateHandoff(store.MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "先接住交互收口",
		Summary:     "请先把交互语气和漏项收一下。",
		Kind:        "room-auto",
	}); err != nil {
		t.Fatalf("CreateHandoff(codex->claude room-auto) error = %v", err)
	}

	if _, _, err := s.CreateHandoff(store.MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-claude-review-runner",
		ToAgentID:   "agent-memory-clerk",
		Title:       "继续收记忆和验收点",
		Summary:     "请把影片资料、验收点和记忆写回一起收口。",
		Kind:        "room-auto",
	}); err != nil {
		t.Fatalf("CreateHandoff(claude->memory room-auto) error = %v", err)
	}

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	defer centerResp.Body.Close()
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}

	var center store.MemoryCenter
	decodeJSON(t, centerResp, &center)
	preview := findPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "degraded" {
		t.Fatalf("preview search provider = %#v, want degraded before recovery", got)
	}
	if got := findProviderByKind(preview.Providers, "external-persistent"); got == nil || got.Status != "degraded" {
		t.Fatalf("preview external provider = %#v, want degraded before recovery", got)
	}
	if !strings.Contains(preview.PromptSummary, "Memory Clerk") {
		t.Fatalf("preview summary = %q, want current owner Memory Clerk", preview.PromptSummary)
	}
	if !strings.Contains(preview.PromptSummary, "把 next-run injection、promotion 和 version audit 记在同一条记录里，方便回看。") {
		t.Fatalf("preview summary = %q, want Memory Clerk prompt scaffold", preview.PromptSummary)
	}
	if !strings.Contains(preview.PromptSummary, "Search Sidecar") || !strings.Contains(preview.PromptSummary, "External Persistent Memory") {
		t.Fatalf("preview summary missing provider labels:\n%s", preview.PromptSummary)
	}
	if strings.Contains(preview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("preview summary = %q, should not fall back to stale Claude Review Runner prompt", preview.PromptSummary)
	}

	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()
	mustEstablishContractBrowserSession(t, reloadedServer.URL, "larkspur@openshock.dev", "Owner Browser")

	reloadedResp, err := http.Get(reloadedServer.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after reload error = %v", err)
	}
	defer reloadedResp.Body.Close()
	if reloadedResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after reload status = %d, want %d", reloadedResp.StatusCode, http.StatusOK)
	}

	var reloadedCenter store.MemoryCenter
	decodeJSON(t, reloadedResp, &reloadedCenter)
	reloadedPreview := findPreviewBySession(reloadedCenter.Previews, "session-runtime")
	if reloadedPreview == nil {
		t.Fatalf("reloaded session-runtime preview missing: %#v", reloadedCenter.Previews)
	}
	if got := findProviderByKind(reloadedPreview.Providers, "search-sidecar"); got == nil || got.Status != "degraded" {
		t.Fatalf("reloaded preview search provider = %#v, want persisted degraded provider", got)
	}
	if got := findProviderByKind(reloadedPreview.Providers, "external-persistent"); got == nil || got.Status != "degraded" {
		t.Fatalf("reloaded preview external provider = %#v, want persisted degraded provider", got)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "Memory Clerk") {
		t.Fatalf("reloaded preview summary = %q, want persisted current owner Memory Clerk", reloadedPreview.PromptSummary)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "Search Sidecar") || !strings.Contains(reloadedPreview.PromptSummary, "External Persistent Memory") {
		t.Fatalf("reloaded preview summary missing provider labels:\n%s", reloadedPreview.PromptSummary)
	}
	if strings.Contains(reloadedPreview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("reloaded preview summary = %q, should not fall back to stale Claude Review Runner prompt", reloadedPreview.PromptSummary)
	}
}

func TestMemoryCenterProviderRecoveryPersistsHealthyBindingsAcrossReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")

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

	recoverSearchResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/search-sidecar/recover", "")
	defer recoverSearchResp.Body.Close()
	if recoverSearchResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/search-sidecar/recover status = %d, want %d", recoverSearchResp.StatusCode, http.StatusOK)
	}

	writeFakeExternalMemoryProviderAdapter(t, root, "degraded")
	recoverExternalResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/external-persistent/recover", "")
	defer recoverExternalResp.Body.Close()
	if recoverExternalResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/external-persistent/recover status = %d, want %d", recoverExternalResp.StatusCode, http.StatusOK)
	}

	indexPath := filepath.Join(root, ".openshock", "memory", "search-sidecar", "index.json")
	indexBody, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatalf("os.ReadFile(search sidecar index) error = %v", err)
	}
	if !strings.Contains(string(indexBody), `"artifactCount"`) {
		t.Fatalf("search sidecar index = %q, want artifactCount metadata", string(indexBody))
	}

	fakePath := filepath.Join(root, ".openshock", "memory", "external-persistent", "fake-adapter.json")
	fakeBody, err := os.ReadFile(fakePath)
	if err != nil {
		t.Fatalf("os.ReadFile(fake external provider adapter) error = %v", err)
	}
	if !strings.Contains(string(fakeBody), `"status": "healthy"`) ||
		!strings.Contains(string(fakeBody), "local harness verification") {
		t.Fatalf("fake external provider adapter = %q, want recovered healthy fake state", string(fakeBody))
	}

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after recovery error = %v", err)
	}
	defer centerResp.Body.Close()
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after recovery status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}

	var recoveredCenter store.MemoryCenter
	decodeJSON(t, centerResp, &recoveredCenter)
	preview := findPreviewBySession(recoveredCenter.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing after recovery: %#v", recoveredCenter.Previews)
	}
	if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "healthy" || got.LastCheckSource != "recovery-verify" {
		t.Fatalf("preview search provider after recovery = %#v, want healthy recovery-verified provider", got)
	}
	if got := findProviderByKind(preview.Providers, "external-persistent"); got == nil || got.Status != "healthy" || got.LastCheckSource != "recovery-verify" {
		t.Fatalf("preview external provider after recovery = %#v, want healthy recovery-verified provider", got)
	}
	if !strings.Contains(preview.PromptSummary, "Search sidecar index ready") ||
		!strings.Contains(preview.PromptSummary, "Fake external memory provider recovered") {
		t.Fatalf("prompt summary after recovery missing healthy provider truth:\n%s", preview.PromptSummary)
	}

	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()
	mustEstablishContractBrowserSession(t, reloadedServer.URL, "larkspur@openshock.dev", "Owner Browser")

	reloadedProvidersResp, err := http.Get(reloadedServer.URL + "/v1/memory-center/providers")
	if err != nil {
		t.Fatalf("GET /v1/memory-center/providers after reload error = %v", err)
	}
	defer reloadedProvidersResp.Body.Close()
	if reloadedProvidersResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center/providers after reload status = %d, want %d", reloadedProvidersResp.StatusCode, http.StatusOK)
	}

	var reloadedProviders []store.MemoryProviderBinding
	decodeJSON(t, reloadedProvidersResp, &reloadedProviders)
	searchProvider := findProviderByKind(reloadedProviders, "search-sidecar")
	if searchProvider == nil || searchProvider.Status != "healthy" || searchProvider.LastRecoverySummary == "" || searchProvider.LastCheckSource != "recovery-verify" {
		t.Fatalf("reloaded search provider = %#v, want persisted healthy recovery truth", searchProvider)
	}
	externalProvider := findProviderByKind(reloadedProviders, "external-persistent")
	if externalProvider == nil || externalProvider.Status != "healthy" || externalProvider.LastRecoverySummary == "" || externalProvider.LastCheckSource != "recovery-verify" {
		t.Fatalf("reloaded external provider = %#v, want persisted healthy recovery truth", externalProvider)
	}

	reloadedCenterResp, err := http.Get(reloadedServer.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after reload error = %v", err)
	}
	defer reloadedCenterResp.Body.Close()
	if reloadedCenterResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after reload status = %d, want %d", reloadedCenterResp.StatusCode, http.StatusOK)
	}

	var reloadedCenter store.MemoryCenter
	decodeJSON(t, reloadedCenterResp, &reloadedCenter)
	reloadedPreview := findPreviewBySession(reloadedCenter.Previews, "session-memory")
	if reloadedPreview == nil {
		t.Fatalf("reloaded session-memory preview missing: %#v", reloadedCenter.Previews)
	}
	if got := findProviderByKind(reloadedPreview.Providers, "search-sidecar"); got == nil || got.Status != "healthy" {
		t.Fatalf("reloaded preview search provider = %#v, want healthy provider", got)
	}
	if got := findProviderByKind(reloadedPreview.Providers, "external-persistent"); got == nil || got.Status != "healthy" {
		t.Fatalf("reloaded preview external provider = %#v, want healthy provider", got)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "Search sidecar index ready") ||
		!strings.Contains(reloadedPreview.PromptSummary, "Fake external memory provider recovered") {
		t.Fatalf("reloaded prompt summary missing healthy provider truth:\n%s", reloadedPreview.PromptSummary)
	}
}

func TestMemoryCenterRecoveryMatrixKeepsSessionPreviewTruthIndependentAcrossReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	s, server := newContractTestServer(t, root, "http://127.0.0.1:65531")

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

	recoverSearchResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/search-sidecar/recover", "")
	defer recoverSearchResp.Body.Close()
	if recoverSearchResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/search-sidecar/recover status = %d, want %d", recoverSearchResp.StatusCode, http.StatusOK)
	}

	writeFakeExternalMemoryProviderAdapter(t, root, "degraded")
	recoverExternalResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/external-persistent/recover", "")
	defer recoverExternalResp.Body.Close()
	if recoverExternalResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/external-persistent/recover status = %d, want %d", recoverExternalResp.StatusCode, http.StatusOK)
	}

	if _, _, err := s.CreateHandoff(store.MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "先接住交互收口",
		Summary:     "请先把交互语气和漏项收一下。",
		Kind:        "room-auto",
	}); err != nil {
		t.Fatalf("CreateHandoff(codex->claude room-auto) error = %v", err)
	}
	if _, _, err := s.CreateHandoff(store.MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-claude-review-runner",
		ToAgentID:   "agent-memory-clerk",
		Title:       "继续收记忆和验收点",
		Summary:     "请把影片资料、验收点和记忆写回一起收口。",
		Kind:        "room-auto",
	}); err != nil {
		t.Fatalf("CreateHandoff(claude->memory room-auto) error = %v", err)
	}

	runtimeRoomNote := filepath.ToSlash(filepath.Join("notes", "rooms", "room-runtime.md"))
	inboxRoomNote := filepath.ToSlash(filepath.Join("notes", "rooms", "room-inbox.md"))
	assertPreviewMatrix := func(center store.MemoryCenter) {
		t.Helper()

		runtimePreview := findPreviewBySession(center.Previews, "session-runtime")
		if runtimePreview == nil {
			t.Fatalf("session-runtime preview missing: %#v", center.Previews)
		}
		if !previewHasPath(runtimePreview.Items, runtimeRoomNote) {
			t.Fatalf("runtime preview items = %#v, want room-runtime note", runtimePreview.Items)
		}
		if previewHasPath(runtimePreview.Items, inboxRoomNote) {
			t.Fatalf("runtime preview items = %#v, should not bleed room-inbox note", runtimePreview.Items)
		}
		if !strings.Contains(runtimePreview.PromptSummary, "Memory Clerk") ||
			!strings.Contains(runtimePreview.PromptSummary, "把 next-run injection、promotion 和 version audit 记在同一条记录里，方便回看。") {
			t.Fatalf("runtime preview summary = %q, want Memory Clerk handoff truth", runtimePreview.PromptSummary)
		}
		if strings.Contains(runtimePreview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
			t.Fatalf("runtime preview summary = %q, should not fall back to Claude Review Runner prompt", runtimePreview.PromptSummary)
		}
		if got := findProviderByKind(runtimePreview.Providers, "search-sidecar"); got == nil || got.Status != "healthy" {
			t.Fatalf("runtime preview search provider = %#v, want healthy provider", got)
		}
		if got := findProviderByKind(runtimePreview.Providers, "external-persistent"); got == nil || got.Status != "healthy" {
			t.Fatalf("runtime preview external provider = %#v, want healthy provider", got)
		}

		inboxPreview := findPreviewBySession(center.Previews, "session-inbox")
		if inboxPreview == nil {
			t.Fatalf("session-inbox preview missing: %#v", center.Previews)
		}
		if !previewHasPath(inboxPreview.Items, inboxRoomNote) {
			t.Fatalf("inbox preview items = %#v, want room-inbox note", inboxPreview.Items)
		}
		if previewHasPath(inboxPreview.Items, runtimeRoomNote) {
			t.Fatalf("inbox preview items = %#v, should not bleed room-runtime note", inboxPreview.Items)
		}
		if !strings.Contains(inboxPreview.PromptSummary, "Claude Review Runner") ||
			!strings.Contains(inboxPreview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
			t.Fatalf("inbox preview summary = %q, want Claude Review Runner truth", inboxPreview.PromptSummary)
		}
		if strings.Contains(inboxPreview.PromptSummary, "把 next-run injection、promotion 和 version audit 记在同一条记录里，方便回看。") {
			t.Fatalf("inbox preview summary = %q, should not inherit Memory Clerk prompt", inboxPreview.PromptSummary)
		}
		if got := findProviderByKind(inboxPreview.Providers, "search-sidecar"); got == nil || got.Status != "healthy" {
			t.Fatalf("inbox preview search provider = %#v, want healthy provider", got)
		}
		if got := findProviderByKind(inboxPreview.Providers, "external-persistent"); got == nil || got.Status != "healthy" {
			t.Fatalf("inbox preview external provider = %#v, want healthy provider", got)
		}
	}

	centerResp, err := http.Get(server.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center error = %v", err)
	}
	defer centerResp.Body.Close()
	if centerResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center status = %d, want %d", centerResp.StatusCode, http.StatusOK)
	}

	var center store.MemoryCenter
	decodeJSON(t, centerResp, &center)
	assertPreviewMatrix(center)

	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()
	mustEstablishContractBrowserSession(t, reloadedServer.URL, "larkspur@openshock.dev", "Owner Browser")

	reloadedResp, err := http.Get(reloadedServer.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after reload error = %v", err)
	}
	defer reloadedResp.Body.Close()
	if reloadedResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after reload status = %d, want %d", reloadedResp.StatusCode, http.StatusOK)
	}

	var reloadedCenter store.MemoryCenter
	decodeJSON(t, reloadedResp, &reloadedCenter)
	assertPreviewMatrix(reloadedCenter)
}

func TestMemoryCenterProviderHealthFallsBackToDegradedTruthWhenRecoveredArtifactsCorrupt(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")

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

	recoverSearchResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/search-sidecar/recover", "")
	defer recoverSearchResp.Body.Close()
	if recoverSearchResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/search-sidecar/recover status = %d, want %d", recoverSearchResp.StatusCode, http.StatusOK)
	}

	recoverExternalResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/external-persistent/recover", "")
	defer recoverExternalResp.Body.Close()
	if recoverExternalResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/external-persistent/recover status = %d, want %d", recoverExternalResp.StatusCode, http.StatusOK)
	}

	if err := os.WriteFile(filepath.Join(root, ".openshock", "memory", "search-sidecar", "index.json"), []byte("{not-json"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(corrupt search sidecar index) error = %v", err)
	}
	if err := os.Remove(filepath.Join(root, ".openshock", "memory", "external-persistent", "relay.ndjson")); err != nil {
		t.Fatalf("os.Remove(external persistent relay) error = %v", err)
	}

	checkResp := doJSONRequest(t, http.DefaultClient, http.MethodPost, server.URL+"/v1/memory-center/providers/check", `{}`)
	defer checkResp.Body.Close()
	if checkResp.StatusCode != http.StatusOK {
		t.Fatalf("POST /v1/memory-center/providers/check status = %d, want %d", checkResp.StatusCode, http.StatusOK)
	}

	var checkPayload struct {
		Providers []store.MemoryProviderBinding `json:"providers"`
		Center    store.MemoryCenter            `json:"center"`
		State     store.State                   `json:"state"`
	}
	decodeJSON(t, checkResp, &checkPayload)
	searchProvider := findProviderByKind(checkPayload.Providers, "search-sidecar")
	if searchProvider == nil || searchProvider.Status != "degraded" || searchProvider.LastRecoverySummary == "" || searchProvider.LastCheckSource != "manual-check" || searchProvider.FailureCount != 1 {
		t.Fatalf("search provider after corruption = %#v, want degraded provider with preserved recovery summary and failure count", searchProvider)
	}
	externalProvider := findProviderByKind(checkPayload.Providers, "external-persistent")
	if externalProvider == nil || externalProvider.Status != "degraded" || externalProvider.LastRecoverySummary == "" || externalProvider.LastCheckSource != "manual-check" || externalProvider.FailureCount < 1 {
		t.Fatalf("external provider after corruption = %#v, want degraded provider with preserved recovery summary and failure count", externalProvider)
	}
	if !strings.Contains(checkPayload.State.Workspace.MemoryMode, "search-sidecar(degraded)") ||
		!strings.Contains(checkPayload.State.Workspace.MemoryMode, "external-persistent(degraded)") {
		t.Fatalf("workspace memory mode after corruption = %q, want both degraded providers surfaced", checkPayload.State.Workspace.MemoryMode)
	}

	preview := findPreviewBySession(checkPayload.Center.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing after corruption: %#v", checkPayload.Center.Previews)
	}
	if got := findProviderByKind(preview.Providers, "search-sidecar"); got == nil || got.Status != "degraded" {
		t.Fatalf("preview search provider after corruption = %#v, want degraded provider", got)
	}
	if got := findProviderByKind(preview.Providers, "external-persistent"); got == nil || got.Status != "degraded" {
		t.Fatalf("preview external provider after corruption = %#v, want degraded provider", got)
	}
	if !strings.Contains(preview.PromptSummary, "Local recall index is unreadable.") ||
		!strings.Contains(preview.PromptSummary, "External durable relay queue is missing.") {
		t.Fatalf("preview prompt summary after corruption missing degraded truth:\n%s", preview.PromptSummary)
	}

	server.Close()

	reloadedStore, err := store.New(statePath, root)
	if err != nil {
		t.Fatalf("store.New(reload) error = %v", err)
	}
	reloadedServer := httptest.NewServer(New(reloadedStore, http.DefaultClient, Config{
		DaemonURL:     "http://127.0.0.1:65531",
		WorkspaceRoot: root,
	}).Handler())
	defer reloadedServer.Close()
	mustEstablishContractBrowserSession(t, reloadedServer.URL, "larkspur@openshock.dev", "Owner Browser")

	reloadedCenterResp, err := http.Get(reloadedServer.URL + "/v1/memory-center")
	if err != nil {
		t.Fatalf("GET /v1/memory-center after corruption reload error = %v", err)
	}
	defer reloadedCenterResp.Body.Close()
	if reloadedCenterResp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/memory-center after corruption reload status = %d, want %d", reloadedCenterResp.StatusCode, http.StatusOK)
	}

	var reloadedCenter store.MemoryCenter
	decodeJSON(t, reloadedCenterResp, &reloadedCenter)
	reloadedPreview := findPreviewBySession(reloadedCenter.Previews, "session-memory")
	if reloadedPreview == nil {
		t.Fatalf("reloaded session-memory preview missing after corruption: %#v", reloadedCenter.Previews)
	}
	if got := findProviderByKind(reloadedPreview.Providers, "search-sidecar"); got == nil || got.Status != "degraded" {
		t.Fatalf("reloaded preview search provider after corruption = %#v, want degraded provider", got)
	}
	if got := findProviderByKind(reloadedPreview.Providers, "external-persistent"); got == nil || got.Status != "degraded" {
		t.Fatalf("reloaded preview external provider after corruption = %#v, want degraded provider", got)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "Local recall index is unreadable.") ||
		!strings.Contains(reloadedPreview.PromptSummary, "External durable relay queue is missing.") {
		t.Fatalf("reloaded prompt summary after corruption missing degraded truth:\n%s", reloadedPreview.PromptSummary)
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

func writeFakeExternalMemoryProviderAdapter(t *testing.T, root string, status string) {
	t.Helper()

	body := `{
  "version": 1,
  "status": "` + status + `",
  "generatedAt": "2026-04-29T00:00:00Z",
  "summary": "Fake external memory provider is degraded for local harness verification.",
  "detail": "Deterministic fake provider adapter used only by tests and local harnesses.",
  "lastError": "fake outage",
  "nextAction": "Run fake provider recovery.",
  "recoveryStatus": "healthy"
}`
	if status == "healthy" {
		body = `{
  "version": 1,
  "status": "healthy",
  "generatedAt": "2026-04-29T00:00:00Z",
  "summary": "Fake external memory provider is healthy for local harness verification.",
  "detail": "Deterministic fake provider adapter used only by tests and local harnesses.",
  "nextAction": "Keep this fake adapter confined to tests or local harnesses.",
  "recoveryStatus": "healthy"
}`
	}

	fakePath := filepath.Join(root, ".openshock", "memory", "external-persistent", "fake-adapter.json")
	if err := os.MkdirAll(filepath.Dir(fakePath), 0o755); err != nil {
		t.Fatalf("mkdir fake external memory provider adapter dir: %v", err)
	}
	if err := os.WriteFile(fakePath, []byte(body), 0o644); err != nil {
		t.Fatalf("write fake external memory provider adapter: %v", err)
	}
}
