// Keep track of conversation history and debug info
let conversationHistory = [];
let debugHistory = [];
let currentResponseDiv = null;
const OAUTH_LOCAL_KEY = 'codexOAuthToken';

function providerFromLegacy(connectionType) {
    return connectionType === 'external' ? 'external_compatible' : 'local_ollama';
}

function normalizeProvider(settings) {
    return settings.provider || providerFromLegacy(settings.connectionType);
}

function normalizeBase(address) {
    return (address || '').replace(/\/+$/, '');
}

function isLocalProvider(provider) {
    return provider === 'local_ollama';
}

function supportsWebSearch(provider) {
    return provider === 'local_ollama' || provider === 'external_compatible' || provider === 'openrouter_api_key';
}

function defaultBaseForProvider(provider) {
    if (provider === 'openai_direct_api_key' || provider === 'codex_oauth') {
        return 'https://api.openai.com/v1';
    }
    if (provider === 'openrouter_api_key') {
        return 'https://openrouter.ai/api/v1';
    }
    return 'http://localhost:11434';
}

function getProviderAddress(settings, provider) {
    const map = settings.apiBaseOverrideByProvider || {};
    return normalizeBase(map[provider] || settings.ollamaAddress || defaultBaseForProvider(provider));
}

function getProviderModel(settings, provider, fallbackModel) {
    const map = settings.selectedModelByProvider || {};
    return map[provider] || settings.selectedModel || fallbackModel;
}

function getProviderApiKey(settings, provider) {
    const map = settings.apiKeyByProvider || {};
    return map[provider] || (provider === 'external_compatible' ? settings.apiKey || '' : '');
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

function extractStreamingChunk(provider, data) {
    if (isLocalProvider(provider)) {
        return data.response || '';
    }
    return data?.choices?.[0]?.delta?.content || '';
}

function applyWebSearchIfSupported(provider, requestObject, useInternet) {
    if (!useInternet || !supportsWebSearch(provider)) {
        return;
    }

    if (provider === 'openrouter_api_key') {
        requestObject.plugins = [{ id: 'web' }];
        return;
    }

    requestObject.tool_ids = ['web_search'];
}

async function refreshCodexAccessTokenIfNeeded(settings) {
    const local = await chrome.storage.local.get({ [OAUTH_LOCAL_KEY]: null });
    const tokenState = local[OAUTH_LOCAL_KEY];

    if (!tokenState || !tokenState.accessToken) {
        return '';
    }

    if (tokenState.expiresAt && tokenState.expiresAt > Date.now() + 60000) {
        return tokenState.accessToken;
    }

    if (!tokenState.refreshToken || !settings.oauthClientId || !settings.oauthTokenUrl) {
        return '';
    }

    const form = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: settings.oauthClientId,
        refresh_token: tokenState.refreshToken
    });

    if (settings.oauthScope) {
        form.set('scope', settings.oauthScope);
    }

    const response = await fetch(settings.oauthTokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString()
    });

    if (!response.ok) {
        return '';
    }

    const tokenData = await response.json();
    const expiresIn = Number(tokenData.expires_in || 3600);
    const updated = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || tokenState.refreshToken,
        tokenType: tokenData.token_type || 'Bearer',
        scope: tokenData.scope || settings.oauthScope || '',
        expiresAt: Date.now() + expiresIn * 1000
    };
    await chrome.storage.local.set({ [OAUTH_LOCAL_KEY]: updated });
    return updated.accessToken;
}

async function buildHeadersForProvider(provider, settings) {
    const headers = { 'Content-Type': 'application/json' };

    if (provider === 'codex_oauth') {
        const token = await refreshCodexAccessTokenIfNeeded(settings);
        if (!token) {
            throw new Error('Codex OAuth is not signed in. Open extension options and sign in.');
        }
        headers.Authorization = `Bearer ${token}`;
    } else {
        const apiKey = getProviderApiKey(settings, provider);
        if (apiKey) {
            headers.Authorization = `Bearer ${apiKey}`;
        }
    }

    if (provider === 'openrouter_api_key') {
        headers['HTTP-Referer'] = chrome.runtime.getURL('');
        headers['X-Title'] = 'AskOllama';
    }

    return headers;
}

