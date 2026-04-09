package store

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	githubsvc "github.com/Larkspur-Wang/OpenShock/apps/server/internal/github"
)

type IgnoredGitHubWebhookSyncError struct {
	Reason string
}

func (e *IgnoredGitHubWebhookSyncError) Error() string {
	return e.Reason
}

func (s *Store) ApplyGitHubWebhookEvent(event githubsvc.NormalizedWebhookEvent) (State, string, error) {
	snapshot := s.Snapshot()
	pullRequest, ok := findTrackedPullRequestForWebhook(snapshot, event)
	if !ok {
		return State{}, "", &IgnoredGitHubWebhookSyncError{
			Reason: fmt.Sprintf("github webhook event for PR #%d is not tracked by the current control plane", event.PullRequestNumber),
		}
	}

	remote := buildPullRequestRemoteFromWebhookEvent(pullRequest, event)
	nextState, err := s.SyncPullRequestFromRemote(pullRequest.ID, remote)
	if err != nil {
		return State{}, pullRequest.ID, err
	}
	nextState, err = s.UpsertPullRequestConversationFromWebhook(pullRequest.ID, event)
	if err != nil {
		return State{}, pullRequest.ID, err
	}
	nextState, err = s.ensurePullRequestInboxSurface(pullRequest.ID)
	if err != nil {
		return State{}, pullRequest.ID, err
	}
	return nextState, pullRequest.ID, nil
}

