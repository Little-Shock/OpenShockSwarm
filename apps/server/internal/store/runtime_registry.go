package store

import (
	"fmt"
	"strings"
	"time"
)

const (
	runtimeStateOnline  = "online"
	runtimeStateBusy    = "busy"
	runtimeStateStale   = "stale"
	runtimeStateOffline = "offline"

	runtimePairingPaired    = "paired"
	runtimePairingAvailable = "available"

	workspacePairingPaired   = "paired"
	workspacePairingDegraded = "degraded"
	workspacePairingUnpaired = "unpaired"

	defaultRuntimeHeartbeatInterval = 10 * time.Second
	defaultRuntimeHeartbeatTimeout  = 45 * time.Second
)

func (s *Store) UpsertRuntimeHeartbeat(req RuntimeHeartbeatInput) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ensureRuntimeRegistryStateLocked()
	upsertRuntimeHeartbeatLocked(&s.state, req)
	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) ensureRuntimeRegistryState() {
	ensureRuntimeRegistryState(&s.state)
}

func (s *Store) ensureRuntimeRegistryStateLocked() {
	ensureRuntimeRegistryState(&s.state)
}

func ensureRuntimeRegistryState(state *State) {
	defaultReportedAt := defaultString(strings.TrimSpace(state.Workspace.LastPairedAt), time.Now().UTC().Format(time.RFC3339))
	var runtimes []RuntimeRecord

	for _, item := range state.Runtimes {
		normalized := normalizeRuntimeRecord(item, defaultReportedAt)
		if normalized.ID == "" {
			continue
		}
		runtimes = append(runtimes, normalized)
	}

	for _, machine := range state.Machines {
		runtimeID := runtimeIDFor(machine.Name, machine.ID)
		if runtimeID == "" || findRuntimeIndexByAny(runtimes, runtimeID, machine.Name, machine.DaemonURL) != -1 {
			continue
		}
		runtimes = append(runtimes, normalizeRuntimeRecord(RuntimeRecord{
			ID:              runtimeID,
			Machine:         defaultString(machine.Name, runtimeID),
			DaemonURL:       machine.DaemonURL,
			DetectedCLI:     parseMachineCLI(machine.CLI),
			Shell:           machine.Shell,
			State:           machine.State,
			WorkspaceRoot:   "",
			ReportedAt:      defaultReportedAt,
			LastHeartbeatAt: defaultReportedAt,
		}, defaultReportedAt))
	}

	if strings.TrimSpace(state.Workspace.PairedRuntime) != "" && findRuntimeIndexByAny(runtimes, state.Workspace.PairedRuntime, state.Workspace.PairedRuntime, state.Workspace.PairedRuntimeURL) == -1 {
		runtimes = append([]RuntimeRecord{normalizeRuntimeRecord(RuntimeRecord{
			ID:              state.Workspace.PairedRuntime,
			Machine:         state.Workspace.PairedRuntime,
			DaemonURL:       state.Workspace.PairedRuntimeURL,
			State:           runtimeStateOnline,
			PairingState:    runtimePairingPaired,
			ReportedAt:      defaultReportedAt,
			LastHeartbeatAt: defaultReportedAt,
		}, defaultReportedAt)}, runtimes...)
	}

	for index := range runtimes {
		runtimes[index].PairingState = runtimePairingAvailable
		if matchesPairedRuntime(state.Workspace, runtimes[index]) {
			runtimes[index].PairingState = runtimePairingPaired
		}
	}

	state.Runtimes = runtimes
}

