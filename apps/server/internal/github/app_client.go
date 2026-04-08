package github

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type githubAppTokenResponse struct {
	Token string `json:"token"`
}

type githubRESTPullRequest struct {
	Number    int    `json:"number"`
	HTMLURL   string `json:"html_url"`
	Title     string `json:"title"`
	State     string `json:"state"`
	Draft     bool   `json:"draft"`
	Merged    bool   `json:"merged"`
	UpdatedAt string `json:"updated_at"`
	MergedAt  string `json:"merged_at"`
	Head      struct {
		Ref string `json:"ref"`
	} `json:"head"`
	Base struct {
		Ref string `json:"ref"`
	} `json:"base"`
	User struct {
		Login string `json:"login"`
	} `json:"user"`
}

type githubGraphQLPullRequestResponse struct {
	Data struct {
		Repository struct {
			PullRequest *struct {
				ReviewDecision string `json:"reviewDecision"`
			} `json:"pullRequest"`
		} `json:"repository"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type githubAPIError struct {
	Message string `json:"message"`
}

func (s *Service) createPullRequestWithGitHubApp(workspaceRoot string, input CreatePullRequestInput) (PullRequest, error) {
	if _, err := s.git(workspaceRoot, "push", "-u", "origin", input.HeadBranch); err != nil {
		return PullRequest{}, fmt.Errorf("push branch to origin: %w", err)
	}

	token, err := githubAppInstallationToken(workspaceRoot)
	if err != nil {
		return PullRequest{}, err
	}

	var created struct {
		Number int `json:"number"`
	}
	if err := doGitHubAPIJSONRequest(http.MethodPost, githubAPIBaseURL()+"/repos/"+input.Repo+"/pulls", token, map[string]string{
		"title": input.Title,
		"body":  input.Body,
		"head":  input.HeadBranch,
		"base":  input.BaseBranch,
	}, &created); err != nil {
		return PullRequest{}, err
	}
	if created.Number <= 0 {
		return PullRequest{}, fmt.Errorf("github app create returned invalid pull request number")
	}

	return s.viewPullRequestWithGitHubApp(workspaceRoot, input.Repo, created.Number, false)
}

func (s *Service) mergePullRequestWithGitHubApp(workspaceRoot string, input MergePullRequestInput) (PullRequest, error) {
	token, err := githubAppInstallationToken(workspaceRoot)
	if err != nil {
		return PullRequest{}, err
	}

	method := defaultString(strings.TrimSpace(input.Method), "merge")
	if err := doGitHubAPIJSONRequest(http.MethodPut, fmt.Sprintf("%s/repos/%s/pulls/%d/merge", githubAPIBaseURL(), input.Repo, input.Number), token, map[string]string{
		"merge_method": method,
	}, nil); err != nil {
		return PullRequest{}, err
	}

	return s.viewPullRequestWithGitHubApp(workspaceRoot, input.Repo, input.Number, false)
}

func (s *Service) viewPullRequestWithGitHubApp(workspaceRoot, repo string, number int, requireReviewDecision bool) (PullRequest, error) {
	token, err := githubAppInstallationToken(workspaceRoot)
	if err != nil {
		return PullRequest{}, err
	}

	var payload githubRESTPullRequest
	if err := doGitHubAPIJSONRequest(http.MethodGet, fmt.Sprintf("%s/repos/%s/pulls/%d", githubAPIBaseURL(), repo, number), token, nil, &payload); err != nil {
		return PullRequest{}, err
	}

	reviewDecision, err := fetchGitHubAppReviewDecision(token, repo, number)
	if err != nil {
		if requireReviewDecision {
			return PullRequest{}, err
		}
		reviewDecision = ""
	}

	return PullRequest{
		Number:         payload.Number,
		URL:            payload.HTMLURL,
		Title:          payload.Title,
		State:          strings.ToUpper(strings.TrimSpace(payload.State)),
		IsDraft:        payload.Draft,
		ReviewDecision: strings.TrimSpace(reviewDecision),
		HeadRefName:    payload.Head.Ref,
		BaseRefName:    payload.Base.Ref,
		Author:         payload.User.Login,
		UpdatedAt:      payload.UpdatedAt,
		Merged:         payload.Merged || strings.TrimSpace(payload.MergedAt) != "",
	}, nil
}

func fetchGitHubAppReviewDecision(token, repo string, number int) (string, error) {
	parts := strings.SplitN(strings.TrimSpace(repo), "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", fmt.Errorf("invalid repo path %q", repo)
	}

	query := map[string]any{
		"query": `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
    }
  }
}`,
		"variables": map[string]any{
			"owner":  parts[0],
			"name":   parts[1],
			"number": number,
		},
	}

	var payload githubGraphQLPullRequestResponse
	if err := doGitHubAPIJSONRequest(http.MethodPost, githubGraphQLURL(), token, query, &payload); err != nil {
		return "", err
	}
	if len(payload.Errors) > 0 && strings.TrimSpace(payload.Errors[0].Message) != "" {
		return "", errors.New(strings.TrimSpace(payload.Errors[0].Message))
	}
	if payload.Data.Repository.PullRequest == nil {
		return "", nil
	}
	return strings.TrimSpace(payload.Data.Repository.PullRequest.ReviewDecision), nil
}

func githubAppInstallationToken(workspaceRoot string) (string, error) {
	appID, installationID, privateKey, err := loadGitHubAppCredentials(workspaceRoot)
	if err != nil {
		return "", err
	}

	jwt, err := signGitHubAppJWT(appID, privateKey, time.Now().UTC())
	if err != nil {
		return "", err
	}

	var response githubAppTokenResponse
	if err := doGitHubAPIJSONRequest(http.MethodPost, fmt.Sprintf("%s/app/installations/%s/access_tokens", githubAPIBaseURL(), installationID), jwt, map[string]any{}, &response); err != nil {
		return "", err
	}
	if strings.TrimSpace(response.Token) == "" {
		return "", fmt.Errorf("github app access token response was empty")
	}
	return strings.TrimSpace(response.Token), nil
}

func doGitHubAPIJSONRequest(method, requestURL, bearerToken string, requestBody any, responseBody any) error {
	var body io.Reader
	if requestBody != nil {
		payload, err := json.Marshal(requestBody)
		if err != nil {
			return fmt.Errorf("encode github request: %w", err)
		}
		body = bytes.NewReader(payload)
	}

	request, err := http.NewRequest(method, requestURL, body)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(bearerToken))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "openshock-server")
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var apiErr githubAPIError
		if json.Unmarshal(payload, &apiErr) == nil && strings.TrimSpace(apiErr.Message) != "" {
			return errors.New(strings.TrimSpace(apiErr.Message))
		}
		text := strings.TrimSpace(string(payload))
		if text == "" {
			text = response.Status
		}
		return errors.New(text)
	}
	if responseBody == nil || len(bytes.TrimSpace(payload)) == 0 {
		return nil
	}
	if err := json.Unmarshal(payload, responseBody); err != nil {
		return fmt.Errorf("decode github response: %w", err)
	}
	return nil
}

func loadGitHubAppCredentials(workspaceRoot string) (string, string, *rsa.PrivateKey, error) {
	appID := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_ID"))
	installationID := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_INSTALLATION_ID"))
	if installationID == "" {
		installationID = strings.TrimSpace(loadInstallationStateFallback(workspaceRoot).InstallationID)
	}
	if appID == "" {
		return "", "", nil, fmt.Errorf("github app id is not configured")
	}
	if installationID == "" {
		return "", "", nil, fmt.Errorf("github app installation id is not configured")
	}

	keyMaterial := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY"))
	if keyMaterial == "" {
		path := strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_APP_PRIVATE_KEY_PATH"))
		if path == "" {
			return "", "", nil, fmt.Errorf("github app private key is not configured")
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return "", "", nil, fmt.Errorf("read github app private key: %w", err)
		}
		keyMaterial = string(body)
	}

	privateKey, err := parseGitHubAppPrivateKey(keyMaterial)
	if err != nil {
		return "", "", nil, err
	}
	return appID, installationID, privateKey, nil
}

func parseGitHubAppPrivateKey(raw string) (*rsa.PrivateKey, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(raw), "\\n", "\n")
	block, _ := pem.Decode([]byte(normalized))
	if block == nil {
		return nil, fmt.Errorf("decode github app private key: no PEM block found")
	}

	if privateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return privateKey, nil
	}
	privateKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse github app private key: %w", err)
	}
	rsaKey, ok := privateKey.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("github app private key must be RSA")
	}
	return rsaKey, nil
}

func signGitHubAppJWT(appID string, privateKey *rsa.PrivateKey, now time.Time) (string, error) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, err := json.Marshal(map[string]any{
		"iss": appID,
		"iat": now.Add(-time.Minute).Unix(),
		"exp": now.Add(9 * time.Minute).Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("encode github app jwt claims: %w", err)
	}

	token := header + "." + base64.RawURLEncoding.EncodeToString(claims)
	sum := sha256.Sum256([]byte(token))
	signature, err := rsa.SignPKCS1v15(rand.Reader, privateKey, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("sign github app jwt: %w", err)
	}

	return token + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func githubAPIBaseURL() string {
	if value := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_API_BASE_URL")), "/"); value != "" {
		return value
	}
	return "https://api.github.com"
}

func githubGraphQLURL() string {
	if value := strings.TrimRight(strings.TrimSpace(os.Getenv("OPENSHOCK_GITHUB_GRAPHQL_URL")), "/"); value != "" {
		return value
	}
	return githubAPIBaseURL() + "/graphql"
}