// Function to update debug section
function updateDebug(info) {
    const debugSection = document.getElementById('debug');
    const debugContent = document.getElementById('debugContent');
    
    // Add timestamp to debug info
    const timestamp = new Date().toISOString();
    const debugEntry = `[${timestamp}]\n${JSON.stringify(info, null, 2)}`;
    debugHistory.push(debugEntry);
    
    // Update debug content
    debugContent.textContent = debugHistory.join('\n\n');
    debugSection.classList.add('visible');
}

// Copy debug information
document.getElementById('copyDebug').addEventListener('click', () => {
    const debugContent = document.getElementById('debugContent').textContent;
    navigator.clipboard.writeText(debugContent).then(() => {
        const button = document.getElementById('copyDebug');
        button.textContent = 'Copied!';
        setTimeout(() => {
            button.textContent = 'Copy';
        }, 2000);
    });
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const contentDiv = document.getElementById('content');
    
    // Clear placeholder if it exists
    const placeholder = contentDiv.querySelector('.placeholder');
    if (placeholder) {
        contentDiv.removeChild(placeholder);
    }

    if (message.type === 'stream-start') {
        // Add the query message
        const queryDiv = document.createElement('div');
        queryDiv.className = 'message query';
        
        // Check if this is an image analysis
        if (message.query === 'Analyzing image...') {
            queryDiv.innerHTML = `
                <div class="image-analysis">
                    <p>${message.query}</p>
                    <div class="loading-spinner"></div>
                </div>
            `;
        } else {
            queryDiv.textContent = message.query;
        }
        
        contentDiv.appendChild(queryDiv);
        conversationHistory.push({ type: 'query', text: message.query });

        // Create a new response div for streaming
        currentResponseDiv = document.createElement('div');
        currentResponseDiv.className = 'message response';
        contentDiv.appendChild(currentResponseDiv);
        
        // Scroll to bottom
        contentDiv.scrollTop = contentDiv.scrollHeight;
    } else if (message.type === 'stream-chunk') {
        if (currentResponseDiv) {
            currentResponseDiv.textContent += message.chunk;
            contentDiv.scrollTop = contentDiv.scrollHeight;
        }
    } else if (message.type === 'stream-end') {
        conversationHistory.push({ type: 'response', text: message.fullResponse });
        currentResponseDiv = null;
    } else if (message.type === 'clear-chat') {
        // Clear the chat display and history
        contentDiv.innerHTML = '<div class="placeholder">Select text and right-click to send to Ollama</div>';
        conversationHistory = [];
        currentResponseDiv = null;
        // Optionally clear debug history too? For now, keep it.
        // debugHistory = [];
        // document.getElementById('debugContent').textContent = '';
        // document.getElementById('debug').classList.remove('visible');
    } else if (message.error) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'message error';
        errorDiv.textContent = message.error;
        contentDiv.appendChild(errorDiv);
        contentDiv.scrollTop = contentDiv.scrollHeight;
    } else if (message.error || message.debug) {
        // Add to debug history
        updateDebug({
            type: 'error',
            timestamp: new Date().toISOString(),
            error: message.error,
            debug: message.debug,
            stack: message.stack
        });

        // Add error message to conversation
        if (message.error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error';
            errorDiv.innerHTML = `
                <h3>Error connecting to Ollama</h3>
                <p>${message.error}</p>
                <p>Please check:</p>
                <ul>
                    <li>Ollama is running</li>
                    <li>The address in extension settings is correct</li>
                    <li>Your network connection</li>
                    <li>CORS is properly configured in open-webui</li>
                </ul>
                <p style="font-size: 12px; margin-top: 8px;">Check debug section below for more details</p>
            `;
            contentDiv.appendChild(errorDiv);
            conversationHistory.push({ type: 'error', text: message.error });
        }
    }

    // Scroll to bottom
    contentDiv.scrollTop = contentDiv.scrollHeight;
});