func (s *Store) UpsertPullRequestConversationFromWebhook(pullRequestID string, event githubsvc.NormalizedWebhookEvent) (State, error) {
	entry, ok := buildPullRequestConversationEntry(event)
	if !ok {
		return s.Snapshot(), nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	prIndex := s.findPullRequestLocked(pullRequestID)
	if prIndex == -1 {
		return State{}, fmt.Errorf("pull request not found")
	}

	pr := &s.state.PullRequests[prIndex]
	if pr.Conversation == nil {
		pr.Conversation = []PullRequestConversationEntry{}
	}

	existingIndex := -1
	for index := range pr.Conversation {
		if pr.Conversation[index].ID == entry.ID {
			existingIndex = index
			break
		}
	}
	if existingIndex != -1 {
		pr.Conversation = append(pr.Conversation[:existingIndex], pr.Conversation[existingIndex+1:]...)
	}
	pr.Conversation = append([]PullRequestConversationEntry{entry}, pr.Conversation...)

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func findTrackedPullRequestForWebhook(state State, event githubsvc.NormalizedWebhookEvent) (PullRequest, bool) {
	eventRepo := webhookEventRepoIdentity(event)
	workspaceRepo := normalizeRepoIdentity(state.Workspace.Repo)
	if eventRepo != "" && workspaceRepo != "" && eventRepo != workspaceRepo {
		return PullRequest{}, false
	}

	eventURL := strings.TrimSpace(event.PullRequestURL)
	for _, item := range state.PullRequests {
		if !pullRequestMatchesWebhookRepo(item, state.Workspace.Repo, eventRepo) {
			continue
		}
		if event.PullRequestNumber > 0 && item.Number == event.PullRequestNumber {
			return item, true
		}
		if eventURL != "" && strings.EqualFold(strings.TrimSpace(item.URL), eventURL) {
			return item, true
		}
	}
	return PullRequest{}, false
}

func pullRequestMatchesWebhookRepo(item PullRequest, workspaceRepo, eventRepo string) bool {
	if eventRepo == "" {
		return true
	}

	if itemRepo := pullRequestRepoIdentity(item.URL); itemRepo != "" {
		return itemRepo == eventRepo
	}

	if workspaceRepo = normalizeRepoIdentity(workspaceRepo); workspaceRepo != "" {
		return workspaceRepo == eventRepo
	}

	return true
}

func webhookEventRepoIdentity(event githubsvc.NormalizedWebhookEvent) string {
	if repo := normalizeRepoIdentity(event.Repository); repo != "" {
		return repo
	}
	return pullRequestRepoIdentity(event.PullRequestURL)
}

func pullRequestRepoIdentity(rawURL string) string {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return ""
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}

	segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(segments) < 2 {
		return ""
	}
	return normalizeRepoIdentity(strings.Join(segments[:2], "/"))
}

func normalizeRepoIdentity(repo string) string {
	repo = strings.TrimSpace(repo)
	repo = strings.TrimSuffix(repo, ".git")
	repo = strings.Trim(repo, "/")
	return strings.ToLower(repo)
}

func buildPullRequestRemoteFromWebhookEvent(current PullRequest, event githubsvc.NormalizedWebhookEvent) PullRequestRemoteSnapshot {
	status := pullRequestStatusFromWebhookEvent(current, event)
	reviewDecision := strings.TrimSpace(current.ReviewDecision)
	if strings.TrimSpace(event.ReviewDecision) != "" {
		reviewDecision = strings.TrimSpace(event.ReviewDecision)
	}

	return PullRequestRemoteSnapshot{
		Number:           defaultInt(event.PullRequestNumber, current.Number),
		Title:            defaultString(strings.TrimSpace(event.PullRequestTitle), current.Title),
		Status:           status,
		Branch:           defaultString(strings.TrimSpace(event.HeadBranch), current.Branch),
		BaseBranch:       defaultString(strings.TrimSpace(event.BaseBranch), current.BaseBranch),
		Author:           defaultString(strings.TrimSpace(event.Sender), current.Author),
		Provider:         defaultString(strings.TrimSpace(current.Provider), "github"),
		URL:              defaultString(strings.TrimSpace(event.PullRequestURL), current.URL),
		Mergeable:        current.Mergeable,
		MergeStateStatus: current.MergeStateStatus,
		ReviewDecision:   reviewDecision,
		ReviewSummary:    summarizeWebhookPullRequestEvent(current, event, status, reviewDecision),
		UpdatedAt:        "刚刚",
	}
}

func pullRequestStatusFromWebhookEvent(current PullRequest, event githubsvc.NormalizedWebhookEvent) string {
	currentStatus := defaultString(strings.TrimSpace(current.Status), "in_review")
	if strings.EqualFold(currentStatus, "merged") || event.PullRequestMerged || strings.EqualFold(strings.TrimSpace(event.Kind), "merge") {
		return "merged"
	}

	switch strings.TrimSpace(event.Kind) {
	case "review":
		if strings.EqualFold(strings.TrimSpace(event.ReviewDecision), "CHANGES_REQUESTED") || strings.EqualFold(strings.TrimSpace(event.ReviewState), "changes_requested") {
			return "changes_requested"
		}
		return "in_review"
	case "check":
		if webhookCheckBlocksPullRequest(event) {
			return "changes_requested"
		}
		return currentStatus
	case "pull_request", "comment":
		return currentStatus
	default:
		return currentStatus
	}
}

func summarizeWebhookPullRequestEvent(current PullRequest, event githubsvc.NormalizedWebhookEvent, status, reviewDecision string) string {
	if strings.EqualFold(status, "merged") {
		return summarizePullRequestStatus("merged", reviewDecision)
	}

	switch strings.TrimSpace(event.Kind) {
	case "review":
		switch strings.TrimSpace(reviewDecision) {
		case "CHANGES_REQUESTED":
			if detail := compactWebhookText(event.CommentBody); detail != "" {
				return fmt.Sprintf("GitHub Review 要求补充修改：%s", detail)
			}
			return "GitHub Review 要求补充修改，等待 follow-up run。"
		case "APPROVED":
			if detail := compactWebhookText(event.CommentBody); detail != "" {
				return fmt.Sprintf("GitHub Review 已批准：%s", detail)
			}
			return "GitHub Review 已批准，等待最终合并。"
		default:
			if detail := compactWebhookText(event.CommentBody); detail != "" {
				return fmt.Sprintf("GitHub Review 已同步：%s", detail)
			}
			return "GitHub Review 已同步，等待下一步处理。"
		}
	case "comment":
		if strings.EqualFold(strings.TrimSpace(current.Status), "changes_requested") || strings.EqualFold(strings.TrimSpace(current.ReviewDecision), "CHANGES_REQUESTED") {
			return defaultString(strings.TrimSpace(current.ReviewSummary), summarizePullRequestStatusWithSafety(current.Status, current.ReviewDecision, current.Mergeable, current.MergeStateStatus))
		}
		if detail := compactWebhookText(event.CommentBody); detail != "" {
			return fmt.Sprintf("GitHub 评论已同步：%s", detail)
		}
		return "GitHub 评论已同步到当前讨论间。"
	case "review_comment":
		if detail := compactWebhookText(event.CommentBody); detail != "" {
			return fmt.Sprintf("GitHub review comment 已同步：%s", detail)
		}
		return "GitHub review comment 已同步到当前讨论间。"
	case "review_thread":
		switch strings.TrimSpace(event.ThreadStatus) {
		case "resolved":
			return "GitHub 评论线程已标记为 resolved。"
		case "open":
			return "GitHub 评论线程已重新打开。"
		default:
			return "GitHub 评论线程状态已同步。"
		}
	case "check":
		checkName := defaultString(strings.TrimSpace(event.CheckName), "check")
		if webhookCheckBlocksPullRequest(event) {
			return fmt.Sprintf("GitHub Check %s 失败，当前 PR 被阻塞。", checkName)
		}
		if conclusion := strings.TrimSpace(event.CheckConclusion); conclusion != "" {
			return fmt.Sprintf("GitHub Check %s 已完成：%s。", checkName, strings.ToLower(conclusion))
		}
		if checkStatus := strings.TrimSpace(event.CheckStatus); checkStatus != "" {
			return fmt.Sprintf("GitHub Check %s 状态已同步：%s。", checkName, strings.ToLower(checkStatus))
		}
		return fmt.Sprintf("GitHub Check %s 已同步。", checkName)
	case "pull_request":
		if action := strings.TrimSpace(event.Action); action != "" {
			return fmt.Sprintf("GitHub PR 事件已同步：%s。", action)
		}
	}

	return defaultString(strings.TrimSpace(current.ReviewSummary), summarizePullRequestStatusWithSafety(status, reviewDecision, current.Mergeable, current.MergeStateStatus))
}

func webhookCheckBlocksPullRequest(event githubsvc.NormalizedWebhookEvent) bool {
	if !strings.EqualFold(strings.TrimSpace(event.Kind), "check") {
		return false
	}
	if !strings.EqualFold(strings.TrimSpace(event.CheckStatus), "completed") {
		return false
	}

	switch strings.ToLower(strings.TrimSpace(event.CheckConclusion)) {
	case "", "success", "neutral", "skipped":
		return false
	default:
		return true
	}
}

func compactWebhookText(text string) string {
	fields := strings.Fields(strings.TrimSpace(text))
	if len(fields) == 0 {
		return ""
	}

	compact := strings.Join(fields, " ")
	runes := []rune(compact)
	if len(runes) <= 96 {
		return compact
	}
	return string(runes[:96]) + "..."
}

func buildPullRequestConversationEntry(event githubsvc.NormalizedWebhookEvent) (PullRequestConversationEntry, bool) {
	key := strings.TrimSpace(event.ConversationKey)
	if key == "" {
		return PullRequestConversationEntry{}, false
	}

	entry := PullRequestConversationEntry{
		ID:             key,
		Kind:           strings.TrimSpace(event.Kind),
		Action:         strings.TrimSpace(event.Action),
		Author:         defaultString(strings.TrimSpace(event.Sender), "GitHub"),
		Summary:        summarizePullRequestConversation(event),
		Body:           strings.TrimSpace(event.CommentBody),
		ReviewDecision: strings.TrimSpace(event.ReviewDecision),
		ReviewState:    strings.TrimSpace(event.ReviewState),
		ThreadStatus:   strings.TrimSpace(event.ThreadStatus),
		Path:           strings.TrimSpace(event.ConversationPath),
		Line:           event.ConversationLine,
		URL:            strings.TrimSpace(event.ConversationURL),
		UpdatedAt:      defaultString(strings.TrimSpace(event.ConversationAt), "刚刚"),
	}
	return entry, true
}

func summarizePullRequestConversation(event githubsvc.NormalizedWebhookEvent) string {
	author := defaultString(strings.TrimSpace(event.Sender), "GitHub")
	location := strings.TrimSpace(event.ConversationPath)
	if event.ConversationLine > 0 {
		location = fmt.Sprintf("%s:%d", defaultString(location, "review thread"), event.ConversationLine)
	}

	switch strings.TrimSpace(event.Kind) {
	case "review":
		switch strings.TrimSpace(event.ReviewDecision) {
		case "APPROVED":
			return fmt.Sprintf("%s 批准了当前 PR。", author)
		case "CHANGES_REQUESTED":
			return fmt.Sprintf("%s 请求当前 PR 继续补充修改。", author)
		default:
			return fmt.Sprintf("%s 同步了 review 状态：%s。", author, defaultString(strings.TrimSpace(event.ReviewState), "submitted"))
		}
	case "review_comment":
		if location != "" {
			return fmt.Sprintf("%s 在 %s 追加了 review comment。", author, location)
		}
		return fmt.Sprintf("%s 追加了 review comment。", author)
	case "review_thread":
		switch strings.TrimSpace(event.ThreadStatus) {
		case "resolved":
			if location != "" {
				return fmt.Sprintf("%s 将 %s 的评论线程标记为 resolved。", author, location)
			}
			return fmt.Sprintf("%s 将评论线程标记为 resolved。", author)
		case "open":
			if location != "" {
				return fmt.Sprintf("%s 重新打开了 %s 的评论线程。", author, location)
			}
			return fmt.Sprintf("%s 重新打开了评论线程。", author)
		default:
			return fmt.Sprintf("%s 同步了评论线程状态。", author)
		}
	default:
		if detail := compactWebhookText(event.CommentBody); detail != "" {
			return fmt.Sprintf("%s 在 PR 对话里追加了评论：%s", author, detail)
		}
		return fmt.Sprintf("%s 在 PR 对话里追加了评论。", author)
	}
}

func (s *Store) ensurePullRequestInboxSurface(pullRequestID string) (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	prIndex := s.findPullRequestLocked(pullRequestID)
	if prIndex == -1 {
		return State{}, fmt.Errorf("pull request not found")
	}

	pr := s.state.PullRequests[prIndex]
	roomIndex, _, _, ok := s.findRoomRunIssueLocked(pr.RoomID)
	if !ok {
		return State{}, fmt.Errorf("room not found for pull request")
	}

	desired := pullRequestInboxItem(pr, s.state.Rooms[roomIndex].Title)
	relevantCount := 0
	exactMatch := false
	filtered := make([]InboxItem, 0, len(s.state.Inbox))
	for _, item := range s.state.Inbox {
		if !isTrackedPullRequestInboxItem(item, pr) {
			filtered = append(filtered, item)
			continue
		}
		relevantCount++
		if item.Kind == desired.Kind && item.Title == desired.Title && item.Room == desired.Room && item.Summary == desired.Summary && item.Action == desired.Action && item.Href == desired.Href {
			exactMatch = true
			filtered = append(filtered, item)
		}
	}

	if relevantCount == 1 && exactMatch {
		return cloneState(s.state), nil
	}

	filteredWithoutPR := filtered[:0]
	for _, item := range filtered {
		if !isTrackedPullRequestInboxItem(item, pr) {
			filteredWithoutPR = append(filteredWithoutPR, item)
		}
	}
	s.state.Inbox = append([]InboxItem{desired}, filteredWithoutPR...)

	if err := s.persistLocked(); err != nil {
		return State{}, err
	}
	return cloneState(s.state), nil
}

func pullRequestInboxItem(pr PullRequest, roomTitle string) InboxItem {
	item := InboxItem{
		ID:      fmt.Sprintf("inbox-pr-%s-%d", pr.Status, time.Now().UnixNano()),
		Room:    roomTitle,
		Time:    "刚刚",
		Href:    fmt.Sprintf("/rooms/%s/runs/%s", pr.RoomID, pr.RunID),
		Summary: defaultString(strings.TrimSpace(pr.ReviewSummary), summarizePullRequestStatusWithSafety(pr.Status, pr.ReviewDecision, pr.Mergeable, pr.MergeStateStatus)),
	}

	switch strings.TrimSpace(pr.Status) {
	case "merged":
		item.Title = fmt.Sprintf("%s 已合并", pr.Label)
		item.Kind = "status"
		item.Action = "打开房间"
	case "changes_requested":
		item.Title = fmt.Sprintf("%s 需要补充修改", pr.Label)
		item.Kind = "blocked"
		item.Action = "恢复执行"
		item.Href = fmt.Sprintf("/rooms/%s", pr.RoomID)
	case "draft":
		item.Title = fmt.Sprintf("%s 草稿已同步", pr.Label)
		item.Kind = "review"
		item.Action = "打开评审"
	default:
		item.Title = fmt.Sprintf("%s 已准备评审", pr.Label)
		item.Kind = "review"
		item.Action = "打开评审"
	}

	return item
}

func isTrackedPullRequestInboxItem(item InboxItem, pr PullRequest) bool {
	if item.Kind != "review" && item.Kind != "blocked" && item.Kind != "status" {
		return false
	}
	if item.Href != fmt.Sprintf("/rooms/%s/runs/%s", pr.RoomID, pr.RunID) && item.Href != fmt.Sprintf("/rooms/%s", pr.RoomID) {
		return false
	}
	labelPrefix := strings.TrimSpace(pr.Label)
	if labelPrefix == "" {
		if pr.Number > 0 {
			labelPrefix = fmt.Sprintf("PR #%d", pr.Number)
		} else {
			labelPrefix = "PR"
		}
	}
	return strings.HasPrefix(strings.TrimSpace(item.Title), labelPrefix)
}

func defaultInt(value, fallback int) int {
	if value != 0 {
		return value
	}
	return fallback
}
