// options.js

async function fetchModels(address) {
    try {
        const response = await fetch(`${address}/api/tags`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        const modelSelect = document.getElementById('modelSelect');
        
        // Clear existing options
        modelSelect.innerHTML = '';
        
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            option.textContent = model.name;
            modelSelect.appendChild(option);
        });

        modelSelect.disabled = false;
        return true;
    } catch (error) {
        showStatus('Error fetching models: ' + error.message, false);
        return false;
    }
}

async function loadSettings() {
    const settings = await chrome.storage.sync.get(['ollamaAddress', 'selectedModel', 'systemPrompt']);
    
    // Set address
    if (settings.ollamaAddress) {
        document.getElementById('ollamaAddress').value = settings.ollamaAddress;
        // If we have an address, automatically test connection and populate models
        const success = await fetchModels(settings.ollamaAddress);
        if (success && settings.selectedModel) {
            document.getElementById('modelSelect').value = settings.selectedModel;
        }
    } else {
        document.getElementById('ollamaAddress').value = 'http://localhost:11434';
    }
    
    // Set system prompt
    if (settings.systemPrompt) {
        document.getElementById('systemPrompt').value = settings.systemPrompt;
    }
}

function showStatus(message, success) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = success ? 'success' : 'error';
    status.style.display = 'block';
    setTimeout(() => {
        status.style.display = 'none';
    }, 3000);
}

// Test connection button handler
document.getElementById('testConnection').addEventListener('click', async function() {
    const address = document.getElementById('ollamaAddress').value.trim();
    if (!address) {
        showStatus('Please enter Ollama address', false);
        return;
    }

    try {
        const success = await fetchModels(address);
        if (success) {
            showStatus('Connection successful!', true);
            // Load saved model selection after successful connection
            chrome.storage.sync.get(['selectedModel'], function(result) {
                if (result.selectedModel) {
                    document.getElementById('modelSelect').value = result.selectedModel;
                }
            });
        }
    } catch (error) {
        showStatus('Connection failed: ' + error.message, false);
    }
});

// Test chat button handler
document.getElementById('testChat').addEventListener('click', async function() {
    const address = document.getElementById('ollamaAddress').value.trim();
    const model = document.getElementById('modelSelect').value;
    const systemPrompt = document.getElementById('systemPrompt').value;
    const testPrompt = document.getElementById('testPrompt').value.trim();
    const responseBox = document.getElementById('chatResponse');

    if (!address || !model) {
        showStatus('Please set Ollama address and select a model first', false);
        return;
    }

    if (!testPrompt) {
        showStatus('Please enter a test prompt', false);
        return;
    }

    responseBox.textContent = 'Generating response...';
    
    try {
        const response = await fetch(`${address}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                prompt: systemPrompt ? `${systemPrompt}\n\n${testPrompt}` : testPrompt,
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        responseBox.textContent = data.response;
        showStatus('Test completed successfully!', true);
    } catch (error) {
        responseBox.textContent = 'Error: ' + error.message;
        showStatus('Test failed: ' + error.message, false);
    }
});

// Save settings
document.getElementById('save').addEventListener('click', function() {
    const ollamaAddress = document.getElementById('ollamaAddress').value.trim();
    const selectedModel = document.getElementById('modelSelect').value;
    const systemPrompt = document.getElementById('systemPrompt').value;

    if (!ollamaAddress) {
        showStatus('Please enter Ollama address', false);
        return;
    }

    chrome.storage.sync.set({
        ollamaAddress: ollamaAddress,
        selectedModel: selectedModel,
        systemPrompt: systemPrompt
    }, function() {
        showStatus('Settings saved successfully!', true);
    });
});

// Initialize
document.addEventListener('DOMContentLoaded', loadSettings);