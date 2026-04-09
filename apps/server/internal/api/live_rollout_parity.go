package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type liveRolloutParityResponse struct {
	Status        string                   `json:"status"`
	Summary       string                   `json:"summary"`
	TargetBaseURL string                   `json:"targetBaseUrl"`
	Current       liveRolloutCurrentTruth  `json:"current"`
	Actual        liveRolloutActualTruth   `json:"actual"`
	Drifts        []liveRolloutParityDrift `json:"drifts"`
}

type liveRolloutCurrentTruth struct {
	Repo                   string `json:"repo,omitempty"`
	Branch                 string `json:"branch,omitempty"`
	StartRoute             string `json:"startRoute"`
	HomeRoute              string `json:"homeRoute"`
	FirstScreenStatus      string `json:"firstScreenStatus"`
	FirstScreenSummary     string `json:"firstScreenSummary"`
	ExperienceSummary      string `json:"experienceSummary"`
	LiveServiceRoute       string `json:"liveServiceRoute"`
	ExperienceMetricsRoute string `json:"experienceMetricsRoute"`
}

type liveRolloutActualTruth struct {
	Health            liveRolloutHealthTruth            `json:"health"`
	State             liveRolloutStateTruth             `json:"state"`
	LiveService       liveRolloutLiveServiceTruth       `json:"liveService"`
	ExperienceMetrics liveRolloutExperienceMetricsTruth `json:"experienceMetrics"`
}

type liveRolloutHealthTruth struct {
	Reachable  bool   `json:"reachable"`
	StatusCode int    `json:"statusCode"`
	OK         bool   `json:"ok"`
	Service    string `json:"service,omitempty"`
	Error      string `json:"error,omitempty"`
}

type liveRolloutStateTruth struct {
	Reachable        bool   `json:"reachable"`
	StatusCode       int    `json:"statusCode"`
	Repo             string `json:"repo,omitempty"`
	Branch           string `json:"branch,omitempty"`
	StartRoute       string `json:"startRoute,omitempty"`
	OnboardingStatus string `json:"onboardingStatus,omitempty"`
	Error            string `json:"error,omitempty"`
}

type liveRolloutLiveServiceTruth struct {
	Reachable  bool   `json:"reachable"`
	StatusCode int    `json:"statusCode"`
	Available  bool   `json:"available"`
	Managed    bool   `json:"managed"`
	Status     string `json:"status,omitempty"`
	Owner      string `json:"owner,omitempty"`
	Branch     string `json:"branch,omitempty"`
	Head       string `json:"head,omitempty"`
	Error      string `json:"error,omitempty"`
}

type liveRolloutExperienceMetricsTruth struct {
	Reachable                bool   `json:"reachable"`
	StatusCode               int    `json:"statusCode"`
	Available                bool   `json:"available"`
	Summary                  string `json:"summary,omitempty"`
	Branch                   string `json:"branch,omitempty"`
	CollaborationShellStatus string `json:"collaborationShellStatus,omitempty"`
	CollaborationShellValue  string `json:"collaborationShellValue,omitempty"`
	Error                    string `json:"error,omitempty"`
}

type liveRolloutParityDrift struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
	Summary  string `json:"summary"`
}

type liveRolloutProbeMeta struct {
	reachable  bool
	statusCode int
	available  bool
	error      string
}

type liveRolloutHealthPayload struct {
	OK      bool   `json:"ok"`
	Service string `json:"service"`
}

type liveRolloutStatePayload struct {
	Workspace struct {
		Repo       string `json:"repo"`
		Branch     string `json:"branch"`
		Onboarding struct {
			Status string `json:"status"`
		} `json:"onboarding"`
	} `json:"workspace"`
	Auth struct {
		Session struct {
			Preferences struct {
				StartRoute string `json:"startRoute"`
			} `json:"preferences"`
		} `json:"session"`
	} `json:"auth"`
}

func init() {
	registerServerRoutes(registerLiveRolloutParityRoutes)
}

func registerLiveRolloutParityRoutes(s *Server, mux *http.ServeMux) {
	mux.HandleFunc("/v1/workspace/live-rollout-parity", s.handleLiveRolloutParity)
}