func upsertRuntimeHeartbeatLocked(state *State, req RuntimeHeartbeatInput) RuntimeRecord {
	defaultReportedAt := time.Now().UTC().Format(time.RFC3339)
	runtimeID := runtimeIDFor(req.Machine, req.RuntimeID)
	if runtimeID == "" {
		runtimeID = runtimeIDFor(req.RuntimeID, "")
	}
	record := normalizeRuntimeRecord(RuntimeRecord{
		ID:                 runtimeID,
		Machine:            defaultString(strings.TrimSpace(req.Machine), runtimeID),
		DaemonURL:          strings.TrimRight(strings.TrimSpace(req.DaemonURL), "/"),
		DetectedCLI:        req.DetectedCLI,
		Providers:          req.Providers,
		Shell:              strings.TrimSpace(req.Shell),
		State:              req.State,
		WorkspaceRoot:      strings.TrimSpace(req.WorkspaceRoot),
		ReportedAt:         strings.TrimSpace(req.ReportedAt),
		LastHeartbeatAt:    strings.TrimSpace(req.ReportedAt),
		HeartbeatIntervalS: req.HeartbeatIntervalS,
		HeartbeatTimeoutS:  req.HeartbeatTimeoutS,
	}, defaultReportedAt)
	record.PairingState = runtimePairingAvailable
	if matchesPairedRuntime(state.Workspace, record) {
		record.PairingState = runtimePairingPaired
		if record.DaemonURL != "" {
			state.Workspace.PairedRuntimeURL = record.DaemonURL
		}
	}

	index := findRuntimeIndexByAny(state.Runtimes, record.ID, record.Machine, record.DaemonURL)
	if index == -1 {
		state.Runtimes = append([]RuntimeRecord{record}, state.Runtimes...)
	} else {
		existing := state.Runtimes[index]
		if record.DaemonURL == "" {
			record.DaemonURL = existing.DaemonURL
		}
		if len(record.DetectedCLI) == 0 {
			record.DetectedCLI = existing.DetectedCLI
		}
		if len(record.Providers) == 0 {
			record.Providers = existing.Providers
		}
		if record.WorkspaceRoot == "" {
			record.WorkspaceRoot = existing.WorkspaceRoot
		}
		if record.HeartbeatIntervalS == 0 {
			record.HeartbeatIntervalS = existing.HeartbeatIntervalS
		}
		if record.HeartbeatTimeoutS == 0 {
			record.HeartbeatTimeoutS = existing.HeartbeatTimeoutS
		}
		state.Runtimes[index] = record
	}

	syncMachineForRuntime(state, record)
	return record
}

func applyRuntimeDerivedTruth(state *State, now time.Time) {
	ensureRuntimeRegistryState(state)

	for index := range state.Runtimes {
		record := normalizeRuntimeRecord(state.Runtimes[index], now.UTC().Format(time.RFC3339))
		record.State = deriveRuntimeState(record, now)
		record.PairingState = runtimePairingAvailable
		if matchesPairedRuntime(state.Workspace, record) {
			record.PairingState = runtimePairingPaired
			if record.DaemonURL != "" && strings.TrimSpace(state.Workspace.PairedRuntimeURL) == "" {
				state.Workspace.PairedRuntimeURL = record.DaemonURL
			}
		}
		state.Runtimes[index] = record
		syncMachineForRuntime(state, record)
	}

	switch {
	case strings.TrimSpace(state.Workspace.PairedRuntime) == "":
		state.Workspace.PairingStatus = workspacePairingUnpaired
	case findPairedRuntime(state) == nil:
		state.Workspace.PairingStatus = workspacePairingDegraded
	default:
		paired := findPairedRuntime(state)
		if paired == nil {
			state.Workspace.PairingStatus = workspacePairingDegraded
			return
		}
		if paired.State == runtimeStateStale || paired.State == runtimeStateOffline {
			state.Workspace.PairingStatus = workspacePairingDegraded
			return
		}
		state.Workspace.PairingStatus = workspacePairingPaired
	}
}

