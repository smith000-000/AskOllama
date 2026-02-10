const PROVIDERS = {
    local_ollama: {
        label: 'Local Ollama',
        defaultBase: 'http://localhost:11434'
    },
    external_compatible: {
        label: 'External API (OpenAI-compatible)',
        defaultBase: 'http://localhost:8080'
    },
    openai_direct_api_key: {
        label: 'OpenAI Direct API Key',
        defaultBase: 'https://api.openai.com/v1'
    },
    openrouter_api_key: {
        label: 'OpenRouter API Key',
        defaultBase: 'https://openrouter.ai/api/v1'
    },
    codex_oauth: {
        label: 'Codex OAuth',
        defaultBase: 'https://api.openai.com/v1'
    }
};

const OAUTH_LOCAL_KEY = 'codexOAuthToken';

const providerRadios = document.querySelectorAll('input[name="provider"]');
const apiKeyGroup = document.getElementById('apiKeyGroup');
const apiKeyInput = document.getElementById('apiKey');
const oauthGroup = document.getElementById('oauthGroup');
const oauthAdvancedGroup = document.getElementById('oauthAdvancedGroup');
const oauthStatus = document.getElementById('oauthStatus');
const oauthSetupHint = document.getElementById('oauthSetupHint');
const oauthRedirectUriEl = document.getElementById('oauthRedirectUri');
const codexSignInButton = document.getElementById('codexSignIn');
const codexSignOutButton = document.getElementById('codexSignOut');
const useInternetCheckbox = document.getElementById('useInternet');
const addressInput = document.getElementById('ollamaAddress');
const addressLabel = document.querySelector('label[for="ollamaAddress"]');
const modelSelect = document.getElementById('modelSelect');
const modelSearchInput = document.getElementById('modelSearch');
const fullErrorDetailsDiv = document.getElementById('fullErrorDetails');
const statusDiv = document.getElementById('status');

let previousProvider = 'local_ollama';
let allModels = [];
let apiBaseByProvider = {};
let currentSettings = null;

function providerFromLegacy(connectionType) {
    return connectionType === 'external' ? 'external_compatible' : 'local_ollama';
}

function getCurrentProvider() {
    const selected = document.querySelector('input[name="provider"]:checked');
    return selected ? selected.value : 'local_ollama';
}

function isApiKeyProvider(provider) {
    return provider === 'external_compatible' || provider === 'openai_direct_api_key' || provider === 'openrouter_api_key';
}

function supportsInternetToggle(provider) {
    return provider === 'local_ollama' || provider === 'external_compatible' || provider === 'openrouter_api_key';
}

function normalizeBase(address) {
    return (address || '').trim().replace(/\/+$/, '');
}

function showStatus(message, success, fullError = '') {
    statusDiv.textContent = message;
    statusDiv.className = success ? 'success' : 'error';
    statusDiv.style.display = 'block';

    statusDiv.removeEventListener('click', handleStatusClick);
    fullErrorDetailsDiv.style.display = 'none';
    delete statusDiv.dataset.fullError;

    if (!success && fullError) {
        statusDiv.dataset.fullError = fullError;
        statusDiv.addEventListener('click', handleStatusClick);
    } else {
        setTimeout(() => {
            statusDiv.style.display = 'none';
            fullErrorDetailsDiv.style.display = 'none';
        }, 3000);
    }
}

function handleStatusClick() {
    const fullError = statusDiv.dataset.fullError;
    if (fullError) {
        fullErrorDetailsDiv.textContent = fullError;
        fullErrorDetailsDiv.style.display = fullErrorDetailsDiv.style.display === 'none' ? 'block' : 'none';
    }
}

function base64UrlEncode(bytes) {
    const str = btoa(String.fromCharCode(...bytes));
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(length = 64) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes).slice(0, length);
}

async function sha256(input) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return new Uint8Array(digest);
}

async function createPkcePair() {
    const verifier = randomString(96);
    const challengeBytes = await sha256(verifier);
    const challenge = base64UrlEncode(challengeBytes);
    return { verifier, challenge };
}

function setAddressForProvider(provider) {
    const fallback = PROVIDERS[provider]?.defaultBase || '';
    const value = apiBaseByProvider[provider] || fallback;
    addressInput.value = value;
    addressInput.placeholder = fallback;
    addressLabel.textContent = `${PROVIDERS[provider]?.label || 'Provider'} Endpoint URL:`;
}

