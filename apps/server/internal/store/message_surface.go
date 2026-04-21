package store

import (
	"fmt"
	"net/url"
	"strings"
	"time"
)

type MessageSurfaceCollectionUpdateInput struct {
	Kind      string
	ChannelID string
	MessageID string
	Enabled   bool
}

func normalizeMessageSearchText(parts ...string) string {
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(strings.ToLower(part))
		if part == "" {
			continue
		}
		normalized = append(normalized, part)
	}
	return strings.Join(normalized, " ")
}

func buildChannelWorkbenchHref(channelID, tab, threadID string) string {
	if strings.TrimSpace(channelID) == "" {
		return "/chat"
	}
	base := fmt.Sprintf("/chat/%s", channelID)
	params := make([]string, 0, 2)
	if strings.TrimSpace(tab) != "" && tab != "chat" {
		params = append(params, "tab="+tab)
	}
	if strings.TrimSpace(threadID) != "" {
		params = append(params, "thread="+threadID)
	}
	if len(params) == 0 {
		return base
	}
	return base + "?" + strings.Join(params, "&")
}

func buildMessageSurfaceQuickSearchEntries(state State) []SearchResult {
	roomByID := make(map[string]Room, len(state.Rooms))
	for _, room := range state.Rooms {
		roomByID[room.ID] = room
	}
	issueByKey := make(map[string]Issue, len(state.Issues))
	for _, issue := range state.Issues {
		issueByKey[issue.Key] = issue
	}

	results := make([]SearchResult, 0, len(state.Channels)+len(state.DirectMessages)+(len(state.Rooms)*2)+len(state.Issues)+len(state.Runs)+len(state.Agents)+len(state.FollowedThreads)+len(state.SavedLaterItems))

	for _, channel := range state.Channels {
		results = append(results, SearchResult{
			ID:       channel.ID,
			Kind:     "channel",
			Title:    fmt.Sprintf("# %s", channel.Name),
			Summary:  defaultString(channel.Summary, channel.Purpose),
			Meta:     fmt.Sprintf("channel · unread %d", channel.Unread),
			Href:     buildChannelWorkbenchHref(channel.ID, "chat", ""),
			Keywords: normalizeMessageSearchText(channel.ID, channel.Name, channel.Summary, channel.Purpose, "channel"),
			Order:    0,
		})
	}
	for _, dm := range state.DirectMessages {
		results = append(results, SearchResult{
			ID:       dm.ID,
			Kind:     "dm",
			Title:    dm.Name,
			Summary:  defaultString(dm.Summary, dm.Purpose),
			Meta:     fmt.Sprintf("dm · %s · unread %d", defaultString(dm.Presence, "idle"), dm.Unread),
			Href:     buildChannelWorkbenchHref(dm.ID, "chat", ""),
			Keywords: normalizeMessageSearchText(dm.ID, dm.Name, dm.Summary, dm.Purpose, dm.Counterpart, dm.Presence, "dm", "direct message"),
			Order:    1,
		})
	}
	for _, room := range state.Rooms {
		results = append(results, SearchResult{
			ID:       room.ID,
			Kind:     "room",
			Title:    room.Title,
			Summary:  defaultString(room.Summary, room.Topic.Summary),
			Meta:     fmt.Sprintf("room · %s · %s", room.IssueKey, room.Topic.Status),
			Href:     fmt.Sprintf("/rooms/%s", room.ID),
			Keywords: normalizeMessageSearchText(room.ID, room.Title, room.IssueKey, room.Summary, room.Topic.Title, room.Topic.Summary, room.Topic.Status, "room"),
			Order:    2,
		})
		results = append(results, SearchResult{
			ID:       room.Topic.ID,
			Kind:     "topic",
			Title:    room.Topic.Title,
			Summary:  defaultString(room.Topic.Summary, room.Summary),
			Meta:     fmt.Sprintf("topic · %s · %s · %s", room.IssueKey, room.Topic.Status, room.Title),
			Href:     fmt.Sprintf("/topics/%s", room.Topic.ID),
			Keywords: normalizeMessageSearchText(room.Topic.ID, room.Topic.Title, room.Topic.Summary, room.Topic.Owner, room.Topic.Status, room.ID, room.Title, room.IssueKey, "topic"),
			Order:    3,
		})
	}
	for _, issue := range state.Issues {
		results = append(results, SearchResult{
			ID:       issue.ID,
			Kind:     "issue",
			Title:    issue.Title,
			Summary:  fmt.Sprintf("%s · %s", issue.Key, issue.Summary),
			Meta:     fmt.Sprintf("issue · %s · %s", issue.Priority, issue.State),
			Href:     fmt.Sprintf("/issues/%s", issue.Key),
			Keywords: normalizeMessageSearchText(issue.ID, issue.Key, issue.Title, issue.Summary, issue.Owner, issue.State, issue.Priority, "issue"),
			Order:    4,
		})
	}
	for _, run := range state.Runs {
		room := roomByID[run.RoomID]
		issue := issueByKey[run.IssueKey]
		results = append(results, SearchResult{
			ID:       run.ID,
			Kind:     "run",
			Title:    run.ID,
			Summary:  fmt.Sprintf("%s · %s", run.IssueKey, defaultString(issue.Title, defaultString(room.Title, run.Summary))),
			Meta:     fmt.Sprintf("run · %s · %s · %s", run.Status, run.Runtime, run.Machine),
			Href:     fmt.Sprintf("/rooms/%s/runs/%s", run.RoomID, run.ID),
			Keywords: normalizeMessageSearchText(run.ID, run.IssueKey, run.Summary, run.Owner, run.Runtime, run.Machine, run.Provider, run.Status, room.Title, issue.Title, "run"),
			Order:    5,
		})
	}
	for _, agent := range state.Agents {
		results = append(results, SearchResult{
			ID:       agent.ID,
			Kind:     "agent",
			Title:    agent.Name,
			Summary:  defaultString(agent.Description, fmt.Sprintf("%s · %s", agent.Provider, agent.RuntimePreference)),
			Meta:     fmt.Sprintf("agent · %s · %s", agent.State, agent.Provider),
			Href:     fmt.Sprintf("/profiles/agent/%s", url.PathEscape(agent.ID)),
			Keywords: normalizeMessageSearchText(agent.ID, agent.Name, agent.Description, agent.State, agent.Provider, agent.RuntimePreference, agent.Lane, strings.Join(agent.MemorySpaces, " "), "agent"),
			Order:    6,
		})
	}
	for _, item := range state.FollowedThreads {
		results = append(results, SearchResult{
			ID:       item.ID,
			Kind:     "followed",
			Title:    item.Title,
			Summary:  item.Summary,
			Meta:     fmt.Sprintf("%s · followed · unread %d", item.ChannelLabel, item.Unread),
			Href:     buildChannelWorkbenchHref(item.ChannelID, "followed", item.MessageID),
			Keywords: normalizeMessageSearchText(item.ID, item.ChannelID, item.MessageID, item.ChannelLabel, item.Title, item.Summary, item.Note, "followed", "thread"),
			Order:    7,
		})
	}
	for _, item := range state.SavedLaterItems {
		results = append(results, SearchResult{
			ID:       item.ID,
			Kind:     "saved",
			Title:    item.Title,
			Summary:  item.Summary,
			Meta:     fmt.Sprintf("%s · later · unread %d", item.ChannelLabel, item.Unread),
			Href:     buildChannelWorkbenchHref(item.ChannelID, "saved", item.MessageID),
			Keywords: normalizeMessageSearchText(item.ID, item.ChannelID, item.MessageID, item.ChannelLabel, item.Title, item.Summary, item.Note, "saved", "later"),
			Order:    8,
		})
	}

	return results
}