func normalizeRuntimeRecord(item RuntimeRecord, fallbackReportedAt string) RuntimeRecord {
	item.ID = runtimeIDFor(item.Machine, item.ID)
	item.Machine = defaultString(strings.TrimSpace(item.Machine), item.ID)
	item.DaemonURL = strings.TrimRight(strings.TrimSpace(item.DaemonURL), "/")
	item.DetectedCLI = normalizeDetectedCLI(item.DetectedCLI)
	item.Providers = normalizeRuntimeProviders(item.Providers)
	item.Shell = strings.TrimSpace(item.Shell)
	item.State = normalizeRuntimeState(item.State)
	item.PairingState = defaultString(strings.TrimSpace(item.PairingState), runtimePairingAvailable)
	item.WorkspaceRoot = strings.TrimSpace(item.WorkspaceRoot)
	item.ReportedAt = defaultString(strings.TrimSpace(item.ReportedAt), fallbackReportedAt)
	item.LastHeartbeatAt = defaultString(strings.TrimSpace(item.LastHeartbeatAt), item.ReportedAt)
	if item.HeartbeatIntervalS <= 0 {
		item.HeartbeatIntervalS = int(defaultRuntimeHeartbeatInterval / time.Second)
	}
	if item.HeartbeatTimeoutS <= 0 {
		item.HeartbeatTimeoutS = int(defaultRuntimeHeartbeatTimeout / time.Second)
	}
	return item
}

func syncMachineForRuntime(state *State, record RuntimeRecord) {
	lastHeartbeat := humanizeRuntimeHeartbeat(record.LastHeartbeatAt, time.Now())
	cliLabel := "none-detected"
	if len(record.DetectedCLI) > 0 {
		cliLabel = strings.Join(record.DetectedCLI, " + ")
	}

	index := -1
	for candidate := range state.Machines {
		if state.Machines[candidate].Name == record.Machine || state.Machines[candidate].ID == record.ID {
			index = candidate
			break
		}
	}

	if index == -1 {
		state.Machines = append([]Machine{{
			ID:            record.ID,
			Name:          record.Machine,
			State:         record.State,
			DaemonURL:     record.DaemonURL,
			CLI:           cliLabel,
			Shell:         record.Shell,
			OS:            "Local",
			LastHeartbeat: lastHeartbeat,
		}}, state.Machines...)
		return
	}

	state.Machines[index].ID = defaultString(strings.TrimSpace(state.Machines[index].ID), record.ID)
	state.Machines[index].Name = record.Machine
	state.Machines[index].State = record.State
	state.Machines[index].DaemonURL = record.DaemonURL
	state.Machines[index].CLI = cliLabel
	if strings.TrimSpace(record.Shell) != "" {
		state.Machines[index].Shell = record.Shell
	}
	state.Machines[index].LastHeartbeat = lastHeartbeat
}

func findPairedRuntime(state *State) *RuntimeRecord {
	for index := range state.Runtimes {
		if matchesPairedRuntime(state.Workspace, state.Runtimes[index]) {
			return &state.Runtimes[index]
		}
	}
	return nil
}

func findRuntimeIndexByAny(items []RuntimeRecord, runtimeID, machine, daemonURL string) int {
	runtimeID = strings.TrimSpace(runtimeID)
	machine = strings.TrimSpace(machine)
	daemonURL = strings.TrimRight(strings.TrimSpace(daemonURL), "/")
	for index := range items {
		switch {
		case runtimeID != "" && items[index].ID == runtimeID:
			return index
		case machine != "" && items[index].Machine == machine:
			return index
		case daemonURL != "" && strings.TrimRight(items[index].DaemonURL, "/") == daemonURL:
			return index
		}
	}
	return -1
}

func matchesPairedRuntime(workspace WorkspaceSnapshot, record RuntimeRecord) bool {
	pairedRuntime := strings.TrimSpace(workspace.PairedRuntime)
	if pairedRuntime == "" {
		return false
	}
	return pairedRuntime == record.ID || pairedRuntime == record.Machine
}

func runtimeIDFor(machine, runtimeID string) string {
	if value := strings.TrimSpace(runtimeID); value != "" {
		return value
	}
	return strings.TrimSpace(machine)
}