function setApiKeyForProvider(provider) {
    const map = currentSettings?.apiKeyByProvider || {};
    const legacy = currentSettings?.apiKey || '';
    apiKeyInput.value = map[provider] || (provider === 'external_compatible' ? legacy : '');
}

function updateVisibility() {
    const provider = getCurrentProvider();

    apiKeyGroup.style.display = isApiKeyProvider(provider) ? 'block' : 'none';
    oauthGroup.style.display = provider === 'codex_oauth' ? 'block' : 'none';
    oauthAdvancedGroup.style.display = provider === 'codex_oauth' ? 'block' : 'none';

    const internetSupported = supportsInternetToggle(provider);
    useInternetCheckbox.disabled = !internetSupported;
    if (!internetSupported) {
        useInternetCheckbox.checked = false;
    }

    updateOAuthSetupState();
}

function setProviderRadio(provider) {
    const candidate = PROVIDERS[provider] ? provider : 'local_ollama';
    const radio = document.querySelector(`input[name="provider"][value="${candidate}"]`);
    if (radio) {
        radio.checked = true;
    }
}

function buildHeaders(provider, apiKey, oauthToken) {
    const headers = { 'Content-Type': 'application/json' };

    if (provider === 'codex_oauth' && oauthToken) {
        headers.Authorization = `Bearer ${oauthToken}`;
    } else if (isApiKeyProvider(provider) && apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    if (provider === 'openrouter_api_key') {
        headers['HTTP-Referer'] = chrome.runtime.getURL('');
        headers['X-Title'] = 'AskOllama';
    }

    return headers;
}

function applyWebSearchIfSupported(provider, requestObject, useInternet) {
    if (!useInternet) {
        return;
    }

    if (provider === 'local_ollama' || provider === 'external_compatible') {
        requestObject.tool_ids = ['web_search'];
        return;
    }

    if (provider === 'openrouter_api_key') {
        requestObject.plugins = [{ id: 'web' }];
    }
}

function parseModelsResponse(provider, data) {
    if (provider === 'local_ollama') {
        if (!data.models || !Array.isArray(data.models)) {
            return [];
        }
        return data.models.map((model) => ({ id: model.name, name: model.name })).filter((m) => m.name);
    }

    if (data.data && Array.isArray(data.data)) {
        return data.data
            .map((model) => ({ id: model.id || model.name, name: model.id || model.name }))
            .filter((m) => m.name);
    }

    if (Array.isArray(data)) {
        return data.map((model) => ({ id: model.id || model.name, name: model.id || model.name })).filter((m) => m.name);
    }

    return [];
}

function getModelsEndpoint(provider, baseAddress) {
    if (provider === 'local_ollama') {
        return `${baseAddress}/api/tags`;
    }
    if (provider === 'external_compatible') {
        return `${baseAddress}/api/models`;
    }
    return `${baseAddress}/models`;
}

function getChatEndpoint(provider, baseAddress) {
    if (provider === 'local_ollama') {
        return `${baseAddress}/api/generate`;
    }
    if (provider === 'external_compatible') {
        return `${baseAddress}/api/chat/completions`;
    }
    return `${baseAddress}/chat/completions`;
}

function renderModelOptions(filteredModels, selectedModel = '') {
    modelSelect.innerHTML = '';

    if (filteredModels.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = allModels.length > 0 ? 'No models match your search' : 'No models found';
        modelSelect.appendChild(option);
        modelSelect.disabled = true;
        return;
    }

    filteredModels.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = model.name;
        modelSelect.appendChild(option);
    });

    modelSelect.disabled = false;
    if (selectedModel && filteredModels.some((m) => m.name === selectedModel)) {
        modelSelect.value = selectedModel;
    }
}

function applyModelFilter() {
    const selectedModel = modelSelect.value;
    const query = modelSearchInput.value.trim().toLowerCase();
    const filtered = !query
        ? allModels
        : allModels.filter((model) => model.name.toLowerCase().includes(query));

    renderModelOptions(filtered, selectedModel);
}