func (s *Store) findDirectMessageIndexLocked(dmID string) int {
	for index := range s.state.DirectMessages {
		if s.state.DirectMessages[index].ID == dmID {
			return index
		}
	}
	return -1
}

func (s *Store) findMessageSurfaceEntryIndexLocked(items []MessageSurfaceEntry, channelID, messageID string) int {
	for index := range items {
		if items[index].ChannelID == channelID && items[index].MessageID == messageID {
			return index
		}
	}
	return -1
}

func (s *Store) messageSurfaceSourceLocked(channelID string) ([]Message, string, bool) {
	for _, channel := range s.state.Channels {
		if channel.ID == channelID {
			return s.state.ChannelMessages[channelID], "#" + channel.Name, true
		}
	}
	for _, dm := range s.state.DirectMessages {
		if dm.ID == channelID {
			return s.state.DirectMessageMessages[channelID], dm.Name, true
		}
	}
	return nil, "", false
}

func (s *Store) findMessageSurfaceMessageLocked(channelID, messageID string) (Message, string, bool) {
	messages, label, ok := s.messageSurfaceSourceLocked(channelID)
	if !ok {
		return Message{}, "", false
	}
	for _, message := range messages {
		if message.ID == messageID {
			return message, label, true
		}
	}
	return Message{}, "", false
}

