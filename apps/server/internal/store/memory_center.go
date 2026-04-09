package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	memoryPolicyModeBalanced      = "balanced"
	memoryPolicyModeGovernedFirst = "governed-first"

	memoryPromotionKindSkill  = "skill"
	memoryPromotionKindPolicy = "policy"

	memoryPromotionStatusPending  = "pending_review"
	memoryPromotionStatusApproved = "approved"
	memoryPromotionStatusRejected = "rejected"

	memoryCleanupStatusCleaned   = "cleaned"
	memoryCleanupStatusNoChanges = "no_changes"

	defaultMemoryPolicyMaxItems = 6
	maxMemoryPolicyMaxItems     = 12

	memoryCleanupPendingTTL       = 72 * time.Hour
	memoryCleanupRejectedTTL      = 14 * 24 * time.Hour
	maxMemoryCleanupLedgerEntries = 8
)

var (
	ErrMemoryPolicyModeInvalid      = errors.New("memory policy mode is invalid")
	ErrMemoryPolicyMaxItemsInvalid  = errors.New("memory policy maxItems is invalid")
	ErrMemoryArtifactNotFound       = errors.New("memory artifact not found")
	ErrMemoryPromotionKindInvalid   = errors.New("memory promotion kind is invalid")
	ErrMemoryPromotionTitleRequired = errors.New("memory promotion title is required")
	ErrMemoryPromotionNotFound      = errors.New("memory promotion not found")
	ErrMemoryPromotionReviewInvalid = errors.New("memory promotion review decision is invalid")
)

type MemoryInjectionPolicy struct {
	Mode                     string `json:"mode"`
	IncludeRoomNotes         bool   `json:"includeRoomNotes"`
	IncludeDecisionLedger    bool   `json:"includeDecisionLedger"`
	IncludeAgentMemory       bool   `json:"includeAgentMemory"`
	IncludePromotedArtifacts bool   `json:"includePromotedArtifacts"`
	MaxItems                 int    `json:"maxItems"`
	UpdatedAt                string `json:"updatedAt"`
	UpdatedBy                string `json:"updatedBy"`
}

type MemoryInjectionPreviewItem struct {
	ArtifactID  string           `json:"artifactId"`
	Path        string           `json:"path"`
	Scope       string           `json:"scope"`
	Kind        string           `json:"kind"`
	Version     int              `json:"version"`
	Summary     string           `json:"summary"`
	LatestWrite string           `json:"latestWrite,omitempty"`
	Reason      string           `json:"reason"`
	Snippet     string           `json:"snippet,omitempty"`
	Required    bool             `json:"required"`
	Governance  MemoryGovernance `json:"governance"`
}

type MemoryInjectionPreview struct {
	ID            string                       `json:"id"`
	SessionID     string                       `json:"sessionId"`
	RunID         string                       `json:"runId"`
	RoomID        string                       `json:"roomId"`
	IssueKey      string                       `json:"issueKey"`
	Title         string                       `json:"title"`
	RecallPolicy  string                       `json:"recallPolicy"`
	PromptSummary string                       `json:"promptSummary"`
	Files         []string                     `json:"files"`
	Tools         []string                     `json:"tools"`
	Items         []MemoryInjectionPreviewItem `json:"items"`
}

type MemoryPromotion struct {
	ID             string `json:"id"`
	MemoryID       string `json:"memoryId"`
	SourcePath     string `json:"sourcePath"`
	SourceScope    string `json:"sourceScope"`
	SourceVersion  int    `json:"sourceVersion"`
	SourceSummary  string `json:"sourceSummary"`
	Excerpt        string `json:"excerpt,omitempty"`
	Kind           string `json:"kind"`
	Title          string `json:"title"`
	Rationale      string `json:"rationale"`
	Status         string `json:"status"`
	TargetPath     string `json:"targetPath"`
	TargetMemoryID string `json:"targetMemoryId,omitempty"`
	ProposedBy     string `json:"proposedBy"`
	ProposedAt     string `json:"proposedAt"`
	ReviewedBy     string `json:"reviewedBy,omitempty"`
	ReviewedAt     string `json:"reviewedAt,omitempty"`
	ReviewNote     string `json:"reviewNote,omitempty"`
}

type MemoryCleanupStats struct {
	DedupedPending         int `json:"dedupedPending"`
	SupersededPending      int `json:"supersededPending"`
	ForgottenSourcePending int `json:"forgottenSourcePending"`
	ExpiredPending         int `json:"expiredPending"`
	ExpiredRejected        int `json:"expiredRejected"`
	OrphanedPromotions     int `json:"orphanedPromotions"`
	TotalRemoved           int `json:"totalRemoved"`
}

type MemoryCleanupRun struct {
	ID          string             `json:"id"`
	TriggeredAt string             `json:"triggeredAt"`
	TriggeredBy string             `json:"triggeredBy"`
	Status      string             `json:"status"`
	Summary     string             `json:"summary"`
	Recovery    string             `json:"recovery"`
	Stats       MemoryCleanupStats `json:"stats"`
}

type MemoryCleanupState struct {
	LastRunAt    string             `json:"lastRunAt,omitempty"`
	LastRunBy    string             `json:"lastRunBy,omitempty"`
	LastStatus   string             `json:"lastStatus,omitempty"`
	LastSummary  string             `json:"lastSummary,omitempty"`
	LastRecovery string             `json:"lastRecovery,omitempty"`
	LastStats    MemoryCleanupStats `json:"lastStats"`
	Ledger       []MemoryCleanupRun `json:"ledger"`
}

