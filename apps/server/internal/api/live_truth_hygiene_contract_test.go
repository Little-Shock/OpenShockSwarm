package api

import (
	"strings"
	"testing"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

func TestSanitizeLiveStateFailClosesGovernanceAndAdapterResidue(t *testing.T) {
	snapshot := store.State{
		Workspace: store.WorkspaceSnapshot{
			Name:              "OpenShock",
			Repo:              "repo",
			RepoURL:           "https://example.com/repo",
			Branch:            "main",
			RepoProvider:      "github",
			RepoBindingStatus: "bound",
			RepoAuthMode:      "local-git-origin",
			Plan:              "builder",
			PairedRuntime:     "shock-main",
			PairingStatus:     "paired",
			DeviceAuth:        "browser-approved",
			BrowserPush:       "all",
			MemoryMode:        "MEMORY.md",
			Governance: store.WorkspaceGovernanceSnapshot{
				Label:   "",
				Summary: "本地 mock governance summary",
				RoutingPolicy: store.WorkspaceGovernanceRoutingPolicy{
					Summary: "",
					Rules: []store.WorkspaceGovernanceRouteRule{{
						ID:       "rule-1",
						Trigger:  "",
						FromLane: "",
						ToLane:   "",
						Policy:   "/tmp/openshock-route",
						Summary:  "placeholder rule",
					}},
				},
				ResponseAggregation: store.WorkspaceResponseAggregation{
					Summary:       "",
					FinalResponse: "",
					Sources:       []string{"E2E residue 20260410"},
					AuditTrail: []store.WorkspaceResponseAggregationAuditEntry{{
						ID:      "audit-1",
						Label:   "",
						Summary: "placeholder audit",
					}},
				},
			},
		},
		ControlPlane: store.ControlPlaneState{
			Commands: []store.ControlPlaneCommand{{
				ID:           "cp-1",
				Summary:      "placeholder command summary",
				ReplayAnchor: "/home/lark/OpenShock/debug/cp-1",
				ErrorMessage: "本地 mock command",
				Debug: []store.ControlPlaneDebugEntry{{
					ID:      "cp-debug-1",
					Summary: "placeholder debug",
				}},
			}},
			Events: []store.ControlPlaneEvent{{
				Cursor:       1,
				CommandID:    "cp-1",
				Summary:      "placeholder event",
				ReplayAnchor: "/tmp/openshock-event",
			}},
			Rejections: []store.ControlPlaneRejection{{
				ID:           "cp-reject-1",
				CommandID:    "cp-1",
				Summary:      "placeholder rejection",
				Reason:       "本地 mock rejection",
				ReplayAnchor: "/home/lark/OpenShock/reject",
			}},
		},
		RuntimePublish: store.RuntimePublishState{
			Records: []store.RuntimePublishRecord{{
				ID:             "publish-1",
				RuntimeID:      "shock-main",
				RunID:          "run_runtime_01",
				Sequence:       1,
				Cursor:         1,
				Phase:          "closeout",
				Status:         "done",
				Summary:        "placeholder publish summary",
				FailureAnchor:  "/tmp/openshock-failure",
				CloseoutReason: "本地 mock closeout",
				EvidenceLines:  []string{"placeholder evidence", "/home/lark/OpenShock/evidence"},
			}},
		},
	}

	sanitized := sanitizeLiveState(snapshot)

	if strings.Contains(sanitized.Workspace.Governance.Summary, "mock") {
		t.Fatalf("governance = %#v, want dirty governance summary sanitized", sanitized.Workspace.Governance)
	}
	if strings.Contains(sanitized.Workspace.Governance.RoutingPolicy.Rules[0].Summary, "placeholder") ||
		strings.Contains(sanitized.Workspace.Governance.RoutingPolicy.Rules[0].Policy, "/tmp/openshock") {
		t.Fatalf("routing rule = %#v, want dirty routing content sanitized", sanitized.Workspace.Governance.RoutingPolicy.Rules[0])
	}
	if strings.Contains(sanitized.Workspace.Governance.ResponseAggregation.Sources[0], "E2E") ||
		strings.Contains(sanitized.Workspace.Governance.ResponseAggregation.AuditTrail[0].Summary, "placeholder") {
		t.Fatalf("response aggregation = %#v, want dirty aggregation content sanitized", sanitized.Workspace.Governance.ResponseAggregation)
	}
	if strings.Contains(sanitized.ControlPlane.Commands[0].Summary, "placeholder") || strings.Contains(sanitized.ControlPlane.Commands[0].ReplayAnchor, "/home/lark/OpenShock") {
		t.Fatalf("control-plane command = %#v, want sanitized command summary and anchor", sanitized.ControlPlane.Commands[0])
	}
	if strings.Contains(sanitized.ControlPlane.Rejections[0].Reason, "mock") {
		t.Fatalf("control-plane rejection = %#v, want sanitized rejection reason", sanitized.ControlPlane.Rejections[0])
	}
	if strings.Contains(sanitized.RuntimePublish.Records[0].FailureAnchor, "/tmp/openshock") || strings.Contains(sanitized.RuntimePublish.Records[0].CloseoutReason, "mock") {
		t.Fatalf("runtime publish record = %#v, want sanitized runtime publish fallback", sanitized.RuntimePublish.Records[0])
	}
}
