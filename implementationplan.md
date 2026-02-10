# Implementation Plan: Multi-Provider Support + Model Search

## Goals
- Keep existing functionality and flows intact:
- `Local Ollama`
- Existing `External API` (OpenAI-compatible proxy path)
- Add new provider options:
- `OpenAI Direct API Key`
- `OpenRouter API Key`
- `Codex OAuth`
- Preserve existing custom prompting behavior, especially the Rosh auto-answer flow.
- Add model type-ahead filtering in options UI without breaking current model selection flow.
- Defer web search integration changes for now (no new provider-specific web tool wiring in this phase).

## Non-Goals (This Iteration)
- No redesign of core chat UX.
- No removal of legacy settings fields yet.
- No backend/proxy server; extension-only implementation.
- No web-search provider compatibility expansion beyond existing behavior.

## Safety Constraints
- Do not modify prompt text templates used in current answer workflow unless explicitly requested.
- Do not remove old settings keys; migrate forward with backward compatibility.
- Keep old paths/auth methods working for current users without forced reconfiguration.

## Architecture Changes

### 1. Provider Abstraction
- Introduce canonical `provider` setting (string enum) while retaining old `connectionType` fallback.
- Provider IDs:
- `local_ollama`
- `external_compatible`
- `openai_direct_api_key`
- `openrouter_api_key`
- `codex_oauth`

### 2. Provider Config Resolution
- Add helper(s) to resolve:
- Base URL
- Auth header strategy
- Models endpoint
- Chat endpoint
- Request/response format expectations
- Backward compatibility mapping:
- `connectionType=local` -> `local_ollama`
- `connectionType=external` -> `external_compatible`

### 3. Settings Storage Strategy
- Keep current settings readable.
- Add new settings for extensibility:
- `provider`
- `apiKeyByProvider` (object)
- `selectedModelByProvider` (object)
- `apiBaseOverrideByProvider` (object; optional)
- `oauthState` (non-sensitive metadata in sync if needed)
- Token storage:
- Codex OAuth tokens in `chrome.storage.local` only.
- Avoid `chrome.storage.sync` for OAuth tokens.

## UI Changes (Options)

### 1. Provider Radios
- Replace/extend current connection type section with provider radios:
- Local Ollama
- External API (OpenAI-compatible)
- OpenAI Direct API Key
- OpenRouter API Key
- Codex OAuth

### 2. Dynamic Field Visibility
- Show/hide controls based on selected provider:
- API key input for API key providers.
- Endpoint/base URL field for local/external and optional override where useful.
- Codex OAuth controls:
- Sign in
- Sign out
- Session status text

### 3. Model Selection Type-Ahead
- Add `modelSearch` input above model dropdown.
- Filter loaded models client-side as user types.
- Keep current select control; repopulate options from filtered list.
- Preserve selected model even when filter changes.
- Add empty-state message if no matches.

## Runtime Routing Changes

### 1. `background.js`
- Update settings load to use provider + legacy fallback.
- Keep existing prompt construction unchanged in `handleAnswerQuestion`.
- Route requests per provider:
- Local Ollama -> `/api/generate`
- External-compatible -> `/api/chat/completions`
- OpenAI direct -> `/v1/chat/completions`
- OpenRouter -> OpenAI-compatible chat endpoint
- Codex OAuth -> OpenAI-compatible endpoint with OAuth bearer token
- Maintain streaming parse compatibility for each path.

### 2. `sidepanel.js`
- Same provider routing and parse strategy as background text flow.
- Preserve conversation/history behavior.
- Keep current UX unchanged except provider compatibility and auth source.

### 3. `options.js`
- Models fetch by provider:
- Local -> `/api/tags`
- External-compatible -> `/api/models`
- OpenAI direct/OpenRouter/Codex OAuth -> `/v1/models` (provider base-specific)
- Normalize model list to common shape and render in existing select.

## Codex OAuth Implementation (Extension-Only)
- Implement auth start via `chrome.identity.launchWebAuthFlow` (PKCE flow).
- Store access/refresh tokens in `chrome.storage.local`.
- Add token utility functions:
- `getValidCodexAccessToken()`
- `refreshCodexTokenIfNeeded()`
- `clearCodexSession()`
- Handle re-auth requirement gracefully in options and request failures.
- Never log raw tokens.

## Backward Compatibility Plan
- On load:
- If `provider` missing, infer from `connectionType`.
- Reuse existing `apiKey` and `selectedModel` as fallback defaults.
- On save:
- Persist new canonical fields.
- Also keep minimum legacy fields (`connectionType`, `apiKey`, `selectedModel`) for transition.

## Testing and Verification Checklist

### Regression (Must Pass)
- Existing Local Ollama connection/model fetch/chat still works.
- Existing External-compatible flow still works with current endpoint style.
- Auto-answer workflow still generates the same prompt template and selects answers as before.

### New Provider Functional
- OpenAI Direct:
- Connection test
- Model list load
- Test chat response
- Sidepanel follow-up streaming
- OpenRouter:
- Connection test
- Model list load
- Type-ahead usable with large list
- Test chat response
- Codex OAuth:
- Sign in
- Model list load (authenticated)
- Test chat response
- Sign out and failure/re-auth path

### Error Handling
- Invalid key/token surfaces actionable error.
- Non-JSON responses handled cleanly.
- Empty model list displays warning state.

## Phased Execution

### Phase 1
- Options UI/provider model/type-ahead scaffolding.
- Settings migration helpers.

### Phase 2
- Background + sidepanel provider routing.
- Preserve all prompt templates.

### Phase 3
- Codex OAuth auth flow + token lifecycle.

### Phase 4
- Regression sweep and docs update.

## Progress Log
- [x] Plan documented in repository (`implementationplan.md`)
- [ ] Phase 1 in progress
- [ ] Phase 2 in progress
- [ ] Phase 3 in progress
- [ ] Phase 4 in progress
