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
    // Get settings
    const settings = await chrome.storage.sync.get(['ollamaAddress', 'selectedModel', 'systemPrompt']);
    const address = settings.ollamaAddress || 'http://localhost:11434';
    const model = settings.selectedModel || 'llava';  // Default to llava for image processing
    const systemPrompt = settings.systemPrompt || '';

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
      const response = await fetch(`${address}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          prompt: systemPrompt ? `${systemPrompt}\n\nDescribe this image in detail.` : 'Describe this image in detail.',
          images: [imageBase64],
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
            
            chrome.runtime.sendMessage({
              type: 'stream-chunk',
              chunk: data.response
            });
          } catch (e) {
            console.error('Error parsing JSON:', e);
          }
        }
      }

      chrome.runtime.sendMessage({
        type: 'stream-end',
        fullResponse
      });

    } catch (error) {
      console.error('Error:', error);
      
      let errorMessage = error.message;
      let debugInfo = {
        timestamp: new Date().toISOString(),
        requestUrl: `${address}/api/generate`,
        requestHeaders: {
          'Content-Type': 'application/json'
        },
        requestBody: {
          model: model,
          prompt: 'Describe this image in detail.',
          // Don't include the base64 image in debug info
          hasImage: true,
          stream: true
        },
        error: {
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
    // Get settings
    const settings = await chrome.storage.sync.get(['ollamaAddress', 'selectedModel', 'systemPrompt']);
    const address = settings.ollamaAddress || 'http://localhost:11434';
    const model = settings.selectedModel || 'mistral';
    const systemPrompt = settings.systemPrompt || '';

    // Wait a moment for the panel to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send the query to the side panel
    chrome.runtime.sendMessage({
      type: 'stream-start',
      query: selectedText
    });

    try {
      const response = await fetch(`${address}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          prompt: systemPrompt ? `${systemPrompt}\n\n${selectedText}` : selectedText,
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
            
            chrome.runtime.sendMessage({
              type: 'stream-chunk',
              chunk: data.response
            });
          } catch (e) {
            console.error('Error parsing JSON:', e);
          }
        }
      }

      chrome.runtime.sendMessage({
        type: 'stream-end',
        fullResponse
      });

    } catch (error) {
      console.error('Error:', error);
      
      let errorMessage = error.message;
      let debugInfo = {
        timestamp: new Date().toISOString(),
        requestUrl: `${address}/api/generate`,
        requestHeaders: {
          'Content-Type': 'application/json'
        },
        requestBody: {
          model: model,
          prompt: systemPrompt ? `${systemPrompt}\n\n${selectedText}` : selectedText,
          stream: true
        },
        error: {
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
