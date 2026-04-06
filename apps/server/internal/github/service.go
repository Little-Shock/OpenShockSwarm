package github

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type Status struct {
	Repo              string   `json:"repo"`
	RepoURL           string   `json:"repoUrl"`
	Branch            string   `json:"branch"`
	Provider          string   `json:"provider"`
	RemoteConfigured  bool     `json:"remoteConfigured"`
	GHCLIInstalled    bool     `json:"ghCliInstalled"`
	GHAuthenticated   bool     `json:"ghAuthenticated"`
	AppID             string   `json:"appId"`
	AppSlug           string   `json:"appSlug"`
	AppConfigured     bool     `json:"appConfigured"`
	AppInstalled      bool     `json:"appInstalled"`
	InstallationID    string   `json:"installationId"`
	InstallationURL   string   `json:"installationUrl"`
	Missing           []string `json:"missing,omitempty"`
	Ready             bool     `json:"ready"`
	AuthMode          string   `json:"authMode"`
	PreferredAuthMode string   `json:"preferredAuthMode,omitempty"`
	Message           string   `json:"message"`
}

type Prober interface {
	Probe(workspaceRoot string) (Status, error)
}

type Client interface {
	Prober
	CreatePullRequest(workspaceRoot string, input CreatePullRequestInput) (PullRequest, error)
	SyncPullRequest(workspaceRoot string, input SyncPullRequestInput) (PullRequest, error)
	MergePullRequest(workspaceRoot string, input MergePullRequestInput) (PullRequest, error)
}

type Runner interface {
	LookPath(file string) (string, error)
	CombinedOutput(name string, args ...string) ([]byte, error)
}

type CreatePullRequestInput struct {
	Repo       string
	BaseBranch string
	HeadBranch string
	Title      string
	Body       string
}

type SyncPullRequestInput struct {
	Repo   string
	Number int
}

type MergePullRequestInput struct {
	Repo   string
	Number int
	Method string
}

type PullRequest struct {
	Number         int    `json:"number"`
	URL            string `json:"url"`
	Title          string `json:"title"`
	State          string `json:"state"`
	IsDraft        bool   `json:"isDraft"`
	ReviewDecision string `json:"reviewDecision"`
	HeadRefName    string `json:"headRefName"`
	BaseRefName    string `json:"baseRefName"`
	Author         string `json:"author"`
	UpdatedAt      string `json:"updatedAt"`
	Merged         bool   `json:"merged"`
}

type Service struct {
	runner Runner
}

type execRunner struct{}

func NewService(runner Runner) *Service {
	if runner == nil {
		runner = execRunner{}
	}
	return &Service{runner: runner}
}