type MemoryCenter struct {
	Policy        MemoryInjectionPolicy    `json:"policy"`
	Previews      []MemoryInjectionPreview `json:"previews"`
	Promotions    []MemoryPromotion        `json:"promotions"`
	Cleanup       MemoryCleanupState       `json:"cleanup"`
	PendingCount  int                      `json:"pendingCount"`
	ApprovedCount int                      `json:"approvedCount"`
	RejectedCount int                      `json:"rejectedCount"`
}

type MemoryPolicyInput struct {
	Mode                     string
	IncludeRoomNotes         bool
	IncludeDecisionLedger    bool
	IncludeAgentMemory       bool
	IncludePromotedArtifacts bool
	MaxItems                 int
	UpdatedBy                string
}

type MemoryPromotionRequestInput struct {
	MemoryID      string
	SourceVersion int
	Kind          string
	Title         string
	Rationale     string
	ProposedBy    string
}

type MemoryPromotionReviewInput struct {
	Status     string
	ReviewNote string
	ReviewedBy string
}

type memoryCenterStateFile struct {
	Policy     MemoryInjectionPolicy `json:"policy"`
	Promotions []MemoryPromotion     `json:"promotions"`
	Cleanup    MemoryCleanupState    `json:"cleanup"`
}

func defaultMemoryCenterState(now string) memoryCenterStateFile {
	return memoryCenterStateFile{
		Policy: MemoryInjectionPolicy{
			Mode:                     memoryPolicyModeGovernedFirst,
			IncludeRoomNotes:         true,
			IncludeDecisionLedger:    true,
			IncludeAgentMemory:       false,
			IncludePromotedArtifacts: true,
			MaxItems:                 defaultMemoryPolicyMaxItems,
			UpdatedAt:                now,
			UpdatedBy:                "System",
		},
		Promotions: []MemoryPromotion{},
		Cleanup: MemoryCleanupState{
			Ledger: []MemoryCleanupRun{},
		},
	}
}

func normalizeMemoryPolicyMode(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryPolicyModeBalanced:
		return memoryPolicyModeBalanced, nil
	case memoryPolicyModeGovernedFirst:
		return memoryPolicyModeGovernedFirst, nil
	default:
		return "", ErrMemoryPolicyModeInvalid
	}
}

func normalizeMemoryPolicyMaxItems(value int) (int, error) {
	if value < 1 || value > maxMemoryPolicyMaxItems {
		return 0, ErrMemoryPolicyMaxItemsInvalid
	}
	return value, nil
}

func normalizeMemoryPromotionKind(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryPromotionKindSkill:
		return memoryPromotionKindSkill, nil
	case memoryPromotionKindPolicy:
		return memoryPromotionKindPolicy, nil
	default:
		return "", ErrMemoryPromotionKindInvalid
	}
}

func normalizeMemoryPromotionReviewStatus(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryPromotionStatusApproved:
		return memoryPromotionStatusApproved, nil
	case memoryPromotionStatusRejected:
		return memoryPromotionStatusRejected, nil
	default:
		return "", ErrMemoryPromotionReviewInvalid
	}
}

func normalizeMemoryCleanupStatus(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryCleanupStatusCleaned:
		return memoryCleanupStatusCleaned
	default:
		return memoryCleanupStatusNoChanges
	}
}

func memoryPromotionTargetPath(kind string) string {
	if kind == memoryPromotionKindPolicy {
		return filepath.ToSlash(filepath.Join("notes", "policies.md"))
	}
	return filepath.ToSlash(filepath.Join("notes", "skills.md"))
}

func (s *Store) memoryCenterStatePathLocked() string {
	return filepath.Join(filepath.Dir(s.path), "memory-center.json")
}

func (s *Store) loadMemoryCenterStateLocked() (memoryCenterStateFile, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	defaults := defaultMemoryCenterState(now)

	body, err := os.ReadFile(s.memoryCenterStatePathLocked())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return s.normalizeMemoryCenterStateLocked(defaults), nil
		}
		return memoryCenterStateFile{}, err
	}
	if strings.TrimSpace(string(body)) == "" {
		return s.normalizeMemoryCenterStateLocked(defaults), nil
	}

	var state memoryCenterStateFile
	if err := json.Unmarshal(body, &state); err != nil {
		return memoryCenterStateFile{}, err
	}
	return s.normalizeMemoryCenterStateLocked(state), nil
}

func (s *Store) saveMemoryCenterStateLocked(state memoryCenterStateFile) error {
	body, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	path := s.memoryCenterStatePathLocked()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
}

