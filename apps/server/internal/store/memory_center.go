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

	memoryProviderKindWorkspaceFile      = "workspace-file"
	memoryProviderKindSearchSidecar      = "search-sidecar"
	memoryProviderKindExternalPersistent = "external-persistent"

	memoryProviderStatusHealthy  = "healthy"
	memoryProviderStatusStandby  = "standby"
	memoryProviderStatusDegraded = "degraded"

	memoryProviderActivityActionCheck    = "check"
	memoryProviderActivityActionRecovery = "recovery"

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
	maxMemoryProviderActivityRuns = 6
)

var (
	ErrMemoryPolicyModeInvalid         = errors.New("memory policy mode is invalid")
	ErrMemoryPolicyMaxItemsInvalid     = errors.New("memory policy maxItems is invalid")
	ErrMemoryArtifactNotFound          = errors.New("memory artifact not found")
	ErrMemoryPromotionKindInvalid      = errors.New("memory promotion kind is invalid")
	ErrMemoryPromotionTitleRequired    = errors.New("memory promotion title is required")
	ErrMemoryPromotionNotFound         = errors.New("memory promotion not found")
	ErrMemoryPromotionReviewInvalid    = errors.New("memory promotion review decision is invalid")
	ErrMemoryProviderBindingsRequired  = errors.New("memory provider bindings are required")
	ErrMemoryProviderKindInvalid       = errors.New("memory provider kind is invalid")
	ErrMemoryProviderScopeInvalid      = errors.New("memory provider scope is invalid")
	ErrMemoryProviderWorkspaceRequired = errors.New("workspace-file provider must stay enabled")
	ErrMemoryProviderNotFound          = errors.New("memory provider not found")
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
	Providers     []MemoryProviderBinding      `json:"providers"`
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
	Due          bool               `json:"due"`
	DueCount     int                `json:"dueCount"`
	NextRunAt    string             `json:"nextRunAt,omitempty"`
}

type MemoryProviderActivityRun struct {
	ID          string `json:"id"`
	Action      string `json:"action"`
	TriggeredAt string `json:"triggeredAt"`
	TriggeredBy string `json:"triggeredBy"`
	Source      string `json:"source,omitempty"`
	Status      string `json:"status"`
	Summary     string `json:"summary"`
	Detail      string `json:"detail,omitempty"`
	NextAction  string `json:"nextAction,omitempty"`
}

type MemoryProviderBinding struct {
	ID                  string                      `json:"id"`
	Label               string                      `json:"label"`
	Kind                string                      `json:"kind"`
	Status              string                      `json:"status"`
	Enabled             bool                        `json:"enabled"`
	ReadScopes          []string                    `json:"readScopes"`
	WriteScopes         []string                    `json:"writeScopes"`
	RecallPolicy        string                      `json:"recallPolicy"`
	RetentionPolicy     string                      `json:"retentionPolicy"`
	SharingPolicy       string                      `json:"sharingPolicy"`
	Summary             string                      `json:"summary"`
	LastSummary         string                      `json:"lastSummary,omitempty"`
	NextAction          string                      `json:"nextAction,omitempty"`
	LastCheckedAt       string                      `json:"lastCheckedAt,omitempty"`
	LastCheckSource     string                      `json:"lastCheckSource,omitempty"`
	LastError           string                      `json:"lastError,omitempty"`
	LastRecoveryAt      string                      `json:"lastRecoveryAt,omitempty"`
	LastRecoveryBy      string                      `json:"lastRecoveryBy,omitempty"`
	LastRecoverySummary string                      `json:"lastRecoverySummary,omitempty"`
	FailureCount        int                         `json:"failureCount,omitempty"`
	Activity            []MemoryProviderActivityRun `json:"activity"`
	UpdatedAt           string                      `json:"updatedAt,omitempty"`
	UpdatedBy           string                      `json:"updatedBy,omitempty"`
}

type MemoryCenter struct {
	Policy        MemoryInjectionPolicy    `json:"policy"`
	Previews      []MemoryInjectionPreview `json:"previews"`
	Providers     []MemoryProviderBinding  `json:"providers"`
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
	Policy     MemoryInjectionPolicy   `json:"policy"`
	Providers  []MemoryProviderBinding `json:"providers"`
	Promotions []MemoryPromotion       `json:"promotions"`
	Cleanup    MemoryCleanupState      `json:"cleanup"`
}

type memoryProviderObservation struct {
	Status     string
	Summary    string
	Detail     string
	LastError  string
	NextAction string
}

type memorySearchSidecarIndexFile struct {
	Version       int      `json:"version"`
	GeneratedAt   string   `json:"generatedAt"`
	ArtifactCount int      `json:"artifactCount"`
	Paths         []string `json:"paths"`
}

type memoryCleanupEvaluation struct {
	kept         []MemoryPromotion
	stats        MemoryCleanupStats
	pendingAfter int
	nextRunAt    string
}

