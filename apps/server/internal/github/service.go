package github

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

type Status struct {
	Repo             string `json:"repo"`
	RepoURL          string `json:"repoUrl"`
	Branch           string `json:"branch"`
	Provider         string `json:"provider"`
	RemoteConfigured bool   `json:"remoteConfigured"`
	GHCLIInstalled   bool   `json:"ghCliInstalled"`
	GHAuthenticated  bool   `json:"ghAuthenticated"`
	Ready            bool   `json:"ready"`
	AuthMode         string `json:"authMode"`
	Message          string `json:"message"`
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
		Provider: "github",
		AuthMode: "unavailable",
		Message:  "尚未探测 GitHub 连接状态。",
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

	if _, err := s.runner.LookPath("gh"); err == nil {
		status.GHCLIInstalled = true
		status.AuthMode = "gh-cli"
		if _, err := s.runner.CombinedOutput("gh", "auth", "status", "--hostname", "github.com"); err == nil {
			status.GHAuthenticated = true
			status.Message = "GitHub CLI 已认证，可以继续推进真实远端 PR 集成。"
		} else {
			status.Message = "GitHub CLI 已安装，但当前没有认证。"
		}
	} else {
		status.Message = "未发现 GitHub CLI，当前只能维持本地 repo 绑定。"
	}

	status.Ready = status.RemoteConfigured && status.GHCLIInstalled && status.GHAuthenticated

	if !status.RemoteConfigured {
		status.Message = "当前仓库还没有 origin remote，无法进入真实 GitHub 闭环。"
	}

	if !status.Ready && status.RemoteConfigured && status.GHCLIInstalled && !status.GHAuthenticated {
		status.Message = "origin 已存在，但 GitHub CLI 尚未认证。"
	}

	if !status.Ready && status.RemoteConfigured && !status.GHCLIInstalled {
		status.Message = "origin 已存在，但机器上没有 gh CLI。"
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
