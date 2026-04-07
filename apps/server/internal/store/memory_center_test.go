package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