type memoryExternalPersistentAdapterFile struct {
	Version         int      `json:"version"`
	Mode            string   `json:"mode"`
	WorkspaceRoot   string   `json:"workspaceRoot"`
	RelayPath       string   `json:"relayPath"`
	GeneratedAt     string   `json:"generatedAt"`
	RecallPolicy    string   `json:"recallPolicy"`
	RetentionPolicy string   `json:"retentionPolicy"`
	SharingPolicy   string   `json:"sharingPolicy"`
	ReadScopes      []string `json:"readScopes"`
	WriteScopes     []string `json:"writeScopes"`
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
		Providers:  defaultMemoryProviderBindings(now),
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

func defaultMemoryProviderBindings(now string) []MemoryProviderBinding {
	return []MemoryProviderBinding{
		defaultMemoryProviderBinding(memoryProviderKindWorkspaceFile, now),
		defaultMemoryProviderBinding(memoryProviderKindSearchSidecar, now),
		defaultMemoryProviderBinding(memoryProviderKindExternalPersistent, now),
	}
}

func defaultMemoryProviderBinding(kind string, now string) MemoryProviderBinding {
	switch kind {
	case memoryProviderKindWorkspaceFile:
		return MemoryProviderBinding{
			ID:              memoryProviderKindWorkspaceFile,
			Label:           "Workspace File Memory",
			Kind:            memoryProviderKindWorkspaceFile,
			Status:          memoryProviderStatusHealthy,
			Enabled:         true,
			ReadScopes:      []string{"workspace", "issue-room", "room-notes", "decision-ledger", "agent", "promoted-ledger"},
			WriteScopes:     []string{"workspace", "issue-room", "room-notes", "decision-ledger", "agent"},
			RecallPolicy:    "governed-first",
			RetentionPolicy: "保留版本、人工纠偏和提升 ledger。",
			SharingPolicy:   "workspace-governed",
			Summary:         "Primary file-backed memory via MEMORY.md、notes/、decisions/ 和 .openshock/agents。",
			Activity:        []MemoryProviderActivityRun{},
			LastCheckedAt:   now,
			UpdatedAt:       now,
			UpdatedBy:       "System",
		}
	case memoryProviderKindSearchSidecar:
		return MemoryProviderBinding{
			ID:              memoryProviderKindSearchSidecar,
			Label:           "Search Sidecar",
			Kind:            memoryProviderKindSearchSidecar,
			Status:          memoryProviderStatusStandby,
			Enabled:         false,
			ReadScopes:      []string{"workspace", "issue-room", "room-notes", "decision-ledger", "promoted-ledger"},
			WriteScopes:     []string{},
			RecallPolicy:    "search-on-demand",
			RetentionPolicy: "只保留本地 recall index 与短期 query cache。",
			SharingPolicy:   "workspace-query-only",
			Summary:         "Optional local search sidecar over governed file memory; 不向外部持久化写入。",
			Activity:        []MemoryProviderActivityRun{},
			LastCheckedAt:   now,
			UpdatedAt:       now,
			UpdatedBy:       "System",
		}
	case memoryProviderKindExternalPersistent:
		return MemoryProviderBinding{
			ID:              memoryProviderKindExternalPersistent,
			Label:           "External Persistent Memory",
			Kind:            memoryProviderKindExternalPersistent,
			Status:          memoryProviderStatusStandby,
			Enabled:         false,
			ReadScopes:      []string{"workspace", "issue-room", "agent", "user"},
			WriteScopes:     []string{"workspace", "agent", "user"},
			RecallPolicy:    "promote-approved-only",
			RetentionPolicy: "长期保留经治理批准的 durable memory。",
			SharingPolicy:   "explicit-share-only",
			Summary:         "Optional external durable memory binding for cross-run recall and replay exports.",
			Activity:        []MemoryProviderActivityRun{},
			LastCheckedAt:   now,
			UpdatedAt:       now,
			UpdatedBy:       "System",
		}
	default:
		return MemoryProviderBinding{}
	}
}

func normalizeMemoryProviderKind(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryProviderKindWorkspaceFile:
		return memoryProviderKindWorkspaceFile, nil
	case memoryProviderKindSearchSidecar:
		return memoryProviderKindSearchSidecar, nil
	case memoryProviderKindExternalPersistent:
		return memoryProviderKindExternalPersistent, nil
	default:
		return "", ErrMemoryProviderKindInvalid
	}
}

func normalizeMemoryProviderStatus(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryProviderStatusHealthy:
		return memoryProviderStatusHealthy
	case memoryProviderStatusDegraded:
		return memoryProviderStatusDegraded
	default:
		return memoryProviderStatusStandby
	}
}

func normalizeMemoryProviderActivityAction(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case memoryProviderActivityActionRecovery:
		return memoryProviderActivityActionRecovery
	default:
		return memoryProviderActivityActionCheck
	}
}

