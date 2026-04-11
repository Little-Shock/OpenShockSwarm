package store

import (
	"fmt"
	"sort"
	"strings"
)

const (
	runtimeSchedulerStrategyUnavailable     = "unavailable"
	runtimeSchedulerStrategySelected        = "selected_runtime"
	runtimeSchedulerStrategyAgentPreference = "agent_preference"
	runtimeSchedulerStrategyLeastLoaded     = "least_loaded"
	runtimeSchedulerStrategyFailover        = "failover"
)

type runtimeSchedulerResult struct {
	Scheduler RuntimeScheduler
	Provider  string
}

func buildRuntimeLeases(snapshot State) []RuntimeLease {
	leases := make([]RuntimeLease, 0, len(snapshot.Sessions))
	for _, session := range snapshot.Sessions {
		lease, ok := runtimeLeaseFromSession(snapshot, session)
		if !ok {
			continue
		}
		leases = append(leases, lease)
	}
	return leases
}

func runtimeLeaseFromSession(snapshot State, session Session) (RuntimeLease, bool) {
	run, _ := findRuntimeLeaseRunByID(snapshot, session.ActiveRunID)
	runtimeName := defaultString(strings.TrimSpace(session.Runtime), strings.TrimSpace(run.Runtime))
	machine := defaultString(strings.TrimSpace(session.Machine), strings.TrimSpace(run.Machine))
	if runtimeName == "" && machine == "" {
		return RuntimeLease{}, false
	}
	worktreePath := defaultString(strings.TrimSpace(session.WorktreePath), strings.TrimSpace(run.WorktreePath))
	lease := RuntimeLease{
		LeaseID:      defaultString(strings.TrimSpace(session.ID), defaultString(strings.TrimSpace(run.ID), strings.TrimSpace(session.RoomID))),
		SessionID:    strings.TrimSpace(session.ID),
		RunID:        defaultString(strings.TrimSpace(session.ActiveRunID), strings.TrimSpace(run.ID)),
		RoomID:       strings.TrimSpace(session.RoomID),
		Runtime:      defaultString(runtimeName, machine),
		Machine:      defaultString(machine, runtimeName),
		Owner:        strings.TrimSpace(run.Owner),
		Provider:     defaultString(strings.TrimSpace(session.Provider), strings.TrimSpace(run.Provider)),
		Status:       defaultString(strings.TrimSpace(session.Status), strings.TrimSpace(run.Status)),
		Branch:       defaultString(strings.TrimSpace(session.Branch), strings.TrimSpace(run.Branch)),
		WorktreeName: defaultString(strings.TrimSpace(session.Worktree), strings.TrimSpace(run.Worktree)),
		WorktreePath: worktreePath,
		Cwd:          worktreePath,
		Summary:      defaultString(strings.TrimSpace(session.Summary), strings.TrimSpace(run.Summary)),
	}
	return lease, true
}

func findRuntimeLeaseRunByID(snapshot State, runID string) (Run, bool) {
	runID = strings.TrimSpace(runID)
	for _, item := range snapshot.Runs {
		if item.ID == runID {
			return item, true
		}
	}
	return Run{}, false
}

func buildRuntimeScheduler(state State, owner string) runtimeSchedulerResult {
	provider := "Claude Code CLI"
	selectedRuntime := strings.TrimSpace(state.Workspace.PairedRuntime)
	preferredRuntime := selectedRuntime
	preferenceSource := runtimeSchedulerStrategySelected

	owner = strings.TrimSpace(owner)
	if owner != "" {
		for _, agent := range state.Agents {
			if agent.Name != owner {
				continue
			}
			if text := strings.TrimSpace(agent.Provider); text != "" {
				provider = text
			}
			if text := strings.TrimSpace(agent.RuntimePreference); text != "" {
				preferredRuntime = text
				preferenceSource = runtimeSchedulerStrategyAgentPreference
			}
			break
		}
	}

	candidates := buildRuntimeSchedulerCandidates(state, selectedRuntime, preferredRuntime)
	scheduler := RuntimeScheduler{
		SelectedRuntime:  selectedRuntime,
		PreferredRuntime: preferredRuntime,
		Strategy:         runtimeSchedulerStrategyUnavailable,
		Summary:          "当前没有可调度 runtime。",
		Candidates:       candidates,
	}

	assignedIndex := -1
	if preferredRuntime != "" {
		if index := findSchedulableRuntimeSchedulerCandidate(candidates, preferredRuntime); index != -1 {
			assignedIndex = index
			scheduler.Strategy = preferenceSource
		} else if index := firstSchedulableRuntimeSchedulerCandidate(candidates); index != -1 {
			assignedIndex = index
			scheduler.Strategy = runtimeSchedulerStrategyFailover
			scheduler.FailoverFrom = preferredRuntime
		}
	} else if index := firstSchedulableRuntimeSchedulerCandidate(candidates); index != -1 {
		assignedIndex = index
		scheduler.Strategy = runtimeSchedulerStrategyLeastLoaded
	}

	if assignedIndex != -1 {
		candidates[assignedIndex].Assigned = true
		scheduler.AssignedRuntime = defaultString(strings.TrimSpace(candidates[assignedIndex].Runtime), strings.TrimSpace(candidates[assignedIndex].Machine))
		scheduler.AssignedMachine = defaultString(strings.TrimSpace(candidates[assignedIndex].Machine), scheduler.AssignedRuntime)
		scheduler.Summary = runtimeSchedulerSummary(scheduler, candidates[assignedIndex], owner)
	}

	scheduler.Candidates = annotateRuntimeSchedulerCandidates(candidates, scheduler)
	return runtimeSchedulerResult{Scheduler: scheduler, Provider: provider}
}