func (s *Service) Probe(workspaceRoot string) (Status, error) {
	status := Status{
		Provider:          "github",
		AuthMode:          "unavailable",
		PreferredAuthMode: "unavailable",
		Message:           "尚未探测 GitHub 连接状态。",
	}

	repoURL, repoErr := s.git(workspaceRoot, "remote", "get-url", "origin")
	if repoErr == nil && strings.TrimSpace(repoURL) != "" {
		status.RepoURL = repoURL
		status.RemoteConfigured = true
		status.Repo, status.Provider = ParseRepoIdentity(repoURL)
	}

	branch, branchErr := s.git(workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD")
	if branchErr == nil {
		status.Branch = branch
	}

	appStatus := detectGitHubAppProbe()
	status.AppID = appStatus.AppID
	status.AppSlug = appStatus.AppSlug
	status.AppConfigured = appStatus.Configured
	status.AppInstalled = appStatus.Installed
	status.InstallationID = appStatus.InstallationID
	status.InstallationURL = appStatus.InstallationURL
	if len(appStatus.Missing) > 0 {
		status.Missing = append([]string(nil), appStatus.Missing...)
	}

	if _, err := s.runner.LookPath("gh"); err == nil {
		status.GHCLIInstalled = true
		if _, err := s.runner.CombinedOutput("gh", "auth", "status", "--hostname", "github.com"); err == nil {
			status.GHAuthenticated = true
		}
	}

	appReady := status.RemoteConfigured && status.AppConfigured && status.AppInstalled && status.Provider == "github"
	ghReady := status.RemoteConfigured && status.GHCLIInstalled && status.GHAuthenticated
	status.Ready = appReady || ghReady

	switch {
	case appReady:
		status.AuthMode = "github-app"
		status.PreferredAuthMode = "github-app"
		status.Message = githubAppProbeMessage(status, appReady, ghReady)
	case ghReady:
		status.AuthMode = "gh-cli"
		if appStatus.Enabled {
			status.PreferredAuthMode = "github-app"
			status.Message = githubAppProbeMessage(status, appReady, ghReady)
			break
		}
		status.PreferredAuthMode = "gh-cli"
		switch {
		case !status.RemoteConfigured:
			status.Message = "当前仓库还没有 origin remote，无法进入真实 GitHub 闭环。"
		case status.GHAuthenticated:
			status.Message = "GitHub CLI 已认证，可以继续推进真实远端 PR 集成。"
		default:
			status.Message = "origin 已存在，但 GitHub CLI 尚未认证。"
		}
	case appStatus.Enabled:
		status.PreferredAuthMode = "github-app"
		status.Message = githubAppProbeMessage(status, appReady, ghReady)
	case status.GHCLIInstalled:
		status.PreferredAuthMode = "gh-cli"
		switch {
		case !status.RemoteConfigured:
			status.Message = "当前仓库还没有 origin remote，无法进入真实 GitHub 闭环。"
		case status.GHAuthenticated:
			status.Message = "GitHub CLI 已认证，可以继续推进真实远端 PR 集成。"
		default:
			status.Message = "origin 已存在，但 GitHub CLI 尚未认证。"
		}
	default:
		switch {
		case !status.RemoteConfigured:
			status.Message = "当前仓库还没有 origin remote，无法进入真实 GitHub 闭环。"
		default:
			status.Message = "origin 已存在，但机器上没有 gh CLI。"
		}
	}

	return status, nil
}

func (s *Service) CreatePullRequest(workspaceRoot string, input CreatePullRequestInput) (PullRequest, error) {
	if strings.TrimSpace(input.Repo) == "" {
		return PullRequest{}, fmt.Errorf("repo is required")
	}
	if strings.TrimSpace(input.BaseBranch) == "" {
		return PullRequest{}, fmt.Errorf("base branch is required")
	}
	if strings.TrimSpace(input.HeadBranch) == "" {
		return PullRequest{}, fmt.Errorf("head branch is required")
	}
	if strings.TrimSpace(input.Title) == "" {
		return PullRequest{}, fmt.Errorf("title is required")
	}
	if _, err := s.runner.LookPath("gh"); err != nil {
		return PullRequest{}, fmt.Errorf("gh CLI not found")
	}

	if _, err := s.git(workspaceRoot, "push", "-u", "origin", input.HeadBranch); err != nil {
		return PullRequest{}, fmt.Errorf("push branch to origin: %w", err)
	}

	output, err := s.runner.CombinedOutput(
		"gh",
		"pr", "create",
		"--repo", input.Repo,
		"--base", input.BaseBranch,
		"--head", input.HeadBranch,
		"--title", input.Title,
		"--body", input.Body,
	)
	if err != nil {
		return PullRequest{}, fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}

	identifier := lastNonEmptyLine(string(output))
	if identifier == "" {
		return PullRequest{}, fmt.Errorf("gh pr create returned empty output")
	}

	return s.viewPullRequest(input.Repo, identifier)
}

func (s *Service) SyncPullRequest(_ string, input SyncPullRequestInput) (PullRequest, error) {
	if strings.TrimSpace(input.Repo) == "" {
		return PullRequest{}, fmt.Errorf("repo is required")
	}
	if input.Number <= 0 {
		return PullRequest{}, fmt.Errorf("pull request number is required")
	}
	if _, err := s.runner.LookPath("gh"); err != nil {
		return PullRequest{}, fmt.Errorf("gh CLI not found")
	}
	return s.viewPullRequest(input.Repo, fmt.Sprintf("%d", input.Number))
}

func (s *Service) MergePullRequest(workspaceRoot string, input MergePullRequestInput) (PullRequest, error) {
	if strings.TrimSpace(input.Repo) == "" {
		return PullRequest{}, fmt.Errorf("repo is required")
	}
	if input.Number <= 0 {
		return PullRequest{}, fmt.Errorf("pull request number is required")
	}
	if _, err := s.runner.LookPath("gh"); err != nil {
		return PullRequest{}, fmt.Errorf("gh CLI not found")
	}

	method := defaultString(strings.TrimSpace(input.Method), "merge")
	output, err := s.runner.CombinedOutput(
		"gh",
		"pr", "merge",
		fmt.Sprintf("%d", input.Number),
		"--repo", input.Repo,
		"--"+method,
		"--delete-branch=false",
	)
	if err != nil {
		return PullRequest{}, fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}

	return s.SyncPullRequest(workspaceRoot, SyncPullRequestInput{
		Repo:   input.Repo,
		Number: input.Number,
	})
}

func (s *Service) git(workspaceRoot string, args ...string) (string, error) {
	commandArgs := append([]string{"-C", workspaceRoot}, args...)
	output, err := s.runner.CombinedOutput("git", commandArgs...)
	if err != nil {
		return "", fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
}

func (s *Service) viewPullRequest(repo, identifier string) (PullRequest, error) {
	output, err := s.runner.CombinedOutput(
		"gh",
		"pr", "view",
		identifier,
		"--repo", repo,
		"--json", "number,title,url,state,isDraft,reviewDecision,headRefName,baseRefName,author,updatedAt,mergedAt",
	)
	if err != nil {
		return PullRequest{}, fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}

	var payload struct {
		Number         int    `json:"number"`
		Title          string `json:"title"`
		URL            string `json:"url"`
		State          string `json:"state"`
		IsDraft        bool   `json:"isDraft"`
		ReviewDecision string `json:"reviewDecision"`
		HeadRefName    string `json:"headRefName"`
		BaseRefName    string `json:"baseRefName"`
		UpdatedAt      string `json:"updatedAt"`
		MergedAt       string `json:"mergedAt"`
		Author         struct {
			Login string `json:"login"`
		} `json:"author"`
	}
	if err := json.Unmarshal(output, &payload); err != nil {
		return PullRequest{}, fmt.Errorf("decode gh pr view payload: %w", err)
	}

	return PullRequest{
		Number:         payload.Number,
		URL:            payload.URL,
		Title:          payload.Title,
		State:          payload.State,
		IsDraft:        payload.IsDraft,
		ReviewDecision: payload.ReviewDecision,
		HeadRefName:    payload.HeadRefName,
		BaseRefName:    payload.BaseRefName,
		Author:         payload.Author.Login,
		UpdatedAt:      payload.UpdatedAt,
		Merged:         strings.TrimSpace(payload.MergedAt) != "",
	}, nil
}

func ParseRepoIdentity(remoteURL string) (string, string) {
	if strings.HasPrefix(remoteURL, "git@") {
		hostPath := strings.TrimPrefix(remoteURL, "git@")
		hostPath = strings.Replace(hostPath, ":", "/", 1)
		parts := strings.SplitN(hostPath, "/", 2)
		if len(parts) != 2 {
			return "", "github"
		}
		return normalizeRepoPath(parts[1]), detectProvider(parts[0])
	}

	if strings.HasPrefix(remoteURL, "https://") || strings.HasPrefix(remoteURL, "http://") {
		sansScheme := strings.TrimPrefix(strings.TrimPrefix(remoteURL, "https://"), "http://")
		parts := strings.SplitN(sansScheme, "/", 2)
		if len(parts) != 2 {
			return "", "github"
		}
		return normalizeRepoPath(parts[1]), detectProvider(parts[0])
	}

	return "", "github"
}

func normalizeRepoPath(raw string) string {
	clean := strings.TrimSpace(raw)
	clean = strings.TrimSuffix(clean, ".git")
	clean = strings.Trim(clean, "/")
	return clean
}

func detectProvider(host string) string {
	normalized := strings.ToLower(strings.TrimSpace(host))
	switch {
	case strings.Contains(normalized, "github"):
		return "github"
	case strings.Contains(normalized, "gitlab"):
		return "gitlab"
	case strings.Contains(normalized, "bitbucket"):
		return "bitbucket"
	default:
		return normalized
	}
}

type appProbeStatus struct {
	Enabled         bool
	Configured      bool
	Installed       bool
	AppID           string
	AppSlug         string
	InstallationID  string
	InstallationURL string
	Missing         []string
}

func detectGitHubAppProbe() appProbeStatus {
	appID := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_ID"))
	appSlug := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_SLUG"))
	installationID := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID"))
	privateKey := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY"))
	privateKeyPath := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY_PATH"))
	installationURL := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_INSTALL_URL"))

	enabled := appID != "" || appSlug != "" || installationID != "" || privateKey != "" || privateKeyPath != "" || installationURL != ""
	configured := appID != "" && (privateKey != "" || privateKeyPath != "")
	installed := configured && installationID != ""
	if installationURL == "" {
		switch {
		case installationID != "":
			installationURL = "https://github.com/settings/installations/" + installationID
		case appSlug != "":
			installationURL = "https://github.com/apps/" + appSlug + "/installations/new"
		}
	}

	missing := make([]string, 0, 3)
	if enabled {
		if appID == "" {
			missing = append(missing, "appId")
		}
		if privateKey == "" && privateKeyPath == "" {
			missing = append(missing, "privateKey")
		}
		if installationID == "" {
			missing = append(missing, "installationId")
		}
	}

	return appProbeStatus{
		Enabled:         enabled,
		Configured:      configured,
		Installed:       installed,
		AppID:           appID,
		AppSlug:         appSlug,
		InstallationID:  installationID,
		InstallationURL: installationURL,
		Missing:         missing,
	}
}

func githubAppProbeMessage(status Status, appReady, ghReady bool) string {
	switch {
	case !status.RemoteConfigured:
		return "GitHub App 配置已探测，但当前仓库还没有 origin remote。"
	case !status.AppConfigured && ghReady:
		return fmt.Sprintf("GitHub App 配置不完整，缺少 %s；当前仍退回 gh CLI。", strings.Join(status.Missing, " / "))
	case !status.AppConfigured:
		return fmt.Sprintf("GitHub App 配置不完整，缺少 %s。", strings.Join(status.Missing, " / "))
	case !status.AppInstalled && ghReady:
		return "GitHub App 已配置，但 installation 还未完成；当前仍退回 gh CLI。"
	case !status.AppInstalled:
		return "GitHub App 已配置，但 installation 还未完成。"
	case ghReady:
		return "GitHub App installation 已就绪；当前 gh CLI 也已认证，可并行支撑 repo binding 与现有 PR 闭环。"
	case status.GHCLIInstalled && !status.GHAuthenticated:
		return "GitHub App installation 已就绪；gh CLI 尚未认证，但不影响 installation / repo binding contract。"
	default:
		return "GitHub App installation 已就绪，可以继续推进 repo binding 与 webhook contract。"
	}
}

func (execRunner) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}

func (execRunner) CombinedOutput(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).CombinedOutput()
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func lastNonEmptyLine(output string) string {
	lines := strings.Split(strings.TrimSpace(output), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if text := strings.TrimSpace(lines[index]); text != "" {
			return text
		}
	}
	return ""
}