func (s *Server) handleLiveRolloutParity(w http.ResponseWriter, r *http.Request) {
	if !requireMethod(w, r, http.MethodGet) {
		return
	}
	writeJSON(w, http.StatusOK, s.buildLiveRolloutParity())
}

func (s *Server) buildLiveRolloutParity() liveRolloutParityResponse {
	snapshot := s.store.Snapshot()
	currentMetrics := s.store.ExperienceMetrics()
	currentFirstScreen, _ := findExperienceMetricInSections(currentMetrics.Sections, "collaboration-shell-first")
	currentRepo, currentBranch := detectLiveRolloutCurrentCheckout(s.workspaceRoot)
	targetBaseURL := s.actualLiveURLValue()

	current := liveRolloutCurrentTruth{
		Repo:                   defaultString(currentMetrics.Repo, defaultString(currentRepo, snapshot.Workspace.Repo)),
		Branch:                 defaultString(currentMetrics.Branch, currentBranch),
		StartRoute:             defaultString(currentFirstScreen.Value, "/chat/all"),
		HomeRoute:              "/chat/all",
		FirstScreenStatus:      defaultString(currentFirstScreen.Status, "blocked"),
		FirstScreenSummary:     defaultString(currentFirstScreen.Summary, "Current first-screen truth should land in a collaboration shell."),
		ExperienceSummary:      currentMetrics.Summary,
		LiveServiceRoute:       "/v1/runtime/live-service",
		ExperienceMetricsRoute: "/v1/experience-metrics",
	}
	actual := s.probeActualLiveRollout(targetBaseURL)
	drifts := buildLiveRolloutParityDrifts(current, actual, targetBaseURL)
	status, summary := summarizeLiveRolloutParity(current, actual, drifts, targetBaseURL)

	return liveRolloutParityResponse{
		Status:        status,
		Summary:       summary,
		TargetBaseURL: targetBaseURL,
		Current:       current,
		Actual:        actual,
		Drifts:        drifts,
	}
}

func (s *Server) probeActualLiveRollout(baseURL string) liveRolloutActualTruth {
	return liveRolloutActualTruth{
		Health:            s.probeActualLiveHealth(baseURL),
		State:             s.probeActualLiveState(baseURL),
		LiveService:       s.probeActualLiveService(baseURL),
		ExperienceMetrics: s.probeActualLiveExperienceMetrics(baseURL),
	}
}

func (s *Server) probeActualLiveHealth(baseURL string) liveRolloutHealthTruth {
	var payload liveRolloutHealthPayload
	meta := s.probeActualLiveJSON(baseURL, "/healthz", &payload)
	return liveRolloutHealthTruth{
		Reachable:  meta.reachable,
		StatusCode: meta.statusCode,
		OK:         meta.available && payload.OK,
		Service:    strings.TrimSpace(payload.Service),
		Error:      meta.error,
	}
}

func (s *Server) probeActualLiveState(baseURL string) liveRolloutStateTruth {
	var payload liveRolloutStatePayload
	meta := s.probeActualLiveJSON(baseURL, "/v1/state", &payload)
	return liveRolloutStateTruth{
		Reachable:        meta.reachable,
		StatusCode:       meta.statusCode,
		Repo:             strings.TrimSpace(payload.Workspace.Repo),
		Branch:           strings.TrimSpace(payload.Workspace.Branch),
		StartRoute:       strings.TrimSpace(payload.Auth.Session.Preferences.StartRoute),
		OnboardingStatus: strings.TrimSpace(payload.Workspace.Onboarding.Status),
		Error:            meta.error,
	}
}

func (s *Server) probeActualLiveService(baseURL string) liveRolloutLiveServiceTruth {
	var payload liveServiceStatusResponse
	meta := s.probeActualLiveJSON(baseURL, "/v1/runtime/live-service", &payload)
	return liveRolloutLiveServiceTruth{
		Reachable:  meta.reachable,
		StatusCode: meta.statusCode,
		Available:  meta.available,
		Managed:    payload.Managed,
		Status:     strings.TrimSpace(payload.Status),
		Owner:      strings.TrimSpace(payload.Owner),
		Branch:     strings.TrimSpace(payload.Branch),
		Head:       strings.TrimSpace(payload.Head),
		Error:      meta.error,
	}
}