func parseMachineCLI(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, "+")
	items := make([]string, 0, len(parts))
	for _, item := range parts {
		if trimmed := strings.TrimSpace(strings.ToLower(item)); trimmed != "" {
			items = append(items, trimmed)
		}
	}
	return normalizeDetectedCLI(items)
}

func normalizeDetectedCLI(items []string) []string {
	seen := make(map[string]bool, len(items))
	result := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(strings.ToLower(item))
		if trimmed == "" || seen[trimmed] {
			continue
		}
		seen[trimmed] = true
		result = append(result, trimmed)
	}
	return result
}

func normalizeRuntimeProviders(items []RuntimeProvider) []RuntimeProvider {
	result := make([]RuntimeProvider, 0, len(items))
	for _, item := range items {
		if strings.TrimSpace(item.ID) == "" {
			continue
		}
		item.ID = strings.TrimSpace(item.ID)
		item.Label = strings.TrimSpace(item.Label)
		item.Mode = strings.TrimSpace(item.Mode)
		item.Transport = strings.TrimSpace(item.Transport)
		item.Capabilities = normalizeDetectedCLI(item.Capabilities)
		item.Models = normalizeRuntimeModels(item.Models)
		result = append(result, item)
	}
	return result
}

func normalizeRuntimeModels(items []string) []string {
	seen := make(map[string]bool, len(items))
	result := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		key := strings.ToLower(trimmed)
		if trimmed == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, trimmed)
	}
	return result
}

func normalizeRuntimeState(value string) string {
	switch strings.TrimSpace(value) {
	case runtimeStateBusy:
		return runtimeStateBusy
	case runtimeStateStale:
		return runtimeStateStale
	case runtimeStateOffline:
		return runtimeStateOffline
	default:
		return runtimeStateOnline
	}
}

func deriveRuntimeState(record RuntimeRecord, now time.Time) string {
	lastHeartbeat := parseHeartbeatTime(defaultString(record.LastHeartbeatAt, record.ReportedAt))
	if lastHeartbeat.IsZero() {
		return normalizeRuntimeState(record.State)
	}

	timeout := defaultRuntimeHeartbeatTimeout
	if record.HeartbeatTimeoutS > 0 {
		timeout = time.Duration(record.HeartbeatTimeoutS) * time.Second
	}
	staleAfter := timeout / 2
	if staleAfter < defaultRuntimeHeartbeatInterval {
		staleAfter = defaultRuntimeHeartbeatInterval
	}

	age := now.Sub(lastHeartbeat)
	switch {
	case age >= timeout:
		return runtimeStateOffline
	case age >= staleAfter:
		return runtimeStateStale
	default:
		state := normalizeRuntimeState(record.State)
		if state == runtimeStateStale || state == runtimeStateOffline {
			return runtimeStateOnline
		}
		return state
	}
}

func parseHeartbeatTime(value string) time.Time {
	if strings.TrimSpace(value) == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func humanizeRuntimeHeartbeat(value string, now time.Time) string {
	parsed := parseHeartbeatTime(value)
	if parsed.IsZero() {
		return "未知"
	}
	if now.Before(parsed) {
		return "刚刚"
	}

	age := now.Sub(parsed)
	switch {
	case age < time.Second:
		return "刚刚"
	case age < time.Minute:
		return formatHeartbeatAge(int(age.Round(time.Second)/time.Second), "秒")
	case age < time.Hour:
		return formatHeartbeatAge(int(age.Round(time.Minute)/time.Minute), "分钟")
	default:
		return formatHeartbeatAge(int(age.Round(time.Hour)/time.Hour), "小时")
	}
}

func formatHeartbeatAge(value int, unit string) string {
	if value <= 0 {
		return "刚刚"
	}
	return fmt.Sprintf("%d %s前", value, unit)
}
