package store

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	workspaceOnboardingNotStarted = "not_started"
	workspaceOnboardingInProgress = "in_progress"
	workspaceOnboardingReady      = "ready"
	workspaceOnboardingDone       = "done"

	governanceDeliveryDelegationModeFormalHandoff = "formal-handoff"
	governanceDeliveryDelegationModeSignalOnly    = "signal-only"
	governanceDeliveryDelegationModeAutoComplete  = "auto-complete"
)

var (
	ErrWorkspaceOnboardingStatusInvalid                 = errors.New("workspace onboarding status is invalid")
	ErrWorkspaceResumeURLInvalid                        = errors.New("workspace resume url must start with /")
	ErrWorkspaceStartRouteInvalid                       = errors.New("workspace start route must start with /")
	ErrWorkspacePreferredAgentNotFound                  = errors.New("preferred agent not found")
	ErrWorkspaceGovernanceTopologyInvalid               = errors.New("workspace governance topology is invalid")
	ErrWorkspaceGovernanceDeliveryDelegationModeInvalid = errors.New("workspace governance delivery delegation mode is invalid")
)

type WorkspaceConfigUpdateInput struct {
	Plan        string
	BrowserPush string
	MemoryMode  string
	Sandbox     *SandboxPolicy
	Onboarding  *WorkspaceOnboardingSnapshot
	Governance  *WorkspaceGovernanceConfigInput
	UpdatedBy   string
}

type WorkspaceGovernanceConfigInput struct {
	TeamTopology           []WorkspaceGovernanceLaneConfig
	DeliveryDelegationMode string
}

type WorkspaceMemberPreferencesInput struct {
	PreferredAgentID string
	StartRoute       string
	GitHubHandle     string
}

type onboardingTemplateDefinition struct {
	ID                 string
	Label              string
	Channels           []string
	Roles              []string
	Agents             []string
	NotificationPolicy string
	Notes              []string
}

func defaultWorkspaceOnboarding(now string) WorkspaceOnboardingSnapshot {
	return WorkspaceOnboardingSnapshot{
		Status:         workspaceOnboardingInProgress,
		TemplateID:     "dev-team",
		CurrentStep:    "account",
		CompletedSteps: []string{"workspace-created", "template-selected"},
		ResumeURL:      "/onboarding",
		UpdatedAt:      now,
	}
}

func canonicalWorkspaceOnboardingTemplateID(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "delivery-ops", "delivery_ops", "deliveryops", "dev-team", "developer-team":
		return "dev-team"
	case "research-team", "research_team", "research":
		return "research-team"
	case "blank-custom", "blank_custom", "blank", "custom":
		return "blank-custom"
	default:
		return "blank-custom"
	}
}

func workspaceOnboardingTemplateDefinition(templateID string) onboardingTemplateDefinition {
	switch canonicalWorkspaceOnboardingTemplateID(templateID) {
	case "dev-team":
		return onboardingTemplateDefinition{
			ID:                 "dev-team",
			Label:              "开发团队",
			Channels:           []string{"#shiproom", "#review-lane", "#ops-watch"},
			Roles:              []string{"PM", "Architect", "Developer", "Reviewer", "QA"},
			Agents:             []string{"Spec Captain", "Build Pilot", "Review Runner", "QA Relay"},
			NotificationPolicy: "blocked / review / release gate 优先推送",
			Notes: []string{
				"系统会创建交付、评审和发布相关频道。",
				"适合需要多人协作推进需求和发布的团队。",
				"后续可继续补充审批、通知和协作规则。",
			},
		}
	case "research-team":
		return onboardingTemplateDefinition{
			ID:                 "research-team",
			Label:              "研究团队",
			Channels:           []string{"#intake", "#evidence", "#synthesis"},
			Roles:              []string{"Research Lead", "Collector", "Synthesizer", "Reviewer"},
			Agents:             []string{"Collector", "Synthesizer", "Review Runner"},
			NotificationPolicy: "evidence ready / synthesis blocked / reviewer feedback 优先推送",
			Notes: []string{
				"系统会创建输入、资料和综合相关频道。",
				"适合研究、分析和结论整理类工作。",
				"设置支持中断后继续。",
			},
		}
	default:
		return onboardingTemplateDefinition{
			ID:                 "blank-custom",
			Label:              "空白自定义",
			Channels:           []string{"#all", "#roadmap", "#announcements"},
			Roles:              []string{"Owner / Member / Viewer"},
			Agents:             []string{"启动智能体", "评审智能体"},
			NotificationPolicy: "只推高优先级与显式 review 事件",
			Notes: []string{
				"系统会先创建基础频道、角色和默认智能体。",
				"首次设置支持中断后继续，后续可再补充更多协作规则。",
				"适合从空白工作区开始搭建自己的协作方式。",
			},
		}
	}
}

