package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMemoryCenterBuildsInjectionPreviewAndPromotionLifecycle(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	initial := s.MemoryCenter()
	if initial.Policy.Mode != memoryPolicyModeGovernedFirst || !initial.Policy.IncludePromotedArtifacts {
		t.Fatalf("initial policy = %#v, want governed-first with promoted artifacts", initial.Policy)
	}

	preview := findMemoryPreviewBySession(initial.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing: %#v", initial.Previews)
	}
	if !previewContainsPath(preview.Items, "MEMORY.md") || !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join("decisions", "ops-27.md"))) {
		t.Fatalf("preview items = %#v, want workspace + decision memory", preview.Items)
	}

	_, policy, updatedCenter, err := s.UpdateMemoryPolicy(MemoryPolicyInput{
		Mode:                     memoryPolicyModeGovernedFirst,
		IncludeRoomNotes:         true,
		IncludeDecisionLedger:    true,
		IncludeAgentMemory:       true,
		IncludePromotedArtifacts: true,
		MaxItems:                 8,
		UpdatedBy:                "Larkspur",
	})
	if err != nil {
		t.Fatalf("UpdateMemoryPolicy() error = %v", err)
	}
	if !policy.IncludeAgentMemory || policy.MaxItems != 8 || policy.UpdatedBy != "Larkspur" {
		t.Fatalf("updated policy = %#v, want agent memory + actor", policy)
	}

	preview = findMemoryPreviewBySession(updatedCenter.Previews, "session-memory")
	if preview == nil || !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "MEMORY.md"))) {
		t.Fatalf("preview after policy update = %#v, want owner agent memory", preview)
	}

	roomArtifact := findMemoryArtifactByPath(s.Snapshot(), filepath.ToSlash(filepath.Join("notes", "rooms", "room-memory.md")))
	if roomArtifact == nil {
		t.Fatalf("room memory artifact missing")
	}
	_, skillPromotion, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:   roomArtifact.ID,
		Kind:       memoryPromotionKindSkill,
		Title:      "Room Conflict Triage",
		Rationale:  "把反复出现的冲突整理成可复用技能。",
		ProposedBy: "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(skill) error = %v", err)
	}
	if skillPromotion.Status != memoryPromotionStatusPending || skillPromotion.TargetPath != filepath.ToSlash(filepath.Join("notes", "skills.md")) {
		t.Fatalf("skill promotion = %#v, want pending skill target", skillPromotion)
	}

	decisionArtifact := findMemoryArtifactByPath(s.Snapshot(), filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision memory artifact missing")
	}
	_, policyPromotion, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:   decisionArtifact.ID,
		Kind:       memoryPromotionKindPolicy,
		Title:      "Room Over User Priority",
		Rationale:  "把阻塞时的优先级顺序收成团队 policy。",
		ProposedBy: "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(policy) error = %v", err)
	}

	_, skillApproved, _, err := s.ReviewMemoryPromotion(skillPromotion.ID, MemoryPromotionReviewInput{
		Status:     memoryPromotionStatusApproved,
		ReviewNote: "作为复用技能保留。",
		ReviewedBy: "Larkspur",
	})
	if err != nil {
		t.Fatalf("ReviewMemoryPromotion(skill approve) error = %v", err)
	}
	if skillApproved.Status != memoryPromotionStatusApproved || skillApproved.TargetMemoryID == "" {
		t.Fatalf("approved skill promotion = %#v, want approved target memory", skillApproved)
	}

	_, policyApproved, finalCenter, err := s.ReviewMemoryPromotion(policyPromotion.ID, MemoryPromotionReviewInput{
		Status:     memoryPromotionStatusApproved,
		ReviewNote: "作为团队治理 policy 生效。",
		ReviewedBy: "Larkspur",
	})
	if err != nil {
		t.Fatalf("ReviewMemoryPromotion(policy approve) error = %v", err)
	}
	if policyApproved.Status != memoryPromotionStatusApproved || policyApproved.TargetMemoryID == "" {
		t.Fatalf("approved policy promotion = %#v, want approved target memory", policyApproved)
	}

	if finalCenter.PendingCount != 0 || finalCenter.ApprovedCount < 2 {
		t.Fatalf("final center counts = %#v, want two approved promotions", finalCenter)
	}

	preview = findMemoryPreviewBySession(finalCenter.Previews, "session-memory")
	if preview == nil || !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "skills.md"))) || !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "policies.md"))) {
		t.Fatalf("final preview = %#v, want promoted ledgers injected", preview)
	}

	skillBody, err := os.ReadFile(filepath.Join(root, "notes", "skills.md"))
	if err != nil {
		t.Fatalf("read notes/skills.md: %v", err)
	}
	if !strings.Contains(string(skillBody), "Room Conflict Triage") || !strings.Contains(string(skillBody), "promoted_from: notes/rooms/room-memory.md") {
		t.Fatalf("skills ledger missing approved promotion:\n%s", string(skillBody))
	}

	policyBody, err := os.ReadFile(filepath.Join(root, "notes", "policies.md"))
	if err != nil {
		t.Fatalf("read notes/policies.md: %v", err)
	}
	if !strings.Contains(string(policyBody), "Room Over User Priority") || !strings.Contains(string(policyBody), "promoted_from: decisions/ops-27.md") {
		t.Fatalf("policies ledger missing approved promotion:\n%s", string(policyBody))
	}
}

