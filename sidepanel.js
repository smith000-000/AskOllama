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
            selectedModel: 'mistral', // Default model if none selected
            systemPrompt: '',
            connectionType: 'local', // Default to local
            apiKey: ''
        });
        const { ollamaAddress: address, selectedModel: model, systemPrompt, connectionType, apiKey } = settings;

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
        const headers = {
            'Content-Type': 'application/json'
        };
        if (connectionType === 'external' && apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        if (connectionType === 'external') {
            chatEndpoint = `${address}/api/chat/completions`;
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
            requestBody = JSON.stringify({
                model: model,
                messages: messages,
                stream: true // Assuming external API supports streaming similarly
            });
        } else {
            // Local Ollama format - include context
            chatEndpoint = `${address}/api/generate`;
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
            requestBody = JSON.stringify({
                model: model,
                prompt: prompt,
                stream: true
            });
        }
        // ---

        // --- Make API Call and Process Stream ---
        console.log(`Sidepanel Fetch: Type=${connectionType}, Endpoint=${chatEndpoint}, KeyPresent=${!!apiKey}`); // DEBUG LOG
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
                    if (connectionType === 'external') {
                        // OpenAI streaming format: data.choices[0].delta.content
                        if (data.choices && data.choices.length > 0 && data.choices[0].delta && data.choices[0].delta.content) {
                            responseChunk = data.choices[0].delta.content;
                        }
                    } else {
                        // Ollama streaming format: data.response
                        if (data.response) {
                            responseChunk = data.response;
                        }
                    }

                    if (responseChunk && currentResponseDiv) {
                        fullResponse += responseChunk;
                        currentResponseDiv.textContent += responseChunk; // Append chunk to UI
                        contentDiv.scrollTop = contentDiv.scrollHeight; // Scroll with new content
                    }
                    // Handle potential end-of-stream markers if needed (e.g., Ollama's final object)
                    if (data.done && connectionType === 'local') {
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
