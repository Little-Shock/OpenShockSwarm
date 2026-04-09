package api

import (
	"fmt"
	"net/http"
	"path/filepath"
	"strings"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type branchHeadTruthResponse struct {
	Status              string                    `json:"status"`
	Summary             string                    `json:"summary"`
	RepoBinding         RepoBindingResponse       `json:"repoBinding"`
	GitHubConnection    githubsvc.Status          `json:"githubConnection"`
	GitHubProbeError    string                    `json:"githubProbeError,omitempty"`
	Checkout            branchHeadCheckoutTruth   `json:"checkout"`
	Refs                []branchHeadRefTruth      `json:"refs"`
	Worktrees           []branchHeadWorktreeTruth `json:"worktrees"`
	LiveService         liveServiceStatusResponse `json:"liveService"`
	Drifts              []branchHeadDrift         `json:"drifts"`
	LinkedWorktreeCount int                       `json:"linkedWorktreeCount"`
}

type branchHeadCheckoutTruth struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	WorktreePath  string `json:"worktreePath"`
	Repo          string `json:"repo,omitempty"`
	RepoURL       string `json:"repoUrl,omitempty"`
	Provider      string `json:"provider,omitempty"`
	Branch        string `json:"branch,omitempty"`
	Head          string `json:"head,omitempty"`
	Dirty         bool   `json:"dirty"`
	DirtyEntries  int    `json:"dirtyEntries"`
	Status        string `json:"status"`
	Message       string `json:"message,omitempty"`
}

type branchHeadRefTruth struct {
	Name    string `json:"name"`
	Head    string `json:"head,omitempty"`
	Present bool   `json:"present"`
}

type branchHeadWorktreeTruth struct {
	Path    string `json:"path"`
	Branch  string `json:"branch,omitempty"`
	Head    string `json:"head,omitempty"`
	Current bool   `json:"current"`
}

type branchHeadDrift struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
	Summary  string `json:"summary"`
}

func init() {
	registerServerRoutes(registerBranchHeadTruthRoutes)
}

func registerBranchHeadTruthRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/workspace/branch-head-truth", s.handleBranchHeadTruth)
}

func (s *Server) handleBranchHeadTruth(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.buildBranchHeadTruth())
}

func (s *Server) buildBranchHeadTruth() branchHeadTruthResponse {
	workspace := s.store.Snapshot().Workspace
	connection, probeErr := s.github.Probe(s.workspaceRoot)
	if probeErr == nil {
		connection = s.withGitHubPublicIngress(connection)
	}

	var binding RepoBindingResponse
	if probeErr == nil {
		binding = bindingResponseFromWorkspace(workspace, "", &connection)
	} else {
		binding = bindingResponseFromWorkspace(workspace, "", nil)
	}

	checkout := detectBranchHeadCheckoutTruth(s.workspaceRoot)
	liveService := buildLiveServiceStatus(s.workspaceRoot)
	refs := collectBranchHeadRefs(s.workspaceRoot, binding.Branch, checkout.Branch, liveService.Branch)
	worktrees := collectBranchHeadWorktrees(s.workspaceRoot)
	drifts := buildBranchHeadDrifts(binding, connection, probeErr, checkout, refs, worktrees, liveService)
	status, summary := summarizeBranchHeadTruth(drifts)

	response := branchHeadTruthResponse{
		Status:              status,
		Summary:             summary,
		RepoBinding:         binding,
		GitHubConnection:    fallbackGitHubConnectionTruth(workspace, connection, probeErr),
		Checkout:            checkout,
		Refs:                refs,
		Worktrees:           worktrees,
		LiveService:         liveService,
		Drifts:              drifts,
		LinkedWorktreeCount: len(worktrees),
	}
	if probeErr != nil {
		response.GitHubProbeError = probeErr.Error()
	}
	return response
}

