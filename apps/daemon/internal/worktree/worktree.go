package worktree

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Request struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	Branch        string `json:"branch"`
	WorktreeName  string `json:"worktreeName"`
	BaseRef       string `json:"baseRef"`
	LeaseID       string `json:"leaseId,omitempty"`
	RunID         string `json:"runId,omitempty"`
	SessionID     string `json:"sessionId,omitempty"`
	RoomID        string `json:"roomId,omitempty"`
}

type Response struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	Branch        string `json:"branch"`
	WorktreeName  string `json:"worktreeName"`
	Path          string `json:"path"`
	Created       bool   `json:"created"`
	BaseRef       string `json:"baseRef"`
}

func Ensure(req Request, defaultRoot string) (Response, error) {
	root := strings.TrimSpace(req.WorkspaceRoot)
	if root == "" {
		root = defaultRoot
	}
	gitRoot, err := resolveGitRoot(root)
	if err != nil {
		return Response{}, err
	}

	branch := strings.TrimSpace(req.Branch)
	if branch == "" {
		return Response{}, fmt.Errorf("branch is required")
	}
	worktreeName := strings.TrimSpace(req.WorktreeName)
	if worktreeName == "" {
		worktreeName = strings.ReplaceAll(strings.TrimPrefix(branch, "feat/"), "/", "-")
	}
	baseRef := strings.TrimSpace(req.BaseRef)
	if baseRef == "" {
		baseRef = "HEAD"
	}

	targetPath := filepath.Join(filepath.Dir(gitRoot), ".openshock-worktrees", filepath.Base(gitRoot), worktreeName)
	if existingPath, ok := findWorktreeByBranch(gitRoot, branch); ok {
		return Response{WorkspaceRoot: gitRoot, Branch: branch, WorktreeName: worktreeName, Path: existingPath, Created: false, BaseRef: baseRef}, nil
	}

	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return Response{}, err
	}

	branchExists := gitRefExists(gitRoot, "refs/heads/"+branch)
	var args []string
	if branchExists {
		args = []string{"worktree", "add", targetPath, branch}
	} else {
		args = []string{"worktree", "add", "-b", branch, targetPath, baseRef}
	}
	if _, err := runGit(gitRoot, args...); err != nil {
		return Response{}, err
	}

	return Response{WorkspaceRoot: gitRoot, Branch: branch, WorktreeName: worktreeName, Path: targetPath, Created: true, BaseRef: baseRef}, nil
}

func resolveGitRoot(root string) (string, error) {
	output, err := runGit(root, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", fmt.Errorf("git root not found: %w", err)
	}
	return strings.TrimSpace(output), nil
}

func findWorktreeByBranch(root, branch string) (string, bool) {
	output, err := runGit(root, "worktree", "list", "--porcelain")
	if err != nil {
		return "", false
	}
	lines := strings.Split(output, "\n")
	currentPath := ""
	currentBranch := ""
	for _, line := range lines {
		switch {
		case strings.HasPrefix(line, "worktree "):
			currentPath = strings.TrimSpace(strings.TrimPrefix(line, "worktree "))
		case strings.HasPrefix(line, "branch "):
			currentBranch = strings.TrimSpace(strings.TrimPrefix(line, "branch refs/heads/"))
		case strings.TrimSpace(line) == "":
			if currentBranch == branch && currentPath != "" {
				return currentPath, true
			}
			currentPath = ""
			currentBranch = ""
		}
	}
	if currentBranch == branch && currentPath != "" {
		return currentPath, true
	}
	return "", false
}

func gitRefExists(root, ref string) bool {
	_, err := runGit(root, "show-ref", "--verify", "--quiet", ref)
	return err == nil
}

func runGit(root string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = root
	cmd.Env = os.Environ()

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err != nil {
		if stderr.Len() > 0 {
			return "", errors.New(strings.TrimSpace(stderr.String()))
		}
		return "", err
	}
	return strings.TrimSpace(stdout.String()), nil
}