func (s *Store) normalizeMemoryCenterStateLocked(state memoryCenterStateFile) memoryCenterStateFile {
	now := time.Now().UTC().Format(time.RFC3339)
	defaults := defaultMemoryCenterState(now)

	mode, err := normalizeMemoryPolicyMode(state.Policy.Mode)
	if err != nil {
		mode = defaults.Policy.Mode
	}
	maxItems, err := normalizeMemoryPolicyMaxItems(state.Policy.MaxItems)
	if err != nil {
		maxItems = defaults.Policy.MaxItems
	}
	state.Policy.Mode = mode
	state.Policy.MaxItems = maxItems
	state.Policy.UpdatedAt = defaultString(strings.TrimSpace(state.Policy.UpdatedAt), defaults.Policy.UpdatedAt)
	state.Policy.UpdatedBy = defaultString(strings.TrimSpace(state.Policy.UpdatedBy), defaults.Policy.UpdatedBy)

	normalizedPromotions := make([]MemoryPromotion, 0, len(state.Promotions))
	for _, item := range state.Promotions {
		kind, err := normalizeMemoryPromotionKind(item.Kind)
		if err != nil {
			continue
		}
		status := strings.TrimSpace(strings.ToLower(item.Status))
		switch status {
		case "":
			status = memoryPromotionStatusPending
		case memoryPromotionStatusPending, memoryPromotionStatusApproved, memoryPromotionStatusRejected:
		default:
			status = memoryPromotionStatusPending
		}
		title := strings.TrimSpace(item.Title)
		if title == "" {
			continue
		}

		item.ID = defaultString(strings.TrimSpace(item.ID), fmt.Sprintf("memory-promotion-%s", slugify(kind+"-"+title)))
		item.Kind = kind
		item.Status = status
		item.Title = title
		item.TargetPath = defaultString(strings.TrimSpace(item.TargetPath), memoryPromotionTargetPath(kind))
		item.SourcePath = filepath.ToSlash(strings.TrimSpace(item.SourcePath))
		item.SourceScope = strings.TrimSpace(item.SourceScope)
		item.SourceSummary = strings.TrimSpace(item.SourceSummary)
		item.Rationale = strings.TrimSpace(item.Rationale)
		item.ProposedBy = defaultString(strings.TrimSpace(item.ProposedBy), "System")
		item.ProposedAt = defaultString(strings.TrimSpace(item.ProposedAt), now)
		item.ReviewedBy = strings.TrimSpace(item.ReviewedBy)
		item.ReviewedAt = strings.TrimSpace(item.ReviewedAt)
		item.ReviewNote = strings.TrimSpace(item.ReviewNote)
		item.Excerpt = strings.TrimSpace(item.Excerpt)
		normalizedPromotions = append(normalizedPromotions, item)
	}

	sort.SliceStable(normalizedPromotions, func(i, j int) bool {
		if normalizedPromotions[i].Status != normalizedPromotions[j].Status {
			return memoryPromotionStatusRank(normalizedPromotions[i].Status) < memoryPromotionStatusRank(normalizedPromotions[j].Status)
		}
		if normalizedPromotions[i].ProposedAt != normalizedPromotions[j].ProposedAt {
			return normalizedPromotions[i].ProposedAt > normalizedPromotions[j].ProposedAt
		}
		return normalizedPromotions[i].Title < normalizedPromotions[j].Title
	})

	state.Promotions = normalizedPromotions
	state.Cleanup = normalizeMemoryCleanupState(state.Cleanup, now)
	return state
}

func normalizeMemoryCleanupState(state MemoryCleanupState, now string) MemoryCleanupState {
	state.LastRunAt = strings.TrimSpace(state.LastRunAt)
	state.LastRunBy = strings.TrimSpace(state.LastRunBy)
	state.LastStatus = normalizeMemoryCleanupStatus(state.LastStatus)
	state.LastSummary = strings.TrimSpace(state.LastSummary)
	state.LastRecovery = strings.TrimSpace(state.LastRecovery)
	state.LastStats.TotalRemoved = memoryCleanupTotalRemoved(state.LastStats)

	normalizedLedger := make([]MemoryCleanupRun, 0, len(state.Ledger))
	for _, entry := range state.Ledger {
		if normalized, ok := normalizeMemoryCleanupRun(entry, now); ok {
			normalizedLedger = append(normalizedLedger, normalized)
		}
	}
	sort.SliceStable(normalizedLedger, func(i, j int) bool {
		if normalizedLedger[i].TriggeredAt != normalizedLedger[j].TriggeredAt {
			return normalizedLedger[i].TriggeredAt > normalizedLedger[j].TriggeredAt
		}
		return normalizedLedger[i].ID < normalizedLedger[j].ID
	})
	if len(normalizedLedger) > maxMemoryCleanupLedgerEntries {
		normalizedLedger = normalizedLedger[:maxMemoryCleanupLedgerEntries]
	}
	state.Ledger = normalizedLedger

	if state.LastRunAt == "" && len(state.Ledger) > 0 {
		state.LastRunAt = state.Ledger[0].TriggeredAt
		state.LastRunBy = state.Ledger[0].TriggeredBy
		state.LastStatus = state.Ledger[0].Status
		state.LastSummary = state.Ledger[0].Summary
		state.LastRecovery = state.Ledger[0].Recovery
		state.LastStats = state.Ledger[0].Stats
	}
	if state.LastStatus == "" {
		state.LastStatus = memoryCleanupStatusNoChanges
	}
	if state.LastSummary == "" && state.LastRunAt != "" {
		state.LastSummary = "cleanup run recorded"
	}
	if state.LastRecovery == "" && state.LastRunAt != "" {
		state.LastRecovery = "queue already aligned; current promotions can proceed to review."
	}
	return state
}

func normalizeMemoryCleanupRun(entry MemoryCleanupRun, now string) (MemoryCleanupRun, bool) {
	entry.TriggeredAt = defaultString(strings.TrimSpace(entry.TriggeredAt), now)
	entry.TriggeredBy = defaultString(strings.TrimSpace(entry.TriggeredBy), "System")
	entry.Status = normalizeMemoryCleanupStatus(entry.Status)
	entry.Summary = strings.TrimSpace(entry.Summary)
	entry.Recovery = strings.TrimSpace(entry.Recovery)
	entry.Stats.TotalRemoved = memoryCleanupTotalRemoved(entry.Stats)
	if entry.Summary == "" && entry.Stats.TotalRemoved == 0 {
		return MemoryCleanupRun{}, false
	}
	if entry.Summary == "" {
		entry.Summary = "cleanup run recorded"
	}
	if entry.Recovery == "" {
		entry.Recovery = "queue already aligned; current promotions can proceed to review."
	}
	entry.ID = defaultString(strings.TrimSpace(entry.ID), fmt.Sprintf("memory-cleanup-%s", slugify(entry.TriggeredAt+"-"+entry.Summary)))
	return entry, true
}