func fallbackGitHubConnectionTruth(workspace store.WorkspaceSnapshot, live githubsvc.Status, probeErr error) githubsvc.Status {
	if probeErr == nil {
		return live
	}
	binding := storeBindingSnapshot(workspace)
	installation := workspaceGitHubInstallationSnapshot(workspace)
	message := strings.TrimSpace(installation.ConnectionMessage)
	if message == "" {
		message = fmt.Sprintf("GitHub probe failed: %s", probeErr.Error())
	}
	return githubsvc.Status{
		Repo:              defaultString(binding.Repo, workspace.Repo),
		RepoURL:           defaultString(binding.RepoURL, workspace.RepoURL),
		Branch:            defaultString(binding.Branch, workspace.Branch),
		Provider:          defaultString(binding.Provider, defaultString(workspace.RepoProvider, "github")),
		RemoteConfigured:  strings.TrimSpace(defaultString(binding.RepoURL, workspace.RepoURL)) != "",
		AppConfigured:     installation.AppConfigured,
		AppInstalled:      installation.AppInstalled,
		InstallationID:    installation.InstallationID,
		InstallationURL:   installation.InstallationURL,
		CallbackURL:       live.CallbackURL,
		WebhookURL:        live.WebhookURL,
		Missing:           append([]string(nil), installation.Missing...),
		Ready:             installation.ConnectionReady,
		AuthMode:          defaultString(strings.TrimSpace(workspace.RepoAuthMode), "unavailable"),
		PreferredAuthMode: defaultString(strings.TrimSpace(installation.PreferredAuthMode), defaultString(strings.TrimSpace(workspace.RepoAuthMode), "unavailable")),
		Message:           message,
	}
}

