package store

import (
	"path/filepath"
	"testing"
)

func TestFreshExperienceMetricsMarksZeroInboxCorrectionsAsReady(t *testing.T) {
	t.Setenv("OPENSHOCK_BOOTSTRAP_MODE", "fresh")

	root := t.TempDir()
	statePath := filepath.Join(root, "data", "state.json")

	s, err := New(statePath, root)
	if err != nil {
		t.Fatalf("New() error = %v", err)
	}

	snapshot := s.ExperienceMetrics()
	experience, ok := findExperienceMetricsSection(snapshot.Sections, "experience")
	if !ok {
		t.Fatalf("experience section missing: %#v", snapshot.Sections)
	}
	metric, ok := findExperienceMetricByID(experience.Metrics, "inbox-correction")
	if !ok || metric.Status != experienceMetricReady {
		t.Fatalf("inbox-correction metric = %#v, want ready when no open signals exist", metric)
	}
}

func findExperienceMetricsSection(sections []ExperienceMetricSection, id string) (ExperienceMetricSection, bool) {
	for _, section := range sections {
		if section.ID == id {
			return section, true
		}
	}
	return ExperienceMetricSection{}, false
}

func findExperienceMetricByID(metrics []ExperienceMetric, id string) (ExperienceMetric, bool) {
	for _, metric := range metrics {
		if metric.ID == id {
			return metric, true
		}
	}
	return ExperienceMetric{}, false
}
