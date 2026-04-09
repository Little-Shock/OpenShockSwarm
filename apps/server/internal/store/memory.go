package store

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const maxMemoryArtifactVersions = 8

var (
	ErrMemoryFeedbackNoteRequired     = errors.New("memory feedback note is required")
	ErrMemoryForgetReasonRequired     = errors.New("memory forget reason is required")
	ErrMemoryArtifactImmutable        = errors.New("memory artifact is not backed by a mutable file")
	ErrMemoryArtifactAlreadyForgotten = errors.New("memory artifact is already forgotten")
	ErrMemoryArtifactForgotten        = errors.New("memory artifact is forgotten")
	ErrMemoryArtifactVersionConflict  = errors.New("memory artifact version is stale")
)

type MemoryFeedbackInput struct {
	SourceVersion int
	Summary       string
	Note          string
	CorrectedBy   string
}

type MemoryForgetInput struct {
	SourceVersion int
	Reason        string
	ForgottenBy   string
}

func (s *Store) MemoryDetail(memoryID string) (MemoryArtifactDetail, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for index := range s.state.Memory {
		if s.state.Memory[index].ID != memoryID {
			continue
		}

		if s.hydrateMemoryArtifactLocked(&s.state.Memory[index]) {
			_ = s.persistLocked()
		}

		artifact := s.state.Memory[index]
		versions := append([]MemoryArtifactVersion{}, s.state.MemoryVersions[artifact.ID]...)
		content := ""
		if len(versions) > 0 {
			content = versions[len(versions)-1].Content
		}
		return MemoryArtifactDetail{
			Artifact: artifact,
			Content:  content,
			Versions: versions,
		}, true
	}
	return MemoryArtifactDetail{}, false
}

func (s *Store) ensureMemorySubsystemLocked() {
	if s.state.MemoryVersions == nil {
		s.state.MemoryVersions = map[string][]MemoryArtifactVersion{}
	}
	for index := range s.state.Memory {
		s.hydrateMemoryArtifactLocked(&s.state.Memory[index])
	}
}