func detectBranchHeadCheckoutTruth(workspaceRoot string) branchHeadCheckoutTruth {
	response := branchHeadCheckoutTruth{
		WorkspaceRoot: workspaceRoot,
		WorktreePath:  workspaceRoot,
		Status:        "unavailable",
		Message:       "workspace root is empty; cannot inspect checkout truth",
	}
	if strings.TrimSpace(workspaceRoot) == "" {
		return response
	}

	repoURL, _ := runGit(workspaceRoot, "remote", "get-url", "origin")
	repo, provider := parseRepoIdentity(repoURL)
	branch, branchErr := runGit(workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD")
	head, headErr := runGit(workspaceRoot, "rev-parse", "--short", "HEAD")
	dirtyOutput, dirtyErr := runGit(workspaceRoot, "status", "--short")

	response.RepoURL = repoURL
	response.Repo = repo
	response.Provider = provider
	response.Branch = branch
	response.Head = head
	if dirtyErr == nil && strings.TrimSpace(dirtyOutput) != "" {
		response.Dirty = true
		response.DirtyEntries = countNonEmptyLines(dirtyOutput)
	}

	switch {
	case branchErr != nil && headErr != nil:
		response.Message = fmt.Sprintf("git checkout truth unavailable: %s / %s", branchErr.Error(), headErr.Error())
	case branchErr != nil:
		response.Message = fmt.Sprintf("git checkout branch unavailable: %s", branchErr.Error())
	case headErr != nil:
		response.Message = fmt.Sprintf("git checkout head unavailable: %s", headErr.Error())
	default:
		response.Status = "ready"
		if response.Dirty {
			response.Message = fmt.Sprintf("current checkout has %d dirty entries", response.DirtyEntries)
		} else {
			response.Message = "current checkout truth is readable"
		}
	}
	if response.Status != "ready" && response.Repo == "" && strings.TrimSpace(response.RepoURL) != "" {
		response.Repo, response.Provider = parseRepoIdentity(response.RepoURL)
	}
	return response
}

func collectBranchHeadRefs(workspaceRoot string, branches ...string) []branchHeadRefTruth {
	candidates := []struct {
		name string
		rev  string
	}{
		{name: "HEAD", rev: "HEAD"},
		{name: "dev", rev: "refs/heads/dev"},
		{name: "origin/dev", rev: "refs/remotes/origin/dev"},
		{name: "main", rev: "refs/heads/main"},
		{name: "origin/main", rev: "refs/remotes/origin/main"},
	}

	seen := map[string]bool{}
	appendBranchRefs := func(branch string) {
		branch = strings.TrimSpace(branch)
		if branch == "" || branch == "HEAD" {
			return
		}
		localName := branch
		remoteName := "origin/" + branch
		if !seen[localName] {
			candidates = append(candidates, struct {
				name string
				rev  string
			}{name: localName, rev: "refs/heads/" + branch})
			seen[localName] = true
		}
		if !seen[remoteName] {
			candidates = append(candidates, struct {
				name string
				rev  string
			}{name: remoteName, rev: "refs/remotes/origin/" + branch})
			seen[remoteName] = true
		}
	}
	for _, branch := range branches {
		appendBranchRefs(branch)
	}

	results := make([]branchHeadRefTruth, 0, len(candidates))
	reported := map[string]bool{}
	for _, candidate := range candidates {
		if reported[candidate.name] {
			continue
		}
		reported[candidate.name] = true
		head, err := runGit(workspaceRoot, "rev-parse", "--short", candidate.rev)
		results = append(results, branchHeadRefTruth{
			Name:    candidate.name,
			Head:    head,
			Present: err == nil && strings.TrimSpace(head) != "",
		})
	}
	return results
}

func collectBranchHeadWorktrees(workspaceRoot string) []branchHeadWorktreeTruth {
	output, err := runGit(workspaceRoot, "worktree", "list", "--porcelain")
	if err != nil {
		return nil
	}

	current := branchHeadWorktreeTruth{}
	results := make([]branchHeadWorktreeTruth, 0)
	flush := func() {
		if strings.TrimSpace(current.Path) == "" {
			return
		}
		current.Current = samePath(current.Path, workspaceRoot)
		results = append(results, current)
		current = branchHeadWorktreeTruth{}
	}

	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		switch {
		case line == "":
			flush()
		case strings.HasPrefix(line, "worktree "):
			flush()
			current.Path = strings.TrimSpace(strings.TrimPrefix(line, "worktree "))
		case strings.HasPrefix(line, "HEAD "):
			current.Head = shortenGitHead(strings.TrimSpace(strings.TrimPrefix(line, "HEAD ")))
		case strings.HasPrefix(line, "branch refs/heads/"):
			current.Branch = strings.TrimSpace(strings.TrimPrefix(line, "branch refs/heads/"))
		case strings.HasPrefix(line, "branch "):
			current.Branch = strings.TrimSpace(strings.TrimPrefix(line, "branch "))
		}
	}
	flush()
	return results
}