func normalizeMemoryProviderScopes(values []string, allowEmpty bool) ([]string, error) {
	allowed := map[string]bool{
		"workspace":       true,
		"issue-room":      true,
		"room-notes":      true,
		"decision-ledger": true,
		"promoted-ledger": true,
		"topic":           true,
		"agent":           true,
		"user":            true,
		"run":             true,
		"session":         true,
	}

	seen := map[string]bool{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		item := strings.TrimSpace(strings.ToLower(value))
		if item == "" {
			continue
		}
		if !allowed[item] {
			return nil, fmt.Errorf("%w: %s", ErrMemoryProviderScopeInvalid, item)
		}
		if seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	if len(normalized) == 0 && !allowEmpty {
		return nil, ErrMemoryProviderScopeInvalid
	}
	return normalized, nil
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
	state.Providers = normalizeMemoryProviderBindings(state.Providers, defaults.Providers, now, s.workspaceRoot)

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

func normalizeMemoryProviderBindings(items []MemoryProviderBinding, defaults []MemoryProviderBinding, now string, workspaceRoot string) []MemoryProviderBinding {
	index := map[string]MemoryProviderBinding{}
	for _, item := range items {
		kind, err := normalizeMemoryProviderKind(defaultString(strings.TrimSpace(item.Kind), strings.TrimSpace(item.ID)))
		if err != nil {
			continue
		}
		index[kind] = item
	}

	normalized := make([]MemoryProviderBinding, 0, len(defaults))
	for _, fallback := range defaults {
		current, ok := index[fallback.Kind]
		if !ok {
			current = fallback
		}
		normalized = append(normalized, materializeMemoryProviderBinding(current, fallback, now, workspaceRoot))
	}
	return normalized
}

func materializeMemoryProviderBinding(current, fallback MemoryProviderBinding, now string, workspaceRoot string) MemoryProviderBinding {
	provider := fallback
	provider.ID = fallback.ID
	provider.Kind = fallback.Kind

	if label := strings.TrimSpace(current.Label); label != "" {
		provider.Label = label
	}
	provider.Enabled = current.Enabled
	if current.Kind == "" && current.ID == "" {
		provider.Enabled = fallback.Enabled
	}

	if current.ReadScopes != nil {
		if scopes, err := normalizeMemoryProviderScopes(current.ReadScopes, false); err == nil {
			provider.ReadScopes = scopes
		}
	}
	if current.WriteScopes != nil {
		if scopes, err := normalizeMemoryProviderScopes(current.WriteScopes, true); err == nil {
			provider.WriteScopes = scopes
		}
	}

	if recallPolicy := strings.TrimSpace(current.RecallPolicy); recallPolicy != "" {
		provider.RecallPolicy = recallPolicy
	}
	if retentionPolicy := strings.TrimSpace(current.RetentionPolicy); retentionPolicy != "" {
		provider.RetentionPolicy = retentionPolicy
	}
	if sharingPolicy := strings.TrimSpace(current.SharingPolicy); sharingPolicy != "" {
		provider.SharingPolicy = sharingPolicy
	}
	if summary := strings.TrimSpace(current.Summary); summary != "" {
		provider.Summary = summary
	}
	provider.LastSummary = strings.TrimSpace(current.LastSummary)
	provider.NextAction = strings.TrimSpace(current.NextAction)
	provider.LastCheckedAt = defaultString(strings.TrimSpace(current.LastCheckedAt), fallback.LastCheckedAt)
	provider.LastCheckSource = strings.TrimSpace(current.LastCheckSource)
	provider.UpdatedAt = defaultString(strings.TrimSpace(current.UpdatedAt), fallback.UpdatedAt)
	provider.UpdatedBy = defaultString(strings.TrimSpace(current.UpdatedBy), fallback.UpdatedBy)
	provider.LastError = strings.TrimSpace(current.LastError)
	provider.LastRecoveryAt = strings.TrimSpace(current.LastRecoveryAt)
	provider.LastRecoveryBy = strings.TrimSpace(current.LastRecoveryBy)
	provider.LastRecoverySummary = strings.TrimSpace(current.LastRecoverySummary)
	provider.FailureCount = current.FailureCount
	provider.Activity = normalizeMemoryProviderActivityRuns(current.Activity, now)

	observed := observeMemoryProviderBinding(workspaceRoot, provider)
	provider.Status = observed.Status
	provider.LastSummary = defaultString(strings.TrimSpace(observed.Summary), provider.LastSummary)
	provider.NextAction = strings.TrimSpace(observed.NextAction)
	provider.LastError = strings.TrimSpace(observed.LastError)

	provider.LastCheckedAt = defaultString(strings.TrimSpace(provider.LastCheckedAt), now)
	provider.UpdatedAt = defaultString(strings.TrimSpace(provider.UpdatedAt), now)
	provider.UpdatedBy = defaultString(strings.TrimSpace(provider.UpdatedBy), "System")
	if provider.Activity == nil {
		provider.Activity = []MemoryProviderActivityRun{}
	}
	return provider
}

func normalizeMemoryProviderActivityRuns(entries []MemoryProviderActivityRun, now string) []MemoryProviderActivityRun {
	normalized := make([]MemoryProviderActivityRun, 0, len(entries))
	for _, entry := range entries {
		entry.TriggeredAt = defaultString(strings.TrimSpace(entry.TriggeredAt), now)
		entry.TriggeredBy = defaultString(strings.TrimSpace(entry.TriggeredBy), "System")
		entry.Action = normalizeMemoryProviderActivityAction(entry.Action)
		entry.Status = normalizeMemoryProviderStatus(entry.Status)
		entry.Source = strings.TrimSpace(entry.Source)
		entry.Summary = strings.TrimSpace(entry.Summary)
		entry.Detail = strings.TrimSpace(entry.Detail)
		entry.NextAction = strings.TrimSpace(entry.NextAction)
		if entry.Summary == "" {
			continue
		}
		entry.ID = defaultString(strings.TrimSpace(entry.ID), fmt.Sprintf("memory-provider-%s-%s", entry.Action, slugify(entry.TriggeredAt+"-"+entry.Summary)))
		normalized = append(normalized, entry)
	}
	sort.SliceStable(normalized, func(i, j int) bool {
		if normalized[i].TriggeredAt != normalized[j].TriggeredAt {
			return normalized[i].TriggeredAt > normalized[j].TriggeredAt
		}
		return normalized[i].ID < normalized[j].ID
	})
	if len(normalized) > maxMemoryProviderActivityRuns {
		normalized = normalized[:maxMemoryProviderActivityRuns]
	}
	if normalized == nil {
		return []MemoryProviderActivityRun{}
	}
	return normalized
}

func observeMemoryProviderBinding(workspaceRoot string, provider MemoryProviderBinding) memoryProviderObservation {
	switch provider.Kind {
	case memoryProviderKindWorkspaceFile:
		return observeWorkspaceFileMemoryProvider(workspaceRoot)
	case memoryProviderKindSearchSidecar:
		return observeSearchSidecarMemoryProvider(workspaceRoot, provider.Enabled)
	case memoryProviderKindExternalPersistent:
		return observeExternalPersistentMemoryProvider(workspaceRoot, provider.Enabled)
	default:
		return memoryProviderObservation{
			Status:  memoryProviderStatusStandby,
			Summary: "provider kind not recognized",
		}
	}
}

func observeWorkspaceFileMemoryProvider(workspaceRoot string) memoryProviderObservation {
	if strings.TrimSpace(workspaceRoot) == "" {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "Workspace root missing; file-backed memory cannot be mounted.",
			LastError:  "Workspace root is empty, so MEMORY.md / notes / decisions cannot be read.",
			NextAction: "Set a workspace root and rerun provider recovery to materialize the governed memory scaffold.",
		}
	}

	missing := missingMemoryProviderPaths(workspaceRoot, memoryWorkspaceFileRequiredPaths(workspaceRoot))
	if len(missing) > 0 {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    fmt.Sprintf("Workspace memory scaffold missing %d required file(s).", len(missing)),
			Detail:     strings.Join(missing, ", "),
			LastError:  fmt.Sprintf("Missing governed memory scaffold: %s", strings.Join(missing, ", ")),
			NextAction: "Attempt recovery to recreate MEMORY.md / notes / decisions scaffold before the next run.",
		}
	}

	return memoryProviderObservation{
		Status:  memoryProviderStatusHealthy,
		Summary: "Workspace memory scaffold is present across MEMORY.md / notes / decisions.",
		Detail:  "MEMORY.md, notes/ and decisions/ are available for governed recall.",
	}
}