func (s *Server) probeActualLiveExperienceMetrics(baseURL string) liveRolloutExperienceMetricsTruth {
	var payload store.ExperienceMetricsSnapshot
	meta := s.probeActualLiveJSON(baseURL, "/v1/experience-metrics", &payload)
	collaborationShell, _ := findExperienceMetricInSections(payload.Sections, "collaboration-shell-first")
	return liveRolloutExperienceMetricsTruth{
		Reachable:                meta.reachable,
		StatusCode:               meta.statusCode,
		Available:                meta.available,
		Summary:                  strings.TrimSpace(payload.Summary),
		Branch:                   strings.TrimSpace(payload.Branch),
		CollaborationShellStatus: strings.TrimSpace(collaborationShell.Status),
		CollaborationShellValue:  strings.TrimSpace(collaborationShell.Value),
		Error:                    meta.error,
	}
}

func (s *Server) probeActualLiveJSON(baseURL, route string, target any) liveRolloutProbeMeta {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(baseURL, "/")+route, nil)
	if err != nil {
		return liveRolloutProbeMeta{error: err.Error()}
	}

	response, err := s.httpClient.Do(request)
	if err != nil {
		return liveRolloutProbeMeta{error: err.Error()}
	}
	defer response.Body.Close()

	body, err := io.ReadAll(response.Body)
	if err != nil {
		return liveRolloutProbeMeta{
			reachable:  true,
			statusCode: response.StatusCode,
			error:      err.Error(),
		}
	}

	meta := liveRolloutProbeMeta{
		reachable:  true,
		statusCode: response.StatusCode,
	}

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		meta.error = strings.TrimSpace(string(body))
		if meta.error == "" {
			meta.error = response.Status
		}
		return meta
	}

	if target != nil {
		if err := json.Unmarshal(body, target); err != nil {
			meta.error = err.Error()
			return meta
		}
	}

	meta.available = true
	return meta
}

func buildLiveRolloutParityDrifts(current liveRolloutCurrentTruth, actual liveRolloutActualTruth, targetBaseURL string) []liveRolloutParityDrift {
	drifts := make([]liveRolloutParityDrift, 0)
	appendDrift := func(kind, severity, summary string) {
		drifts = append(drifts, liveRolloutParityDrift{
			Kind:     kind,
			Severity: severity,
			Summary:  summary,
		})
	}

	if !actual.Health.Reachable {
		appendDrift("actual_live_unreachable", "drift", fmt.Sprintf("actual live target %s is not reachable: %s", targetBaseURL, defaultString(actual.Health.Error, "health probe failed")))
		return drifts
	}
	if !actual.Health.OK {
		appendDrift("actual_live_health_not_ready", "drift", fmt.Sprintf("actual live target %s answered health with status %d (%s)", targetBaseURL, actual.Health.StatusCode, defaultString(actual.Health.Error, "not ready")))
	}

	if !actual.LiveService.Available {
		switch actual.LiveService.StatusCode {
		case http.StatusNotFound:
			appendDrift("missing_live_service_route", "drift", fmt.Sprintf("actual live target %s still returns 404 for /v1/runtime/live-service", targetBaseURL))
		case 0:
			appendDrift("live_service_probe_failed", "drift", fmt.Sprintf("actual live target %s did not return /v1/runtime/live-service: %s", targetBaseURL, defaultString(actual.LiveService.Error, "probe failed")))
		default:
			appendDrift("live_service_probe_failed", "drift", fmt.Sprintf("actual live target %s returned %d for /v1/runtime/live-service: %s", targetBaseURL, actual.LiveService.StatusCode, defaultString(actual.LiveService.Error, "probe failed")))
		}
	}

	if !actual.ExperienceMetrics.Available {
		switch actual.ExperienceMetrics.StatusCode {
		case http.StatusNotFound:
			appendDrift("missing_experience_metrics_route", "drift", fmt.Sprintf("actual live target %s still returns 404 for /v1/experience-metrics", targetBaseURL))
		case 0:
			appendDrift("experience_metrics_probe_failed", "drift", fmt.Sprintf("actual live target %s did not return /v1/experience-metrics: %s", targetBaseURL, defaultString(actual.ExperienceMetrics.Error, "probe failed")))
		default:
			appendDrift("experience_metrics_probe_failed", "drift", fmt.Sprintf("actual live target %s returned %d for /v1/experience-metrics: %s", targetBaseURL, actual.ExperienceMetrics.StatusCode, defaultString(actual.ExperienceMetrics.Error, "probe failed")))
		}
	}

	actualBranch := strings.TrimSpace(defaultString(actual.State.Branch, actual.LiveService.Branch))
	currentBranch := strings.TrimSpace(current.Branch)
	if currentBranch != "" && actualBranch != "" && currentBranch != actualBranch {
		appendDrift("actual_live_branch_mismatch", "drift", fmt.Sprintf("current branch = %s, but actual live branch = %s", currentBranch, actualBranch))
	}

	actualStartRoute := actualFirstScreenRoute(actual)
	if actualStartRoute != "" && !parityStartRouteIsCollaborationShell(actualStartRoute) {
		appendDrift("actual_live_first_screen_not_collaboration_shell", "drift", fmt.Sprintf("actual live first-screen truth is still %s instead of a collaboration shell route", actualStartRoute))
	}

	currentStartRoute := strings.TrimSpace(current.StartRoute)
	if currentStartRoute != "" && actualStartRoute != "" && currentStartRoute != actualStartRoute {
		appendDrift("actual_live_first_screen_mismatch", "drift", fmt.Sprintf("current first-screen truth = %s, but actual live reports %s", currentStartRoute, actualStartRoute))
	}

	if strings.TrimSpace(current.FirstScreenStatus) != "ready" {
		appendDrift("current_first_screen_contract_not_ready", "warning", fmt.Sprintf("current first-screen contract is %s, so rollout parity would stay weak even after deploy", defaultString(current.FirstScreenStatus, "unknown")))
	}

	return drifts
}