func (s *Store) hydrateMemoryArtifactLocked(artifact *MemoryArtifact) bool {
	if artifact == nil {
		return false
	}

	path := filepath.ToSlash(strings.TrimSpace(artifact.Path))
	if path == "" {
		return false
	}

	scope, kind, baseSummary, governance := describeMemoryArtifact(path)
	if strings.TrimSpace(artifact.ID) == "" {
		artifact.ID = slugify(scope + "-" + kind + "-" + path)
	}
	if strings.TrimSpace(artifact.Scope) == "" {
		artifact.Scope = scope
	}
	if strings.TrimSpace(artifact.Kind) == "" {
		artifact.Kind = kind
	}
	if strings.TrimSpace(artifact.Summary) == "" {
		artifact.Summary = baseSummary
	}
	if strings.TrimSpace(artifact.Governance.Mode) == "" {
		artifact.Governance = governance
	}
	if artifact.Version < 1 {
		artifact.Version = 1
	}
	changed := false

	versions := s.state.MemoryVersions[artifact.ID]
	if len(versions) == 0 {
		base, latest := splitMemorySummary(artifact.Summary)
		if strings.TrimSpace(base) == "" {
			base = baseSummary
		}
		if strings.TrimSpace(latest) == "" {
			latest = defaultString(strings.TrimSpace(artifact.LatestWrite), base)
		}
		source := defaultString(strings.TrimSpace(artifact.LatestSource), "bootstrap")
		actor := defaultString(strings.TrimSpace(artifact.LatestActor), "System")
		recordedAt := defaultString(strings.TrimSpace(artifact.UpdatedAt), time.Now().UTC().Format(time.RFC3339))
		content, digest, size := readMemoryArtifactContent(s.workspaceRoot, path)
		snapshot := MemoryArtifactVersion{
			Version:   artifact.Version,
			Summary:   latest,
			UpdatedAt: recordedAt,
			Source:    source,
			Actor:     actor,
			Digest:    digest,
			SizeBytes: size,
			Content:   content,
		}
		s.state.MemoryVersions[artifact.ID] = []MemoryArtifactVersion{snapshot}
		artifact.Digest = digest
		artifact.SizeBytes = size
		artifact.LatestWrite = latest
		artifact.LatestSource = source
		artifact.LatestActor = actor
		if strings.TrimSpace(artifact.UpdatedAt) == "" {
			artifact.UpdatedAt = recordedAt
		}
		return true
	}

	content, digest, size := readMemoryArtifactContent(s.workspaceRoot, path)
	last := versions[len(versions)-1]
	if shouldSyncMemoryArtifactFromDisk(last, content, digest, size) {
		recordedAt := time.Now().UTC().Format(time.RFC3339)
		nextVersion := last.Version + 1
		if nextVersion <= artifact.Version {
			nextVersion = artifact.Version + 1
		}
		last = MemoryArtifactVersion{
			Version:   nextVersion,
			Summary:   "External File Edit",
			UpdatedAt: recordedAt,
			Source:    "external-file-edit",
			Actor:     "Filesystem",
			Digest:    digest,
			SizeBytes: size,
			Content:   content,
		}
		versions = append(versions, last)
		if len(versions) > maxMemoryArtifactVersions {
			versions = versions[len(versions)-maxMemoryArtifactVersions:]
		}
		s.state.MemoryVersions[artifact.ID] = versions
		changed = true
	}

	artifact.Scope = scope
	artifact.Kind = kind
	artifact.Path = path
	artifact.Governance = governance
	artifact.Version = last.Version
	artifact.UpdatedAt = last.UpdatedAt
	artifact.LatestWrite = last.Summary
	artifact.LatestSource = last.Source
	artifact.LatestActor = last.Actor
	artifact.Digest = last.Digest
	artifact.SizeBytes = last.SizeBytes
	if strings.TrimSpace(baseSummary) == "" {
		artifact.Summary = last.Summary
	} else {
		artifact.Summary = baseSummary + " 最近写回：" + last.Summary
	}

	return changed
}

func (s *Store) recordMemoryArtifactWriteLocked(path, latest, source, actor string) {
	path = filepath.ToSlash(strings.TrimSpace(path))
	if path == "" {
		return
	}
	if s.state.MemoryVersions == nil {
		s.state.MemoryVersions = map[string][]MemoryArtifactVersion{}
	}

	scope, kind, baseSummary, governance := describeMemoryArtifact(path)
	index := -1
	for itemIndex := range s.state.Memory {
		if s.state.Memory[itemIndex].Path == path {
			index = itemIndex
			break
		}
	}
	if index == -1 {
		s.state.Memory = append(s.state.Memory, MemoryArtifact{
			ID:         slugify(scope + "-" + kind + "-" + path),
			Scope:      scope,
			Kind:       kind,
			Path:       path,
			Summary:    baseSummary,
			Version:    1,
			Governance: governance,
		})
		index = len(s.state.Memory) - 1
	}

	artifact := &s.state.Memory[index]
	s.hydrateMemoryArtifactLocked(artifact)

	versions := s.state.MemoryVersions[artifact.ID]
	nextVersion := 1
	if len(versions) > 0 {
		nextVersion = versions[len(versions)-1].Version + 1
	}

	summary := strings.TrimSpace(latest)
	if summary == "" {
		summary = baseSummary
	}
	source = defaultString(strings.TrimSpace(source), "system")
	actor = defaultString(strings.TrimSpace(actor), "System")
	recordedAt := time.Now().UTC().Format(time.RFC3339)
	content, digest, size := readMemoryArtifactContent(s.workspaceRoot, path)
	version := MemoryArtifactVersion{
		Version:   nextVersion,
		Summary:   summary,
		UpdatedAt: recordedAt,
		Source:    source,
		Actor:     actor,
		Digest:    digest,
		SizeBytes: size,
		Content:   content,
	}
	history := append(versions, version)
	if len(history) > maxMemoryArtifactVersions {
		history = history[len(history)-maxMemoryArtifactVersions:]
	}
	s.state.MemoryVersions[artifact.ID] = history

	artifact.Scope = scope
	artifact.Kind = kind
	artifact.Path = path
	artifact.Governance = governance
	artifact.Version = nextVersion
	artifact.UpdatedAt = recordedAt
	artifact.LatestWrite = summary
	artifact.LatestSource = source
	artifact.LatestActor = actor
	artifact.Digest = digest
	artifact.SizeBytes = size
	if strings.TrimSpace(latest) == "" {
		artifact.Summary = baseSummary
	} else {
		artifact.Summary = baseSummary + " 最近写回：" + summary
	}
}

