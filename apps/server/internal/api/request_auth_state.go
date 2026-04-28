package api

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

const requestAuthStateVersion = 1

type authRequestStateFile struct {
	Version int                           `json:"version"`
	Tokens  map[string]authRequestBinding `json:"tokens"`
}

func requestAuthStatePath(storeStatePath string) string {
	storeStatePath = strings.TrimSpace(storeStatePath)
	if storeStatePath == "" {
		return ""
	}
	return filepath.Join(filepath.Dir(storeStatePath), "request-auth-tokens.json")
}

func normalizePersistedRequestAuthTokens(tokens map[string]authRequestBinding) map[string]authRequestBinding {
	if len(tokens) == 0 {
		return map[string]authRequestBinding{}
	}

	cleaned := make(map[string]authRequestBinding, len(tokens))
	for token, binding := range tokens {
		token = strings.TrimSpace(token)
		if token == "" || requestAuthBindingExpired(binding) {
			continue
		}
		binding.MemberID = strings.TrimSpace(binding.MemberID)
		binding.Email = strings.TrimSpace(binding.Email)
		binding.DeviceID = strings.TrimSpace(binding.DeviceID)
		binding.DeviceLabel = strings.TrimSpace(binding.DeviceLabel)
		binding.AuthMethod = strings.TrimSpace(binding.AuthMethod)
		binding.SignedInAt = strings.TrimSpace(binding.SignedInAt)
		cleaned[token] = binding
	}
	return cleaned
}

func (s *Server) loadPersistedRequestAuthTokens() {
	path := strings.TrimSpace(s.authTokenStatePath)
	if path == "" {
		return
	}

	body, err := os.ReadFile(path)
	if err != nil || len(bytes.TrimSpace(body)) == 0 {
		return
	}

	var payload authRequestStateFile
	if err := json.Unmarshal(body, &payload); err != nil {
		return
	}

	tokens := normalizePersistedRequestAuthTokens(payload.Tokens)
	s.authTokenMu.Lock()
	s.authTokens = tokens
	s.authTokenMu.Unlock()
}

func (s *Server) persistRequestAuthTokensLocked() error {
	path := strings.TrimSpace(s.authTokenStatePath)
	if path == "" {
		return nil
	}

	s.authTokens = normalizePersistedRequestAuthTokens(s.authTokens)
	payload := authRequestStateFile{
		Version: requestAuthStateVersion,
		Tokens:  s.authTokens,
	}
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, body, 0o600)
}