func TestMemoryCleanupPrunesStaleQueueAndKeepsPromotionPathLive(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	snapshot := s.Snapshot()
	decisionArtifact := findMemoryArtifactByPath(snapshot, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	roomArtifact := findMemoryArtifactByPath(snapshot, filepath.ToSlash(filepath.Join("notes", "rooms", "room-memory.md")))
	workspaceArtifact := findMemoryArtifactByPath(snapshot, "MEMORY.md")
	if decisionArtifact == nil || roomArtifact == nil || workspaceArtifact == nil {
		t.Fatalf("seeded artifacts missing: decision=%#v room=%#v workspace=%#v", decisionArtifact, roomArtifact, workspaceArtifact)
	}

	_, duplicateOlder, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          memoryPromotionKindSkill,
		Title:         "Room Conflict Triage",
		Rationale:     "older duplicate should be collapsed",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate older) error = %v", err)
	}
	_, duplicateNewer, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          memoryPromotionKindSkill,
		Title:         "Room Conflict Triage",
		Rationale:     "newest duplicate should survive",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate newer) error = %v", err)
	}
	_, supersededPending, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      workspaceArtifact.ID,
		SourceVersion: workspaceArtifact.Version,
		Kind:          memoryPromotionKindPolicy,
		Title:         "Workspace Guardrail Policy",
		Rationale:     "becomes stale after feedback",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(superseded pending) error = %v", err)
	}
	_, forgottenPending, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      roomArtifact.ID,
		SourceVersion: roomArtifact.Version,
		Kind:          memoryPromotionKindSkill,
		Title:         "Temporary Room Scratchpad",
		Rationale:     "should be removed once source is forgotten",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(forgotten pending) error = %v", err)
	}
	_, rejectedExpired, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          memoryPromotionKindPolicy,
		Title:         "Rejected Legacy Policy",
		Rationale:     "should expire after TTL",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(rejected expired) error = %v", err)
	}

	if _, _, _, err := s.SubmitMemoryFeedback(workspaceArtifact.ID, MemoryFeedbackInput{
		SourceVersion: workspaceArtifact.Version,
		Summary:       "Workspace cleanup refresh",
		Note:          "advance workspace truth so the old promotion request becomes stale",
		CorrectedBy:   "Larkspur",
	}); err != nil {
		t.Fatalf("SubmitMemoryFeedback(workspace) error = %v", err)
	}
	if _, _, _, err := s.ForgetMemoryArtifact(roomArtifact.ID, MemoryForgetInput{
		SourceVersion: roomArtifact.Version,
		Reason:        "room scratchpad is obsolete and should leave the recall pack",
		ForgottenBy:   "Larkspur",
	}); err != nil {
		t.Fatalf("ForgetMemoryArtifact(room) error = %v", err)
	}
	if _, _, _, err := s.ReviewMemoryPromotion(rejectedExpired.ID, MemoryPromotionReviewInput{
		Status:     memoryPromotionStatusRejected,
		ReviewNote: "outdated policy",
		ReviewedBy: "Anne",
	}); err != nil {
		t.Fatalf("ReviewMemoryPromotion(rejected) error = %v", err)
	}

	rejectedAt := time.Now().UTC().Add(-(memoryCleanupRejectedTTL + time.Hour)).Format(time.RFC3339)
	olderDuplicateAt := time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	newerDuplicateAt := time.Now().UTC().Add(-1 * time.Hour).Format(time.RFC3339)

	s.mu.Lock()
	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		s.mu.Unlock()
		t.Fatalf("loadMemoryCenterStateLocked() error = %v", err)
	}
	for index := range state.Promotions {
		switch state.Promotions[index].ID {
		case duplicateOlder.ID:
			state.Promotions[index].ProposedAt = olderDuplicateAt
		case duplicateNewer.ID:
			state.Promotions[index].ProposedAt = newerDuplicateAt
		case rejectedExpired.ID:
			state.Promotions[index].ReviewedAt = rejectedAt
			state.Promotions[index].ProposedAt = rejectedAt
		}
	}
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		s.mu.Unlock()
		t.Fatalf("saveMemoryCenterStateLocked() error = %v", err)
	}
	s.mu.Unlock()

	snapshot, cleanupRun, center, err := s.RunMemoryCleanup("Larkspur")
	if err != nil {
		t.Fatalf("RunMemoryCleanup() error = %v", err)
	}
	if cleanupRun.Status != memoryCleanupStatusCleaned {
		t.Fatalf("cleanup run status = %q, want %q", cleanupRun.Status, memoryCleanupStatusCleaned)
	}
	if cleanupRun.Stats.DedupedPending != 1 ||
		cleanupRun.Stats.SupersededPending != 1 ||
		cleanupRun.Stats.ForgottenSourcePending != 1 ||
		cleanupRun.Stats.ExpiredRejected != 1 {
		t.Fatalf("cleanup stats = %#v, want dedupe/superseded/forgotten/rejected pruning", cleanupRun.Stats)
	}
	if center.PendingCount != 1 || center.Cleanup.LastRunBy != "Larkspur" {
		t.Fatalf("center after cleanup = %#v, want one pending + cleanup actor", center)
	}
	if findPromotionByID(center.Promotions, duplicateOlder.ID) != nil ||
		findPromotionByID(center.Promotions, supersededPending.ID) != nil ||
		findPromotionByID(center.Promotions, forgottenPending.ID) != nil ||
		findPromotionByID(center.Promotions, rejectedExpired.ID) != nil {
		t.Fatalf("cleanup kept stale promotions: %#v", center.Promotions)
	}
	if kept := findPromotionByID(center.Promotions, duplicateNewer.ID); kept == nil || kept.Status != memoryPromotionStatusPending {
		t.Fatalf("cleanup removed newest duplicate instead of keeping it: %#v", center.Promotions)
	}
	if len(center.Cleanup.Ledger) == 0 || center.Cleanup.Ledger[0].Stats.TotalRemoved != 4 {
		t.Fatalf("cleanup ledger = %#v, want recorded removal run", center.Cleanup)
	}

	decisionArtifact = findMemoryArtifactByPath(snapshot, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing after cleanup snapshot")
	}
	_, policyPromotion, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          memoryPromotionKindPolicy,
		Title:         "Room Recovery Priority",
		Rationale:     "cleanup should leave a healthy queue so a fresh promotion can still land",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(policy after cleanup) error = %v", err)
	}
	_, policyApproved, finalCenter, err := s.ReviewMemoryPromotion(policyPromotion.ID, MemoryPromotionReviewInput{
		Status:     memoryPromotionStatusApproved,
		ReviewNote: "approved after cleanup recovered the queue",
		ReviewedBy: "Anne",
	})
	if err != nil {
		t.Fatalf("ReviewMemoryPromotion(policy after cleanup) error = %v", err)
	}
	if policyApproved.Status != memoryPromotionStatusApproved || policyApproved.TargetMemoryID == "" {
		t.Fatalf("policyApproved = %#v, want approved policy ledger target", policyApproved)
	}
	preview := findMemoryPreviewBySession(finalCenter.Previews, "session-memory")
	if preview == nil || !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join("notes", "policies.md"))) {
		t.Fatalf("final preview missing policies ledger after cleanup->promote flow: %#v", preview)
	}
}