func workspaceOnboardingMaterialization(templateID string) WorkspaceOnboardingMaterialization {
	definition := workspaceOnboardingTemplateDefinition(templateID)
	return WorkspaceOnboardingMaterialization{
		Label:              definition.Label,
		Channels:           append([]string{}, definition.Channels...),
		Roles:              append([]string{}, definition.Roles...),
		Agents:             append([]string{}, definition.Agents...),
		NotificationPolicy: definition.NotificationPolicy,
		Notes:              append([]string{}, definition.Notes...),
	}
}

func defaultWorkspaceRepoBinding(workspace WorkspaceSnapshot, now string) WorkspaceRepoBindingSnapshot {
	return WorkspaceRepoBindingSnapshot{
		Repo:          workspace.Repo,
		RepoURL:       workspace.RepoURL,
		Branch:        workspace.Branch,
		Provider:      defaultString(workspace.RepoProvider, "github"),
		BindingStatus: defaultString(workspace.RepoBindingStatus, "pending"),
		AuthMode:      defaultString(workspace.RepoAuthMode, "local-git-origin"),
		SyncedAt:      now,
	}
}

func defaultWorkspaceGitHubInstallation(workspace WorkspaceSnapshot, now string) WorkspaceGitHubInstallSnapshot {
	message := "GitHub 应用尚未完成安装，可先使用本地仓库。"
	if strings.EqualFold(strings.TrimSpace(workspace.RepoBindingStatus), "bound") {
		message = "仓库已绑定，GitHub 状态会在下一次检查后更新。"
	}
	return WorkspaceGitHubInstallSnapshot{
		Provider:          defaultString(workspace.RepoProvider, "github"),
		PreferredAuthMode: defaultString(workspace.RepoAuthMode, "local-git-origin"),
		ConnectionMessage: message,
		SyncedAt:          now,
	}
}

func defaultWorkspaceMemberPreferences() WorkspaceMemberPreferences {
	return WorkspaceMemberPreferences{
		StartRoute: "/chat/all",
	}
}

func normalizeWorkspaceOnboardingStatus(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case workspaceOnboardingNotStarted:
		return workspaceOnboardingNotStarted, nil
	case workspaceOnboardingInProgress:
		return workspaceOnboardingInProgress, nil
	case workspaceOnboardingReady:
		return workspaceOnboardingReady, nil
	case workspaceOnboardingDone:
		return workspaceOnboardingDone, nil
	default:
		return "", ErrWorkspaceOnboardingStatusInvalid
	}
}

func normalizeWorkspaceRoute(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, "/") {
		return "", ErrWorkspaceStartRouteInvalid
	}
	return value, nil
}

func normalizeWorkspaceResumeURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if !strings.HasPrefix(value, "/") {
		return "", ErrWorkspaceResumeURLInvalid
	}
	return value, nil
}

func normalizeWorkspaceGovernanceDeliveryDelegationMode(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", governanceDeliveryDelegationModeFormalHandoff, "formal_handoff", "formal":
		return governanceDeliveryDelegationModeFormalHandoff, nil
	case governanceDeliveryDelegationModeSignalOnly, "signal_only", "signal":
		return governanceDeliveryDelegationModeSignalOnly, nil
	case governanceDeliveryDelegationModeAutoComplete, "auto_complete", "autocomplete", "auto":
		return governanceDeliveryDelegationModeAutoComplete, nil
	default:
		return "", ErrWorkspaceGovernanceDeliveryDelegationModeInvalid
	}
}

