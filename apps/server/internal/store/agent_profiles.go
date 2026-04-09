package store

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
)

const (
	agentRecallPolicyGovernedFirst = "governed-first"
	agentRecallPolicyBalanced      = "balanced"
	agentRecallPolicyAgentFirst    = "agent-first"
)

var (
	ErrAgentNotFound                   = errors.New("agent not found")
	ErrAgentRoleRequired               = errors.New("agent role is required")
	ErrAgentAvatarRequired             = errors.New("agent avatar is required")
	ErrAgentPromptRequired             = errors.New("agent prompt is required")
	ErrAgentProviderPreferenceRequired = errors.New("agent provider preference is required")
	ErrAgentModelPreferenceRequired    = errors.New("agent model preference is required")
	ErrAgentRuntimePreferenceRequired  = errors.New("agent runtime preference is required")
	ErrAgentRecallPolicyInvalid        = errors.New("agent recall policy is invalid")
	ErrAgentMemoryBindingRequired      = errors.New("agent memory binding requires at least one scope")
	ErrAgentMemorySpaceInvalid         = errors.New("agent memory space is invalid")
	ErrAgentRuntimePreferenceInvalid   = errors.New("agent runtime preference must match a known runtime")
	ErrAgentProviderPreferenceInvalid  = errors.New("agent provider preference must match runtime provider truth")
	ErrAgentModelPreferenceInvalid     = errors.New("agent model preference is invalid")
	ErrAgentCredentialBindingInvalid   = errors.New("agent credential binding is invalid")
)

type AgentProfileUpdateInput struct {
	Role                  string
	Avatar                string
	Prompt                string
	OperatingInstructions string
	ProviderPreference    string
	ModelPreference       string
	RecallPolicy          string
	RuntimePreference     string
	MemorySpaces          []string
	CredentialProfileIDs  []string
	Sandbox               *SandboxPolicy
	UpdatedBy             string
}

func (s *Store) Agent(agentID string) (Agent, bool) {
	snapshot := s.Snapshot()
	for _, agent := range snapshot.Agents {
		if agent.ID == agentID {
			return agent, true
		}
	}
	return Agent{}, false
}