func buildRuntimeSchedulerCandidates(state State, selectedRuntime, preferredRuntime string) []RuntimeSchedulerCandidate {
	leaseCounts := activeRuntimeLeaseCounts(state)
	candidates := make([]RuntimeSchedulerCandidate, 0, len(state.Machines))

	for _, machine := range state.Machines {
		record, ok := findRuntimeRecordForMachine(state, machine)
		runtimeName := strings.TrimSpace(machine.Name)
		pairingState := runtimePairingAvailable
		if ok {
			if text := strings.TrimSpace(record.ID); text != "" {
				runtimeName = text
			}
			if text := strings.TrimSpace(record.PairingState); text != "" {
				pairingState = text
			}
		} else if machineMatches(machine, state.Workspace.PairedRuntime) {
			pairingState = runtimePairingPaired
		}
		if runtimeName == "" {
			runtimeName = strings.TrimSpace(machine.ID)
		}
		candidates = append(candidates, RuntimeSchedulerCandidate{
			Runtime:          runtimeName,
			Machine:          defaultString(strings.TrimSpace(machine.Name), runtimeName),
			State:            strings.TrimSpace(machine.State),
			PairingState:     pairingState,
			Schedulable:      machineSchedulable(machine),
			Selected:         runtimeSchedulerNameMatches(selectedRuntime, runtimeName, machine.Name, machine.ID),
			Preferred:        runtimeSchedulerNameMatches(preferredRuntime, runtimeName, machine.Name, machine.ID),
			ActiveLeaseCount: runtimeLeaseCountForKeys(leaseCounts, runtimeName, machine.Name, machine.ID),
		})
	}

	sort.SliceStable(candidates, func(left, right int) bool {
		leftRank := runtimeSchedulerCandidateRank(candidates[left])
		rightRank := runtimeSchedulerCandidateRank(candidates[right])
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if candidates[left].ActiveLeaseCount != candidates[right].ActiveLeaseCount {
			return candidates[left].ActiveLeaseCount < candidates[right].ActiveLeaseCount
		}
		if candidates[left].Machine != candidates[right].Machine {
			return candidates[left].Machine < candidates[right].Machine
		}
		return candidates[left].Runtime < candidates[right].Runtime
	})

	return candidates
}

func annotateRuntimeSchedulerCandidates(candidates []RuntimeSchedulerCandidate, scheduler RuntimeScheduler) []RuntimeSchedulerCandidate {
	annotated := make([]RuntimeSchedulerCandidate, len(candidates))
	copy(annotated, candidates)

	for index := range annotated {
		switch {
		case annotated[index].Assigned:
			switch scheduler.Strategy {
			case runtimeSchedulerStrategyAgentPreference:
				annotated[index].Reason = fmt.Sprintf("按 owner runtime preference 选中；当前承载 %d 条 active lease。", annotated[index].ActiveLeaseCount)
			case runtimeSchedulerStrategySelected:
				annotated[index].Reason = fmt.Sprintf("沿用当前 selection；当前承载 %d 条 active lease。", annotated[index].ActiveLeaseCount)
			case runtimeSchedulerStrategyFailover:
				annotated[index].Reason = fmt.Sprintf("承接 `%s` 的 failover；当前承载 %d 条 active lease。", scheduler.FailoverFrom, annotated[index].ActiveLeaseCount)
			case runtimeSchedulerStrategyLeastLoaded:
				annotated[index].Reason = fmt.Sprintf("按 lease 压力选中；当前承载 %d 条 active lease。", annotated[index].ActiveLeaseCount)
			}
		case !annotated[index].Schedulable && annotated[index].State != "":
			if annotated[index].State == runtimeStateOffline || annotated[index].State == runtimeStateStale {
				annotated[index].Reason = fmt.Sprintf("当前 `%s`，不可调度。", annotated[index].State)
			} else {
				annotated[index].Reason = fmt.Sprintf("当前 `%s`，未进入可调度状态。", annotated[index].State)
			}
		case !annotated[index].Schedulable:
			annotated[index].Reason = "未配对 daemon，当前不可调度。"
		case annotated[index].Preferred && scheduler.Strategy == runtimeSchedulerStrategyFailover:
			annotated[index].Reason = "preferred runtime 当前不可调度，已被 failover 跳过。"
		case annotated[index].ActiveLeaseCount > 0:
			annotated[index].Reason = fmt.Sprintf("当前承载 %d 条 active lease。", annotated[index].ActiveLeaseCount)
		default:
			annotated[index].Reason = "当前可接新 lane。"
		}
	}

	return annotated
}