func TestMemoryProviderBindingsPersistAndAnnotatePromptSummary(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	initial := s.MemoryCenter()
	if got := findMemoryProviderByKind(initial.Providers, memoryProviderKindWorkspaceFile); got == nil || !got.Enabled || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("workspace-file provider = %#v, want enabled healthy", got)
	}
	if got := findMemoryProviderByKind(initial.Providers, memoryProviderKindSearchSidecar); got == nil || got.Enabled || got.Status != memoryProviderStatusStandby {
		t.Fatalf("search-sidecar provider = %#v, want disabled standby", got)
	}

	_, providers, center, err := s.UpdateMemoryProviders([]MemoryProviderBinding{
		{
			ID:              memoryProviderKindWorkspaceFile,
			Kind:            memoryProviderKindWorkspaceFile,
			Label:           "Workspace File Memory",
			Enabled:         true,
			ReadScopes:      []string{"workspace", "issue-room", "room-notes", "decision-ledger", "agent", "promoted-ledger"},
			WriteScopes:     []string{"workspace", "issue-room", "room-notes", "decision-ledger", "agent"},
			RecallPolicy:    "governed-first",
			RetentionPolicy: "保留版本、人工纠偏和提升 ledger。",
			SharingPolicy:   "workspace-governed",
			Summary:         "Primary file-backed memory.",
		},
		{
			ID:              memoryProviderKindSearchSidecar,
			Kind:            memoryProviderKindSearchSidecar,
			Label:           "Search Sidecar",
			Enabled:         true,
			ReadScopes:      []string{"workspace", "issue-room", "decision-ledger", "promoted-ledger"},
			WriteScopes:     []string{},
			RecallPolicy:    "search-on-demand",
			RetentionPolicy: "短期 query cache。",
			SharingPolicy:   "workspace-query-only",
			Summary:         "Use local recall index before falling back to full ledger scan.",
		},
		{
			ID:              memoryProviderKindExternalPersistent,
			Kind:            memoryProviderKindExternalPersistent,
			Label:           "External Persistent Memory",
			Enabled:         true,
			ReadScopes:      []string{"workspace", "agent", "user"},
			WriteScopes:     []string{"agent", "user"},
			RecallPolicy:    "promote-approved-only",
			RetentionPolicy: "长期保留审核通过的 durable memory。",
			SharingPolicy:   "explicit-share-only",
			Summary:         "Forward approved memories to an external durable sink.",
		},
	}, "Larkspur")
	if err != nil {
		t.Fatalf("UpdateMemoryProviders() error = %v", err)
	}

	searchProvider := findMemoryProviderByKind(providers, memoryProviderKindSearchSidecar)
	if searchProvider == nil || !searchProvider.Enabled || searchProvider.Status != memoryProviderStatusHealthy {
		t.Fatalf("search provider = %#v, want enabled healthy", searchProvider)
	}
	externalProvider := findMemoryProviderByKind(providers, memoryProviderKindExternalPersistent)
	if externalProvider == nil || !externalProvider.Enabled || externalProvider.Status != memoryProviderStatusDegraded || externalProvider.LastError == "" {
		t.Fatalf("external provider = %#v, want enabled degraded with error", externalProvider)
	}

	preview := findMemoryPreviewBySession(center.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing")
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("preview search provider = %#v, want healthy", got)
	}
	if !strings.Contains(preview.PromptSummary, "Memory providers active for this run:") ||
		!strings.Contains(preview.PromptSummary, "Search Sidecar") ||
		!strings.Contains(preview.PromptSummary, "External Persistent Memory") ||
		!strings.Contains(preview.PromptSummary, "External durable adapter is not configured yet") {
		t.Fatalf("prompt summary missing provider orchestration details:\n%s", preview.PromptSummary)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reload) error = %v", err)
	}
	reloadedCenter := reloaded.MemoryCenter()
	if got := findMemoryProviderByKind(reloadedCenter.Providers, memoryProviderKindExternalPersistent); got == nil || !got.Enabled || got.Status != memoryProviderStatusDegraded {
		t.Fatalf("reloaded external provider = %#v, want persisted degraded binding", got)
	}
}

func findMemoryPreviewBySession(previews []MemoryInjectionPreview, sessionID string) *MemoryInjectionPreview {
	for index := range previews {
		if previews[index].SessionID == sessionID {
			return &previews[index]
		}
	}
	return nil
}

func previewContainsPath(items []MemoryInjectionPreviewItem, want string) bool {
	for _, item := range items {
		if item.Path == want {
			return true
		}
	}
	return false
}

func findPromotionByID(promotions []MemoryPromotion, promotionID string) *MemoryPromotion {
	for index := range promotions {
		if promotions[index].ID == promotionID {
			return &promotions[index]
		}
	}
	return nil
}

func findMemoryProviderByKind(providers []MemoryProviderBinding, kind string) *MemoryProviderBinding {
	for index := range providers {
		if providers[index].Kind == kind {
			return &providers[index]
		}
	}
	return nil
}