func workspaceGovernanceDeliveryDelegationMode(workspace WorkspaceSnapshot) string {
	mode, err := normalizeWorkspaceGovernanceDeliveryDelegationMode(workspace.Governance.DeliveryDelegationMode)
	if err != nil {
		return governanceDeliveryDelegationModeFormalHandoff
	}
	return mode
}

func sessionHasPermission(session AuthSession, permission string) bool {
	for _, granted := range session.Permissions {
		if granted == permission {
			return true
		}
	}
	return false
}

func normalizeCompletedSteps(values []string, fallback []string) []string {
	if values == nil {
		return append([]string{}, fallback...)
	}
	seen := map[string]bool{}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		item := strings.TrimSpace(value)
		if item == "" || seen[item] {
			continue
		}
		seen[item] = true
		normalized = append(normalized, item)
	}
	return normalized
}

func normalizeWorkspaceGovernanceTopology(values []WorkspaceGovernanceLaneConfig) ([]WorkspaceGovernanceLaneConfig, error) {
	if len(values) < 2 {
		return nil, fmt.Errorf("%w: at least 2 lanes are required", ErrWorkspaceGovernanceTopologyInvalid)
	}

	seen := map[string]bool{}
	normalized := make([]WorkspaceGovernanceLaneConfig, 0, len(values))
	for index, item := range values {
		label := strings.TrimSpace(item.Label)
		role := strings.TrimSpace(item.Role)
		if label == "" {
			return nil, fmt.Errorf("%w: lane %d label is required", ErrWorkspaceGovernanceTopologyInvalid, index+1)
		}
		if role == "" {
			return nil, fmt.Errorf("%w: lane %d role is required", ErrWorkspaceGovernanceTopologyInvalid, index+1)
		}

		laneID := slugify(defaultString(strings.TrimSpace(item.ID), label))
		if laneID == "" {
			laneID = fmt.Sprintf("lane-%d", index+1)
		}
		if seen[laneID] {
			return nil, fmt.Errorf("%w: duplicate lane id %q", ErrWorkspaceGovernanceTopologyInvalid, laneID)
		}
		seen[laneID] = true

		normalized = append(normalized, WorkspaceGovernanceLaneConfig{
			ID:           laneID,
			Label:        label,
			Role:         role,
			DefaultAgent: strings.TrimSpace(item.DefaultAgent),
			Lane:         strings.TrimSpace(item.Lane),
		})
	}

	return normalized, nil
}