func (s *Store) recordMemoryArtifactWritesLocked(paths []string, latest, source, actor string) {
	for _, path := range paths {
		s.recordMemoryArtifactWriteLocked(path, latest, source, actor)
	}
}

func (s *Store) SubmitMemoryFeedback(memoryID string, input MemoryFeedbackInput) (State, MemoryArtifactDetail, MemoryCenter, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index, artifact, err := s.mutableMemoryArtifactLocked(memoryID, input.SourceVersion)
	if err != nil {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, err
	}

	note := strings.TrimSpace(input.Note)
	if note == "" {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, ErrMemoryFeedbackNoteRequired
	}

	summary := defaultString(strings.TrimSpace(input.Summary), "Human Correction")
	actor := defaultString(strings.TrimSpace(input.CorrectedBy), "System")
	recordedAt := time.Now().UTC().Format(time.RFC3339)

	if err := appendMemoryArtifactMutationEntry(s.workspaceRoot, artifact.Path, "Human Correction", []string{
		fmt.Sprintf("- time: %s", recordedAt),
		fmt.Sprintf("- actor: %s", actor),
		fmt.Sprintf("- source_version: v%d", artifact.Version),
		fmt.Sprintf("- summary: %s", summary),
		fmt.Sprintf("- note: %s", note),
	}); err != nil {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, err
	}

	s.recordMemoryArtifactWriteLocked(artifact.Path, summary, "memory.feedback", actor)
	s.state.Memory[index].CorrectionCount++
	s.state.Memory[index].LastCorrectionAt = recordedAt
	s.state.Memory[index].LastCorrectionBy = actor
	s.state.Memory[index].LastCorrectionNote = note

	if err := s.persistLocked(); err != nil {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	detail := s.memoryDetailFromStateLocked(memoryID)
	center := s.memoryCenterFromStateLocked(snapshot)
	return snapshot, detail, center, nil
}

func (s *Store) ForgetMemoryArtifact(memoryID string, input MemoryForgetInput) (State, MemoryArtifactDetail, MemoryCenter, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index, artifact, err := s.mutableMemoryArtifactLocked(memoryID, input.SourceVersion)
	if err != nil {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, err
	}
	if artifact.Forgotten {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, ErrMemoryArtifactAlreadyForgotten
	}

	reason := strings.TrimSpace(input.Reason)
	if reason == "" {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, ErrMemoryForgetReasonRequired
	}

	actor := defaultString(strings.TrimSpace(input.ForgottenBy), "System")
	recordedAt := time.Now().UTC().Format(time.RFC3339)
	if err := appendMemoryArtifactMutationEntry(s.workspaceRoot, artifact.Path, "Human Forget", []string{
		fmt.Sprintf("- time: %s", recordedAt),
		fmt.Sprintf("- actor: %s", actor),
		fmt.Sprintf("- source_version: v%d", artifact.Version),
		fmt.Sprintf("- reason: %s", reason),
	}); err != nil {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, err
	}

	s.recordMemoryArtifactWriteLocked(artifact.Path, "Human Forget", "memory.forget", actor)
	s.state.Memory[index].Forgotten = true
	s.state.Memory[index].ForgottenAt = recordedAt
	s.state.Memory[index].ForgottenBy = actor
	s.state.Memory[index].ForgetReason = reason

	if err := s.persistLocked(); err != nil {
		return State{}, MemoryArtifactDetail{}, MemoryCenter{}, err
	}

	snapshot := cloneState(s.state)
	detail := s.memoryDetailFromStateLocked(memoryID)
	center := s.memoryCenterFromStateLocked(snapshot)
	return snapshot, detail, center, nil
}

func describeMemoryArtifact(path string) (scope, kind, baseSummary string, governance MemoryGovernance) {
	path = filepath.ToSlash(strings.TrimSpace(path))
	scope = "workspace"
	kind = "notes"
	baseSummary = "文件写回记录。"
	governance = MemoryGovernance{Mode: "append-only"}

	switch {
	case path == "MEMORY.md":
		kind = "memory"
		baseSummary = "工作区级长期记忆。"
		governance = MemoryGovernance{Mode: "append-only", RequiresReview: true, Escalation: "inbox"}
	case path == filepath.ToSlash(filepath.Join("notes", "skills.md")):
		kind = "skill-ledger"
		baseSummary = "已提升 skill 记录。"
		governance = MemoryGovernance{Mode: "skill-ledger", RequiresReview: true, Escalation: "approval-center"}
	case path == filepath.ToSlash(filepath.Join("notes", "policies.md")):
		kind = "policy-ledger"
		baseSummary = "已提升 policy 记录。"
		governance = MemoryGovernance{Mode: "policy-ledger", RequiresReview: true, Escalation: "approval-center"}
	case path == "repo-binding":
		kind = "integration"
		baseSummary = "仓库绑定真值。"
		governance = MemoryGovernance{Mode: "state-snapshot"}
	case path == filepath.ToSlash(filepath.Join("notes", "work-log.md")):
		baseSummary = "全局运行日志。"
	case strings.HasPrefix(path, filepath.ToSlash(filepath.Join("notes", "rooms"))+"/"):
		kind = "room-note"
		roomID := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		scope = "room:" + roomID
		baseSummary = "讨论间运行记录。"
	case strings.HasPrefix(path, filepath.ToSlash("decisions")+"/"):
		kind = "decision"
		issueKey := strings.ToUpper(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
		scope = "issue:" + issueKey
		baseSummary = "需求与审批决策记录。"
		governance = MemoryGovernance{Mode: "decision-ledger", RequiresReview: true, Escalation: "inbox"}
	case strings.HasPrefix(path, filepath.ToSlash(filepath.Join(".openshock", "agents"))+"/") && strings.HasSuffix(path, filepath.ToSlash("MEMORY.md")):
		kind = "memory"
		segments := strings.Split(path, "/")
		if len(segments) >= 3 {
			scope = "agent:" + segments[2]
		}
		baseSummary = "Agent 长期记忆。"
		governance = MemoryGovernance{Mode: "agent-memory"}
	case strings.HasPrefix(path, filepath.ToSlash(filepath.Join(".openshock", "agents"))+"/") && strings.HasSuffix(path, filepath.ToSlash(filepath.Join("notes", "work-log.md"))):
		segments := strings.Split(path, "/")
		if len(segments) >= 3 {
			scope = "agent:" + segments[2]
		}
		baseSummary = "Agent 运行日志。"
		governance = MemoryGovernance{Mode: "append-only"}
	}

	return scope, kind, baseSummary, governance
}

func splitMemorySummary(summary string) (base, latest string) {
	base = strings.TrimSpace(summary)
	const marker = " 最近写回："
	if index := strings.Index(base, marker); index != -1 {
		latest = strings.TrimSpace(base[index+len(marker):])
		base = strings.TrimSpace(base[:index])
	}
	return base, latest
}

func shouldSyncMemoryArtifactFromDisk(last MemoryArtifactVersion, content, digest string, size int) bool {
	return strings.TrimSpace(content) != strings.TrimSpace(last.Content) ||
		strings.TrimSpace(digest) != strings.TrimSpace(last.Digest) ||
		size != last.SizeBytes
}

func readMemoryArtifactContent(root, path string) (string, string, int) {
	if strings.TrimSpace(root) == "" {
		return "", "", 0
	}
	path = filepath.ToSlash(strings.TrimSpace(path))
	if path == "" || path == "repo-binding" {
		return "", "", 0
	}

	absolutePath := path
	if !filepath.IsAbs(absolutePath) {
		absolutePath = filepath.Join(root, filepath.FromSlash(path))
	}
	body, err := os.ReadFile(absolutePath)
	if err != nil {
		return "", "", 0
	}

	sum := sha256.Sum256(body)
	return string(body), hex.EncodeToString(sum[:]), len(body)
}

func (s *Store) mutableMemoryArtifactLocked(memoryID string, sourceVersion int) (int, MemoryArtifact, error) {
	index := s.findMemoryArtifactIndexLocked(memoryID)
	if index == -1 {
		return -1, MemoryArtifact{}, ErrMemoryArtifactNotFound
	}

	if s.hydrateMemoryArtifactLocked(&s.state.Memory[index]) {
		_ = s.persistLocked()
	}

	artifact := s.state.Memory[index]
	if !memoryArtifactIsMutable(artifact) {
		return -1, MemoryArtifact{}, ErrMemoryArtifactImmutable
	}
	if artifact.Forgotten {
		return -1, MemoryArtifact{}, ErrMemoryArtifactForgotten
	}
	if sourceVersion > 0 && artifact.Version != sourceVersion {
		return -1, MemoryArtifact{}, ErrMemoryArtifactVersionConflict
	}
	return index, artifact, nil
}

func (s *Store) findMemoryArtifactIndexLocked(memoryID string) int {
	memoryID = strings.TrimSpace(memoryID)
	for index := range s.state.Memory {
		if s.state.Memory[index].ID == memoryID {
			return index
		}
	}
	return -1
}

func (s *Store) memoryDetailFromStateLocked(memoryID string) MemoryArtifactDetail {
	index := s.findMemoryArtifactIndexLocked(memoryID)
	if index == -1 {
		return MemoryArtifactDetail{}
	}
	artifact := s.state.Memory[index]
	versions := append([]MemoryArtifactVersion{}, s.state.MemoryVersions[artifact.ID]...)
	content := ""
	if len(versions) > 0 {
		content = versions[len(versions)-1].Content
	}
	return MemoryArtifactDetail{
		Artifact: artifact,
		Content:  content,
		Versions: versions,
	}
}

func (s *Store) memoryCenterFromStateLocked(snapshot State) MemoryCenter {
	state, err := s.loadMemoryCenterStateLocked()
	if err != nil {
		state = defaultMemoryCenterState(time.Now().UTC().Format(time.RFC3339))
	}
	return buildMemoryCenter(snapshot, state)
}

func memoryArtifactIsMutable(artifact MemoryArtifact) bool {
	path := filepath.ToSlash(strings.TrimSpace(artifact.Path))
	return path != "" && path != "repo-binding"
}

func appendMemoryArtifactMutationEntry(root, artifactPath, heading string, lines []string) error {
	if strings.TrimSpace(root) == "" {
		return nil
	}
	artifactPath = filepath.ToSlash(strings.TrimSpace(artifactPath))
	if artifactPath == "" || artifactPath == "repo-binding" {
		return ErrMemoryArtifactImmutable
	}

	entry := "\n## " + strings.TrimSpace(heading) + "\n\n" + strings.Join(lines, "\n") + "\n"
	return appendMarkdown(filepath.Join(root, filepath.FromSlash(artifactPath)), entry)
}