func memoryCleanupTotalRemoved(stats MemoryCleanupStats) int {
	return stats.DedupedPending +
		stats.SupersededPending +
		stats.ForgottenSourcePending +
		stats.ExpiredPending +
		stats.ExpiredRejected +
		stats.OrphanedPromotions
}

func memoryPromotionStatusRank(status string) int {
	switch status {
	case memoryPromotionStatusPending:
		return 0
	case memoryPromotionStatusApproved:
		return 1
	default:
		return 2
	}
}

func memoryModeLabel(policy MemoryInjectionPolicy) string {
	mode := "balanced"
	if policy.Mode == memoryPolicyModeGovernedFirst {
		mode = "governed-first"
	}

	parts := []string{
		"MEMORY.md + notes/ + decisions/",
		mode,
	}
	if policy.IncludePromotedArtifacts {
		parts = append(parts, "promoted-ledgers")
	}
	return strings.Join(parts, " / ")
}

func (s *Store) MemoryCenter() MemoryCenter {
	snapshot := s.Snapshot()

	s.mu.RLock()
	state, err := s.loadMemoryCenterStateLocked()
	s.mu.RUnlock()
	if err != nil {
		state = defaultMemoryCenterState(time.Now().UTC().Format(time.RFC3339))
	}

	return buildMemoryCenter(snapshot, state)
}

func buildMemoryCenter(snapshot State, state memoryCenterStateFile) MemoryCenter {
	center := MemoryCenter{
		Policy:     state.Policy,
		Previews:   buildMemoryInjectionPreviews(snapshot, state.Policy),
		Promotions: append([]MemoryPromotion{}, state.Promotions...),
		Cleanup:    state.Cleanup,
	}

	for _, promotion := range state.Promotions {
		switch promotion.Status {
		case memoryPromotionStatusApproved:
			center.ApprovedCount++
		case memoryPromotionStatusRejected:
			center.RejectedCount++
		default:
			center.PendingCount++
		}
	}

	return center
}

func buildMemoryInjectionPreviews(snapshot State, policy MemoryInjectionPolicy) []MemoryInjectionPreview {
	previews := make([]MemoryInjectionPreview, 0, len(snapshot.Sessions))
	for _, session := range snapshot.Sessions {
		previews = append(previews, buildMemoryInjectionPreview(snapshot, policy, session))
	}
	return previews
}

func buildMemoryInjectionPreview(snapshot State, policy MemoryInjectionPolicy, session Session) MemoryInjectionPreview {
	type candidate struct {
		path     string
		reason   string
		required bool
	}

	run := findRunForSession(snapshot, session.ID, session.ActiveRunID)
	var agent *Agent
	if run != nil {
		if found, ok := findAgentByOwner(snapshot, run.Owner); ok {
			agent = &found
		}
	}

	candidates := []candidate{}
	seen := map[string]bool{}
	addCandidate := func(path, reason string, required bool) {
		path = filepath.ToSlash(strings.TrimSpace(path))
		if path == "" || seen[path] {
			return
		}
		seen[path] = true
		candidates = append(candidates, candidate{
			path:     path,
			reason:   reason,
			required: required,
		})
	}

	for _, path := range session.MemoryPaths {
		if !shouldIncludeSessionMemoryPath(path, policy) {
			continue
		}
		if agent != nil && !agentAllowsMemoryPath(*agent, path) {
			continue
		}
		addCandidate(path, "session recall path", true)
	}

	if run != nil && (policy.IncludeAgentMemory || (agent != nil && agentWantsAgentMemory(*agent, policy))) {
		agentSlug := slugify(run.Owner)
		if agentSlug != "" {
			addCandidate(filepath.ToSlash(filepath.Join(".openshock", "agents", agentSlug, "MEMORY.md")), "owner agent memory", false)
		}
	}

	if policy.IncludePromotedArtifacts {
		addCandidate(filepath.ToSlash(filepath.Join("notes", "skills.md")), "approved skill ledger", false)
		addCandidate(filepath.ToSlash(filepath.Join("notes", "policies.md")), "approved policy ledger", false)
	}

	items := make([]MemoryInjectionPreviewItem, 0, len(candidates))
	for _, candidate := range candidates {
		artifact := findMemoryArtifactByPathInSnapshot(snapshot, candidate.path)
		if artifact == nil {
			continue
		}
		if artifact.Forgotten {
			continue
		}
		version := latestMemoryArtifactVersion(snapshot, artifact.ID)
		items = append(items, MemoryInjectionPreviewItem{
			ArtifactID:  artifact.ID,
			Path:        artifact.Path,
			Scope:       artifact.Scope,
			Kind:        artifact.Kind,
			Version:     artifact.Version,
			Summary:     artifact.Summary,
			LatestWrite: artifact.LatestWrite,
			Reason:      candidate.reason,
			Snippet:     memoryContentSnippet(version.Content),
			Required:    candidate.required,
			Governance:  artifact.Governance,
		})
	}

	sortMemoryPreviewItems(items, policy.Mode)
	items = trimMemoryPreviewItems(items, policy.MaxItems)

	files := make([]string, 0, len(items))
	for _, item := range items {
		files = append(files, item.Path)
	}

	title := defaultString(strings.TrimSpace(session.IssueKey), session.ID)
	if session.RoomID != "" {
		title = title + " / " + session.RoomID
	}

	tools := []string{
		"memory.search",
		"memory.get",
		"memory.write",
		"memory.feedback",
		"memory.forget",
		"memory.promote",
	}

	return MemoryInjectionPreview{
		ID:            session.ID,
		SessionID:     session.ID,
		RunID:         session.ActiveRunID,
		RoomID:        session.RoomID,
		IssueKey:      session.IssueKey,
		Title:         title,
		RecallPolicy:  fmt.Sprintf("%s / max %d items / room:%t / decision:%t / agent:%t / promoted:%t", policy.Mode, policy.MaxItems, policy.IncludeRoomNotes, policy.IncludeDecisionLedger, policy.IncludeAgentMemory, policy.IncludePromotedArtifacts),
		PromptSummary: buildMemoryPromptSummary(policy, session, items, agent),
		Files:         files,
		Tools:         tools,
		Items:         items,
	}
}

