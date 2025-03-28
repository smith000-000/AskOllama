// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Create context menu items
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sendToOllama',
    title: 'Ask Ollama about this text',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'sendImageToOllama',
    title: 'Ask Ollama about this image',
    contexts: ['image']
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sendToOllama') {
    // Open the side panel immediately in response to user click
    chrome.sidePanel.open({ windowId: tab.windowId });
    
    // Then process the text query
    processQuery(info.selectionText, tab.windowId);
  } else if (info.menuItemId === 'sendImageToOllama') {
    // Open the side panel immediately in response to user click
    chrome.sidePanel.open({ windowId: tab.windowId });
    
    // Then process the image
    processImageQuery(info.srcUrl, tab.windowId);
  }
});

// Convert image URL to base64
async function getImageAsBase64(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

// Process image query and send to Ollama
async function processImageQuery(imageUrl, windowId) {
  try {
    // Get all relevant settings with defaults
    const settings = await chrome.storage.sync.get({
        ollamaAddress: 'http://localhost:11434',
        selectedModel: 'llava', // Default to llava for images
        systemPrompt: '',
        connectionType: 'local', // Default to local
        apiKey: ''
    });
    const { ollamaAddress: address, selectedModel: model, systemPrompt, connectionType, apiKey } = settings;

    // Wait a moment for the panel to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Convert image to base64
    const imageBase64 = await getImageAsBase64(imageUrl);

    // Send initial message to UI
    chrome.runtime.sendMessage({
      type: 'stream-start',
      query: 'Analyzing image...'
    });

    try {
      // --- Prepare API Request based on connectionType ---
      let requestBody;
      let endpointUrl;
      const headers = {
          'Content-Type': 'application/json'
      };
      if (connectionType === 'external' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const imagePrompt = systemPrompt ? `${systemPrompt}\n\nDescribe this image in detail.` : 'Describe this image in detail.';

      if (connectionType === 'external') {
          // Assuming OpenAI compatible multimodal format
          endpointUrl = `${address}/api/chat/completions`;
          requestBody = JSON.stringify({
              model: model,
              messages: [
                  {
                      role: "user",
                      content: [
                          { type: "text", text: imagePrompt },
                          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } } // Assuming JPEG, might need dynamic type
                      ]
                  }
              ],
              stream: true
          });
      } else {
          // Local Ollama format
          endpointUrl = `${address}/api/generate`;
          requestBody = JSON.stringify({
              model: model,
              prompt: imagePrompt,
              images: [imageBase64],
              stream: true
          });
      }
      // ---

      // --- Make API Call ---
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: headers,
        body: requestBody
      });

      if (!response.ok) {
         let errorBody = '';
         try { errorBody = await response.text(); } catch (e) { /* ignore */ }
         throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
      }
      // ---

      // --- Process Stream ---
      const reader = response.body.getReader();
      let fullResponse = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new TextDecoder().decode(value);
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

            if (responseChunk) {
                fullResponse += responseChunk;
                chrome.runtime.sendMessage({
                    type: 'stream-chunk',
                    chunk: responseChunk
                });
            }
            // Handle potential end-of-stream markers if needed
            if (data.done && connectionType === 'local') {
                 // Ollama specific end signal
            }

          } catch (e) {
            console.error('Error parsing JSON line:', jsonData, e);
          }
        }
      }
      // ---

      chrome.runtime.sendMessage({
        type: 'stream-end',
        fullResponse
      });

    } catch (error) {
      console.error('Error processing image API request:', error); // Log full error
      
      let errorMessage = error.message;
      // Basic debug info, excluding potentially large base64 image
      let debugInfo = {
        timestamp: new Date().toISOString(),
        requestUrl: endpointUrl, // Use dynamic endpoint
        requestHeaders: headers, // Include headers (API key is masked by Chrome DevTools)
        requestBody: { // Simplified body for logging
          model: model,
          prompt: imagePrompt, // Use the actual prompt
          hasImage: true,
          stream: true,
          connectionType: connectionType // Log connection type
        },
        error: { // Basic error info
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      };

      if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to Ollama. Make sure Ollama is running and the address is correct.';
      } else if (error.message.includes('404')) {
        errorMessage = 'API endpoint not found. Make sure you are using the correct Ollama API version.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Invalid request. Check if the llava model is available in Ollama.';
      }

      chrome.runtime.sendMessage({
        error: errorMessage,
        debug: debugInfo,
        stack: error.stack
      });
    }
  } catch (error) {
    console.error('Error processing image query:', error);
    chrome.runtime.sendMessage({
      error: 'Failed to process image. ' + error.message
    });
  }
}