func (s *Store) UpdateAgentProfile(agentID string, input AgentProfileUpdateInput) (State, Agent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureRuntimeRegistryStateLocked()

	index := s.findAgentByIDLocked(agentID)
	if index == -1 {
		return State{}, Agent{}, ErrAgentNotFound
	}

	role := strings.TrimSpace(input.Role)
	if role == "" {
		return State{}, Agent{}, ErrAgentRoleRequired
	}
	avatar := strings.TrimSpace(input.Avatar)
	if avatar == "" {
		return State{}, Agent{}, ErrAgentAvatarRequired
	}
	prompt := strings.TrimSpace(input.Prompt)
	if prompt == "" {
		return State{}, Agent{}, ErrAgentPromptRequired
	}
	providerPreference := strings.TrimSpace(input.ProviderPreference)
	if providerPreference == "" {
		return State{}, Agent{}, ErrAgentProviderPreferenceRequired
	}
	modelPreference := strings.TrimSpace(input.ModelPreference)
	if modelPreference == "" {
		return State{}, Agent{}, ErrAgentModelPreferenceRequired
	}
	recallPolicy, err := normalizeAgentRecallPolicy(input.RecallPolicy)
	if err != nil {
		return State{}, Agent{}, err
	}
	memorySpaces, err := normalizeAgentMemorySpaces(input.MemorySpaces)
	if err != nil {
		return State{}, Agent{}, err
	}
	credentialProfileIDs, err := s.normalizeCredentialProfileIDsLocked(input.CredentialProfileIDs)
	if err != nil {
		return State{}, Agent{}, fmt.Errorf("%w: %s", ErrAgentCredentialBindingInvalid, err.Error())
	}
	runtimeRecord, runtimePreference, err := resolveRuntimePreference(s.state.Runtimes, input.RuntimePreference)
	if err != nil {
		return State{}, Agent{}, err
	}
	providerRecord, providerPreference, err := resolveProviderPreference(runtimeRecord, providerPreference)
	if err != nil {
		return State{}, Agent{}, err
	}
	modelPreference, err = resolveModelPreference(providerRecord, modelPreference)
	if err != nil {
		return State{}, Agent{}, err
	}

	agent := s.state.Agents[index]
	changes := []AgentProfileAuditChange{}
	changes = appendAgentProfileChange(changes, "role", agent.Role, role)
	changes = appendAgentProfileChange(changes, "avatar", agent.Avatar, avatar)
	changes = appendAgentProfileChange(changes, "prompt", agent.Prompt, prompt)
	changes = appendAgentProfileChange(changes, "operatingInstructions", agent.OperatingInstructions, strings.TrimSpace(input.OperatingInstructions))
	changes = appendAgentProfileChange(changes, "providerPreference", agent.ProviderPreference, providerPreference)
	changes = appendAgentProfileChange(changes, "modelPreference", agent.ModelPreference, modelPreference)
	changes = appendAgentProfileChange(changes, "runtimePreference", agent.RuntimePreference, runtimePreference)
	changes = appendAgentProfileChange(changes, "recallPolicy", agent.RecallPolicy, recallPolicy)
	changes = appendAgentProfileChange(changes, "memoryBinding", strings.Join(agent.MemorySpaces, ", "), strings.Join(memorySpaces, ", "))
	changes = appendAgentProfileChange(changes, "credentialBinding", strings.Join(agent.CredentialProfileIDs, ", "), strings.Join(credentialProfileIDs, ", "))
	if input.Sandbox != nil {
		policy, err := normalizeSandboxPolicyInput(*input.Sandbox, agent.Sandbox, input.UpdatedBy)
		if err != nil {
			return State{}, Agent{}, err
		}
		changes = appendAgentProfileChange(changes, "sandbox", sandboxPolicySummary(agent.Sandbox), sandboxPolicySummary(policy))
		agent.Sandbox = policy
	}

	agent.Role = role
	agent.Avatar = avatar
	agent.Prompt = prompt
	agent.OperatingInstructions = strings.TrimSpace(input.OperatingInstructions)
	agent.Provider = providerPreference
	agent.ProviderPreference = providerPreference
	agent.ModelPreference = modelPreference
	agent.RecallPolicy = recallPolicy
	agent.RuntimePreference = runtimePreference
	agent.MemorySpaces = memorySpaces
	agent.CredentialProfileIDs = credentialProfileIDs

	if len(changes) > 0 {
		now := time.Now().UTC().Format(time.RFC3339)
		audit := AgentProfileAuditEntry{
			ID:        fmt.Sprintf("agent-profile-audit-%s-%d", slugify(agent.ID), time.Now().UnixNano()),
			UpdatedAt: now,
			UpdatedBy: defaultString(strings.TrimSpace(input.UpdatedBy), "System"),
			Summary:   buildAgentProfileAuditSummary(changes),
			Changes:   changes,
		}
		agent.ProfileAudit = prependAgentProfileAudit(agent.ProfileAudit, audit)
	}

	s.state.Agents[index] = agent
	s.syncAllCredentialGuardsLocked()
	if err := s.persistLocked(); err != nil {
		return State{}, Agent{}, err
	}
	return cloneState(s.state), agent, nil
}

func (s *Store) findAgentByIDLocked(agentID string) int {
	for index, agent := range s.state.Agents {
		if agent.ID == agentID {
			return index
		}
	}
	return -1
}

func normalizeAgentRecallPolicy(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case agentRecallPolicyGovernedFirst:
		return agentRecallPolicyGovernedFirst, nil
	case agentRecallPolicyBalanced:
		return agentRecallPolicyBalanced, nil
	case agentRecallPolicyAgentFirst:
		return agentRecallPolicyAgentFirst, nil
	default:
		return "", ErrAgentRecallPolicyInvalid
	}
}