func observeSearchSidecarMemoryProvider(workspaceRoot string, enabled bool) memoryProviderObservation {
	if !enabled {
		return memoryProviderObservation{
			Status:  memoryProviderStatusStandby,
			Summary: "Search sidecar is disabled; recall falls back to governed file scan.",
		}
	}

	workspace := observeWorkspaceFileMemoryProvider(workspaceRoot)
	if workspace.Status == memoryProviderStatusDegraded {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "Search sidecar cannot index because workspace file memory is not ready.",
			Detail:     workspace.Detail,
			LastError:  defaultString(workspace.LastError, "Workspace scaffold is missing."),
			NextAction: "Recover the workspace-file provider first, then rebuild the local recall index.",
		}
	}

	indexPath := memorySearchSidecarIndexPath(workspaceRoot)
	body, err := os.ReadFile(indexPath)
	if err != nil {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "Local recall index is missing.",
			LastError:  fmt.Sprintf("Search sidecar index not found at %s", filepath.ToSlash(indexPath)),
			NextAction: "Attempt recovery to rebuild the search sidecar index from governed memory artifacts.",
		}
	}

	var indexFile memorySearchSidecarIndexFile
	if err := json.Unmarshal(body, &indexFile); err != nil {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "Local recall index is unreadable.",
			LastError:  fmt.Sprintf("Search sidecar index at %s is invalid JSON.", filepath.ToSlash(indexPath)),
			NextAction: "Attempt recovery to rewrite the index metadata and rebuild recall coverage.",
		}
	}

	return memoryProviderObservation{
		Status:  memoryProviderStatusHealthy,
		Summary: fmt.Sprintf("Search sidecar index ready with %d governed artifact(s).", indexFile.ArtifactCount),
		Detail:  fmt.Sprintf("Index file: %s / generated: %s", filepath.ToSlash(indexPath), defaultString(indexFile.GeneratedAt, "unknown")),
	}
}

func observeExternalPersistentMemoryProvider(workspaceRoot string, enabled bool) memoryProviderObservation {
	if !enabled {
		return memoryProviderObservation{
			Status:  memoryProviderStatusStandby,
			Summary: "External persistent adapter is disabled.",
		}
	}
	if strings.TrimSpace(workspaceRoot) == "" {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "External durable adapter cannot start without a workspace root.",
			LastError:  "Workspace root is empty, so no external adapter stub can be materialized.",
			NextAction: "Set a workspace root, then run recovery to scaffold the local export adapter.",
		}
	}

	configPath := memoryExternalPersistentConfigPath(workspaceRoot)
	body, err := os.ReadFile(configPath)
	if err != nil {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "External durable adapter stub is not configured.",
			LastError:  fmt.Sprintf("External persistent config not found at %s", filepath.ToSlash(configPath)),
			NextAction: "Attempt recovery to scaffold the local export adapter and relay files.",
		}
	}

	var config memoryExternalPersistentAdapterFile
	if err := json.Unmarshal(body, &config); err != nil {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "External durable adapter config is unreadable.",
			LastError:  fmt.Sprintf("External persistent config at %s is invalid JSON.", filepath.ToSlash(configPath)),
			NextAction: "Attempt recovery to rewrite the local export adapter config.",
		}
	}

	relayPath := strings.TrimSpace(config.RelayPath)
	if relayPath == "" {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "External durable adapter stub is missing a relay path.",
			LastError:  "External persistent config does not declare a relay path for queued exports.",
			NextAction: "Attempt recovery to recreate the adapter stub with a relay queue file.",
		}
	}

	relayAbsolute := relayPath
	if !filepath.IsAbs(relayAbsolute) {
		relayAbsolute = filepath.Join(workspaceRoot, filepath.FromSlash(relayPath))
	}
	if _, err := os.Stat(relayAbsolute); err != nil {
		return memoryProviderObservation{
			Status:     memoryProviderStatusDegraded,
			Summary:    "External durable relay queue is missing.",
			LastError:  fmt.Sprintf("Relay queue not found at %s", filepath.ToSlash(relayAbsolute)),
			NextAction: "Attempt recovery to recreate the relay queue and adapter stub.",
		}
	}

	return memoryProviderObservation{
		Status:     memoryProviderStatusHealthy,
		Summary:    "External durable adapter stub is configured in local relay mode.",
		Detail:     fmt.Sprintf("Config: %s / relay: %s / mode: %s", filepath.ToSlash(configPath), filepath.ToSlash(relayAbsolute), defaultString(config.Mode, "unknown")),
		NextAction: "Attach a real remote durable sink when available; current relay stays local-only.",
	}
}

func missingMemoryProviderPaths(workspaceRoot string, paths []string) []string {
	missing := make([]string, 0, len(paths))
	for _, candidate := range paths {
		absolute := candidate
		if !filepath.IsAbs(absolute) {
			absolute = filepath.Join(workspaceRoot, filepath.FromSlash(candidate))
		}
		if _, err := os.Stat(absolute); err != nil {
			relative := absolute
			if rel, relErr := filepath.Rel(workspaceRoot, absolute); relErr == nil && !strings.HasPrefix(rel, "..") {
				relative = filepath.ToSlash(rel)
			}
			missing = append(missing, filepath.ToSlash(relative))
		}
	}
	return missing
}

func memoryWorkspaceFileRequiredPaths(workspaceRoot string) []string {
	return []string{
		filepath.Join(workspaceRoot, "MEMORY.md"),
		filepath.Join(workspaceRoot, "notes", "channels.md"),
		filepath.Join(workspaceRoot, "notes", "operating-rules.md"),
		filepath.Join(workspaceRoot, "notes", "skills.md"),
		filepath.Join(workspaceRoot, "notes", "policies.md"),
		filepath.Join(workspaceRoot, "notes", "work-log.md"),
		filepath.Join(workspaceRoot, "decisions", "README.md"),
	}
}