async function getOAuthConfigFromForm() {
    return {
        clientId: document.getElementById('oauthClientId').value.trim(),
        authUrl: document.getElementById('oauthAuthUrl').value.trim(),
        tokenUrl: document.getElementById('oauthTokenUrl').value.trim(),
        scope: document.getElementById('oauthScope').value.trim()
    };
}

function updateOAuthSetupState() {
    if (!oauthGroup || !oauthAdvancedGroup) {
        return;
    }

    const provider = getCurrentProvider();
    const isCodex = provider === 'codex_oauth';
    if (!isCodex) {
        return;
    }

    const clientId = document.getElementById('oauthClientId').value.trim();
    const authUrl = document.getElementById('oauthAuthUrl').value.trim();
    const tokenUrl = document.getElementById('oauthTokenUrl').value.trim();
    const hasRequiredConfig = Boolean(clientId && authUrl && tokenUrl);

    codexSignInButton.disabled = !hasRequiredConfig;
    codexSignOutButton.disabled = false;

    if (oauthSetupHint) {
        oauthSetupHint.style.display = hasRequiredConfig ? 'none' : 'block';
    }

    if (!hasRequiredConfig) {
        oauthStatus.textContent = 'Configure OAuth settings to enable sign-in.';
    }
}

async function refreshCodexTokenIfNeeded(oauthConfig) {
    const local = await chrome.storage.local.get({ [OAUTH_LOCAL_KEY]: null });
    const tokenState = local[OAUTH_LOCAL_KEY];

    if (!tokenState || !tokenState.accessToken) {
        return null;
    }

    const now = Date.now();
    if (tokenState.expiresAt && tokenState.expiresAt > now + 60000) {
        return tokenState.accessToken;
    }

    if (!tokenState.refreshToken || !oauthConfig.clientId || !oauthConfig.tokenUrl) {
        return null;
    }

    const refreshBody = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: oauthConfig.clientId,
        refresh_token: tokenState.refreshToken
    });

    if (oauthConfig.scope) {
        refreshBody.set('scope', oauthConfig.scope);
    }

    const response = await fetch(oauthConfig.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: refreshBody.toString()
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OAuth refresh failed (${response.status}): ${errorBody}`);
    }

    const tokenData = await response.json();
    const expiresIn = Number(tokenData.expires_in || 3600);
    const updated = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || tokenState.refreshToken,
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || oauthConfig.scope,
        expiresAt: Date.now() + expiresIn * 1000
    };

    await chrome.storage.local.set({ [OAUTH_LOCAL_KEY]: updated });
    return updated.accessToken;
}

async function updateOAuthStatus() {
    const local = await chrome.storage.local.get({ [OAUTH_LOCAL_KEY]: null });
    const tokenState = local[OAUTH_LOCAL_KEY];

    if (!tokenState || !tokenState.accessToken) {
        oauthStatus.textContent = 'Not signed in';
        return;
    }

    if (!tokenState.expiresAt) {
        oauthStatus.textContent = 'Signed in';
        return;
    }

    const expiresDate = new Date(tokenState.expiresAt).toLocaleString();
    oauthStatus.textContent = `Signed in (expires ${expiresDate})`;
}

async function startCodexOAuthFlow() {
    const oauthConfig = await getOAuthConfigFromForm();

    if (!oauthConfig.clientId || !oauthConfig.authUrl || !oauthConfig.tokenUrl) {
        showStatus('OAuth settings are required before sign in.', false);
        return;
    }

    const state = randomString(32);
    const { verifier, challenge } = await createPkcePair();
    const redirectUri = chrome.identity.getRedirectURL('codex');

    const authUrl = new URL(oauthConfig.authUrl);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', oauthConfig.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', oauthConfig.scope || 'openid profile email offline_access');
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);

    if (!chrome.identity || typeof chrome.identity.launchWebAuthFlow !== 'function') {
        throw new Error('chrome.identity.launchWebAuthFlow is unavailable. Reload extension after granting identity permission.');
    }

    const callbackUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true }, (responseUrl) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(responseUrl);
        });
    });

    if (!callbackUrl) {
        throw new Error('No OAuth callback URL received.');
    }

    const callback = new URL(callbackUrl);
    const returnedState = callback.searchParams.get('state');
    const code = callback.searchParams.get('code');
    const oauthError = callback.searchParams.get('error');

    if (oauthError) {
        throw new Error(`OAuth authorize error: ${oauthError}`);
    }
    if (!code) {
        throw new Error('OAuth authorize flow did not return a code.');
    }
    if (returnedState !== state) {
        throw new Error('OAuth state mismatch.');
    }

    const tokenBody = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: oauthConfig.clientId,
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier
    });

    const tokenResponse = await fetch(oauthConfig.tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenBody.toString()
    });

    if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        throw new Error(`OAuth token exchange failed (${tokenResponse.status}): ${errorBody}`);
    }

    const tokenData = await tokenResponse.json();
    const expiresIn = Number(tokenData.expires_in || 3600);
    const tokenState = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || '',
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || oauthConfig.scope,
        expiresAt: Date.now() + expiresIn * 1000
    };

    await chrome.storage.local.set({ [OAUTH_LOCAL_KEY]: tokenState });
    await updateOAuthStatus();
    showStatus('Codex OAuth sign-in completed.', true);
}

async function clearCodexOAuthSession() {
    await chrome.storage.local.remove(OAUTH_LOCAL_KEY);
    await updateOAuthStatus();
    showStatus('Codex OAuth session cleared.', true);
}

async function getAuthHeaders(provider, apiKey) {
    if (provider !== 'codex_oauth') {
        return buildHeaders(provider, apiKey, '');
    }

    const oauthConfig = await getOAuthConfigFromForm();
    const token = await refreshCodexTokenIfNeeded(oauthConfig);
    if (!token) {
        throw new Error('Codex OAuth is not signed in or token refresh failed.');
    }

    return buildHeaders(provider, '', token);
}

async function fetchModels(address, provider, apiKey, selectedModel = '') {
    const baseAddress = normalizeBase(address);
    if (!baseAddress) {
        showStatus('Please enter API Endpoint URL', false);
        return false;
    }

    const headers = await getAuthHeaders(provider, apiKey);
    const modelsEndpoint = getModelsEndpoint(provider, baseAddress);

    const response = await fetch(modelsEndpoint, { headers });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
        const bodyPreview = (await response.text()).slice(0, 500);
        throw new Error(`Unexpected response type (${contentType || 'unknown'}). Preview: ${bodyPreview}`);
    }

    const data = await response.json();
    allModels = parseModelsResponse(provider, data);

    if (allModels.length === 0) {
        renderModelOptions([], selectedModel);
        showStatus('Warning: No models found or unexpected API response format.', false);
        return false;
    }

    renderModelOptions(allModels, selectedModel);
    return true;
}

function updateProviderSelection(nextProvider) {
    const currentProvider = previousProvider;
    if (currentProvider) {
        apiBaseByProvider[currentProvider] = addressInput.value.trim();
    }

    previousProvider = nextProvider;
    setAddressForProvider(nextProvider);
    setApiKeyForProvider(nextProvider);
    updateVisibility();

    modelSearchInput.value = '';
    allModels = [];
    modelSelect.innerHTML = '<option value="">Please test connection first</option>';
    modelSelect.disabled = true;
}

async function loadSettings() {
    const settings = await chrome.storage.sync.get({
        ollamaAddress: 'http://localhost:11434',
        selectedModel: '',
        selectedModelByProvider: {},
        systemPrompt: '',
        connectionType: 'local',
        provider: '',
        apiKey: '',
        apiKeyByProvider: {},
        apiBaseOverrideByProvider: {},
        useInternet: false,
        oauthClientId: '',
        oauthAuthUrl: 'https://auth.openai.com/oauth/authorize',
        oauthTokenUrl: 'https://auth.openai.com/oauth/token',
        oauthScope: 'openid profile email offline_access'
    });

    currentSettings = settings;

    const provider = settings.provider || providerFromLegacy(settings.connectionType);
    setProviderRadio(provider);

    apiBaseByProvider = {
        local_ollama: settings.ollamaAddress || PROVIDERS.local_ollama.defaultBase,
        external_compatible: settings.ollamaAddress || PROVIDERS.external_compatible.defaultBase,
        openai_direct_api_key: PROVIDERS.openai_direct_api_key.defaultBase,
        openrouter_api_key: PROVIDERS.openrouter_api_key.defaultBase,
        codex_oauth: PROVIDERS.codex_oauth.defaultBase,
        ...(settings.apiBaseOverrideByProvider || {})
    };

    previousProvider = provider;
    setAddressForProvider(provider);
    setApiKeyForProvider(provider);
    updateVisibility();

    document.getElementById('systemPrompt').value = settings.systemPrompt || '';
    useInternetCheckbox.checked = !!settings.useInternet;

    document.getElementById('oauthClientId').value = settings.oauthClientId || '';
    document.getElementById('oauthAuthUrl').value = settings.oauthAuthUrl || 'https://auth.openai.com/oauth/authorize';
    document.getElementById('oauthTokenUrl').value = settings.oauthTokenUrl || 'https://auth.openai.com/oauth/token';
    document.getElementById('oauthScope').value = settings.oauthScope || 'openid profile email offline_access';
    if (oauthRedirectUriEl) {
        oauthRedirectUriEl.textContent = chrome.identity.getRedirectURL('codex');
    }

    await updateOAuthStatus();
    updateOAuthSetupState();

    const selectedModelByProvider = settings.selectedModelByProvider || {};
    const selectedModel = selectedModelByProvider[provider] || settings.selectedModel || '';

    try {
        if (addressInput.value.trim()) {
            const apiKeyMap = settings.apiKeyByProvider || {};
            const keyForProvider = apiKeyMap[provider] || (provider === 'external_compatible' ? settings.apiKey : '');
            const success = await fetchModels(addressInput.value.trim(), provider, keyForProvider, selectedModel);
            if (!success) {
                modelSelect.disabled = true;
            }
        }
    } catch (error) {
        console.error('Error loading models:', error);
        showStatus('Error fetching models. Click for details.', false, error.message);
    }
}

providerRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
        updateProviderSelection(getCurrentProvider());
    });
});

modelSearchInput.addEventListener('input', applyModelFilter);

addressInput.addEventListener('input', () => {
    apiBaseByProvider[getCurrentProvider()] = addressInput.value.trim();
});

apiKeyInput.addEventListener('input', () => {
    if (!currentSettings) {
        return;
    }
    if (!currentSettings.apiKeyByProvider) {
        currentSettings.apiKeyByProvider = {};
    }
    currentSettings.apiKeyByProvider[getCurrentProvider()] = apiKeyInput.value.trim();
});

document.getElementById('codexSignIn').addEventListener('click', async () => {
    fullErrorDetailsDiv.style.display = 'none';
    oauthStatus.textContent = 'Starting OAuth sign-in...';
    showStatus('Starting Codex OAuth sign-in...', true);
    try {
        await startCodexOAuthFlow();
        await updateOAuthStatus();
    } catch (error) {
        console.error('Codex OAuth sign-in failed:', error);
        oauthStatus.textContent = `Sign-in failed: ${error.message}`;
        showStatus('Codex OAuth sign-in failed. Click for details.', false, error.message);
    }
});

document.getElementById('codexSignOut').addEventListener('click', async () => {
    try {
        await clearCodexOAuthSession();
        oauthStatus.textContent = 'Not signed in';
    } catch (error) {
        console.error('Codex OAuth sign-out failed:', error);
        oauthStatus.textContent = `Sign-out failed: ${error.message}`;
        showStatus('Codex OAuth sign-out failed. Click for details.', false, error.message);
    }
});

document.getElementById('testConnection').addEventListener('click', async () => {
    const provider = getCurrentProvider();
    const address = addressInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    fullErrorDetailsDiv.style.display = 'none';
    showStatus('Testing connection...', true);

    try {
        const success = await fetchModels(address, provider, apiKey, modelSelect.value);
        if (success) {
            showStatus('Connection successful! Models loaded.', true);
        }
    } catch (error) {
        console.error('Error testing connection:', error);
        showStatus('Connection failed. Click for details.', false, error.message);
    }
});

document.getElementById('testChat').addEventListener('click', async () => {
    const provider = getCurrentProvider();
    const address = normalizeBase(addressInput.value.trim());
    const model = modelSelect.value;
    const systemPrompt = document.getElementById('systemPrompt').value;
    const testPrompt = document.getElementById('testPrompt').value.trim();
    const responseBox = document.getElementById('chatResponse');
    const useInternet = useInternetCheckbox.checked;

    if (!address || !model) {
        showStatus('Please set API Endpoint URL and select a model first', false);
        return;
    }

    if (!testPrompt) {
        showStatus('Please enter a test prompt', false);
        return;
    }

    fullErrorDetailsDiv.style.display = 'none';
    responseBox.textContent = 'Generating response...';

    try {
        const headers = await getAuthHeaders(provider, apiKeyInput.value.trim());
        const chatEndpoint = getChatEndpoint(provider, address);

        let requestBody;
        if (provider === 'local_ollama') {
            const requestObject = {
                model,
                prompt: systemPrompt ? `${systemPrompt}\n\n${testPrompt}` : testPrompt,
                stream: false
            };
            applyWebSearchIfSupported(provider, requestObject, useInternet);
            requestBody = JSON.stringify(requestObject);
        } else {
            const messages = [];
            if (systemPrompt) {
                messages.push({ role: 'system', content: systemPrompt });
            }
            messages.push({ role: 'user', content: testPrompt });
            const requestObject = { model, messages, stream: false };
            applyWebSearchIfSupported(provider, requestObject, useInternet);
            requestBody = JSON.stringify(requestObject);
        }

        const response = await fetch(chatEndpoint, {
            method: 'POST',
            headers,
            body: requestBody
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
            const bodyPreview = (await response.text()).slice(0, 500);
            throw new Error(`Unexpected response type (${contentType || 'unknown'}). Preview: ${bodyPreview}`);
        }

        const data = await response.json();
        let chatResponseText = '';

        if (provider === 'local_ollama') {
            chatResponseText = data.response || JSON.stringify(data);
        } else {
            chatResponseText = data?.choices?.[0]?.message?.content || JSON.stringify(data);
        }

        responseBox.textContent = chatResponseText;
        showStatus('Test completed successfully!', true);
    } catch (error) {
        console.error('Error during test chat:', error);
        responseBox.textContent = `Error: ${error.message}`;
        showStatus('Test failed. Click for details.', false, error.message);
    }
});

document.getElementById('save').addEventListener('click', async () => {
    const provider = getCurrentProvider();
    const currentAddress = addressInput.value.trim();
    const selectedModel = modelSelect.value;
    const systemPrompt = document.getElementById('systemPrompt').value;
    const apiKey = apiKeyInput.value.trim();

    if (!currentAddress) {
        showStatus('Please enter API Endpoint URL', false);
        return;
    }

    if (!currentSettings) {
        currentSettings = {};
    }

    const selectedModelByProvider = {
        ...(currentSettings.selectedModelByProvider || {})
    };
    const apiKeyByProvider = {
        ...(currentSettings.apiKeyByProvider || {})
    };

    selectedModelByProvider[provider] = selectedModel;
    if (isApiKeyProvider(provider)) {
        apiKeyByProvider[provider] = apiKey;
    }

    apiBaseByProvider[provider] = currentAddress;

    const settingsToSave = {
        ollamaAddress: currentAddress,
        selectedModel,
        selectedModelByProvider,
        systemPrompt,
        provider,
        connectionType: provider === 'local_ollama' ? 'local' : 'external',
        apiKey,
        apiKeyByProvider,
        apiBaseOverrideByProvider: apiBaseByProvider,
        useInternet: useInternetCheckbox.checked,
        oauthClientId: document.getElementById('oauthClientId').value.trim(),
        oauthAuthUrl: document.getElementById('oauthAuthUrl').value.trim(),
        oauthTokenUrl: document.getElementById('oauthTokenUrl').value.trim(),
        oauthScope: document.getElementById('oauthScope').value.trim()
    };

    try {
        await chrome.storage.sync.set(settingsToSave);
        currentSettings = settingsToSave;
        showStatus('Settings saved successfully!', true);
    } catch (error) {
        console.error('Error saving settings:', error);
        showStatus('Error saving settings. Click for details.', false, error.message || String(error));
    }
});

['oauthClientId', 'oauthAuthUrl', 'oauthTokenUrl', 'oauthScope'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('input', updateOAuthSetupState);
});

document.addEventListener('DOMContentLoaded', loadSettings);