func shouldIncludeSessionMemoryPath(path string, policy MemoryInjectionPolicy) bool {
	path = filepath.ToSlash(strings.TrimSpace(path))
	switch {
	case path == "MEMORY.md":
		return true
	case path == filepath.ToSlash(filepath.Join("notes", "work-log.md")):
		return true
	case strings.HasPrefix(path, filepath.ToSlash(filepath.Join("notes", "rooms"))+"/"):
		return policy.IncludeRoomNotes
	case strings.HasPrefix(path, filepath.ToSlash("decisions")+"/"):
		return policy.IncludeDecisionLedger
	default:
		return true
	}
}

func sortMemoryPreviewItems(items []MemoryInjectionPreviewItem, mode string) {
	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if left.Required != right.Required {
			return left.Required
		}
		if mode == memoryPolicyModeGovernedFirst && left.Governance.RequiresReview != right.Governance.RequiresReview {
			return left.Governance.RequiresReview
		}
		leftPriority := memoryPreviewKindPriority(left.Kind)
		rightPriority := memoryPreviewKindPriority(right.Kind)
		if leftPriority != rightPriority {
			return leftPriority < rightPriority
		}
		if left.Scope != right.Scope {
			return left.Scope < right.Scope
		}
		return left.Path < right.Path
	})
}

func memoryPreviewKindPriority(kind string) int {
	switch kind {
	case "policy-ledger":
		return 0
	case "decision", "skill-ledger":
		return 1
	case "memory":
		return 2
	case "room-note":
		return 3
	default:
		return 4
	}
}

func trimMemoryPreviewItems(items []MemoryInjectionPreviewItem, maxItems int) []MemoryInjectionPreviewItem {
	if maxItems <= 0 || len(items) <= maxItems {
		return items
	}

	requiredCount := 0
	for _, item := range items {
		if item.Required {
			requiredCount++
		}
	}
	if requiredCount >= maxItems {
		return items[:requiredCount]
	}

	trimmed := append([]MemoryInjectionPreviewItem{}, items[:requiredCount]...)
	remaining := maxItems - requiredCount
	if remaining > len(items[requiredCount:]) {
		remaining = len(items[requiredCount:])
	}
	trimmed = append(trimmed, items[requiredCount:requiredCount+remaining]...)
	return trimmed
}

func buildMemoryPromptSummary(policy MemoryInjectionPolicy, session Session, items []MemoryInjectionPreviewItem, agent *Agent) string {
	lines := []string{}
	if agent != nil {
		lines = append(lines,
			fmt.Sprintf(
				"Agent `%s` profile => role:`%s` / avatar:`%s` / provider:`%s` / model:`%s` / runtime:`%s` / recall:`%s` / binding:`%s`.",
				defaultString(strings.TrimSpace(agent.Name), "unknown"),
				defaultString(strings.TrimSpace(agent.Role), "unassigned"),
				defaultString(strings.TrimSpace(agent.Avatar), "unset"),
				defaultString(strings.TrimSpace(agent.ProviderPreference), defaultString(strings.TrimSpace(agent.Provider), "unset")),
				defaultString(strings.TrimSpace(agent.ModelPreference), "unset"),
				defaultString(strings.TrimSpace(agent.RuntimePreference), "unset"),
				defaultString(strings.TrimSpace(agent.RecallPolicy), "unset"),
				strings.Join(agent.MemorySpaces, ", "),
			),
		)
		if prompt := strings.TrimSpace(agent.Prompt); prompt != "" {
			lines = append(lines, fmt.Sprintf("Prompt skeleton: %s", summarizeMemoryPromptLine(prompt)))
		}
		if instructions := strings.TrimSpace(agent.OperatingInstructions); instructions != "" {
			lines = append(lines, fmt.Sprintf("Operating instructions: %s", summarizeMemoryPromptLine(instructions)))
		}
	}

	if len(items) == 0 {
		lines = append(lines, "当前 session 还没有可注入的 governed memory。")
		return strings.Join(lines, "\n")
	}

	lines = append(lines,
		fmt.Sprintf("Session `%s` 采用 `%s` recall policy，优先注入 %d 份 governed artifacts。", defaultString(strings.TrimSpace(session.ID), "unknown"), policy.Mode, len(items)),
	)

	for index, item := range items {
		if index >= 4 {
			lines = append(lines, fmt.Sprintf("其余 %d 项继续通过 memory.search / memory.get 按需展开。", len(items)-index))
			break
		}
		summary := defaultString(strings.TrimSpace(item.LatestWrite), item.Summary)
		lines = append(lines, fmt.Sprintf("%d. `%s` (%s) -> %s", index+1, item.Path, item.Kind, summary))
	}

	return strings.Join(lines, "\n")
}