func syncWorkspaceSnapshotDefaults(workspace *WorkspaceSnapshot) {
	now := time.Now().UTC().Format(time.RFC3339)
	defaultBinding := defaultWorkspaceRepoBinding(*workspace, now)
	defaultInstall := defaultWorkspaceGitHubInstallation(*workspace, now)
	defaultOnboarding := defaultWorkspaceOnboarding(now)
	defaultSandbox := defaultSandboxPolicy(now)
	defaultGovernanceTopology := defaultWorkspaceGovernanceTopology(defaultString(workspace.Onboarding.TemplateID, defaultOnboarding.TemplateID))

	if strings.TrimSpace(workspace.Repo) == "" {
		workspace.Repo = defaultBinding.Repo
	}
	if strings.TrimSpace(workspace.RepoURL) == "" {
		workspace.RepoURL = defaultBinding.RepoURL
	}
	if strings.TrimSpace(workspace.Branch) == "" {
		workspace.Branch = defaultBinding.Branch
	}
	if strings.TrimSpace(workspace.RepoProvider) == "" {
		workspace.RepoProvider = defaultBinding.Provider
	}
	if strings.TrimSpace(workspace.RepoBindingStatus) == "" {
		workspace.RepoBindingStatus = defaultBinding.BindingStatus
	}
	if strings.TrimSpace(workspace.RepoAuthMode) == "" {
		workspace.RepoAuthMode = defaultBinding.AuthMode
	}

	if strings.TrimSpace(workspace.RepoBinding.Repo) == "" {
		workspace.RepoBinding.Repo = workspace.Repo
	}
	if strings.TrimSpace(workspace.RepoBinding.RepoURL) == "" {
		workspace.RepoBinding.RepoURL = workspace.RepoURL
	}
	if strings.TrimSpace(workspace.RepoBinding.Branch) == "" {
		workspace.RepoBinding.Branch = workspace.Branch
	}
	if strings.TrimSpace(workspace.RepoBinding.Provider) == "" {
		workspace.RepoBinding.Provider = defaultString(workspace.RepoProvider, defaultBinding.Provider)
	}
	if strings.TrimSpace(workspace.RepoBinding.BindingStatus) == "" {
		workspace.RepoBinding.BindingStatus = defaultString(workspace.RepoBindingStatus, defaultBinding.BindingStatus)
	}
	if strings.TrimSpace(workspace.RepoBinding.AuthMode) == "" {
		workspace.RepoBinding.AuthMode = defaultString(workspace.RepoAuthMode, defaultBinding.AuthMode)
	}
	if strings.TrimSpace(workspace.RepoBinding.SyncedAt) == "" {
		workspace.RepoBinding.SyncedAt = defaultBinding.SyncedAt
	}

	workspace.Repo = workspace.RepoBinding.Repo
	workspace.RepoURL = workspace.RepoBinding.RepoURL
	workspace.Branch = workspace.RepoBinding.Branch
	workspace.RepoProvider = workspace.RepoBinding.Provider
	workspace.RepoBindingStatus = workspace.RepoBinding.BindingStatus
	workspace.RepoAuthMode = workspace.RepoBinding.AuthMode

	if strings.TrimSpace(workspace.GitHubInstallation.Provider) == "" {
		workspace.GitHubInstallation.Provider = defaultString(workspace.RepoProvider, defaultInstall.Provider)
	}
	if strings.TrimSpace(workspace.GitHubInstallation.PreferredAuthMode) == "" {
		workspace.GitHubInstallation.PreferredAuthMode = defaultString(workspace.RepoAuthMode, defaultInstall.PreferredAuthMode)
	}
	if workspace.GitHubInstallation.Missing == nil {
		workspace.GitHubInstallation.Missing = append([]string{}, defaultInstall.Missing...)
	}
	if strings.TrimSpace(workspace.GitHubInstallation.ConnectionMessage) == "" {
		workspace.GitHubInstallation.ConnectionMessage = defaultInstall.ConnectionMessage
	}
	if strings.TrimSpace(workspace.GitHubInstallation.SyncedAt) == "" {
		workspace.GitHubInstallation.SyncedAt = defaultInstall.SyncedAt
	}

	if strings.TrimSpace(workspace.Onboarding.Status) == "" {
		workspace.Onboarding.Status = defaultOnboarding.Status
	} else if normalized, err := normalizeWorkspaceOnboardingStatus(workspace.Onboarding.Status); err == nil {
		workspace.Onboarding.Status = normalized
	} else {
		workspace.Onboarding.Status = defaultOnboarding.Status
	}
	if strings.TrimSpace(workspace.Onboarding.TemplateID) == "" {
		workspace.Onboarding.TemplateID = defaultOnboarding.TemplateID
	} else {
		workspace.Onboarding.TemplateID = canonicalWorkspaceOnboardingTemplateID(workspace.Onboarding.TemplateID)
	}
	if strings.TrimSpace(workspace.Onboarding.CurrentStep) == "" {
		workspace.Onboarding.CurrentStep = defaultOnboarding.CurrentStep
	}
	if workspace.Onboarding.CompletedSteps == nil {
		workspace.Onboarding.CompletedSteps = append([]string{}, defaultOnboarding.CompletedSteps...)
	} else {
		workspace.Onboarding.CompletedSteps = normalizeCompletedSteps(workspace.Onboarding.CompletedSteps, defaultOnboarding.CompletedSteps)
	}
	if strings.TrimSpace(workspace.Onboarding.ResumeURL) == "" {
		workspace.Onboarding.ResumeURL = defaultOnboarding.ResumeURL
	}
	workspace.Onboarding.Materialization = workspaceOnboardingMaterialization(workspace.Onboarding.TemplateID)
	if strings.TrimSpace(workspace.Onboarding.UpdatedAt) == "" {
		workspace.Onboarding.UpdatedAt = defaultOnboarding.UpdatedAt
	}
	if len(workspace.Governance.ConfiguredTopology) == 0 {
		workspace.Governance.ConfiguredTopology = defaultGovernanceTopology
	} else if normalized, err := normalizeWorkspaceGovernanceTopology(workspace.Governance.ConfiguredTopology); err == nil {
		workspace.Governance.ConfiguredTopology = normalized
	} else {
		workspace.Governance.ConfiguredTopology = defaultGovernanceTopology
	}
	workspace.Governance.DeliveryDelegationMode = workspaceGovernanceDeliveryDelegationMode(*workspace)
	if strings.TrimSpace(workspace.Sandbox.Profile) == "" {
		workspace.Sandbox = defaultSandbox
	} else {
		syncSandboxPolicyDefaults(&workspace.Sandbox)
		if strings.TrimSpace(workspace.Sandbox.UpdatedAt) == "" {
			workspace.Sandbox.UpdatedAt = defaultSandbox.UpdatedAt
		}
		if strings.TrimSpace(workspace.Sandbox.UpdatedBy) == "" {
			workspace.Sandbox.UpdatedBy = defaultSandbox.UpdatedBy
		}
	}
}

