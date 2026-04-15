package store

import (
	"path/filepath"
	"sort"
	"strings"
)

func hydrateAgentFileStacks(state *State) {
	for index := range state.Agents {
		state.Agents[index].FileStack = buildAgentFileStack(state.Memory, state.Agents[index])
	}
}

func buildAgentFileStack(items []MemoryArtifact, agent Agent) []AgentFileReference {
	agentSlug := slugify(agent.Name)
	if agentSlug == "" {
		return []AgentFileReference{}
	}

	prefix := filepath.ToSlash(filepath.Join(".openshock", "agents", agentSlug)) + "/"
	stack := make([]AgentFileReference, 0, 6)
	for _, item := range items {
		path := filepath.ToSlash(strings.TrimSpace(item.Path))
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		stack = append(stack, AgentFileReference{
			Path:    path,
			Kind:    item.Kind,
			Summary: item.Summary,
			Scope:   item.Scope,
		})
	}

	sort.SliceStable(stack, func(left, right int) bool {
		leftOrder := agentFileStackOrder(stack[left].Path)
		rightOrder := agentFileStackOrder(stack[right].Path)
		if leftOrder != rightOrder {
			return leftOrder < rightOrder
		}
		return stack[left].Path < stack[right].Path
	})

	return stack
}

func agentFileStackOrder(path string) int {
	path = filepath.ToSlash(path)
	switch {
	case strings.HasSuffix(path, "/SOUL.md"):
		return 0
	case strings.HasSuffix(path, "/MEMORY.md"):
		return 1
	case strings.HasSuffix(path, "/notes/channels.md"):
		return 2
	case strings.HasSuffix(path, "/notes/operating-rules.md"):
		return 3
	case strings.HasSuffix(path, "/notes/skills.md"):
		return 4
	case strings.HasSuffix(path, "/notes/work-log.md"):
		return 5
	default:
		return 99
	}
}
