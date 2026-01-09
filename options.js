// options.js

// Selectors for new elements
const connectionTypeRadios = document.querySelectorAll('input[name="connectionType"]');
const apiKeyGroup = document.getElementById('apiKeyGroup');
const apiKeyInput = document.getElementById('apiKey'); // Keep only one declaration
const fullErrorDetailsDiv = document.getElementById('fullErrorDetails'); // Added selector
const useInternetCheckbox = document.getElementById('useInternet'); // Added selector

// Function to show/hide API key field based on connection type
function updateApiKeyVisibility() {
    const selectedType = document.querySelector('input[name="connectionType"]:checked').value;
    if (selectedType === 'external') {
        apiKeyGroup.style.display = 'block';
    } else {
        apiKeyGroup.style.display = 'none';
    }
}

// --- Helper function to handle status click ---
function handleStatusClick() {
    const fullError = statusDiv.dataset.fullError; // Use statusDiv reference
    if (fullError) {
        fullErrorDetailsDiv.textContent = fullError;
        fullErrorDetailsDiv.style.display = fullErrorDetailsDiv.style.display === 'none' ? 'block' : 'none';
    }
}
// ---

// Updated fetchModels to accept connectionType and apiKey
async function fetchModels(address, connectionType, apiKey) {
    const headers = {
        'Content-Type': 'application/json'
    };
    // Add Authorization header if external type and API key is provided
    if (connectionType === 'external' && apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Normalize base URL to avoid double slashes when users include a trailing slash
    const base = address.replace(/\/+$/, '');
    // Determine the correct endpoint based on connection type
    const modelsEndpoint = connectionType === 'external' ? `${base}/api/models` : `${base}/api/tags`;

    try {
        const response = await fetch(modelsEndpoint, { headers }); // Use dynamic endpoint
        if (!response.ok) {
            // Try to get error message from response body if possible
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch (e) { /* ignore */ }
            throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
        }

        // Guard against HTML error pages (common when hitting the wrong endpoint)
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
            const bodyPreview = (await response.text()).slice(0, 500); // Avoid huge logs
            throw new Error(`Unexpected response type (${contentType || 'unknown'}). Make sure the API endpoint is correct (e.g., http://localhost:11434 for local Ollama). Preview: ${bodyPreview}`);
        }

        const data = await response.json();
        const modelSelect = document.getElementById('modelSelect');
        
        // Clear existing options
        modelSelect.innerHTML = '';

        // Parse response based on connection type
        let models = [];
        if (connectionType === 'external') {
            // OpenAI format: data is often in a 'data' property, array of objects with 'id'
            if (data.data && Array.isArray(data.data)) {
                 models = data.data.map(model => ({ name: model.id })); // Extract id as name
            } else {
                console.warn("Unexpected response format for external /api/models:", data);
                // Attempt fallback if root is array (less common for OpenAI spec)
                 if (Array.isArray(data)) {
                     models = data.map(model => ({ name: model.id || model.name })); // Try id first, then name
                 }
            }
        } else {
            // Ollama format: { models: [ { name: "..." } ] }
            if (data.models && Array.isArray(data.models)) {
                models = data.models;
            } else {
                 console.warn("Unexpected response format for local /api/tags:", data);
            }
        }

        if (models.length === 0) {
             modelSelect.innerHTML = '<option value="">No models found or unexpected format</option>';
             modelSelect.disabled = true;
             // Don't throw error, but show status
             showStatus('Warning: No models found or unexpected API response format.', false);
             return false; // Indicate potential issue but allow proceeding
        }

        models.forEach(model => {
            if (model.name) { // Ensure model has a name property
                const option = document.createElement('option');
                option.value = model.name;
                option.textContent = model.name;
                modelSelect.appendChild(option);
            }
        });

        modelSelect.disabled = false;
        return true;
    } catch (error) {
        console.error("Error fetching models:", error); // Log full error
        // Pass full error message to showStatus
        showStatus('Error fetching models. Click for details.', false, error.message); 
        return false;
    }
}