func syncWorkspaceMemberDefaults(member *WorkspaceMember) {
	member.Preferences.StartRoute = defaultString(member.Preferences.StartRoute, defaultWorkspaceMemberPreferences().StartRoute)
	if github := firstIdentityForProvider(member.LinkedIdentities, "github"); github.Provider != "" {
		if strings.TrimSpace(member.GitHubIdentity.Provider) == "" || strings.TrimSpace(member.GitHubIdentity.Handle) == "" {
			member.GitHubIdentity = github
		}
	}
	if strings.EqualFold(strings.TrimSpace(member.GitHubIdentity.Provider), "github") && strings.TrimSpace(member.GitHubIdentity.Handle) != "" {
		member.GitHubIdentity.Provider = "github"
		member.LinkedIdentities = upsertWorkspaceMemberIdentity(member.LinkedIdentities, member.GitHubIdentity)
	}
}

func firstIdentityForProvider(items []AuthExternalIdentity, provider string) AuthExternalIdentity {
	for _, item := range items {
		if strings.EqualFold(strings.TrimSpace(item.Provider), provider) {
			return item
		}
	}
	return AuthExternalIdentity{}
}

func upsertWorkspaceMemberIdentity(items []AuthExternalIdentity, identity AuthExternalIdentity) []AuthExternalIdentity {
	if strings.TrimSpace(identity.Provider) == "" || strings.TrimSpace(identity.Handle) == "" {
		return items
	}

	next := append([]AuthExternalIdentity{}, items...)
	for index := range next {
		if strings.EqualFold(next[index].Provider, identity.Provider) {
			next[index] = identity
			return next
		}
	}
	return append(next, identity)
}