// Handle follow-up messages
async function sendFollowUpMessage() {
    const chatInput = document.getElementById('chatInput');
    const sendButton = document.getElementById('sendButton');
    const message = chatInput.value.trim();
    
    if (!message) return;
    
    // Disable input and button while sending
    chatInput.disabled = true;
    sendButton.disabled = true;
    
    try {
        // Get all relevant settings with defaults
        const settings = await chrome.storage.sync.get({
            ollamaAddress: 'http://localhost:11434',
            selectedModel: 'mistral',
            selectedModelByProvider: {},
            systemPrompt: '',
            connectionType: 'local',
            provider: '',
            apiKey: '',
            apiKeyByProvider: {},
            apiBaseOverrideByProvider: {},
            useInternet: false,
            oauthClientId: '',
            oauthTokenUrl: '',
            oauthScope: ''
        });
        const provider = normalizeProvider(settings);
        const model = getProviderModel(settings, provider, 'mistral');
        const systemPrompt = settings.systemPrompt || '';
        const useInternet = !!settings.useInternet;
        const baseAddress = getProviderAddress(settings, provider);

        // --- Add the new message to UI ---
        const contentDiv = document.getElementById('content');
        const queryDiv = document.createElement('div');
        queryDiv.className = 'message query';
        queryDiv.textContent = message;
        contentDiv.appendChild(queryDiv);
        conversationHistory.push({ type: 'query', text: message });
        
        // Create response div for streaming
        currentResponseDiv = document.createElement('div');
        currentResponseDiv.className = 'message response';
        contentDiv.appendChild(currentResponseDiv);
        contentDiv.scrollTop = contentDiv.scrollHeight; // Scroll after adding divs
        // ---

        // --- Prepare API Request based on connectionType ---
        let requestBody;
        let chatEndpoint;
        const headers = await buildHeadersForProvider(provider, settings);

        if (!isLocalProvider(provider)) {
            chatEndpoint = getChatEndpoint(provider, baseAddress);
            const messages = [];
            if (systemPrompt) {
                messages.push({ role: "system", content: systemPrompt });
            }
            // Incorporate conversationHistory for external APIs
            conversationHistory.forEach(item => {
                if (item.type === 'query') {
                    messages.push({ role: "user", content: item.text });
                } else if (item.type === 'response') {
                    // Ensure we don't add error messages as assistant responses
                    if (item.type !== 'error') { 
                       messages.push({ role: "assistant", content: item.text });
                    }
                }
            });
            // Add the current user message last
            messages.push({ role: "user", content: message }); 
            const requestObject = { // Prepare object first
                model: model,
                messages: messages,
                stream: true // Assuming external API supports streaming similarly
            }; // Close the object literal here
            applyWebSearchIfSupported(provider, requestObject, useInternet);
            requestBody = JSON.stringify(requestObject); // Stringify at the end
        } else {
            // Local Ollama format - include context
            chatEndpoint = getChatEndpoint(provider, baseAddress);
            // Refine context building for Ollama
            const context = conversationHistory
                .filter(item => item.type === 'query' || item.type === 'response') // Filter out errors
                .map(item => {
                    // Simple User/Assistant prefixing
                    const prefix = item.type === 'query' ? 'User:' : 'Assistant:';
                    return `${prefix} ${item.text}`;
                })
                .join('\n\n'); // Use double newline for separation
            const prompt = `${systemPrompt ? systemPrompt + '\n\n' : ''}${context ? context + '\n\n' : ''}User: ${message}`; // Ensure User: prefix for current message
            const requestObject = { // Prepare object first
                model: model,
                prompt: prompt,
                stream: true
            };
            applyWebSearchIfSupported(provider, requestObject, useInternet);
            requestBody = JSON.stringify(requestObject); // Stringify at the end
        }
        // ---

        // --- Make API Call and Process Stream ---
        console.log(`Sidepanel Fetch: Provider=${provider}, Endpoint=${chatEndpoint}`); // DEBUG LOG
        const response = await fetch(chatEndpoint, {
            method: 'POST',
            headers: headers,
            body: requestBody
        });

        if (!response.ok) {
             let errorBody = '';
             try { errorBody = await response.text(); } catch (e) { /* ignore */ }
             throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
        }

        const reader = response.body.getReader();
        let fullResponse = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = new TextDecoder().decode(value);
            // Process potentially multiple JSON objects in a single chunk
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                 // Handle potential SSE "data: " prefix if present
                 const jsonData = line.startsWith('data: ') ? line.substring(5) : line;
                 try {
                    const data = JSON.parse(jsonData);
                    let responseChunk = '';
                    responseChunk = extractStreamingChunk(provider, data);

                    if (responseChunk && currentResponseDiv) {
                        fullResponse += responseChunk;
                        currentResponseDiv.textContent += responseChunk; // Append chunk to UI
                        contentDiv.scrollTop = contentDiv.scrollHeight; // Scroll with new content
                    }
                    // Handle potential end-of-stream markers if needed (e.g., Ollama's final object)
                    if (data.done && isLocalProvider(provider)) {
                         // Ollama specific end signal, already handled by reader.read() loop
                    }

                 } catch (e) {
                     console.error('Error parsing JSON line:', jsonData, e);
                 }
            }
        }
        // ---

        // --- Finalize ---
        if (currentResponseDiv) { // Check if div still exists
             conversationHistory.push({ type: 'response', text: fullResponse });
        }
        currentResponseDiv = null; // Reset for next response
        chatInput.value = ''; // Clear input
        // ---
        
    } catch (error) { // This is the main catch block
        console.error('Error sending follow-up message:', error); // Log full error
        if (currentResponseDiv) { // If response div was created, show error there
             currentResponseDiv.textContent = `Error: ${error.message}`;
             currentResponseDiv.classList.add('error'); // Add error class for styling
             conversationHistory.push({ type: 'error', text: error.message });
             currentResponseDiv = null; // Reset
        } else { // Otherwise, add a new error div
             const errorDiv = document.createElement('div');
             errorDiv.className = 'message error'; // Use message and error classes
             errorDiv.textContent = `Error: ${error.message}`;
             document.getElementById('content').appendChild(errorDiv);
             conversationHistory.push({ type: 'error', text: error.message });
        }
        // Ensure scroll to show error
        document.getElementById('content').scrollTop = document.getElementById('content').scrollHeight;
    } finally { // This is the single, correct finally block
        // Re-enable input and button regardless of success or failure
        chatInput.disabled = false;
        sendButton.disabled = false;
        chatInput.focus();
    }
} // End of sendFollowUpMessage function