func normalizeAgentMemorySpaces(values []string) ([]string, error) {
	allowed := map[string]bool{
		"workspace":  true,
		"issue-room": true,
		"room-notes": true,
		"topic":      true,
		"user":       true,
	}

	seen := map[string]bool{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		item := strings.TrimSpace(strings.ToLower(value))
		if item == "" {
			continue
		}
		if !allowed[item] {
			return nil, fmt.Errorf("%w: %s", ErrAgentMemorySpaceInvalid, item)
		}
		if seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	if len(normalized) == 0 {
		return nil, ErrAgentMemoryBindingRequired
	}
	return normalized, nil
}

func appendAgentProfileChange(changes []AgentProfileAuditChange, field, previous, current string) []AgentProfileAuditChange {
	previous = strings.TrimSpace(previous)
	current = strings.TrimSpace(current)
	if previous == current {
		return changes
	}
	return append(changes, AgentProfileAuditChange{
		Field:    field,
		Previous: previous,
		Current:  current,
	})
}

func buildAgentProfileAuditSummary(changes []AgentProfileAuditChange) string {
	labels := make([]string, 0, len(changes))
	for _, change := range changes {
		labels = append(labels, change.Field)
		if len(labels) >= 4 {
			break
		}
	}
	if len(changes) > len(labels) {
		labels = append(labels, fmt.Sprintf("+%d more", len(changes)-len(labels)))
	}
	return fmt.Sprintf("updated %s", strings.Join(labels, ", "))
}

func prependAgentProfileAudit(items []AgentProfileAuditEntry, item AgentProfileAuditEntry) []AgentProfileAuditEntry {
	next := append([]AgentProfileAuditEntry{item}, items...)
	if len(next) > 6 {
		next = next[:6]
	}
	return next
}

func agentIncludesMemorySpace(agent Agent, want string) bool {
	want = strings.TrimSpace(strings.ToLower(want))
	for _, item := range agent.MemorySpaces {
		if strings.TrimSpace(strings.ToLower(item)) == want {
			return true
		}
	}
	return false
}

func agentAllowsMemoryPath(agent Agent, path string) bool {
	path = filepath.ToSlash(strings.TrimSpace(path))
	switch {
	case path == "MEMORY.md" || path == filepath.ToSlash(filepath.Join("notes", "work-log.md")):
		return agentIncludesMemorySpace(agent, "workspace")
	case strings.HasPrefix(path, filepath.ToSlash(filepath.Join("notes", "rooms"))+"/"):
		return agentIncludesMemorySpace(agent, "issue-room") || agentIncludesMemorySpace(agent, "room-notes")
	case strings.HasPrefix(path, filepath.ToSlash("decisions")+"/"):
		return agentIncludesMemorySpace(agent, "topic")
	default:
		return true
	}
}

func agentWantsAgentMemory(agent Agent, policy MemoryInjectionPolicy) bool {
	if policy.IncludeAgentMemory {
		return true
	}
	return agentIncludesMemorySpace(agent, "user") || strings.EqualFold(strings.TrimSpace(agent.RecallPolicy), agentRecallPolicyAgentFirst)
}

func resolveRuntimePreference(runtimes []RuntimeRecord, value string) (RuntimeRecord, string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return RuntimeRecord{}, "", ErrAgentRuntimePreferenceRequired
	}
	for _, runtime := range runtimes {
		if strings.EqualFold(runtime.ID, trimmed) || strings.EqualFold(runtime.Machine, trimmed) {
			return runtime, defaultString(strings.TrimSpace(runtime.ID), runtime.Machine), nil
		}
	}
	return RuntimeRecord{}, "", fmt.Errorf("%w: %s", ErrAgentRuntimePreferenceInvalid, trimmed)
}

func resolveProviderPreference(runtime RuntimeRecord, value string) (RuntimeProvider, string, error) {
	trimmed := strings.TrimSpace(value)
	for _, provider := range runtime.Providers {
		if strings.EqualFold(provider.ID, trimmed) || strings.EqualFold(provider.Label, trimmed) {
			return provider, defaultString(strings.TrimSpace(provider.Label), provider.ID), nil
		}
	}
	return RuntimeProvider{}, "", fmt.Errorf("%w: %s", ErrAgentProviderPreferenceInvalid, trimmed)
}

func resolveModelPreference(provider RuntimeProvider, value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", ErrAgentModelPreferenceRequired
	}
	for _, model := range provider.Models {
		if strings.EqualFold(model, trimmed) {
			return model, nil
		}
	}
	return trimmed, nil
}
