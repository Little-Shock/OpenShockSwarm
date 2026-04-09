package api

import (
	"net/http"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestExperienceMetricsRouteReturnsSectionedSnapshot(t *testing.T) {
	root := t.TempDir()
	_, server := newContractTestServer(t, root, "http://127.0.0.1:65531")
	defer server.Close()

	resp, err := http.Get(server.URL + "/v1/experience-metrics")
	if err != nil {
		t.Fatalf("GET /v1/experience-metrics error = %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /v1/experience-metrics status = %d, want %d", resp.StatusCode, http.StatusOK)
	}

	var snapshot store.ExperienceMetricsSnapshot
	decodeJSON(t, resp, &snapshot)

	if len(snapshot.Sections) != 3 {
		t.Fatalf("len(snapshot.Sections) = %d, want 3", len(snapshot.Sections))
	}
	if snapshot.Workspace == "" || snapshot.Summary == "" || snapshot.Methodology == "" {
		t.Fatalf("snapshot summary fields malformed: %#v", snapshot)
	}
	if countMetrics(snapshot.Sections) != 23 {
		t.Fatalf("metric count = %d, want 23", countMetrics(snapshot.Sections))
	}

	product, ok := findMetricSection(snapshot.Sections, "product")
	if !ok {
		t.Fatalf("product section missing: %#v", snapshot.Sections)
	}
	issueFirstRun, ok := findExperienceMetric(product, "issue-first-run")
	if !ok || issueFirstRun.Status != "ready" {
		t.Fatalf("issue-first-run metric = %#v, want ready coverage", issueFirstRun)
	}
	handoffAck, ok := findExperienceMetric(product, "handoff-ack-rate")
	if !ok || handoffAck.Status != "partial" {
		t.Fatalf("handoff-ack-rate metric = %#v, want partial without live handoffs", handoffAck)
	}

	experience, ok := findMetricSection(snapshot.Sections, "experience")
	if !ok {
		t.Fatalf("experience section missing: %#v", snapshot.Sections)
	}
	memoryProvenance, ok := findExperienceMetric(experience, "memory-provenance")
	if !ok || memoryProvenance.Status != "ready" {
		t.Fatalf("memory-provenance metric = %#v, want ready seeded provenance coverage", memoryProvenance)
	}

	design, ok := findMetricSection(snapshot.Sections, "design")
	if !ok {
		t.Fatalf("design section missing: %#v", snapshot.Sections)
	}
	collaborationShell, ok := findExperienceMetric(design, "collaboration-shell-first")
	if !ok || collaborationShell.Status != "blocked" {
		t.Fatalf("collaboration-shell-first metric = %#v, want blocked because default start route is /access", collaborationShell)
	}
}

func countMetrics(sections []store.ExperienceMetricSection) int {
	total := 0
	for _, section := range sections {
		total += len(section.Metrics)
	}
	return total
}

func findMetricSection(sections []store.ExperienceMetricSection, id string) (store.ExperienceMetricSection, bool) {
	for _, section := range sections {
		if section.ID == id {
			return section, true
		}
	}
	return store.ExperienceMetricSection{}, false
}

func findExperienceMetric(section store.ExperienceMetricSection, id string) (store.ExperienceMetric, bool) {
	for _, metric := range section.Metrics {
		if metric.ID == id {
			return metric, true
		}
	}
	return store.ExperienceMetric{}, false
}