func summarizeLiveRolloutParity(current liveRolloutCurrentTruth, actual liveRolloutActualTruth, drifts []liveRolloutParityDrift, targetBaseURL string) (string, string) {
	if len(drifts) == 0 {
		return "aligned", fmt.Sprintf("actual live %s exposes live-service + experience-metrics and matches current branch %s / first-screen %s", targetBaseURL, defaultString(current.Branch, "unknown"), defaultString(current.StartRoute, "unknown"))
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
		summaries = append(summaries[:3], fmt.Sprintf("and %d more", len(summaries)-3))
	}

	if !actual.Health.Reachable {
		return status, fmt.Sprintf("actual live target %s is unreachable; cannot establish rollout parity against current first-screen %s", targetBaseURL, defaultString(current.StartRoute, "unknown"))
	}
	return status, strings.Join(summaries, "; ")
}

func actualFirstScreenRoute(actual liveRolloutActualTruth) string {
	if value := strings.TrimSpace(actual.ExperienceMetrics.CollaborationShellValue); value != "" {
		return value
	}
	return strings.TrimSpace(actual.State.StartRoute)
}

func parityStartRouteIsCollaborationShell(route string) bool {
	switch strings.TrimSpace(route) {
	case "/rooms", "/chat/all", "/inbox", "/mailbox":
		return true
	default:
		return false
	}
}

func findExperienceMetricInSections(sections []store.ExperienceMetricSection, id string) (store.ExperienceMetric, bool) {
	for _, section := range sections {
		for _, metric := range section.Metrics {
			if metric.ID == id {
				return metric, true
			}
		}
	}
	return store.ExperienceMetric{}, false
}

func detectLiveRolloutCurrentCheckout(workspaceRoot string) (string, string) {
	repoURL, err := runGit(workspaceRoot, "remote", "get-url", "origin")
	repo, _ := parseRepoIdentity(repoURL)
	if err != nil {
		repo = ""
	}
	branch, err := runGit(workspaceRoot, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		branch = ""
	}
	return strings.TrimSpace(repo), strings.TrimSpace(branch)
}