async function loadSettings() {
    // Fetch all settings, providing defaults
    const settings = await chrome.storage.sync.get({
        ollamaAddress: 'http://localhost:11434', // Default address
        selectedModel: '',
        systemPrompt: '',
        connectionType: 'local', // Default to local
        apiKey: '', // Default API key
        useInternet: false // Default internet search setting
    });

    // Set connection type radio button
    const connectionType = settings.connectionType || 'local'; // Ensure default if somehow null
    document.querySelector(`input[name="connectionType"][value="${connectionType}"]`).checked = true;

    // Set API Key value
    apiKeyInput.value = settings.apiKey || '';

    // Update API key field visibility based on loaded type FIRST
    updateApiKeyVisibility(); 
    
    // Set address (now endpoint URL)
    if (settings.ollamaAddress) { // Check specifically if it was set, otherwise keep default placeholder
        document.getElementById('ollamaAddress').value = settings.ollamaAddress; 
        // If we have an address, automatically test connection and populate models
        // We need connectionType and apiKey for fetchModels now
        const success = await fetchModels(settings.ollamaAddress, connectionType, settings.apiKey);
        if (success && settings.selectedModel) {
            // Ensure the model exists in the populated list before setting
            if (Array.from(document.getElementById('modelSelect').options).some(opt => opt.value === settings.selectedModel)) {
                 document.getElementById('modelSelect').value = settings.selectedModel;
            }
        }
    } 
    // No else needed, default placeholder is set in HTML or by the get({}) default
    
    // Set system prompt
    document.getElementById('systemPrompt').value = settings.systemPrompt || '';

    // Set internet search checkbox
    useInternetCheckbox.checked = settings.useInternet;
}

// --- Updated showStatus function ---
const statusDiv = document.getElementById('status'); // Get reference outside function

function showStatus(message, success, fullError = '') {
    statusDiv.textContent = message;
    statusDiv.className = success ? 'success' : 'error';
    statusDiv.style.display = 'block';

    // Clear previous listener and hide details div initially
    statusDiv.removeEventListener('click', handleStatusClick);
    fullErrorDetailsDiv.style.display = 'none';
    delete statusDiv.dataset.fullError; // Clear old error data

    if (!success && fullError) {
        // Store full error and add click listener only for errors with details
        statusDiv.dataset.fullError = fullError;
        statusDiv.addEventListener('click', handleStatusClick);
    } else {
         // Auto-hide only for success messages or errors without details
         setTimeout(() => {
            statusDiv.style.display = 'none';
            fullErrorDetailsDiv.style.display = 'none'; // Ensure details are hidden too
         }, 3000);
    }
}
// ---

// Test connection button handler
document.getElementById('testConnection').addEventListener('click', async function() {
    const address = document.getElementById('ollamaAddress').value.trim();
    const connectionType = document.querySelector('input[name="connectionType"]:checked').value;
    const apiKey = apiKeyInput.value.trim(); // Get API key from input

    if (!address) {
        showStatus('Please enter API Endpoint URL', false); // Updated label
        return;
    }

    // Clear previous error details before testing
    fullErrorDetailsDiv.style.display = 'none'; 
    showStatus('Testing connection...', true); // Indicate testing is in progress

    try {
        // Pass connectionType and apiKey to fetchModels
        const success = await fetchModels(address, connectionType, apiKey); 
        if (success) {
            showStatus('Connection successful! Models loaded.', true); // More specific message
            // Load saved model selection after successful connection and model loading
            chrome.storage.sync.get(['selectedModel'], function(result) {
                if (result.selectedModel) {
                    document.getElementById('modelSelect').value = result.selectedModel;
                }
            });
        }
    } catch (error) {
        console.error("Error testing connection:", error); // Log full error
        // Pass full error message
        showStatus('Connection failed. Click for details.', false, error.message); 
    }
});