func summarizeMemoryPromptLine(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\n", " "))
	if len(value) <= 120 {
		return value
	}
	return strings.TrimSpace(value[:117]) + "..."
}

func memoryContentSnippet(content string) string {
	lines := strings.Split(strings.TrimSpace(content), "\n")
	snippet := []string{}
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(line, "#"), "-"))
		if line == "" {
			continue
		}
		snippet = append(snippet, line)
		if len(snippet) >= 3 {
			break
		}
	}
	return strings.Join(snippet, " / ")
}

func latestMemoryArtifactVersion(snapshot State, memoryID string) MemoryArtifactVersion {
	versions := snapshot.MemoryVersions[memoryID]
	if len(versions) == 0 {
		return MemoryArtifactVersion{}
	}
	return versions[len(versions)-1]
}

func (s *Store) RunMemoryCleanup(triggeredBy string) (State, MemoryCleanupRun, MemoryCenter, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureMemorySubsystemLocked()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, MemoryCleanupRun{}, MemoryCenter{}, err
	}

	run := s.runMemoryCleanupLocked(&state, defaultString(strings.TrimSpace(triggeredBy), "System"))
	state = s.normalizeMemoryCenterStateLocked(state)
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, MemoryCleanupRun{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, run, buildMemoryCenter(snapshot, state), nil
}

func (s *Store) runMemoryCleanupLocked(state *memoryCenterStateFile, actor string) MemoryCleanupRun {
	now := time.Now().UTC()
	artifactVersions := map[string]int{}
	for _, artifact := range s.state.Memory {
		artifactVersions[artifact.ID] = artifact.Version
	}

	kept := make([]MemoryPromotion, 0, len(state.Promotions))
	seenPending := map[string]bool{}
	stats := MemoryCleanupStats{}

	for _, promotion := range state.Promotions {
		artifact := findMemoryArtifactByIDInSnapshot(s.state, promotion.MemoryID)
		if promotion.Status != memoryPromotionStatusApproved && artifact == nil {
			stats.OrphanedPromotions++
			continue
		}

		switch promotion.Status {
		case memoryPromotionStatusPending:
			if artifact != nil && artifact.Forgotten {
				stats.ForgottenSourcePending++
				continue
			}
			if latestVersion := artifactVersions[promotion.MemoryID]; artifact != nil && latestVersion > promotion.SourceVersion && promotion.SourceVersion > 0 {
				stats.SupersededPending++
				continue
			}
			if memoryCleanupExpired(promotion.ProposedAt, now, memoryCleanupPendingTTL) {
				stats.ExpiredPending++
				continue
			}

			key := memoryPromotionCleanupKey(promotion)
			if seenPending[key] {
				stats.DedupedPending++
				continue
			}
			seenPending[key] = true
		case memoryPromotionStatusRejected:
			if artifact != nil && artifact.Forgotten {
				stats.ForgottenSourcePending++
				continue
			}
			if memoryCleanupExpired(defaultString(strings.TrimSpace(promotion.ReviewedAt), promotion.ProposedAt), now, memoryCleanupRejectedTTL) {
				stats.ExpiredRejected++
				continue
			}
		}

		kept = append(kept, promotion)
	}

	state.Promotions = kept
	stats.TotalRemoved = memoryCleanupTotalRemoved(stats)
	pendingAfter := countPromotionsByStatus(kept, memoryPromotionStatusPending)

	run := MemoryCleanupRun{
		ID:          fmt.Sprintf("memory-cleanup-%d", now.UnixNano()),
		TriggeredAt: now.Format(time.RFC3339),
		TriggeredBy: actor,
		Status:      memoryCleanupStatusNoChanges,
		Summary:     fmt.Sprintf("cleanup noop; %d pending review remain", pendingAfter),
		Recovery:    "queue already aligned; current promotions can proceed to review.",
		Stats:       stats,
	}

	if stats.TotalRemoved > 0 {
		run.Status = memoryCleanupStatusCleaned
		run.Summary = fmt.Sprintf("removed %d stale queue entries; %d pending review remain", stats.TotalRemoved, pendingAfter)
		run.Recovery = buildMemoryCleanupRecovery(stats, pendingAfter)
	} else if pendingAfter > 0 {
		run.Recovery = fmt.Sprintf("%d pending promotion requests remain live; review or promote the newest artifact versions directly.", pendingAfter)
	}

	state.Cleanup.LastRunAt = run.TriggeredAt
	state.Cleanup.LastRunBy = run.TriggeredBy
	state.Cleanup.LastStatus = run.Status
	state.Cleanup.LastSummary = run.Summary
	state.Cleanup.LastRecovery = run.Recovery
	state.Cleanup.LastStats = run.Stats
	state.Cleanup.Ledger = append([]MemoryCleanupRun{run}, state.Cleanup.Ledger...)
	if len(state.Cleanup.Ledger) > maxMemoryCleanupLedgerEntries {
		state.Cleanup.Ledger = state.Cleanup.Ledger[:maxMemoryCleanupLedgerEntries]
	}

	return run
}