func runtimeSchedulerSummary(scheduler RuntimeScheduler, candidate RuntimeSchedulerCandidate, owner string) string {
	label := defaultString(strings.TrimSpace(candidate.Machine), strings.TrimSpace(candidate.Runtime))
	switch scheduler.Strategy {
	case runtimeSchedulerStrategyAgentPreference:
		return fmt.Sprintf("已按 %s 的设置选择 %s，当前有 %d 个运行任务。", defaultString(strings.TrimSpace(owner), "当前成员"), label, candidate.ActiveLeaseCount)
	case runtimeSchedulerStrategySelected:
		return fmt.Sprintf("当前继续使用 %s，当前有 %d 个运行任务。", label, candidate.ActiveLeaseCount)
	case runtimeSchedulerStrategyFailover:
		return fmt.Sprintf("%s 当前不可用，已切换到 %s，当前有 %d 个运行任务。", scheduler.FailoverFrom, label, candidate.ActiveLeaseCount)
	case runtimeSchedulerStrategyLeastLoaded:
		return fmt.Sprintf("当前已选择 %s，当前有 %d 个运行任务。", label, candidate.ActiveLeaseCount)
	default:
		return "当前没有可用的运行环境。"
	}
}

func runtimeSchedulerTimelineLabel(scheduler RuntimeScheduler) string {
	switch scheduler.Strategy {
	case runtimeSchedulerStrategyFailover:
		return fmt.Sprintf("Runtime 已 failover 到 %s", defaultString(strings.TrimSpace(scheduler.AssignedMachine), strings.TrimSpace(scheduler.AssignedRuntime)))
	default:
		return fmt.Sprintf("Runtime 已分配到 %s", defaultString(strings.TrimSpace(scheduler.AssignedMachine), strings.TrimSpace(scheduler.AssignedRuntime)))
	}
}

func findRuntimeRecordForMachine(state State, machine Machine) (RuntimeRecord, bool) {
	for _, record := range state.Runtimes {
		if runtimeSchedulerNameMatches(record.ID, machine.ID, machine.Name) || runtimeSchedulerNameMatches(record.Machine, machine.Name, machine.ID) {
			return record, true
		}
	}
	return RuntimeRecord{}, false
}

func runtimeSchedulerNameMatches(target string, candidates ...string) bool {
	target = strings.TrimSpace(target)
	if target == "" {
		return false
	}
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == target {
			return true
		}
	}
	return false
}

func findSchedulableRuntimeSchedulerCandidate(candidates []RuntimeSchedulerCandidate, runtimeName string) int {
	for index := range candidates {
		if !candidates[index].Schedulable {
			continue
		}
		if runtimeSchedulerNameMatches(runtimeName, candidates[index].Runtime, candidates[index].Machine) {
			return index
		}
	}
	return -1
}

func firstSchedulableRuntimeSchedulerCandidate(candidates []RuntimeSchedulerCandidate) int {
	for index := range candidates {
		if candidates[index].Schedulable {
			return index
		}
	}
	return -1
}

func activeRuntimeLeaseCounts(state State) map[string]int {
	counts := make(map[string]int)
	for _, lease := range buildRuntimeLeases(state) {
		if !runtimeLeaseIsActive(lease.Status) {
			continue
		}
		for _, key := range runtimeLeaseKeys(lease.Runtime, lease.Machine) {
			counts[key] += 1
		}
	}
	return counts
}

func runtimeLeaseIsActive(status string) bool {
	switch strings.TrimSpace(status) {
	case "", "done":
		return false
	default:
		return true
	}
}

func runtimeLeaseKeys(values ...string) []string {
	seen := make(map[string]bool, len(values))
	keys := make([]string, 0, len(values))
	for _, value := range values {
		key := strings.TrimSpace(value)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		keys = append(keys, key)
	}
	return keys
}

func runtimeLeaseCountForKeys(counts map[string]int, values ...string) int {
	for _, key := range runtimeLeaseKeys(values...) {
		if count, ok := counts[key]; ok {
			return count
		}
	}
	return 0
}

func runtimeSchedulerCandidateRank(candidate RuntimeSchedulerCandidate) int {
	if !candidate.Schedulable {
		return 100
	}
	switch candidate.State {
	case runtimeStateOnline:
		return 0
	case runtimeStateBusy:
		return 1
	default:
		return 10
	}
}
