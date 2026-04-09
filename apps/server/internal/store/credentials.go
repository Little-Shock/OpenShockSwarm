package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	credentialSecretStatusConfigured = "configured"
)

var (
	ErrCredentialProfileNotFound       = errors.New("credential profile not found")
	ErrCredentialProfileLabelRequired  = errors.New("credential profile label is required")
	ErrCredentialProfileKindRequired   = errors.New("credential profile kind is required")
	ErrCredentialProfileSecretRequired = errors.New("credential profile secret is required")
	ErrCredentialProfileBindingInvalid = errors.New("credential profile binding is invalid")
	ErrCredentialRunNotFound           = errors.New("run not found")
)

func (s *Store) CreateCredentialProfile(input CredentialProfileCreateInput) (State, CredentialProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	label := strings.TrimSpace(input.Label)
	if label == "" {
		return State{}, CredentialProfile{}, ErrCredentialProfileLabelRequired
	}
	secretKind := strings.TrimSpace(input.SecretKind)
	if secretKind == "" {
		return State{}, CredentialProfile{}, ErrCredentialProfileKindRequired
	}
	secretValue := strings.TrimSpace(input.SecretValue)
	if secretValue == "" {
		return State{}, CredentialProfile{}, ErrCredentialProfileSecretRequired
	}
	if err := s.ensureCredentialVaultLocked(); err != nil {
		return State{}, CredentialProfile{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	profile := CredentialProfile{
		ID:               fmt.Sprintf("credential-%s-%d", slugify(label), time.Now().UnixNano()),
		Label:            label,
		Summary:          strings.TrimSpace(input.Summary),
		SecretKind:       secretKind,
		SecretStatus:     credentialSecretStatusConfigured,
		WorkspaceDefault: input.WorkspaceDefault,
		UpdatedAt:        now,
		UpdatedBy:        defaultString(strings.TrimSpace(input.UpdatedBy), "System"),
		LastRotatedAt:    now,
		Audit: []CredentialProfileAuditEntry{{
			ID:        fmt.Sprintf("credential-audit-%d", time.Now().UnixNano()),
			Action:    "created",
			Summary:   fmt.Sprintf("created %s", label),
			UpdatedAt: now,
			UpdatedBy: defaultString(strings.TrimSpace(input.UpdatedBy), "System"),
		}},
	}

	item, err := sealCredentialSecret(s.vaultKey, secretValue, now)
	if err != nil {
		return State{}, CredentialProfile{}, err
	}
	if s.vault.Secrets == nil {
		s.vault.Secrets = map[string]credentialVaultItem{}
	}
	s.vault.Secrets[profile.ID] = item
	s.state.Credentials = append([]CredentialProfile{profile}, s.state.Credentials...)
	s.syncAllCredentialGuardsLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, CredentialProfile{}, err
	}
	return cloneState(s.state), profile, nil
}

func (s *Store) UpdateCredentialProfile(profileID string, input CredentialProfileUpdateInput) (State, CredentialProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	index := s.findCredentialProfileByIDLocked(profileID)
	if index == -1 {
		return State{}, CredentialProfile{}, ErrCredentialProfileNotFound
	}
	label := strings.TrimSpace(input.Label)
	if label == "" {
		return State{}, CredentialProfile{}, ErrCredentialProfileLabelRequired
	}
	secretKind := strings.TrimSpace(input.SecretKind)
	if secretKind == "" {
		return State{}, CredentialProfile{}, ErrCredentialProfileKindRequired
	}
	if err := s.ensureCredentialVaultLocked(); err != nil {
		return State{}, CredentialProfile{}, err
	}

	now := time.Now().UTC().Format(time.RFC3339)
	profile := s.state.Credentials[index]
	profile.Label = label
	profile.Summary = strings.TrimSpace(input.Summary)
	profile.SecretKind = secretKind
	profile.WorkspaceDefault = input.WorkspaceDefault
	profile.UpdatedAt = now
	profile.UpdatedBy = defaultString(strings.TrimSpace(input.UpdatedBy), "System")

	action := "updated"
	if secretValue := strings.TrimSpace(input.SecretValue); secretValue != "" {
		item, err := sealCredentialSecret(s.vaultKey, secretValue, now)
		if err != nil {
			return State{}, CredentialProfile{}, err
		}
		if s.vault.Secrets == nil {
			s.vault.Secrets = map[string]credentialVaultItem{}
		}
		s.vault.Secrets[profile.ID] = item
		profile.SecretStatus = credentialSecretStatusConfigured
		profile.LastRotatedAt = now
		action = "rotated"
	}
	profile.Audit = prependCredentialAudit(profile.Audit, CredentialProfileAuditEntry{
		ID:        fmt.Sprintf("credential-audit-%d", time.Now().UnixNano()),
		Action:    action,
		Summary:   fmt.Sprintf("%s %s", action, profile.Label),
		UpdatedAt: now,
		UpdatedBy: profile.UpdatedBy,
	})
	s.state.Credentials[index] = profile
	s.syncAllCredentialGuardsLocked()

	if err := s.persistLocked(); err != nil {
		return State{}, CredentialProfile{}, err
	}
	return cloneState(s.state), profile, nil
}

func (s *Store) UpdateRunCredentialBindings(runID string, input RunCredentialBindingInput) (State, Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	runIndex := s.findRunByIDLocked(runID)
	if runIndex == -1 {
		return State{}, Run{}, ErrCredentialRunNotFound
	}
	ids, err := s.normalizeCredentialProfileIDsLocked(input.CredentialProfileIDs)
	if err != nil {
		return State{}, Run{}, err
	}

	s.state.Runs[runIndex].CredentialProfileIDs = ids
	now := time.Now().UTC().Format(time.RFC3339)
	if len(ids) == 0 {
		s.state.Runs[runIndex].NextAction = "当前 run 没有额外 run-scope secret binding。"
	} else {
		s.state.Runs[runIndex].NextAction = fmt.Sprintf("当前 run 已锁定 %d 条 run-scope credential binding。", len(ids))
	}
	s.appendRoomMessageLocked(s.state.Runs[runIndex].RoomID, Message{
		ID:      fmt.Sprintf("%s-credential-binding-%d", s.state.Runs[runIndex].RoomID, time.Now().UnixNano()),
		Speaker: "System",
		Role:    "system",
		Tone:    "system",
		Message: fmt.Sprintf("Run credential scope 已更新：%d 条显式绑定。", len(ids)),
		Time:    shortClock(),
	})
	_ = now
	s.syncCredentialGuardForRunLocked(runID)

	if err := s.persistLocked(); err != nil {
		return State{}, Run{}, err
	}
	return cloneState(s.state), s.state.Runs[runIndex], nil
}

func (s *Store) RecordCredentialUse(runID, actor string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if runIndex := s.findRunByIDLocked(runID); runIndex == -1 {
		return ErrCredentialRunNotFound
	}

	now := time.Now().UTC().Format(time.RFC3339)
	for _, credentialID := range s.effectiveCredentialProfileIDsLocked(s.state.Runs[s.findRunByIDLocked(runID)]) {
		index := s.findCredentialProfileByIDLocked(credentialID)
		if index == -1 {
			continue
		}
		profile := s.state.Credentials[index]
		profile.LastUsedAt = now
		profile.LastUsedBy = defaultString(strings.TrimSpace(actor), "System")
		profile.LastUsedRunID = runID
		profile.Audit = prependCredentialAudit(profile.Audit, CredentialProfileAuditEntry{
			ID:        fmt.Sprintf("credential-audit-%d", time.Now().UnixNano()),
			Action:    "used",
			Summary:   fmt.Sprintf("used by %s on %s", profile.LastUsedBy, runID),
			UpdatedAt: now,
			UpdatedBy: profile.LastUsedBy,
		})
		s.state.Credentials[index] = profile
	}
	s.syncCredentialGuardForRunLocked(runID)
	return s.persistLocked()
}

func prependCredentialAudit(items []CredentialProfileAuditEntry, item CredentialProfileAuditEntry) []CredentialProfileAuditEntry {
	next := append([]CredentialProfileAuditEntry{item}, items...)
	if len(next) > 8 {
		next = next[:8]
	}
	return next
}

func (s *Store) normalizeCredentialProfileIDsLocked(ids []string) ([]string, error) {
	seen := map[string]bool{}
	normalized := make([]string, 0, len(ids))
	for _, candidate := range ids {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || seen[candidate] {
			continue
		}
		if s.findCredentialProfileByIDLocked(candidate) == -1 {
			return nil, fmt.Errorf("%w: %s", ErrCredentialProfileBindingInvalid, candidate)
		}
		seen[candidate] = true
		normalized = append(normalized, candidate)
	}
	return normalized, nil
}

func (s *Store) findCredentialProfileByIDLocked(profileID string) int {
	for index, profile := range s.state.Credentials {
		if profile.ID == profileID {
			return index
		}
	}
	return -1
}

func (s *Store) findRunByIDLocked(runID string) int {
	for index, run := range s.state.Runs {
		if run.ID == runID {
			return index
		}
	}
	return -1
}

func (s *Store) findAgentForRunLocked(run Run) (Agent, bool) {
	for _, agent := range s.state.Agents {
		if strings.EqualFold(strings.TrimSpace(agent.Name), strings.TrimSpace(run.Owner)) || strings.EqualFold(strings.TrimSpace(agent.ID), strings.TrimSpace(run.Owner)) {
			return agent, true
		}
		for _, recentRunID := range agent.RecentRunIDs {
			if recentRunID == run.ID {
				return agent, true
			}
		}
	}
	return Agent{}, false
}

func (s *Store) effectiveCredentialProfileIDsLocked(run Run) []string {
	seen := map[string]bool{}
	merged := make([]string, 0, len(s.state.Credentials)+len(run.CredentialProfileIDs))

	for _, profile := range s.state.Credentials {
		if !profile.WorkspaceDefault {
			continue
		}
		if seen[profile.ID] {
			continue
		}
		seen[profile.ID] = true
		merged = append(merged, profile.ID)
	}

	if agent, ok := s.findAgentForRunLocked(run); ok {
		for _, profileID := range agent.CredentialProfileIDs {
			if seen[profileID] {
				continue
			}
			seen[profileID] = true
			merged = append(merged, profileID)
		}
	}

	for _, profileID := range run.CredentialProfileIDs {
		if seen[profileID] {
			continue
		}
		seen[profileID] = true
		merged = append(merged, profileID)
	}
	return merged
}

func (s *Store) syncAllCredentialGuardsLocked() {
	for _, run := range s.state.Runs {
		s.syncCredentialGuardForRunLocked(run.ID)
	}
}

func (s *Store) syncCredentialGuardForRunLocked(runID string) {
	runIndex := s.findRunByIDLocked(runID)
	if runIndex == -1 {
		return
	}
	run := s.state.Runs[runIndex]
	effectiveIDs := s.effectiveCredentialProfileIDsLocked(run)
	guardID := credentialGuardID(runID)
	guardIndex := -1
	for index := range s.state.Guards {
		if s.state.Guards[index].ID == guardID {
			guardIndex = index
			break
		}
	}
	if len(effectiveIDs) == 0 {
		if guardIndex != -1 {
			s.state.Guards = append(s.state.Guards[:guardIndex], s.state.Guards[guardIndex+1:]...)
		}
		return
	}

	labels := make([]string, 0, len(effectiveIDs))
	for _, profileID := range effectiveIDs {
		index := s.findCredentialProfileByIDLocked(profileID)
		if index == -1 {
			continue
		}
		labels = append(labels, s.state.Credentials[index].Label)
	}
	if len(labels) == 0 {
		return
	}

	boundary := DestructiveGuard{
		ID:               guardID,
		Title:            "Credential Scope Guard",
		Summary:          fmt.Sprintf("当前 run 可消费 %d 条 credential profile，secret plaintext 保持加密，不会进入 `/v1/state`。", len(labels)),
		Status:           "ready",
		Risk:             "secret_scope",
		Scope:            "workspace / agent / run credential scope",
		RoomID:           run.RoomID,
		RunID:            run.ID,
		ApprovalRequired: false,
		Boundaries: []GuardBoundary{
			{Label: "Profiles", Value: strings.Join(labels, " / ")},
			{Label: "Visibility", Value: "only metadata in live state; secret payload stays encrypted at rest"},
			{Label: "Access", Value: "workspace.manage can write/rotate; run.execute can consume bound scope"},
		},
	}
	if guardIndex == -1 {
		s.state.Guards = append(s.state.Guards, boundary)
		return
	}
	s.state.Guards[guardIndex] = boundary
}

func credentialGuardID(runID string) string {
	return fmt.Sprintf("guard-credential-scope-%s", slugify(runID))
}

func (s *Store) credentialVaultPath() string {
	return filepath.Join(filepath.Dir(s.path), "credentials.vault.json")
}

func (s *Store) credentialVaultKeyPath() string {
	return filepath.Join(filepath.Dir(s.path), "credentials.vault.key")
}

func (s *Store) ensureCredentialVaultLocked() error {
	if len(s.vaultKey) == 0 {
		keyBody, err := os.ReadFile(s.credentialVaultKeyPath())
		if err == nil {
			decoded, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(string(keyBody)))
			if decodeErr != nil {
				return decodeErr
			}
			s.vaultKey = decoded
		} else if errors.Is(err, os.ErrNotExist) {
			key := make([]byte, 32)
			if _, readErr := rand.Read(key); readErr != nil {
				return readErr
			}
			s.vaultKey = key
			if writeErr := os.WriteFile(s.credentialVaultKeyPath(), []byte(base64.StdEncoding.EncodeToString(key)), 0o600); writeErr != nil {
				return writeErr
			}
		} else {
			return err
		}
	}

	if s.vault.Version != 0 || s.vault.Secrets != nil {
		return nil
	}

	body, err := os.ReadFile(s.credentialVaultPath())
	if err == nil && len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &s.vault); err != nil {
			return err
		}
		if s.vault.Secrets == nil {
			s.vault.Secrets = map[string]credentialVaultItem{}
		}
		return nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	s.vault = credentialVault{
		Version: 1,
		Secrets: map[string]credentialVaultItem{},
	}
	return s.persistCredentialVaultLocked()
}

func (s *Store) persistCredentialVaultLocked() error {
	if len(s.vaultKey) == 0 {
		if err := s.ensureCredentialVaultLocked(); err != nil {
			return err
		}
	}
	if s.vault.Version == 0 {
		s.vault.Version = 1
	}
	if s.vault.Secrets == nil {
		s.vault.Secrets = map[string]credentialVaultItem{}
	}
	body, err := json.MarshalIndent(s.vault, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.credentialVaultPath(), body, 0o600)
}

func sealCredentialSecret(key []byte, plaintext, updatedAt string) (credentialVaultItem, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return credentialVaultItem{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return credentialVaultItem{}, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return credentialVaultItem{}, err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return credentialVaultItem{
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
		Ciphertext: base64.StdEncoding.EncodeToString(ciphertext),
		UpdatedAt:  updatedAt,
	}, nil
}
