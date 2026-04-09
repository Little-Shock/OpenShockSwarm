package store

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrTopicNotFound         = errors.New("topic not found")
	ErrTopicGuidanceRequired = errors.New("topic guidance summary is required")
)

type TopicGuidanceUpdateInput struct {
	Summary   string
	UpdatedBy string
}

func (s *Store) UpdateTopicGuidance(topicID string, input TopicGuidanceUpdateInput) (State, Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	topicID = strings.TrimSpace(topicID)
	if topicID == "" {
		return State{}, Room{}, ErrTopicNotFound
	}

	summary := strings.TrimSpace(input.Summary)
	if summary == "" {
		return State{}, Room{}, ErrTopicGuidanceRequired
	}

	roomIndex := -1
	for index := range s.state.Rooms {
		if s.state.Rooms[index].Topic.ID == topicID {
			roomIndex = index
			break
		}
	}
	if roomIndex == -1 {
		return State{}, Room{}, ErrTopicNotFound
	}

	roomID := s.state.Rooms[roomIndex].ID
	currentRunID := strings.TrimSpace(s.state.Rooms[roomIndex].RunID)
	s.state.Rooms[roomIndex].Topic.Summary = summary
	s.state.Rooms[roomIndex].Summary = summary
	s.state.Rooms[roomIndex].Unread = 0

	if runIndex := s.findRunIndexForTopicUpdateLocked(topicID, roomID, currentRunID); runIndex != -1 {
		s.state.Runs[runIndex].Summary = summary
		s.state.Runs[runIndex].NextAction = summary
	}
	if sessionIndex := s.findSessionIndexForTopicUpdateLocked(topicID, roomID, currentRunID); sessionIndex != -1 {
		s.state.Sessions[sessionIndex].Summary = summary
		s.state.Sessions[sessionIndex].UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if issueIndex := s.findIssueIndexByRoomLocked(roomID); issueIndex != -1 {
		s.state.Issues[issueIndex].Summary = summary
	}

	actor := defaultString(strings.TrimSpace(input.UpdatedBy), "Operator")
	s.appendRoomMessageLocked(roomID, Message{
		ID:      fmt.Sprintf("%s-topic-guidance-%d", roomID, time.Now().UnixNano()),
		Speaker: actor,
		Role:    "human",
		Tone:    "human",
		Message: summary,
		Time:    shortClock(),
	})

	if err := s.persistLocked(); err != nil {
		return State{}, Room{}, err
	}

	return cloneState(s.state), s.state.Rooms[roomIndex], nil
}

func (s *Store) findRunIndexForTopicUpdateLocked(topicID, roomID, runID string) int {
	if runID != "" {
		for index := range s.state.Runs {
			if s.state.Runs[index].ID == runID {
				return index
			}
		}
	}
	for index := range s.state.Runs {
		if s.state.Runs[index].TopicID == topicID && s.state.Runs[index].RoomID == roomID {
			return index
		}
	}
	for index := range s.state.Runs {
		if s.state.Runs[index].TopicID == topicID || s.state.Runs[index].RoomID == roomID {
			return index
		}
	}
	return -1
}

func (s *Store) findSessionIndexForTopicUpdateLocked(topicID, roomID, runID string) int {
	if runID != "" {
		for index := range s.state.Sessions {
			if s.state.Sessions[index].ActiveRunID == runID {
				return index
			}
		}
	}
	for index := range s.state.Sessions {
		if s.state.Sessions[index].TopicID == topicID && s.state.Sessions[index].RoomID == roomID {
			return index
		}
	}
	for index := range s.state.Sessions {
		if s.state.Sessions[index].TopicID == topicID || s.state.Sessions[index].RoomID == roomID {
			return index
		}
	}
	return -1
}

func (s *Store) findIssueIndexByRoomLocked(roomID string) int {
	for index := range s.state.Issues {
		if s.state.Issues[index].RoomID == roomID {
			return index
		}
	}
	return -1
}
