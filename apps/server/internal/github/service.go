package github

import (
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

type Runner interface {
	LookPath(file string) (string, error)
	CombinedOutput(name string, args ...string) ([]byte, error)
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

func (s *Service) git(workspaceRoot string, args ...string) (string, error) {
	commandArgs := append([]string{"-C", workspaceRoot}, args...)
	output, err := s.runner.CombinedOutput("git", commandArgs...)
	if err != nil {
		return "", fmt.Errorf("%s", strings.TrimSpace(string(output)))
	}
	return strings.TrimSpace(string(output)), nil
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
