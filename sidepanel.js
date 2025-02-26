// Keep track of conversation history and debug info
let conversationHistory = [];
let debugHistory = [];
let currentResponseDiv = null;

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
        queryDiv.textContent = message.query;
        contentDiv.appendChild(queryDiv);
        conversationHistory.push({ type: 'query', text: message.query });

        // Create a new response div for streaming
        currentResponseDiv = document.createElement('div');
        currentResponseDiv.className = 'message response';
        contentDiv.appendChild(currentResponseDiv);
    } else if (message.type === 'stream-chunk') {
        if (currentResponseDiv) {
            currentResponseDiv.textContent += message.chunk;
            contentDiv.scrollTop = contentDiv.scrollHeight;
        }
    } else if (message.type === 'stream-end') {
        if (currentResponseDiv) {
            conversationHistory.push({ type: 'response', text: message.fullResponse });
            currentResponseDiv = null;
        }
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
        // Get settings
        const settings = await chrome.storage.sync.get(['ollamaAddress', 'selectedModel', 'systemPrompt']);
        const address = settings.ollamaAddress || 'http://localhost:11434';
        const model = settings.selectedModel || 'mistral';
        const systemPrompt = settings.systemPrompt || '';
        
        // Build context from conversation history
        const context = conversationHistory
            .map(item => item.text)
            .join('\n\n');
        
        // Add the new message to UI
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
        
        const response = await fetch(`${address}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                prompt: `${systemPrompt}\n\nContext:\n${context}\n\nUser: ${message}`,
                stream: true
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body.getReader();
        let fullResponse = '';
        
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            
            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    fullResponse += data.response;
                    currentResponseDiv.textContent += data.response;
                    contentDiv.scrollTop = contentDiv.scrollHeight;
                } catch (e) {
                    console.error('Error parsing JSON:', e);
                }
            }
        }
        
        // Save the full response to history
        conversationHistory.push({ type: 'response', text: fullResponse });
        currentResponseDiv = null;
        
        // Clear input
        chatInput.value = '';
        
    } catch (error) {
        console.error('Error:', error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = `Error: ${error.message}`;
        document.getElementById('content').appendChild(errorDiv);
        conversationHistory.push({ type: 'error', text: error.message });
    } finally {
        // Re-enable input and button
        chatInput.disabled = false;
        sendButton.disabled = false;
        chatInput.focus();
    }
}

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