func memoryCleanupExpired(value string, now time.Time, ttl time.Duration) bool {
	if ttl <= 0 {
		return false
	}
	recordedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return now.Sub(recordedAt) > ttl
}

func memoryPromotionCleanupKey(promotion MemoryPromotion) string {
	return strings.Join([]string{
		strings.TrimSpace(promotion.MemoryID),
		strings.TrimSpace(promotion.Kind),
		slugify(strings.ToLower(strings.TrimSpace(promotion.Title))),
		filepath.ToSlash(strings.TrimSpace(promotion.TargetPath)),
	}, "|")
}

func countPromotionsByStatus(promotions []MemoryPromotion, status string) int {
	count := 0
	for _, promotion := range promotions {
		if promotion.Status == status {
			count++
		}
	}
	return count
}

func buildMemoryCleanupRecovery(stats MemoryCleanupStats, pendingAfter int) string {
	parts := []string{}
	if stats.DedupedPending > 0 {
		parts = append(parts, fmt.Sprintf("%d duplicate pending request(s) collapsed to the newest exact head", stats.DedupedPending))
	}
	if stats.SupersededPending > 0 {
		parts = append(parts, fmt.Sprintf("%d pending request(s) dropped because the source artifact moved to a newer version", stats.SupersededPending))
	}
	if stats.ForgottenSourcePending > 0 {
		parts = append(parts, fmt.Sprintf("%d request(s) referencing forgotten artifacts were pruned", stats.ForgottenSourcePending))
	}
	if stats.ExpiredPending > 0 || stats.ExpiredRejected > 0 {
		parts = append(parts, fmt.Sprintf("%d expired queue entry(ies) were removed by TTL", stats.ExpiredPending+stats.ExpiredRejected))
	}
	if stats.OrphanedPromotions > 0 {
		parts = append(parts, fmt.Sprintf("%d orphaned queue entry(ies) were removed", stats.OrphanedPromotions))
	}
	if pendingAfter > 0 {
		parts = append(parts, fmt.Sprintf("%d pending review request(s) remain live", pendingAfter))
	}
	if len(parts) == 0 {
		return "queue already aligned; current promotions can proceed to review."
	}
	return strings.Join(parts, " / ") + "."
}

func findMemoryArtifactByPathInSnapshot(snapshot State, path string) *MemoryArtifact {
	path = filepath.ToSlash(strings.TrimSpace(path))
	for index := range snapshot.Memory {
		if snapshot.Memory[index].Path == path {
			return &snapshot.Memory[index]
		}
	}
	return nil
}

func findMemoryArtifactByIDInSnapshot(snapshot State, memoryID string) *MemoryArtifact {
	memoryID = strings.TrimSpace(memoryID)
	for index := range snapshot.Memory {
		if snapshot.Memory[index].ID == memoryID {
			return &snapshot.Memory[index]
		}
	}
	return nil
}

func findRunForSession(snapshot State, sessionID, runID string) *Run {
	runID = strings.TrimSpace(runID)
	for index := range snapshot.Runs {
		if snapshot.Runs[index].ID == runID {
			return &snapshot.Runs[index]
		}
	}
	if strings.TrimSpace(sessionID) == "" {
		return nil
	}
	for index := range snapshot.Sessions {
		if snapshot.Sessions[index].ID != sessionID {
			continue
		}
		runID = snapshot.Sessions[index].ActiveRunID
		break
	}
	for index := range snapshot.Runs {
		if snapshot.Runs[index].ID == runID {
			return &snapshot.Runs[index]
		}
	}
	return nil
}

func (s *Store) UpdateMemoryPolicy(input MemoryPolicyInput) (State, MemoryInjectionPolicy, MemoryCenter, error) {
	mode, err := normalizeMemoryPolicyMode(input.Mode)
	if err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}
	maxItems, err := normalizeMemoryPolicyMaxItems(input.MaxItems)
	if err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}

	state.Policy = MemoryInjectionPolicy{
		Mode:                     mode,
		IncludeRoomNotes:         input.IncludeRoomNotes,
		IncludeDecisionLedger:    input.IncludeDecisionLedger,
		IncludeAgentMemory:       input.IncludeAgentMemory,
		IncludePromotedArtifacts: input.IncludePromotedArtifacts,
		MaxItems:                 maxItems,
		UpdatedAt:                time.Now().UTC().Format(time.RFC3339),
		UpdatedBy:                defaultString(strings.TrimSpace(input.UpdatedBy), "System"),
	}
	state = s.normalizeMemoryCenterStateLocked(state)
	s.state.Workspace.MemoryMode = memoryModeLabel(state.Policy)

	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, state.Policy, buildMemoryCenter(snapshot, state), nil
}