// Process the query and send to Ollama
async function processQuery(selectedText, windowId) {
  try {
    // Get all relevant settings with defaults
    const settings = await chrome.storage.sync.get({
        ollamaAddress: 'http://localhost:11434',
        selectedModel: 'mistral', // Default model
        systemPrompt: '',
        connectionType: 'local', // Default to local
        apiKey: ''
    });
    const { ollamaAddress: address, selectedModel: model, systemPrompt, connectionType, apiKey } = settings;

    // Wait a moment for the panel to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send the query to the side panel
    chrome.runtime.sendMessage({
      type: 'stream-start',
      query: selectedText
    });

    try {
      // --- Prepare API Request based on connectionType ---
      let requestBody;
      let endpointUrl;
      const headers = {
          'Content-Type': 'application/json'
      };
      if (connectionType === 'external' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
      }

      if (connectionType === 'external') {
          endpointUrl = `${address}/api/chat/completions`;
          const messages = [];
          if (systemPrompt) {
              messages.push({ role: "system", content: systemPrompt });
          }
          messages.push({ role: "user", content: selectedText });
          requestBody = JSON.stringify({
              model: model,
              messages: messages,
              stream: true
          });
      } else {
          // Local Ollama format
          endpointUrl = `${address}/api/generate`;
          const prompt = systemPrompt ? `${systemPrompt}\n\n${selectedText}` : selectedText;
          requestBody = JSON.stringify({
              model: model,
              prompt: prompt,
              stream: true
          });
      }
      // ---

      // --- Make API Call ---
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: headers,
        body: requestBody
      });

      if (!response.ok) {
         let errorBody = '';
         try { errorBody = await response.text(); } catch (e) { /* ignore */ }
         throw new Error(`HTTP error! status: ${response.status}${errorBody ? ` - ${errorBody}` : ''}`);
      }
      // ---

      // --- Process Stream ---
      const reader = response.body.getReader();
      let fullResponse = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new TextDecoder().decode(value);
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

            if (responseChunk) {
                fullResponse += responseChunk;
                chrome.runtime.sendMessage({
                    type: 'stream-chunk',
                    chunk: responseChunk
                });
            }
             // Handle potential end-of-stream markers if needed
            if (data.done && connectionType === 'local') {
                 // Ollama specific end signal
            }

          } catch (e) {
            console.error('Error parsing JSON line:', jsonData, e);
          }
        }
      }
       // ---

      chrome.runtime.sendMessage({
        type: 'stream-end',
        fullResponse
      });

    } catch (error) {
      console.error('Error processing text API request:', error); // Log full error
      
      let errorMessage = error.message;
      // Basic debug info
      let debugInfo = {
        timestamp: new Date().toISOString(),
        requestUrl: endpointUrl, // Use dynamic endpoint
        requestHeaders: headers, // Include headers
        requestBody: { // Simplified body for logging
          model: model,
          prompt: systemPrompt ? `${systemPrompt}\n\n${selectedText}` : selectedText, // Keep original prompt structure for logging simplicity
          stream: true,
          connectionType: connectionType // Log connection type
        },
        error: { // Basic error info
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      };

      if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Could not connect to Ollama. Make sure Ollama is running and the address is correct.';
      } else if (error.message.includes('404')) {
        errorMessage = 'API endpoint not found. Make sure you are using the correct Ollama API version.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Invalid request. Check if the selected model is available in Ollama.';
      }

      chrome.runtime.sendMessage({
        error: errorMessage,
        debug: debugInfo,
        stack: error.stack
      });
    }
  } catch (error) {
    console.error('Error processing query:', error);
  }
}