func (s *Store) UpdateWorkspaceConfig(input WorkspaceConfigUpdateInput) (State, WorkspaceSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	workspace := s.state.Workspace
	previousTemplateID := canonicalWorkspaceOnboardingTemplateID(workspace.Onboarding.TemplateID)
	if text := strings.TrimSpace(input.Plan); text != "" {
		workspace.Plan = text
	}
	if text := strings.TrimSpace(input.BrowserPush); text != "" {
		workspace.BrowserPush = text
	}
	if text := strings.TrimSpace(input.MemoryMode); text != "" {
		workspace.MemoryMode = text
	}
	if input.Sandbox != nil {
		policy, err := normalizeSandboxPolicyInput(*input.Sandbox, workspace.Sandbox, input.UpdatedBy)
		if err != nil {
			return State{}, WorkspaceSnapshot{}, err
		}
		workspace.Sandbox = policy
	}
	if input.Onboarding != nil {
		status, err := normalizeWorkspaceOnboardingStatus(defaultString(input.Onboarding.Status, workspace.Onboarding.Status))
		if err != nil {
			return State{}, WorkspaceSnapshot{}, err
		}
		resumeURL, err := normalizeWorkspaceResumeURL(defaultString(input.Onboarding.ResumeURL, workspace.Onboarding.ResumeURL))
		if err != nil {
			return State{}, WorkspaceSnapshot{}, err
		}
		workspace.Onboarding.Status = status
		workspace.Onboarding.TemplateID = canonicalWorkspaceOnboardingTemplateID(defaultString(strings.TrimSpace(input.Onboarding.TemplateID), workspace.Onboarding.TemplateID))
		workspace.Onboarding.CurrentStep = defaultString(strings.TrimSpace(input.Onboarding.CurrentStep), workspace.Onboarding.CurrentStep)
		workspace.Onboarding.ResumeURL = defaultString(resumeURL, workspace.Onboarding.ResumeURL)
		workspace.Onboarding.CompletedSteps = normalizeCompletedSteps(input.Onboarding.CompletedSteps, workspace.Onboarding.CompletedSteps)
		workspace.Onboarding.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	currentTemplateID := canonicalWorkspaceOnboardingTemplateID(workspace.Onboarding.TemplateID)
	if input.Governance != nil {
		mode, err := normalizeWorkspaceGovernanceDeliveryDelegationMode(defaultString(input.Governance.DeliveryDelegationMode, workspace.Governance.DeliveryDelegationMode))
		if err != nil {
			return State{}, WorkspaceSnapshot{}, err
		}
		workspace.Governance.DeliveryDelegationMode = mode
	}
	if input.Governance != nil && input.Governance.TeamTopology != nil {
		if len(input.Governance.TeamTopology) == 0 {
			workspace.Governance.ConfiguredTopology = defaultWorkspaceGovernanceTopology(currentTemplateID)
		} else {
			normalized, err := normalizeWorkspaceGovernanceTopology(input.Governance.TeamTopology)
			if err != nil {
				return State{}, WorkspaceSnapshot{}, err
			}
			workspace.Governance.ConfiguredTopology = normalized
		}
	} else if previousTemplateID != currentTemplateID {
		workspace.Governance.ConfiguredTopology = defaultWorkspaceGovernanceTopology(currentTemplateID)
	}

	s.state.Workspace = workspace
	syncWorkspaceSnapshotDefaults(&s.state.Workspace)
	if err := s.persistLocked(); err != nil {
		return State{}, WorkspaceSnapshot{}, err
	}
	nextState := cloneState(s.state)
	return nextState, nextState.Workspace, nil
}

func (s *Store) UpdateWorkspaceMemberPreferences(memberID string, input WorkspaceMemberPreferencesInput) (State, WorkspaceMember, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if strings.TrimSpace(s.state.Auth.Session.Status) != authSessionStatusActive {
		return State{}, WorkspaceMember{}, ErrAuthSessionRequired
	}

	index := s.findWorkspaceMemberByIDLocked(memberID)
	if index == -1 {
		return State{}, WorkspaceMember{}, ErrWorkspaceMemberNotFound
	}
	session := s.state.Auth.Session
	if session.MemberID != memberID && !sessionHasPermission(session, "workspace.manage") {
		return State{}, WorkspaceMember{}, ErrWorkspaceRoleForbidden
	}

	member := s.state.Auth.Members[index]
	if agentID := strings.TrimSpace(input.PreferredAgentID); agentID != "" {
		if s.findAgentByIDLocked(agentID) == -1 {
			return State{}, WorkspaceMember{}, ErrWorkspacePreferredAgentNotFound
		}
		member.Preferences.PreferredAgentID = agentID
	}
	startRoute, err := normalizeWorkspaceRoute(defaultString(input.StartRoute, member.Preferences.StartRoute))
	if err != nil {
		return State{}, WorkspaceMember{}, err
	}
	member.Preferences.StartRoute = defaultString(startRoute, member.Preferences.StartRoute)
	member.Preferences.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	if handle := strings.TrimSpace(input.GitHubHandle); handle != "" {
		member.GitHubIdentity = AuthExternalIdentity{
			Provider: "github",
			Handle:   handle,
			Status:   "bound",
			BoundAt:  member.Preferences.UpdatedAt,
		}
		member.LinkedIdentities = upsertWorkspaceMemberIdentity(member.LinkedIdentities, member.GitHubIdentity)
	}

	syncWorkspaceMemberDefaults(&member)
	s.state.Auth.Members[index] = member
	s.refreshAuthSessionLocked()
	if err := s.persistLocked(); err != nil {
		return State{}, WorkspaceMember{}, err
	}
	return cloneState(s.state), member, nil
}

func workspaceGitHubStatusFromSnapshot(workspace WorkspaceSnapshot) WorkspaceGitHubInstallSnapshot {
	snapshot := workspace.GitHubInstallation
	if strings.TrimSpace(snapshot.Provider) == "" {
		snapshot.Provider = defaultString(workspace.RepoProvider, "github")
	}
	if strings.TrimSpace(snapshot.PreferredAuthMode) == "" {
		snapshot.PreferredAuthMode = defaultString(workspace.RepoAuthMode, "local-git-origin")
	}
	if strings.TrimSpace(snapshot.ConnectionMessage) == "" {
		snapshot.ConnectionMessage = "正在等待 GitHub 安装或连接状态更新。"
	}
	return snapshot
}

func workspaceRepoBindingFromSnapshot(workspace WorkspaceSnapshot) WorkspaceRepoBindingSnapshot {
	snapshot := workspace.RepoBinding
	if strings.TrimSpace(snapshot.Repo) == "" {
		snapshot.Repo = workspace.Repo
	}
	if strings.TrimSpace(snapshot.RepoURL) == "" {
		snapshot.RepoURL = workspace.RepoURL
	}
	if strings.TrimSpace(snapshot.Branch) == "" {
		snapshot.Branch = workspace.Branch
	}
	if strings.TrimSpace(snapshot.Provider) == "" {
		snapshot.Provider = defaultString(workspace.RepoProvider, "github")
	}
	if strings.TrimSpace(snapshot.BindingStatus) == "" {
		snapshot.BindingStatus = defaultString(workspace.RepoBindingStatus, "pending")
	}
	if strings.TrimSpace(snapshot.AuthMode) == "" {
		snapshot.AuthMode = defaultString(workspace.RepoAuthMode, "local-git-origin")
	}
	return snapshot
}

func (s *Store) applyRepoBindingConnectionLocked(req RepoBindingInput, syncedAt string) {
	if strings.TrimSpace(s.state.Workspace.GitHubInstallation.Provider) == "" {
		s.state.Workspace.GitHubInstallation.Provider = defaultString(req.Provider, "github")
	}
	if strings.TrimSpace(req.PreferredAuthMode) != "" {
		s.state.Workspace.GitHubInstallation.PreferredAuthMode = strings.TrimSpace(req.PreferredAuthMode)
	}
	s.state.Workspace.GitHubInstallation.ConnectionReady = req.ConnectionReady
	s.state.Workspace.GitHubInstallation.AppConfigured = req.AppConfigured
	s.state.Workspace.GitHubInstallation.AppInstalled = req.AppInstalled
	s.state.Workspace.GitHubInstallation.InstallationID = strings.TrimSpace(req.InstallationID)
	s.state.Workspace.GitHubInstallation.InstallationURL = strings.TrimSpace(req.InstallationURL)
	s.state.Workspace.GitHubInstallation.ConnectionMessage = strings.TrimSpace(req.ConnectionMessage)
	s.state.Workspace.GitHubInstallation.SyncedAt = syncedAt
	if req.Missing != nil {
		s.state.Workspace.GitHubInstallation.Missing = append([]string{}, req.Missing...)
	}
}

func describeWorkspaceMemberPreferences(member WorkspaceMember) string {
	agent := defaultString(member.Preferences.PreferredAgentID, "未绑定")
	startRoute := defaultString(member.Preferences.StartRoute, "未声明")
	githubHandle := "未声明"
	if strings.TrimSpace(member.GitHubIdentity.Handle) != "" {
		githubHandle = member.GitHubIdentity.Handle
	}
	return fmt.Sprintf("preferred agent=%s / start route=%s / github=%s", agent, startRoute, githubHandle)
}