// Add event listeners for the chat input
document.getElementById('sendButton').addEventListener('click', sendFollowUpMessage);

document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendFollowUpMessage();
    }
});

// Clear chat functionality
document.getElementById('clearChat').addEventListener('click', () => {
    const contentDiv = document.getElementById('content');
    contentDiv.innerHTML = '<div class="placeholder">Select text and right-click to send to Ollama</div>';
    conversationHistory = [];
    currentResponseDiv = null;
});

// Optional: Add a function to restore conversation history when panel is reopened
window.addEventListener('load', () => {
    // You could potentially load saved conversation history here
    const contentDiv = document.getElementById('content');
    if (conversationHistory.length === 0) {
        contentDiv.innerHTML = '<div class="placeholder">Select text and right-click to send to Ollama</div>';
    } else {
        contentDiv.innerHTML = ''; // Clear placeholder
        conversationHistory.forEach(item => {
            if (item.type === 'query') {
                const queryDiv = document.createElement('div');
                queryDiv.className = 'message query';
                queryDiv.textContent = item.text;
                contentDiv.appendChild(queryDiv);
            } else if (item.type === 'response') {
                const responseDiv = document.createElement('div');
                responseDiv.className = 'message response';
                responseDiv.textContent = item.text;
                contentDiv.appendChild(responseDiv);
            } else if (item.type === 'error') {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'error';
                errorDiv.innerHTML = `
                    <h3>Error connecting to Ollama</h3>
                    <p>${item.text}</p>
                    <p>Please check:</p>
                    <ul>
                        <li>Ollama is running</li>
                        <li>The address in extension settings is correct</li>
                        <li>Your network connection</li>
                    </ul>
                `;
                contentDiv.appendChild(errorDiv);
            }
        });
    }
});
