package github

import (
	"fmt"
	"testing"
)

type fakeRunner struct {
	lookPaths map[string]string
	outputs   map[string]fakeOutput
}

type fakeOutput struct {
	text string
	err  error
}

func (f fakeRunner) LookPath(file string) (string, error) {
	if value, ok := f.lookPaths[file]; ok {
		return value, nil
	}
	return "", fmt.Errorf("%s not found", file)
}

func (f fakeRunner) CombinedOutput(name string, args ...string) ([]byte, error) {
	key := name + " " + joinArgs(args)
	if value, ok := f.outputs[key]; ok {
		return []byte(value.text), value.err
	}
	return []byte("missing fake output"), fmt.Errorf("missing fake output for %s", key)
}

func joinArgs(args []string) string {
	if len(args) == 0 {
		return ""
	}
	result := args[0]
	for _, item := range args[1:] {
		result += " " + item
	}
	return result
}

func TestProbeReadyWhenOriginAndGitHubAuthExist(t *testing.T) {
	service := NewService(fakeRunner{
		lookPaths: map[string]string{
			"gh": "C:\\gh.exe",
		},
		outputs: map[string]fakeOutput{
			"git -C E:\\repo remote get-url origin":       {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C E:\\repo rev-parse --abbrev-ref HEAD": {text: "main"},
			"gh auth status --hostname github.com":        {text: "github.com\n  ✓ Logged in"},
		},
	})

	status, err := service.Probe(`E:\repo`)
	if err != nil {
		t.Fatalf("Probe() error = %v", err)
	}
	if !status.Ready {
		t.Fatalf("status.Ready = false, want true")
	}
	if !status.GHAuthenticated {
		t.Fatalf("status.GHAuthenticated = false, want true")
	}
	if status.Repo != "Larkspur-Wang/OpenShock" {
		t.Fatalf("status.Repo = %q, want Larkspur-Wang/OpenShock", status.Repo)
	}
}

func TestProbeDegradesWhenGitHubCLIIsMissing(t *testing.T) {
	service := NewService(fakeRunner{
		lookPaths: map[string]string{},
		outputs: map[string]fakeOutput{
			"git -C E:\\repo remote get-url origin":       {text: "https://github.com/Larkspur-Wang/OpenShock.git"},
			"git -C E:\\repo rev-parse --abbrev-ref HEAD": {text: "main"},
		},
	})

	status, err := service.Probe(`E:\repo`)
	if err != nil {
		t.Fatalf("Probe() error = %v", err)
	}
	if status.Ready {
		t.Fatalf("status.Ready = true, want false")
	}
	if status.GHCLIInstalled {
		t.Fatalf("status.GHCLIInstalled = true, want false")
	}
	if status.Message == "" {
		t.Fatal("status.Message should not be empty")
	}
}

func TestParseRepoIdentitySupportsHTTPSAndSSH(t *testing.T) {
	tests := []struct {
		name     string
		remote   string
		wantRepo string
		wantProv string
	}{
		{name: "https", remote: "https://github.com/Larkspur-Wang/OpenShock.git", wantRepo: "Larkspur-Wang/OpenShock", wantProv: "github"},
		{name: "ssh", remote: "git@github.com:Larkspur-Wang/OpenShock.git", wantRepo: "Larkspur-Wang/OpenShock", wantProv: "github"},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			gotRepo, gotProvider := ParseRepoIdentity(testCase.remote)
			if gotRepo != testCase.wantRepo || gotProvider != testCase.wantProv {
				t.Fatalf("ParseRepoIdentity(%q) = (%q, %q), want (%q, %q)", testCase.remote, gotRepo, gotProvider, testCase.wantRepo, testCase.wantProv)
			}
		})
	}
}
