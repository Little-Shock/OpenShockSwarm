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
	if preview == nil ||
		!previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "SOUL.md"))) ||
		!previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "MEMORY.md"))) ||
		!previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "notes", "operating-rules.md"))) {
		t.Fatalf("preview after policy update = %#v, want owner agent file stack", preview)
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

func TestMemoryCenterPreviewPrefersCurrentOwnerOverStaleRecentRunAgent(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, _, err := s.UpdateMemoryPolicy(MemoryPolicyInput{
		Mode:                     memoryPolicyModeGovernedFirst,
		IncludeRoomNotes:         true,
		IncludeDecisionLedger:    true,
		IncludeAgentMemory:       true,
		IncludePromotedArtifacts: true,
		MaxItems:                 8,
		UpdatedBy:                "Larkspur",
	}); err != nil {
		t.Fatalf("UpdateMemoryPolicy() error = %v", err)
	}
	if _, _, _, err := s.UpdateMemoryProviders(sampleMemoryProviderBindings(), "Larkspur"); err != nil {
		t.Fatalf("UpdateMemoryProviders() error = %v", err)
	}
	if _, _, _, err := s.RecoverMemoryProvider(memoryProviderKindSearchSidecar, "Larkspur"); err != nil {
		t.Fatalf("RecoverMemoryProvider(search-sidecar) error = %v", err)
	}
	if _, _, _, err := s.RecoverMemoryProvider(memoryProviderKindExternalPersistent, "Larkspur"); err != nil {
		t.Fatalf("RecoverMemoryProvider(external-persistent) error = %v", err)
	}

	if _, _, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "先接住交互收口",
		Summary:     "请先把交互语气和漏项收一下。",
		Kind:        handoffKindRoomAuto,
	}); err != nil {
		t.Fatalf("CreateHandoff(codex->claude room-auto) error = %v", err)
	}

	if _, _, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-claude-review-runner",
		ToAgentID:   "agent-memory-clerk",
		Title:       "继续收记忆和验收点",
		Summary:     "请把影片资料、验收点和记忆写回一起收口。",
		Kind:        handoffKindRoomAuto,
	}); err != nil {
		t.Fatalf("CreateHandoff(claude->memory room-auto) error = %v", err)
	}

	snapshot := s.Snapshot()
	runtimeRoom := findRoomByID(snapshot, "room-runtime")
	if runtimeRoom == nil || runtimeRoom.Topic.Owner != "Memory Clerk" {
		t.Fatalf("runtime room = %#v, want current owner Memory Clerk after second handoff", runtimeRoom)
	}
	runtimeRun := findRunByID(snapshot, "run_runtime_01")
	if runtimeRun == nil || runtimeRun.Owner != "Memory Clerk" {
		t.Fatalf("runtime run = %#v, want current owner Memory Clerk after second handoff", runtimeRun)
	}

	center := s.MemoryCenter()
	preview := findMemoryPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if !strings.Contains(preview.PromptSummary, "Memory Clerk") {
		t.Fatalf("preview summary = %q, want current owner Memory Clerk", preview.PromptSummary)
	}
	if !previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "SOUL.md"))) ||
		!previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "MEMORY.md"))) ||
		!previewContainsPath(preview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "notes", "skills.md"))) {
		t.Fatalf("preview items = %#v, want current owner Memory Clerk file stack", preview.Items)
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("preview search provider = %#v, want healthy provider for current owner preview", got)
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindExternalPersistent); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("preview external provider = %#v, want healthy provider for current owner preview", got)
	}
	if !strings.Contains(preview.PromptSummary, "把 next-run injection、promotion 和 version audit 记在同一条记录里，方便回看。") {
		t.Fatalf("preview summary = %q, want Memory Clerk prompt scaffold", preview.PromptSummary)
	}
	if !strings.Contains(preview.PromptSummary, "Search sidecar index ready") {
		t.Fatalf("preview summary = %q, want recovered search-sidecar note", preview.PromptSummary)
	}
	if !strings.Contains(preview.PromptSummary, "External durable adapter stub is configured in local relay mode.") {
		t.Fatalf("preview summary = %q, want recovered external provider note", preview.PromptSummary)
	}
	if strings.Contains(preview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("preview summary = %q, should not fall back to stale Claude Review Runner prompt", preview.PromptSummary)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reload) error = %v", err)
	}
	reloadedPreview := findMemoryPreviewBySession(reloaded.MemoryCenter().Previews, "session-runtime")
	if reloadedPreview == nil {
		t.Fatalf("reloaded session-runtime preview missing: %#v", reloaded.MemoryCenter().Previews)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "Memory Clerk") {
		t.Fatalf("reloaded preview summary = %q, want persisted current owner Memory Clerk", reloadedPreview.PromptSummary)
	}
	if !previewContainsPath(reloadedPreview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "SOUL.md"))) ||
		!previewContainsPath(reloadedPreview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "MEMORY.md"))) ||
		!previewContainsPath(reloadedPreview.Items, filepath.ToSlash(filepath.Join(".openshock", "agents", "memory-clerk", "notes", "skills.md"))) {
		t.Fatalf("reloaded preview items = %#v, want persisted current owner Memory Clerk file stack", reloadedPreview.Items)
	}
	if got := findMemoryProviderByKind(reloadedPreview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("reloaded preview search provider = %#v, want persisted healthy provider", got)
	}
	if got := findMemoryProviderByKind(reloadedPreview.Providers, memoryProviderKindExternalPersistent); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("reloaded preview external provider = %#v, want persisted healthy provider", got)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "Search sidecar index ready") {
		t.Fatalf("reloaded preview summary = %q, want persisted recovered search-sidecar note", reloadedPreview.PromptSummary)
	}
	if !strings.Contains(reloadedPreview.PromptSummary, "External durable adapter stub is configured in local relay mode.") {
		t.Fatalf("reloaded preview summary = %q, want persisted recovered external provider note", reloadedPreview.PromptSummary)
	}
	if strings.Contains(reloadedPreview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("reloaded preview summary = %q, should not fall back to stale Claude Review Runner prompt", reloadedPreview.PromptSummary)
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

func TestMemoryCleanupDueRunExecutesOnlyWhenQueueNeedsPruning(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	snapshot := s.Snapshot()
	decisionArtifact := findMemoryArtifactByPath(snapshot, filepath.ToSlash(filepath.Join("decisions", "ops-27.md")))
	if decisionArtifact == nil {
		t.Fatalf("decision artifact missing from seeded snapshot")
	}

	_, rejectedFuture, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          memoryPromotionKindPolicy,
		Title:         "Future Rejected Policy",
		Rationale:     "stays live until the rejected TTL window closes",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(rejected future) error = %v", err)
	}
	if _, _, _, err := s.ReviewMemoryPromotion(rejectedFuture.ID, MemoryPromotionReviewInput{
		Status:     memoryPromotionStatusRejected,
		ReviewNote: "keep around until TTL expires",
		ReviewedBy: "Anne",
	}); err != nil {
		t.Fatalf("ReviewMemoryPromotion(rejected future) error = %v", err)
	}

	_, duplicateOlder, _, err := s.RequestMemoryPromotion(MemoryPromotionRequestInput{
		MemoryID:      decisionArtifact.ID,
		SourceVersion: decisionArtifact.Version,
		Kind:          memoryPromotionKindSkill,
		Title:         "Room Conflict Triage",
		Rationale:     "older duplicate should be pruned when due cleanup runs",
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
		Rationale:     "newest duplicate should stay live",
		ProposedBy:    "Larkspur",
	})
	if err != nil {
		t.Fatalf("RequestMemoryPromotion(duplicate newer) error = %v", err)
	}

	futureReviewedAt := time.Now().UTC().Add(-(memoryCleanupRejectedTTL - 2*time.Hour)).Format(time.RFC3339)
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
		case rejectedFuture.ID:
			state.Promotions[index].ProposedAt = futureReviewedAt
			state.Promotions[index].ReviewedAt = futureReviewedAt
		case duplicateOlder.ID:
			state.Promotions[index].ProposedAt = olderDuplicateAt
		case duplicateNewer.ID:
			state.Promotions[index].ProposedAt = newerDuplicateAt
		}
	}
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		s.mu.Unlock()
		t.Fatalf("saveMemoryCenterStateLocked() error = %v", err)
	}
	s.mu.Unlock()

	center := s.MemoryCenter()
	if !center.Cleanup.Due || center.Cleanup.DueCount != 1 {
		t.Fatalf("center cleanup schedule = %#v, want due=true dueCount=1", center.Cleanup)
	}
	expectedNextRunAt := time.Now().UTC()
	expectedNextRunAt, err = time.Parse(time.RFC3339, futureReviewedAt)
	if err != nil {
		t.Fatalf("time.Parse(futureReviewedAt) error = %v", err)
	}
	expectedNextRunAt = expectedNextRunAt.Add(memoryCleanupRejectedTTL)
	if center.Cleanup.NextRunAt != expectedNextRunAt.Format(time.RFC3339) {
		t.Fatalf("center cleanup nextRunAt = %q, want %q", center.Cleanup.NextRunAt, expectedNextRunAt.Format(time.RFC3339))
	}

	postCleanupSnapshot, cleanupRun, postCleanupCenter, executed, err := s.RunDueMemoryCleanup("Larkspur")
	if err != nil {
		t.Fatalf("RunDueMemoryCleanup() error = %v", err)
	}
	if !executed || cleanupRun == nil {
		t.Fatalf("RunDueMemoryCleanup() = executed=%v cleanup=%#v, want executed cleanup run", executed, cleanupRun)
	}
	if cleanupRun.Status != memoryCleanupStatusCleaned || cleanupRun.Stats.DedupedPending != 1 || cleanupRun.Stats.TotalRemoved != 1 {
		t.Fatalf("cleanupRun = %#v, want cleaned run with one deduped pending removal", cleanupRun)
	}
	if postCleanupCenter.Cleanup.Due || postCleanupCenter.Cleanup.DueCount != 0 {
		t.Fatalf("post cleanup schedule = %#v, want queue no longer due", postCleanupCenter.Cleanup)
	}
	if postCleanupCenter.Cleanup.NextRunAt != expectedNextRunAt.Format(time.RFC3339) {
		t.Fatalf("post cleanup nextRunAt = %q, want %q", postCleanupCenter.Cleanup.NextRunAt, expectedNextRunAt.Format(time.RFC3339))
	}
	if len(postCleanupCenter.Cleanup.Ledger) == 0 || postCleanupCenter.Cleanup.Ledger[0].ID != cleanupRun.ID {
		t.Fatalf("post cleanup ledger = %#v, want run recorded first", postCleanupCenter.Cleanup.Ledger)
	}
	if findPromotionByID(postCleanupCenter.Promotions, duplicateOlder.ID) != nil {
		t.Fatalf("older duplicate still present after due cleanup: %#v", postCleanupCenter.Promotions)
	}
	if kept := findPromotionByID(postCleanupCenter.Promotions, duplicateNewer.ID); kept == nil || kept.Status != memoryPromotionStatusPending {
		t.Fatalf("newest duplicate missing after due cleanup: %#v", postCleanupCenter.Promotions)
	}
	if kept := findPromotionByID(postCleanupCenter.Promotions, rejectedFuture.ID); kept == nil || kept.Status != memoryPromotionStatusRejected {
		t.Fatalf("future rejected promotion should still be live after due cleanup: %#v", postCleanupCenter.Promotions)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reload) error = %v", err)
	}
	reloadedCenter := reloaded.MemoryCenter()
	if reloadedCenter.Cleanup.Due || reloadedCenter.Cleanup.DueCount != 0 {
		t.Fatalf("reloaded cleanup schedule = %#v, want persisted non-due queue", reloadedCenter.Cleanup)
	}
	if reloadedCenter.Cleanup.NextRunAt != expectedNextRunAt.Format(time.RFC3339) {
		t.Fatalf("reloaded cleanup nextRunAt = %q, want %q", reloadedCenter.Cleanup.NextRunAt, expectedNextRunAt.Format(time.RFC3339))
	}
	if kept := findMemoryArtifactByPath(postCleanupSnapshot, filepath.ToSlash(filepath.Join("decisions", "ops-27.md"))); kept == nil {
		t.Fatalf("decision artifact missing after due cleanup snapshot")
	}

	_, noopCleanup, noopCenter, executed, err := s.RunDueMemoryCleanup("Larkspur")
	if err != nil {
		t.Fatalf("RunDueMemoryCleanup(noop) error = %v", err)
	}
	if executed || noopCleanup != nil {
		t.Fatalf("RunDueMemoryCleanup(noop) = executed=%v cleanup=%#v, want no execution", executed, noopCleanup)
	}
	if noopCenter.Cleanup.Due || noopCenter.Cleanup.DueCount != 0 {
		t.Fatalf("noop center cleanup schedule = %#v, want queue still not due", noopCenter.Cleanup)
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

	_, providers, center, err := s.UpdateMemoryProviders(sampleMemoryProviderBindings(), "Larkspur")
	if err != nil {
		t.Fatalf("UpdateMemoryProviders() error = %v", err)
	}

	searchProvider := findMemoryProviderByKind(providers, memoryProviderKindSearchSidecar)
	if searchProvider == nil || !searchProvider.Enabled || searchProvider.Status != memoryProviderStatusDegraded || searchProvider.LastError == "" || searchProvider.NextAction == "" {
		t.Fatalf("search provider = %#v, want enabled degraded with recovery guidance", searchProvider)
	}
	externalProvider := findMemoryProviderByKind(providers, memoryProviderKindExternalPersistent)
	if externalProvider == nil || !externalProvider.Enabled || externalProvider.Status != memoryProviderStatusDegraded || externalProvider.LastError == "" || externalProvider.NextAction == "" {
		t.Fatalf("external provider = %#v, want enabled degraded with error", externalProvider)
	}

	preview := findMemoryPreviewBySession(center.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing")
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusDegraded {
		t.Fatalf("preview search provider = %#v, want degraded before recovery", got)
	}
	if !strings.Contains(preview.PromptSummary, "Memory providers active for this run:") ||
		!strings.Contains(preview.PromptSummary, "Search Sidecar") ||
		!strings.Contains(preview.PromptSummary, "External Persistent Memory") ||
		!strings.Contains(preview.PromptSummary, "Local recall index is missing.") ||
		!strings.Contains(preview.PromptSummary, "External durable adapter stub is not configured.") {
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
	if got := findMemoryProviderByKind(reloadedCenter.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusDegraded || got.NextAction == "" {
		t.Fatalf("reloaded search provider = %#v, want degraded binding with recovery guidance", got)
	}
}

func TestMemoryProviderPreviewFollowsCurrentOwnerAcrossHandoffReload(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, _, err := s.UpdateMemoryProviders(sampleMemoryProviderBindings(), "Larkspur"); err != nil {
		t.Fatalf("UpdateMemoryProviders() error = %v", err)
	}

	if _, _, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "先接住交互收口",
		Summary:     "请先把交互语气和漏项收一下。",
		Kind:        handoffKindRoomAuto,
	}); err != nil {
		t.Fatalf("CreateHandoff(codex->claude room-auto) error = %v", err)
	}

	if _, _, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-claude-review-runner",
		ToAgentID:   "agent-memory-clerk",
		Title:       "继续收记忆和验收点",
		Summary:     "请把影片资料、验收点和记忆写回一起收口。",
		Kind:        handoffKindRoomAuto,
	}); err != nil {
		t.Fatalf("CreateHandoff(claude->memory room-auto) error = %v", err)
	}

	center := s.MemoryCenter()
	preview := findMemoryPreviewBySession(center.Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing: %#v", center.Previews)
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusDegraded {
		t.Fatalf("preview search provider = %#v, want degraded after binding", got)
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindExternalPersistent); got == nil || got.Status != memoryProviderStatusDegraded {
		t.Fatalf("preview external provider = %#v, want degraded after binding", got)
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
	if !strings.Contains(preview.PromptSummary, "Local recall index is missing.") || !strings.Contains(preview.PromptSummary, "External durable adapter stub is not configured.") {
		t.Fatalf("preview summary missing provider degraded notes:\n%s", preview.PromptSummary)
	}
	if strings.Contains(preview.PromptSummary, "优先给 exact-head reviewer verdict 和 scope-local blocker。") {
		t.Fatalf("preview summary = %q, should not fall back to stale Claude Review Runner prompt", preview.PromptSummary)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reload) error = %v", err)
	}
	reloadedPreview := findMemoryPreviewBySession(reloaded.MemoryCenter().Previews, "session-runtime")
	if reloadedPreview == nil {
		t.Fatalf("reloaded session-runtime preview missing: %#v", reloaded.MemoryCenter().Previews)
	}
	if got := findMemoryProviderByKind(reloadedPreview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusDegraded {
		t.Fatalf("reloaded preview search provider = %#v, want persisted degraded provider", got)
	}
	if got := findMemoryProviderByKind(reloadedPreview.Providers, memoryProviderKindExternalPersistent); got == nil || got.Status != memoryProviderStatusDegraded {
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

func TestMemoryCenterPreviewSurfacesFormalHandoffContinuation(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, _, err := s.UpdateMemoryProviders(sampleMemoryProviderBindings(), "Larkspur"); err != nil {
		t.Fatalf("UpdateMemoryProviders() error = %v", err)
	}

	_, handoff, err := s.CreateHandoff(MailboxCreateInput{
		RoomID:      "room-runtime",
		FromAgentID: "agent-codex-dockmaster",
		ToAgentID:   "agent-claude-review-runner",
		Title:       "接住 reviewer lane",
		Summary:     "请正式接住 reviewer lane，并继续把当前房间往前推。",
		Kind:        handoffKindGoverned,
	})
	if err != nil {
		t.Fatalf("CreateHandoff(governed) error = %v", err)
	}

	if _, _, err := s.AdvanceHandoff(handoff.ID, MailboxUpdateInput{
		Action:        "acknowledged",
		ActingAgentID: "agent-claude-review-runner",
	}); err != nil {
		t.Fatalf("AdvanceHandoff(acknowledged) error = %v", err)
	}

	preview := findMemoryPreviewBySession(s.MemoryCenter().Previews, "session-runtime")
	if preview == nil {
		t.Fatalf("session-runtime preview missing")
	}
	if !strings.Contains(preview.PromptSummary, "Handoff continuity: Claude Review Runner 已正式接棒当前房间。") {
		t.Fatalf("preview summary = %q, want formal handoff continuity headline", preview.PromptSummary)
	}
	if !strings.Contains(preview.PromptSummary, "Auto-followup: 等待 Claude Review Runner 自动继续当前房间。") {
		t.Fatalf("preview summary = %q, want durable auto-followup summary", preview.PromptSummary)
	}
}

func TestMemoryProviderHealthCheckAndRecoveryLifecycle(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	if _, _, _, err := s.UpdateMemoryProviders(sampleMemoryProviderBindings(), "Larkspur"); err != nil {
		t.Fatalf("UpdateMemoryProviders() error = %v", err)
	}

	_, checkedProviders, _, err := s.CheckMemoryProviders(memoryProviderKindSearchSidecar, "Larkspur")
	if err != nil {
		t.Fatalf("CheckMemoryProviders(search-sidecar) error = %v", err)
	}
	searchChecked := findMemoryProviderByKind(checkedProviders, memoryProviderKindSearchSidecar)
	if searchChecked == nil || searchChecked.LastCheckSource != "manual-check" || searchChecked.FailureCount != 1 || len(searchChecked.Activity) == 0 {
		t.Fatalf("search checked provider = %#v, want manual-check ledger entry", searchChecked)
	}

	_, recoveredSearch, _, err := s.RecoverMemoryProvider(memoryProviderKindSearchSidecar, "Larkspur")
	if err != nil {
		t.Fatalf("RecoverMemoryProvider(search-sidecar) error = %v", err)
	}
	if recoveredSearch.Status != memoryProviderStatusHealthy || recoveredSearch.LastRecoverySummary == "" || recoveredSearch.LastCheckSource != "recovery-verify" {
		t.Fatalf("recovered search provider = %#v, want healthy recovery-verified provider", recoveredSearch)
	}

	_, recoveredExternal, _, err := s.RecoverMemoryProvider(memoryProviderKindExternalPersistent, "Larkspur")
	if err != nil {
		t.Fatalf("RecoverMemoryProvider(external-persistent) error = %v", err)
	}
	if recoveredExternal.Status != memoryProviderStatusHealthy || recoveredExternal.LastRecoverySummary == "" || !strings.Contains(recoveredExternal.NextAction, "real remote durable sink") {
		t.Fatalf("recovered external provider = %#v, want healthy local relay stub with next action", recoveredExternal)
	}

	workspaceMemoryPath := filepath.Join(root, "MEMORY.md")
	if err := os.Remove(workspaceMemoryPath); err != nil {
		t.Fatalf("Remove(MEMORY.md) error = %v", err)
	}

	_, checkedWorkspaceProviders, _, err := s.CheckMemoryProviders(memoryProviderKindWorkspaceFile, "Larkspur")
	if err != nil {
		t.Fatalf("CheckMemoryProviders(workspace-file) error = %v", err)
	}
	workspaceChecked := findMemoryProviderByKind(checkedWorkspaceProviders, memoryProviderKindWorkspaceFile)
	if workspaceChecked == nil || workspaceChecked.Status != memoryProviderStatusDegraded || workspaceChecked.LastError == "" {
		t.Fatalf("workspace checked provider = %#v, want degraded missing scaffold", workspaceChecked)
	}

	_, recoveredWorkspace, finalCenter, err := s.RecoverMemoryProvider(memoryProviderKindWorkspaceFile, "Larkspur")
	if err != nil {
		t.Fatalf("RecoverMemoryProvider(workspace-file) error = %v", err)
	}
	if recoveredWorkspace.Status != memoryProviderStatusHealthy || recoveredWorkspace.LastRecoverySummary == "" {
		t.Fatalf("recovered workspace provider = %#v, want healthy recovered scaffold", recoveredWorkspace)
	}
	if _, err := os.Stat(workspaceMemoryPath); err != nil {
		t.Fatalf("workspace MEMORY.md not restored: %v", err)
	}

	preview := findMemoryPreviewBySession(finalCenter.Previews, "session-memory")
	if preview == nil {
		t.Fatalf("session-memory preview missing after recovery")
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("preview search provider after recovery = %#v, want healthy", got)
	}
	if got := findMemoryProviderByKind(preview.Providers, memoryProviderKindExternalPersistent); got == nil || got.Status != memoryProviderStatusHealthy {
		t.Fatalf("preview external provider after recovery = %#v, want healthy", got)
	}
	if !strings.Contains(preview.PromptSummary, "External durable adapter stub is configured in local relay mode.") ||
		!strings.Contains(preview.PromptSummary, "Search sidecar index ready") {
		t.Fatalf("prompt summary missing recovered provider health notes:\n%s", preview.PromptSummary)
	}

	reloaded, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New(reload) error = %v", err)
	}
	reloadedCenter := reloaded.MemoryCenter()
	if got := findMemoryProviderByKind(reloadedCenter.Providers, memoryProviderKindSearchSidecar); got == nil || got.Status != memoryProviderStatusHealthy || len(got.Activity) < 2 {
		t.Fatalf("reloaded search provider = %#v, want persisted healthy provider with activity", got)
	}
	if got := findMemoryProviderByKind(reloadedCenter.Providers, memoryProviderKindExternalPersistent); got == nil || got.Status != memoryProviderStatusHealthy || got.LastRecoverySummary == "" {
		t.Fatalf("reloaded external provider = %#v, want persisted healthy relay stub", got)
	}
	if got := findMemoryProviderByKind(reloadedCenter.Providers, memoryProviderKindWorkspaceFile); got == nil || got.Status != memoryProviderStatusHealthy || got.LastRecoverySummary == "" {
		t.Fatalf("reloaded workspace provider = %#v, want persisted recovered scaffold", got)
	}
}

func sampleMemoryProviderBindings() []MemoryProviderBinding {
	return []MemoryProviderBinding{
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