func (s *Store) RequestMemoryPromotion(input MemoryPromotionRequestInput) (State, MemoryPromotion, MemoryCenter, error) {
	kind, err := normalizeMemoryPromotionKind(input.Kind)
	if err != nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, err
	}
	title := strings.TrimSpace(input.Title)
	if title == "" {
		return State{}, MemoryPromotion{}, MemoryCenter{}, ErrMemoryPromotionTitleRequired
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, err
	}

	artifact := findMemoryArtifactByIDInSnapshot(s.state, input.MemoryID)
	if artifact == nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, ErrMemoryArtifactNotFound
	}
	if artifact.Forgotten {
		return State{}, MemoryPromotion{}, MemoryCenter{}, ErrMemoryArtifactForgotten
	}

	version := latestMemoryArtifactVersion(s.state, artifact.ID)
	if input.SourceVersion > 0 {
		found := false
		for _, candidate := range s.state.MemoryVersions[artifact.ID] {
			if candidate.Version == input.SourceVersion {
				version = candidate
				found = true
				break
			}
		}
		if !found {
			return State{}, MemoryPromotion{}, MemoryCenter{}, ErrMemoryArtifactNotFound
		}
	}

	promotion := MemoryPromotion{
		ID:            fmt.Sprintf("memory-promotion-%s-%d", slugify(kind+"-"+title), time.Now().UnixNano()),
		MemoryID:      artifact.ID,
		SourcePath:    artifact.Path,
		SourceScope:   artifact.Scope,
		SourceVersion: version.Version,
		SourceSummary: defaultString(strings.TrimSpace(version.Summary), artifact.Summary),
		Excerpt:       memoryContentSnippet(version.Content),
		Kind:          kind,
		Title:         title,
		Rationale:     strings.TrimSpace(input.Rationale),
		Status:        memoryPromotionStatusPending,
		TargetPath:    memoryPromotionTargetPath(kind),
		ProposedBy:    defaultString(strings.TrimSpace(input.ProposedBy), "System"),
		ProposedAt:    time.Now().UTC().Format(time.RFC3339),
	}

	state.Promotions = append(state.Promotions, promotion)
	state = s.normalizeMemoryCenterStateLocked(state)
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, promotion, buildMemoryCenter(snapshot, state), nil
}

func (s *Store) ReviewMemoryPromotion(promotionID string, input MemoryPromotionReviewInput) (State, MemoryPromotion, MemoryCenter, error) {
	reviewStatus, err := normalizeMemoryPromotionReviewStatus(input.Status)
	if err != nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, err
	}

	index := -1
	for candidate := range state.Promotions {
		if state.Promotions[candidate].ID == strings.TrimSpace(promotionID) {
			index = candidate
			break
		}
	}
	if index == -1 {
		return State{}, MemoryPromotion{}, MemoryCenter{}, ErrMemoryPromotionNotFound
	}

	promotion := state.Promotions[index]
	reviewer := defaultString(strings.TrimSpace(input.ReviewedBy), "System")
	now := time.Now().UTC().Format(time.RFC3339)

	promotion.Status = reviewStatus
	promotion.ReviewNote = strings.TrimSpace(input.ReviewNote)
	promotion.ReviewedBy = reviewer
	promotion.ReviewedAt = now

	if reviewStatus == memoryPromotionStatusApproved {
		absTargetPath := filepath.Join(s.workspaceRoot, filepath.FromSlash(promotion.TargetPath))
		header := "# Skills\n\n"
		if promotion.Kind == memoryPromotionKindPolicy {
			header = "# Policies\n\n"
		}
		if err := ensureFile(absTargetPath, header); err != nil {
			return State{}, MemoryPromotion{}, MemoryCenter{}, err
		}
		if err := appendMarkdown(absTargetPath, buildMemoryPromotionEntry(promotion)); err != nil {
			return State{}, MemoryPromotion{}, MemoryCenter{}, err
		}

		s.recordMemoryArtifactWriteLocked(
			promotion.TargetPath,
			fmt.Sprintf("Promoted %s: %s", promotion.Kind, promotion.Title),
			"memory-promote",
			reviewer,
		)
		if err := s.persistLocked(); err != nil {
			return State{}, MemoryPromotion{}, MemoryCenter{}, err
		}

		if target := findMemoryArtifactByPathInSnapshot(s.state, promotion.TargetPath); target != nil {
			promotion.TargetMemoryID = target.ID
		}
	}

	state.Promotions[index] = promotion
	state = s.normalizeMemoryCenterStateLocked(state)
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, MemoryPromotion{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, promotion, buildMemoryCenter(snapshot, state), nil
}

func buildMemoryPromotionEntry(promotion MemoryPromotion) string {
	lines := []string{
		"",
		fmt.Sprintf("## %s", promotion.Title),
		"",
		fmt.Sprintf("- kind: %s", promotion.Kind),
		fmt.Sprintf("- promoted_from: %s @ v%d", promotion.SourcePath, promotion.SourceVersion),
		fmt.Sprintf("- proposed_by: %s", promotion.ProposedBy),
		fmt.Sprintf("- proposed_at: %s", promotion.ProposedAt),
	}
	if promotion.ReviewedBy != "" {
		lines = append(lines, fmt.Sprintf("- approved_by: %s", promotion.ReviewedBy))
	}
	if promotion.ReviewedAt != "" {
		lines = append(lines, fmt.Sprintf("- approved_at: %s", promotion.ReviewedAt))
	}
	if promotion.Rationale != "" {
		lines = append(lines, fmt.Sprintf("- rationale: %s", promotion.Rationale))
	}
	if promotion.ReviewNote != "" {
		lines = append(lines, fmt.Sprintf("- review_note: %s", promotion.ReviewNote))
	}
	if promotion.SourceSummary != "" {
		lines = append(lines, fmt.Sprintf("- source_summary: %s", promotion.SourceSummary))
	}
	if promotion.Excerpt != "" {
		lines = append(lines, "", "### Source Excerpt", "", fmt.Sprintf("> %s", strings.ReplaceAll(promotion.Excerpt, "\n", "\n> ")))
	}
	return strings.Join(lines, "\n") + "\n"
}