func memorySearchSidecarIndexPath(workspaceRoot string) string {
	return filepath.Join(workspaceRoot, ".openshock", "memory", "search-sidecar", "index.json")
}

func memoryExternalPersistentConfigPath(workspaceRoot string) string {
	return filepath.Join(workspaceRoot, ".openshock", "memory", "external-persistent", "config.json")
}

func normalizeMemoryCleanupState(state MemoryCleanupState, now string) MemoryCleanupState {
	state.LastRunAt = strings.TrimSpace(state.LastRunAt)
	state.LastRunBy = strings.TrimSpace(state.LastRunBy)
	state.LastStatus = normalizeMemoryCleanupStatus(state.LastStatus)
	state.LastSummary = strings.TrimSpace(state.LastSummary)
	state.LastRecovery = strings.TrimSpace(state.LastRecovery)
	state.LastStats.TotalRemoved = memoryCleanupTotalRemoved(state.LastStats)
	state.Due = false
	state.DueCount = 0
	state.NextRunAt = ""

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

func memoryModeLabel(policy MemoryInjectionPolicy, providers []MemoryProviderBinding) string {
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
	activeProviders := []string{}
	for _, provider := range providers {
		if !provider.Enabled {
			continue
		}
		label := provider.Kind
		if provider.Kind == memoryProviderKindExternalPersistent && provider.Status == memoryProviderStatusDegraded {
			label += "(degraded)"
		}
		activeProviders = append(activeProviders, label)
	}
	if len(activeProviders) > 0 {
		parts = append(parts, strings.Join(activeProviders, " + "))
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
		Previews:   buildMemoryInjectionPreviews(snapshot, state.Policy, state.Providers),
		Providers:  append([]MemoryProviderBinding{}, state.Providers...),
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

	cleanupEvaluation := evaluateMemoryCleanup(snapshot, center.Promotions, time.Now().UTC())
	center.Cleanup.Due = cleanupEvaluation.stats.TotalRemoved > 0
	center.Cleanup.DueCount = cleanupEvaluation.stats.TotalRemoved
	center.Cleanup.NextRunAt = cleanupEvaluation.nextRunAt

	return center
}

func buildMemoryInjectionPreviews(snapshot State, policy MemoryInjectionPolicy, providers []MemoryProviderBinding) []MemoryInjectionPreview {
	previews := make([]MemoryInjectionPreview, 0, len(snapshot.Sessions))
	for _, session := range snapshot.Sessions {
		previews = append(previews, buildMemoryInjectionPreview(snapshot, policy, providers, session))
	}
	return previews
}

func buildMemoryInjectionPreview(snapshot State, policy MemoryInjectionPolicy, providers []MemoryProviderBinding, session Session) MemoryInjectionPreview {
	type candidate struct {
		path     string
		reason   string
		required bool
	}

	run := findRunForSession(snapshot, session.ID, session.ActiveRunID)
	var agent *Agent
	ownerName := ""
	if run != nil {
		ownerName = resolveRunOwnerName(snapshot, *run)
		if found, ok := findAgentForRun(snapshot, *run); ok {
			agent = &found
		}
	}
	previewProviders := selectMemoryProvidersForSession(providers, session, agent)

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
		if agent != nil {
			ownerName = strings.TrimSpace(agent.Name)
		}
		agentSlug := slugify(ownerName)
		if agentSlug != "" {
			// The mounted file list drives profile-level preview badges, so the owner
			// agent memory file must survive preview trimming whenever it is selected.
			addCandidate(filepath.ToSlash(filepath.Join(".openshock", "agents", agentSlug, "MEMORY.md")), "owner agent memory", true)
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
		PromptSummary: buildMemoryPromptSummary(policy, session, items, agent, previewProviders),
		Files:         files,
		Tools:         tools,
		Providers:     previewProviders,
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

func selectMemoryProvidersForSession(providers []MemoryProviderBinding, session Session, agent *Agent) []MemoryProviderBinding {
	sessionScopes := map[string]bool{
		"workspace": true,
	}
	if strings.TrimSpace(session.RoomID) != "" {
		sessionScopes["issue-room"] = true
		sessionScopes["room-notes"] = true
		sessionScopes["decision-ledger"] = true
	}
	if agent != nil {
		sessionScopes["agent"] = true
	}
	if strings.TrimSpace(session.ActiveRunID) != "" {
		sessionScopes["run"] = true
		sessionScopes["session"] = true
	}

	selected := make([]MemoryProviderBinding, 0, len(providers))
	for _, provider := range providers {
		if !provider.Enabled {
			continue
		}
		if !memoryProviderAppliesToSession(provider, sessionScopes) {
			continue
		}
		selected = append(selected, provider)
	}
	return selected
}

func memoryProviderAppliesToSession(provider MemoryProviderBinding, sessionScopes map[string]bool) bool {
	for _, scope := range provider.ReadScopes {
		if sessionScopes[strings.TrimSpace(strings.ToLower(scope))] {
			return true
		}
	}
	return false
}

func buildMemoryPromptSummary(policy MemoryInjectionPolicy, session Session, items []MemoryInjectionPreviewItem, agent *Agent, providers []MemoryProviderBinding) string {
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

	if len(providers) > 0 {
		lines = append(lines, "Memory providers active for this run:")
		for _, provider := range providers {
			line := fmt.Sprintf(
				"- %s (%s) / status:%s / read:%s / write:%s / recall:%s / retention:%s",
				defaultString(strings.TrimSpace(provider.Label), provider.Kind),
				provider.Kind,
				defaultString(strings.TrimSpace(provider.Status), memoryProviderStatusStandby),
				strings.Join(provider.ReadScopes, ", "),
				defaultString(strings.Join(provider.WriteScopes, ", "), "read-only"),
				defaultString(strings.TrimSpace(provider.RecallPolicy), "unset"),
				defaultString(strings.TrimSpace(provider.RetentionPolicy), "unset"),
			)
			if provider.LastError != "" {
				line += fmt.Sprintf(" / note:%s", summarizeMemoryPromptLine(provider.LastError))
			}
			if provider.LastSummary != "" {
				line += fmt.Sprintf(" / health:%s", summarizeMemoryPromptLine(provider.LastSummary))
			}
			if provider.NextAction != "" {
				line += fmt.Sprintf(" / next:%s", summarizeMemoryPromptLine(provider.NextAction))
			}
			lines = append(lines, line)
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

func (s *Store) RunDueMemoryCleanup(triggeredBy string) (State, *MemoryCleanupRun, MemoryCenter, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureMemorySubsystemLocked()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, nil, MemoryCenter{}, false, err
	}

	now := time.Now().UTC()
	evaluation := evaluateMemoryCleanup(s.state, state.Promotions, now)
	if evaluation.stats.TotalRemoved == 0 {
		snapshot := cloneState(s.state)
		return snapshot, nil, buildMemoryCenter(snapshot, state), false, nil
	}

	run := s.applyMemoryCleanupEvaluationLocked(&state, defaultString(strings.TrimSpace(triggeredBy), "System"), now, evaluation)
	state = s.normalizeMemoryCenterStateLocked(state)
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, nil, MemoryCenter{}, false, err
	}

	snapshot := cloneState(s.state)
	return snapshot, &run, buildMemoryCenter(snapshot, state), true, nil
}

func (s *Store) runMemoryCleanupLocked(state *memoryCenterStateFile, actor string) MemoryCleanupRun {
	now := time.Now().UTC()
	evaluation := evaluateMemoryCleanup(s.state, state.Promotions, now)
	return s.applyMemoryCleanupEvaluationLocked(state, actor, now, evaluation)
}

func (s *Store) applyMemoryCleanupEvaluationLocked(state *memoryCenterStateFile, actor string, now time.Time, evaluation memoryCleanupEvaluation) MemoryCleanupRun {
	state.Promotions = evaluation.kept
	run := MemoryCleanupRun{
		ID:          fmt.Sprintf("memory-cleanup-%d", now.UnixNano()),
		TriggeredAt: now.Format(time.RFC3339),
		TriggeredBy: actor,
		Status:      memoryCleanupStatusNoChanges,
		Summary:     fmt.Sprintf("cleanup noop; %d pending review remain", evaluation.pendingAfter),
		Recovery:    "queue already aligned; current promotions can proceed to review.",
		Stats:       evaluation.stats,
	}

	if evaluation.stats.TotalRemoved > 0 {
		run.Status = memoryCleanupStatusCleaned
		run.Summary = fmt.Sprintf("removed %d stale queue entries; %d pending review remain", evaluation.stats.TotalRemoved, evaluation.pendingAfter)
		run.Recovery = buildMemoryCleanupRecovery(evaluation.stats, evaluation.pendingAfter)
	} else if evaluation.pendingAfter > 0 {
		run.Recovery = fmt.Sprintf("%d pending promotion requests remain live; review or promote the newest artifact versions directly.", evaluation.pendingAfter)
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

func evaluateMemoryCleanup(snapshot State, promotions []MemoryPromotion, now time.Time) memoryCleanupEvaluation {
	artifactVersions := map[string]int{}
	for _, artifact := range snapshot.Memory {
		artifactVersions[artifact.ID] = artifact.Version
	}

	kept := make([]MemoryPromotion, 0, len(promotions))
	seenPending := map[string]bool{}
	stats := MemoryCleanupStats{}
	var nextRunAt time.Time
	hasNextRunAt := false

	for _, promotion := range promotions {
		artifact := findMemoryArtifactByIDInSnapshot(snapshot, promotion.MemoryID)
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
			recordMemoryCleanupNextRunAt(&nextRunAt, &hasNextRunAt, promotion.ProposedAt, memoryCleanupPendingTTL)
		case memoryPromotionStatusRejected:
			if artifact != nil && artifact.Forgotten {
				stats.ForgottenSourcePending++
				continue
			}
			reviewedAt := defaultString(strings.TrimSpace(promotion.ReviewedAt), promotion.ProposedAt)
			if memoryCleanupExpired(reviewedAt, now, memoryCleanupRejectedTTL) {
				stats.ExpiredRejected++
				continue
			}
			recordMemoryCleanupNextRunAt(&nextRunAt, &hasNextRunAt, reviewedAt, memoryCleanupRejectedTTL)
		}

		kept = append(kept, promotion)
	}

	stats.TotalRemoved = memoryCleanupTotalRemoved(stats)
	evaluation := memoryCleanupEvaluation{
		kept:         kept,
		stats:        stats,
		pendingAfter: countPromotionsByStatus(kept, memoryPromotionStatusPending),
	}
	if hasNextRunAt {
		evaluation.nextRunAt = nextRunAt.UTC().Format(time.RFC3339)
	}
	return evaluation
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

func recordMemoryCleanupNextRunAt(target *time.Time, hasTarget *bool, value string, ttl time.Duration) {
	if ttl <= 0 {
		return
	}
	recordedAt, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return
	}
	candidate := recordedAt.Add(ttl)
	if !*hasTarget || candidate.Before(*target) {
		*target = candidate
		*hasTarget = true
	}
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
	s.state.Workspace.MemoryMode = memoryModeLabel(state.Policy, state.Providers)

	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, MemoryInjectionPolicy{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, state.Policy, buildMemoryCenter(snapshot, state), nil
}

func (s *Store) UpdateMemoryProviders(bindings []MemoryProviderBinding, updatedBy string) (State, []MemoryProviderBinding, MemoryCenter, error) {
	if len(bindings) == 0 {
		return State{}, nil, MemoryCenter{}, ErrMemoryProviderBindingsRequired
	}

	now := time.Now().UTC().Format(time.RFC3339)

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, nil, MemoryCenter{}, err
	}
	state = s.normalizeMemoryCenterStateLocked(state)

	merged := map[string]MemoryProviderBinding{}
	for _, provider := range state.Providers {
		merged[provider.Kind] = provider
	}

	for _, provider := range bindings {
		kind, err := normalizeMemoryProviderKind(defaultString(strings.TrimSpace(provider.Kind), strings.TrimSpace(provider.ID)))
		if err != nil {
			return State{}, nil, MemoryCenter{}, err
		}

		fallback := defaultMemoryProviderBinding(kind, now)
		readScopes, err := normalizeMemoryProviderScopes(provider.ReadScopes, false)
		if err != nil {
			return State{}, nil, MemoryCenter{}, err
		}
		writeScopes, err := normalizeMemoryProviderScopes(provider.WriteScopes, true)
		if err != nil {
			return State{}, nil, MemoryCenter{}, err
		}
		if kind == memoryProviderKindWorkspaceFile && !provider.Enabled {
			return State{}, nil, MemoryCenter{}, ErrMemoryProviderWorkspaceRequired
		}

		next := merged[kind]
		next.ID = fallback.ID
		next.Kind = kind
		next.Label = defaultString(strings.TrimSpace(provider.Label), fallback.Label)
		next.Enabled = provider.Enabled
		if kind == memoryProviderKindWorkspaceFile {
			next.Enabled = true
		}
		next.ReadScopes = readScopes
		next.WriteScopes = writeScopes
		next.RecallPolicy = defaultString(strings.TrimSpace(provider.RecallPolicy), fallback.RecallPolicy)
		next.RetentionPolicy = defaultString(strings.TrimSpace(provider.RetentionPolicy), fallback.RetentionPolicy)
		next.SharingPolicy = defaultString(strings.TrimSpace(provider.SharingPolicy), fallback.SharingPolicy)
		next.Summary = defaultString(strings.TrimSpace(provider.Summary), fallback.Summary)
		next.LastCheckedAt = now
		next.UpdatedAt = now
		next.UpdatedBy = defaultString(strings.TrimSpace(updatedBy), "System")
		next.LastError = strings.TrimSpace(provider.LastError)
		merged[kind] = materializeMemoryProviderBinding(next, fallback, now, s.workspaceRoot)
	}

	state.Providers = normalizeMemoryProviderBindings(
		[]MemoryProviderBinding{
			merged[memoryProviderKindWorkspaceFile],
			merged[memoryProviderKindSearchSidecar],
			merged[memoryProviderKindExternalPersistent],
		},
		defaultMemoryProviderBindings(now),
		now,
		s.workspaceRoot,
	)
	s.state.Workspace.MemoryMode = memoryModeLabel(state.Policy, state.Providers)

	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, nil, MemoryCenter{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, nil, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, append([]MemoryProviderBinding{}, state.Providers...), buildMemoryCenter(snapshot, state), nil
}

func (s *Store) CheckMemoryProviders(providerID string, checkedBy string) (State, []MemoryProviderBinding, MemoryCenter, error) {
	now := time.Now().UTC().Format(time.RFC3339)

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, nil, MemoryCenter{}, err
	}
	state = s.normalizeMemoryCenterStateLocked(state)

	targets, err := resolveMemoryProviderTargets(state.Providers, providerID)
	if err != nil {
		return State{}, nil, MemoryCenter{}, err
	}

	for _, index := range targets {
		provider := state.Providers[index]
		observation := observeMemoryProviderBinding(s.workspaceRoot, provider)
		provider.Status = observation.Status
		provider.LastSummary = observation.Summary
		provider.LastError = observation.LastError
		provider.NextAction = observation.NextAction
		provider.LastCheckedAt = now
		provider.LastCheckSource = "manual-check"
		provider.UpdatedAt = now
		provider.UpdatedBy = defaultString(strings.TrimSpace(checkedBy), "System")
		provider.FailureCount = nextMemoryProviderFailureCount(provider.FailureCount, provider.Enabled, observation.Status)
		provider.Activity = appendMemoryProviderActivityRun(provider.Activity, MemoryProviderActivityRun{
			Action:      memoryProviderActivityActionCheck,
			TriggeredAt: now,
			TriggeredBy: defaultString(strings.TrimSpace(checkedBy), "System"),
			Source:      "manual-check",
			Status:      observation.Status,
			Summary:     observation.Summary,
			Detail:      observation.Detail,
			NextAction:  observation.NextAction,
		}, now)
		state.Providers[index] = provider
	}

	state.Providers = normalizeMemoryProviderBindings(state.Providers, defaultMemoryProviderBindings(now), now, s.workspaceRoot)
	s.state.Workspace.MemoryMode = memoryModeLabel(state.Policy, state.Providers)
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, nil, MemoryCenter{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, nil, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, append([]MemoryProviderBinding{}, state.Providers...), buildMemoryCenter(snapshot, state), nil
}

func (s *Store) RecoverMemoryProvider(providerID string, recoveredBy string) (State, MemoryProviderBinding, MemoryCenter, error) {
	now := time.Now().UTC().Format(time.RFC3339)

	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		return State{}, MemoryProviderBinding{}, MemoryCenter{}, err
	}
	state = s.normalizeMemoryCenterStateLocked(state)

	targets, err := resolveMemoryProviderTargets(state.Providers, providerID)
	if err != nil {
		return State{}, MemoryProviderBinding{}, MemoryCenter{}, err
	}
	if len(targets) != 1 {
		return State{}, MemoryProviderBinding{}, MemoryCenter{}, ErrMemoryProviderNotFound
	}

	index := targets[0]
	provider := state.Providers[index]
	recoverySummary, recoveryDetail, err := s.recoverMemoryProviderLocked(&provider, now)
	if err != nil {
		return State{}, MemoryProviderBinding{}, MemoryCenter{}, err
	}

	observation := observeMemoryProviderBinding(s.workspaceRoot, provider)
	provider.Status = observation.Status
	provider.LastSummary = observation.Summary
	provider.LastError = observation.LastError
	provider.NextAction = observation.NextAction
	provider.LastCheckedAt = now
	provider.LastCheckSource = "recovery-verify"
	provider.LastRecoveryAt = now
	provider.LastRecoveryBy = defaultString(strings.TrimSpace(recoveredBy), "System")
	provider.LastRecoverySummary = recoverySummary
	provider.UpdatedAt = now
	provider.UpdatedBy = defaultString(strings.TrimSpace(recoveredBy), "System")
	provider.FailureCount = nextMemoryProviderFailureCount(provider.FailureCount, provider.Enabled, observation.Status)
	provider.Activity = appendMemoryProviderActivityRun(provider.Activity, MemoryProviderActivityRun{
		Action:      memoryProviderActivityActionRecovery,
		TriggeredAt: now,
		TriggeredBy: defaultString(strings.TrimSpace(recoveredBy), "System"),
		Source:      "manual-recovery",
		Status:      observation.Status,
		Summary:     defaultString(strings.TrimSpace(recoverySummary), observation.Summary),
		Detail:      defaultString(strings.TrimSpace(recoveryDetail), observation.Detail),
		NextAction:  observation.NextAction,
	}, now)
	state.Providers[index] = provider
	state.Providers = normalizeMemoryProviderBindings(state.Providers, defaultMemoryProviderBindings(now), now, s.workspaceRoot)
	s.state.Workspace.MemoryMode = memoryModeLabel(state.Policy, state.Providers)
	if err := s.saveMemoryCenterStateLocked(state); err != nil {
		return State{}, MemoryProviderBinding{}, MemoryCenter{}, err
	}
	if err := s.persistLocked(); err != nil {
		return State{}, MemoryProviderBinding{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	return snapshot, state.Providers[index], buildMemoryCenter(snapshot, state), nil
}

func resolveMemoryProviderTargets(providers []MemoryProviderBinding, providerID string) ([]int, error) {
	target := strings.TrimSpace(providerID)
	if target == "" {
		targets := make([]int, 0, len(providers))
		for index := range providers {
			targets = append(targets, index)
		}
		return targets, nil
	}

	normalized, err := normalizeMemoryProviderKind(target)
	if err != nil {
		return nil, ErrMemoryProviderNotFound
	}
	for index := range providers {
		if providers[index].Kind == normalized || providers[index].ID == normalized {
			return []int{index}, nil
		}
	}
	return nil, ErrMemoryProviderNotFound
}

func nextMemoryProviderFailureCount(current int, enabled bool, status string) int {
	if !enabled || status != memoryProviderStatusDegraded {
		return 0
	}
	return current + 1
}

func appendMemoryProviderActivityRun(entries []MemoryProviderActivityRun, entry MemoryProviderActivityRun, now string) []MemoryProviderActivityRun {
	entry.ID = defaultString(strings.TrimSpace(entry.ID), fmt.Sprintf("memory-provider-%s-%s", entry.Action, slugify(entry.TriggeredAt+"-"+entry.Summary)))
	return normalizeMemoryProviderActivityRuns(append(entries, entry), now)
}

func (s *Store) recoverMemoryProviderLocked(provider *MemoryProviderBinding, now string) (string, string, error) {
	switch provider.Kind {
	case memoryProviderKindWorkspaceFile:
		if err := s.ensureFilesystemArtifactsLocked(); err != nil {
			return "", "", err
		}
		return "Workspace memory scaffold recovered.", "Recreated missing MEMORY.md / notes / decisions files where needed.", nil
	case memoryProviderKindSearchSidecar:
		if err := s.ensureFilesystemArtifactsLocked(); err != nil {
			return "", "", err
		}
		indexFile := memorySearchSidecarIndexFile{
			Version:       1,
			GeneratedAt:   now,
			ArtifactCount: len(s.state.Memory),
			Paths:         collectMemoryArtifactPaths(s.state.Memory),
		}
		if err := writeMemoryProviderJSONFile(memorySearchSidecarIndexPath(s.workspaceRoot), indexFile); err != nil {
			return "", "", err
		}
		return fmt.Sprintf("Search sidecar index rebuilt with %d governed artifact(s).", indexFile.ArtifactCount),
			fmt.Sprintf("Index file written to %s", filepath.ToSlash(memorySearchSidecarIndexPath(s.workspaceRoot))), nil
	case memoryProviderKindExternalPersistent:
		if err := os.MkdirAll(filepath.Dir(memoryExternalPersistentConfigPath(s.workspaceRoot)), 0o755); err != nil {
			return "", "", err
		}
		relayPath := filepath.Join(s.workspaceRoot, ".openshock", "memory", "external-persistent", "relay.ndjson")
		if err := ensureFile(relayPath, ""); err != nil {
			return "", "", err
		}
		config := memoryExternalPersistentAdapterFile{
			Version:         1,
			Mode:            "local-export-stub",
			WorkspaceRoot:   s.workspaceRoot,
			RelayPath:       filepath.ToSlash(relayPath),
			GeneratedAt:     now,
			RecallPolicy:    provider.RecallPolicy,
			RetentionPolicy: provider.RetentionPolicy,
			SharingPolicy:   provider.SharingPolicy,
			ReadScopes:      append([]string{}, provider.ReadScopes...),
			WriteScopes:     append([]string{}, provider.WriteScopes...),
		}
		if err := writeMemoryProviderJSONFile(memoryExternalPersistentConfigPath(s.workspaceRoot), config); err != nil {
			return "", "", err
		}
		return "External durable adapter stub recovered in local relay mode.",
			fmt.Sprintf("Config written to %s with relay queue %s", filepath.ToSlash(memoryExternalPersistentConfigPath(s.workspaceRoot)), filepath.ToSlash(relayPath)), nil
	default:
		return "", "", ErrMemoryProviderNotFound
	}
}

func collectMemoryArtifactPaths(items []MemoryArtifact) []string {
	paths := make([]string, 0, len(items))
	for _, item := range items {
		if path := filepath.ToSlash(strings.TrimSpace(item.Path)); path != "" {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	return paths
}

func writeMemoryProviderJSONFile(path string, payload any) error {
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o644)
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