func buildBranchHeadDrifts(binding RepoBindingResponse, connection githubsvc.Status, probeErr error, checkout branchHeadCheckoutTruth, refs []branchHeadRefTruth, worktrees []branchHeadWorktreeTruth, liveService liveServiceStatusResponse) []branchHeadDrift {
	drifts := make([]branchHeadDrift, 0)
	appendIfMismatch := func(kind, leftLabel, leftValue, rightLabel, rightValue string) {
		leftValue = strings.TrimSpace(leftValue)
		rightValue = strings.TrimSpace(rightValue)
		if leftValue == "" || rightValue == "" || leftValue == rightValue {
			return
		}
		drifts = append(drifts, branchHeadDrift{
			Kind:     kind,
			Severity: "drift",
			Summary:  fmt.Sprintf("%s = %s, but %s = %s", leftLabel, leftValue, rightLabel, rightValue),
		})
	}

	appendIfMismatch("binding_vs_checkout_branch", "repo binding branch", binding.Branch, "current checkout branch", checkout.Branch)
	if probeErr == nil {
		appendIfMismatch("binding_vs_github_branch", "repo binding branch", binding.Branch, "GitHub probe branch", connection.Branch)
	}
	if liveService.Managed {
		appendIfMismatch("live_service_vs_binding_branch", "live service branch", liveService.Branch, "repo binding branch", binding.Branch)
		appendIfMismatch("live_service_vs_checkout_branch", "live service branch", liveService.Branch, "current checkout branch", checkout.Branch)
		if strings.TrimSpace(liveService.WorkspaceRoot) != "" && strings.TrimSpace(checkout.WorktreePath) != "" && !samePath(liveService.WorkspaceRoot, checkout.WorktreePath) {
			drifts = append(drifts, branchHeadDrift{
				Kind:     "live_service_workspace_root",
				Severity: "drift",
				Summary:  fmt.Sprintf("live service workspace root = %s, but current checkout worktree = %s", liveService.WorkspaceRoot, checkout.WorktreePath),
			})
		}
		for _, ref := range refs {
			if strings.TrimSpace(ref.Name) == strings.TrimSpace(liveService.Branch) && ref.Present && strings.TrimSpace(ref.Head) != "" && strings.TrimSpace(ref.Head) != strings.TrimSpace(liveService.Head) {
				drifts = append(drifts, branchHeadDrift{
					Kind:     "live_service_vs_branch_ref_head",
					Severity: "drift",
					Summary:  fmt.Sprintf("live service head = %s, but local ref %s = %s", liveService.Head, ref.Name, ref.Head),
				})
				break
			}
		}
	}
	refHeads := map[string]string{}
	for _, ref := range refs {
		if ref.Present {
			refHeads[ref.Name] = ref.Head
		}
	}
	if refHeads["dev"] != "" && refHeads["origin/dev"] != "" && refHeads["dev"] != refHeads["origin/dev"] {
		drifts = append(drifts, branchHeadDrift{
			Kind:     "local_vs_remote_dev_ref",
			Severity: "drift",
			Summary:  fmt.Sprintf("local dev = %s, but origin/dev = %s", refHeads["dev"], refHeads["origin/dev"]),
		})
	}
	if checkout.Dirty {
		drifts = append(drifts, branchHeadDrift{
			Kind:     "checkout_dirty",
			Severity: "warning",
			Summary:  fmt.Sprintf("current checkout has %d dirty entries", checkout.DirtyEntries),
		})
	}
	if len(worktrees) > 1 {
		drifts = append(drifts, branchHeadDrift{
			Kind:     "linked_worktrees_visible",
			Severity: "warning",
			Summary:  fmt.Sprintf("repo currently exposes %d linked worktrees", len(worktrees)),
		})
	}
	if probeErr != nil {
		drifts = append(drifts, branchHeadDrift{
			Kind:     "github_probe_error",
			Severity: "warning",
			Summary:  fmt.Sprintf("GitHub probe currently failed: %s", probeErr.Error()),
		})
	}
	return drifts
}

func summarizeBranchHeadTruth(drifts []branchHeadDrift) (string, string) {
	if len(drifts) == 0 {
		return "aligned", "repo binding, GitHub probe, current checkout, and live service truth are aligned"
	}

	status := "attention"
	summaries := make([]string, 0, len(drifts))
	for _, drift := range drifts {
		if drift.Severity == "drift" {
			status = "drift"
		}
		summaries = append(summaries, drift.Summary)
	}
	if len(summaries) > 3 {
		summaries = append(summaries[:3], fmt.Sprintf("and %d more", len(drifts)-3))
	}
	return status, strings.Join(summaries, "; ")
}

func shortenGitHead(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 8 {
		return value[:8]
	}
	return value
}

func countNonEmptyLines(value string) int {
	count := 0
	for _, line := range strings.Split(value, "\n") {
		if strings.TrimSpace(line) != "" {
			count++
		}
	}
	return count
}

func samePath(left, right string) bool {
	return filepath.Clean(strings.TrimSpace(left)) == filepath.Clean(strings.TrimSpace(right))
}