// Test chat button handler
document.getElementById('testChat').addEventListener('click', async function() {
    const address = document.getElementById('ollamaAddress').value.trim();
    const model = document.getElementById('modelSelect').value;
    const systemPrompt = document.getElementById('systemPrompt').value;
    const testPrompt = document.getElementById('testPrompt').value.trim();
    const responseBox = document.getElementById('chatResponse');
    const connectionType = document.querySelector('input[name="connectionType"]:checked').value;
    const apiKey = apiKeyInput.value.trim(); // Get API key from input

    if (!address || !model) {
        showStatus('Please set API Endpoint URL and select a model first', false); // Updated label
        return;
    }

    if (!testPrompt) {
        showStatus('Please enter a test prompt', false);
        return;
    }

    // Clear previous error details before testing
    fullErrorDetailsDiv.style.display = 'none'; 
    responseBox.textContent = 'Generating response...';

    // --- Prepare request body and endpoint based on connection type ---
    let requestBody;
    let chatEndpoint;
    const headers = { // Prepare headers (common part)
        'Content-Type': 'application/json'
    }; // Close the object literal here

    // Add Authorization header if external type and API key is provided
    if (connectionType === 'external' && apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (connectionType === 'external') {
        chatEndpoint = `${address.replace(/\/+$/, '')}/api/chat/completions`; // normalize trailing slash
        // Construct messages array for OpenAI format
        const messages = [];
        if (systemPrompt) {
            messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: testPrompt });
        requestBody = JSON.stringify({
            model: model,
            messages: messages
            // stream: false is typically default or handled differently, omit for compatibility
        });
    } else {
        // Local Ollama format
        chatEndpoint = `${address}/api/generate`;
        requestBody = JSON.stringify({
            model: model,
            prompt: systemPrompt ? `${systemPrompt}\n\n${testPrompt}` : testPrompt,
            stream: false // Ollama uses this
        });
    }
    // ---

    try {
        const response = await fetch(chatEndpoint, { // Use dynamic endpoint
            method: 'POST',
            headers: headers, 
            body: requestBody // Use dynamic body
        });

        if (!response.ok) {
             // Try to get error message from response body if possible
            let errorBody = '';
            try {
                errorBody = await response.text();
            } catch (e) { /* ignore */ }
            throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
             const bodyPreview = (await response.text()).slice(0, 500);
             throw new Error(`Unexpected response type (${contentType || 'unknown'}). Preview: ${bodyPreview}`);
        }

        const data = await response.json();

        // Parse response based on connection type
        let chatResponseText = '';
        if (connectionType === 'external') {
            // OpenAI format: data.choices[0].message.content
             if (data.choices && data.choices.length > 0 && data.choices[0].message) {
                 chatResponseText = data.choices[0].message.content;
             } else {
                 console.warn("Unexpected response format for external /api/chat/completions:", data);
                 chatResponseText = JSON.stringify(data); // Show raw data as fallback
             }
        } else {
            // Ollama format: data.response
            if (data.response) {
                chatResponseText = data.response;
            } else {
                 console.warn("Unexpected response format for local /api/generate:", data);
                 chatResponseText = JSON.stringify(data); // Show raw data as fallback
            }
        }

        responseBox.textContent = chatResponseText;
        showStatus('Test completed successfully!', true);
    } catch (error) {
        console.error("Error during test chat:", error); // Log full error
        const errorMessage = 'Error: ' + error.message;
        responseBox.textContent = errorMessage;
        // Pass full error message
        showStatus('Test failed. Click for details.', false, error.message); 
    }
});

// Save settings
document.getElementById('save').addEventListener('click', function() {
    const ollamaAddress = document.getElementById('ollamaAddress').value.trim();
    const selectedModel = document.getElementById('modelSelect').value;
    const systemPrompt = document.getElementById('systemPrompt').value;
    const connectionType = document.querySelector('input[name="connectionType"]:checked').value;
    const apiKey = apiKeyInput.value.trim(); // Get API key from input
    const useInternet = useInternetCheckbox.checked; // Get internet search setting

    if (!ollamaAddress) {
        showStatus('Please enter API Endpoint URL', false); // Updated label
        return;
    }

    // Prepare settings object
    const settingsToSave = {
        ollamaAddress: ollamaAddress,
        selectedModel: selectedModel,
        systemPrompt: systemPrompt,
        connectionType: connectionType,
        apiKey: apiKey, // Save API key regardless of type, load logic handles visibility
        useInternet: useInternet // Save internet search setting
    };

    // Clear previous error details before saving
    fullErrorDetailsDiv.style.display = 'none'; 
    chrome.storage.sync.set(settingsToSave, function() {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
            console.error("Error saving settings:", chrome.runtime.lastError); // Log full error object
            // Pass full error message
            showStatus(`Error saving settings. Click for details.`, false, chrome.runtime.lastError.message); 
        } else {
            showStatus('Settings saved successfully!', true);
        }
    });
});

// Add event listeners to radio buttons
connectionTypeRadios.forEach(radio => {
    radio.addEventListener('change', updateApiKeyVisibility);
});

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);