func buildMessageSurfaceEntry(kind, channelID, channelLabel string, message Message) MessageSurfaceEntry {
	note := "这条 thread 已被 follow，可从 sidebar 或 Followed tab 重新打开。"
	if kind == "saved" {
		note = "稍后查看保留“晚点回看”的消息，不单独再造一层待办。"
	}
	return MessageSurfaceEntry{
		ID:           fmt.Sprintf("%s-%s-%s", kind, channelID, message.ID),
		ChannelID:    channelID,
		MessageID:    message.ID,
		ChannelLabel: channelLabel,
		Title:        fmt.Sprintf("%s / %s", message.Speaker, messageExcerpt(message.Message, 34)),
		Summary:      messageExcerpt(message.Message, 110),
		Note:         note,
		UpdatedAt:    message.Time,
		Unread:       0,
	}
}

func messageExcerpt(text string, limit int) string {
	text = strings.TrimSpace(text)
	if limit <= 0 || len([]rune(text)) <= limit {
		return text
	}
	runes := []rune(text)
	return string(runes[:limit]) + "…"
}

func (s *Store) AppendDirectMessageConversation(dmID, prompt, actor string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	dmIndex := s.findDirectMessageIndexLocked(dmID)
	if dmIndex == -1 {
		return State{}, fmt.Errorf("direct message not found")
	}

	now := shortClock()
	counterpart := defaultString(s.state.DirectMessages[dmIndex].Counterpart, strings.TrimPrefix(s.state.DirectMessages[dmIndex].Name, "@"))
	humanMessage := Message{
		ID:      fmt.Sprintf("dm-human-%d", time.Now().UnixNano()),
		Speaker: defaultString(strings.TrimSpace(actor), "Larkspur"),
		Role:    "human",
		Tone:    "human",
		Message: strings.TrimSpace(prompt),
		Time:    now,
	}
	replyMessage := Message{
		ID:      fmt.Sprintf("dm-agent-%d", time.Now().UnixNano()),
		Speaker: counterpart,
		Role:    "agent",
		Tone:    "agent",
		Message: "收到。这条我先留在 DM / followed thread 工作流里，不急着升级成 room。",
		Time:    now,
	}

	s.state.DirectMessageMessages[dmID] = append(s.state.DirectMessageMessages[dmID], humanMessage, replyMessage)
	s.state.DirectMessages[dmIndex].MessageIDs = append(s.state.DirectMessages[dmIndex].MessageIDs, humanMessage.ID, replyMessage.ID)
	s.state.DirectMessages[dmIndex].Unread = 0
	s.state.DirectMessages[dmIndex].Summary = humanMessage.Message

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func (s *Store) UpdateMessageSurfaceCollection(input MessageSurfaceCollectionUpdateInput) (State, MessageSurfaceEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	kind := strings.TrimSpace(input.Kind)
	if kind != "followed" && kind != "saved" {
		return State{}, MessageSurfaceEntry{}, fmt.Errorf("unsupported collection kind")
	}
	message, label, ok := s.findMessageSurfaceMessageLocked(input.ChannelID, input.MessageID)
	if !ok {
		return State{}, MessageSurfaceEntry{}, fmt.Errorf("message surface target not found")
	}

	entry := buildMessageSurfaceEntry(kind, input.ChannelID, label, message)
	switch kind {
	case "followed":
		index := s.findMessageSurfaceEntryIndexLocked(s.state.FollowedThreads, input.ChannelID, input.MessageID)
		if input.Enabled {
			if index == -1 {
				s.state.FollowedThreads = append([]MessageSurfaceEntry{entry}, s.state.FollowedThreads...)
			} else {
				s.state.FollowedThreads[index] = entry
			}
		} else if index != -1 {
			s.state.FollowedThreads = append(s.state.FollowedThreads[:index], s.state.FollowedThreads[index+1:]...)
		}
	case "saved":
		index := s.findMessageSurfaceEntryIndexLocked(s.state.SavedLaterItems, input.ChannelID, input.MessageID)
		if input.Enabled {
			if index == -1 {
				s.state.SavedLaterItems = append([]MessageSurfaceEntry{entry}, s.state.SavedLaterItems...)
			} else {
				s.state.SavedLaterItems[index] = entry
			}
		} else if index != -1 {
			s.state.SavedLaterItems = append(s.state.SavedLaterItems[:index], s.state.SavedLaterItems[index+1:]...)
		}
	}

	if err := s.persistLocked(); err != nil {
		return State{}, MessageSurfaceEntry{}, err
	}
	return cloneState(s.state), entry, nil
}
