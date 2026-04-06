package api

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/Larkspur-Wang/OpenShock/apps/server/internal/store"
)

type ExecRequest struct {
	Provider  string `json:"provider"`
	Prompt    string `json:"prompt"`
	Cwd       string `json:"cwd"`
	LeaseID   string `json:"leaseId,omitempty"`
	RunID     string `json:"runId,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	RoomID    string `json:"roomId,omitempty"`
}

type DaemonExecResponse struct {
	Provider string   `json:"provider,omitempty"`
	Command  []string `json:"command,omitempty"`
	Output   string   `json:"output"`
	Error    string   `json:"error,omitempty"`
	Duration string   `json:"duration,omitempty"`
}

type DaemonStreamEvent struct {
	Type      string       `json:"type"`
	Provider  string       `json:"provider,omitempty"`
	Command   []string     `json:"command,omitempty"`
	Delta     string       `json:"delta,omitempty"`
	Output    string       `json:"output,omitempty"`
	Error     string       `json:"error,omitempty"`
	Duration  string       `json:"duration,omitempty"`
	Timestamp string       `json:"timestamp,omitempty"`
	State     *store.State `json:"state,omitempty"`
}

type WorktreeRequest struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	Branch        string `json:"branch"`
	WorktreeName  string `json:"worktreeName"`
	BaseRef       string `json:"baseRef"`
	LeaseID       string `json:"leaseId,omitempty"`
	RunID         string `json:"runId,omitempty"`
	SessionID     string `json:"sessionId,omitempty"`
	RoomID        string `json:"roomId,omitempty"`
}

type WorktreeResponse struct {
	WorkspaceRoot string `json:"workspaceRoot"`
	Branch        string `json:"branch"`
	WorktreeName  string `json:"worktreeName"`
	Path          string `json:"path"`
	Created       bool   `json:"created"`
	BaseRef       string `json:"baseRef"`
}

func (s *Server) ensureWorktreeLane(daemonURL string, req WorktreeRequest) (WorktreeResponse, error) {
	body, _ := json.Marshal(req)
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(daemonURL, "/")+"/v1/worktrees/ensure", bytes.NewReader(body))
	if err != nil {
		return WorktreeResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return WorktreeResponse{}, err
	}
	defer response.Body.Close()

	payloadBody, err := io.ReadAll(response.Body)
	if err != nil {
		return WorktreeResponse{}, err
	}

	var payload WorktreeResponse
	if err := json.Unmarshal(payloadBody, &payload); err != nil {
		return WorktreeResponse{}, err
	}
	if response.StatusCode >= 400 {
		if payload.Path != "" {
			return WorktreeResponse{}, errors.New(payload.Path)
		}
		var daemonErr daemonErrorPayload
		if err := json.Unmarshal(payloadBody, &daemonErr); err == nil && daemonErr.Error != "" {
			return WorktreeResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: daemonErr.Error, Conflict: daemonErr.Conflict}
		}
		return WorktreeResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: fmt.Sprintf("worktree error: %s", response.Status)}
	}
	return payload, nil
}

func (s *Server) runDaemonExec(req ExecRequest) (DaemonExecResponse, error) {
	return s.runDaemonExecAgainst(s.currentWorkspaceDaemonURL(), req)
}

func (s *Server) runRoomDaemonExec(roomID string, req ExecRequest) (DaemonExecResponse, error) {
	attachRoomRuntimeLease(&req, s.store.Snapshot(), roomID, s.workspaceRoot)
	daemonURL, err := s.daemonURLForRoom(roomID)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	return s.runDaemonExecAgainst(daemonURL, req)
}

func (s *Server) runDaemonExecAgainst(daemonURL string, req ExecRequest) (DaemonExecResponse, error) {
	if strings.TrimSpace(daemonURL) == "" {
		return DaemonExecResponse{}, fmt.Errorf("runtime daemon url is not configured")
	}
	body, _ := json.Marshal(req)
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(daemonURL, "/")+"/v1/exec", bytes.NewReader(body))
	if err != nil {
		return DaemonExecResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	defer response.Body.Close()

	payloadBody, err := io.ReadAll(response.Body)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	var payload DaemonExecResponse
	if err := json.Unmarshal(payloadBody, &payload); err != nil {
		return DaemonExecResponse{}, err
	}
	if response.StatusCode >= 400 {
		var daemonErr daemonErrorPayload
		if err := json.Unmarshal(payloadBody, &daemonErr); err == nil && daemonErr.Error != "" {
			return DaemonExecResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: daemonErr.Error, Conflict: daemonErr.Conflict}
		}
		if payload.Error != "" {
			return DaemonExecResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: payload.Error}
		}
		return DaemonExecResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: fmt.Sprintf("daemon error: %s", response.Status)}
	}
	return payload, nil
}

func (s *Server) streamDaemonExec(r *http.Request, req ExecRequest, emit func(DaemonStreamEvent) error) (DaemonExecResponse, error) {
	return s.streamDaemonExecAgainst(r, s.currentWorkspaceDaemonURL(), req, emit)
}

func (s *Server) streamRoomDaemonExec(r *http.Request, roomID string, req ExecRequest, emit func(DaemonStreamEvent) error) (DaemonExecResponse, error) {
	attachRoomRuntimeLease(&req, s.store.Snapshot(), roomID, s.workspaceRoot)
	daemonURL, err := s.daemonURLForRoom(roomID)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	return s.streamDaemonExecAgainst(r, daemonURL, req, emit)
}

func (s *Server) streamDaemonExecAgainst(r *http.Request, daemonURL string, req ExecRequest, emit func(DaemonStreamEvent) error) (DaemonExecResponse, error) {
	if strings.TrimSpace(daemonURL) == "" {
		return DaemonExecResponse{}, fmt.Errorf("runtime daemon url is not configured")
	}
	body, _ := json.Marshal(req)
	request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, strings.TrimRight(daemonURL, "/")+"/v1/exec/stream", bytes.NewReader(body))
	if err != nil {
		return DaemonExecResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")

	response, err := s.httpClient.Do(request)
	if err != nil {
		return DaemonExecResponse{}, err
	}
	defer response.Body.Close()

	if response.StatusCode >= 400 {
		payloadBody, readErr := io.ReadAll(response.Body)
		if readErr != nil {
			return DaemonExecResponse{}, readErr
		}
		var daemonErr daemonErrorPayload
		if err := json.Unmarshal(payloadBody, &daemonErr); err == nil && daemonErr.Error != "" {
			return DaemonExecResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: daemonErr.Error, Conflict: daemonErr.Conflict}
		}
		var payload DaemonExecResponse
		if err := json.Unmarshal(payloadBody, &payload); err == nil && payload.Error != "" {
			return payload, &daemonHTTPError{Status: response.StatusCode, Message: payload.Error}
		}
		return DaemonExecResponse{}, &daemonHTTPError{Status: response.StatusCode, Message: fmt.Sprintf("daemon error: %s", response.Status)}
	}

	var resp DaemonExecResponse
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var event DaemonStreamEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return resp, err
		}
		if event.Type == "done" {
			resp.Output = event.Output
		}
		if event.Type == "error" && strings.TrimSpace(event.Error) != "" {
			resp.Error = event.Error
		}
		if emit != nil {
			if err := emit(event); err != nil {
				return resp, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return resp, err
	}
	if strings.TrimSpace(resp.Error) != "" {
		return resp, errors.New(resp.Error)
	}
	return resp, nil
}
