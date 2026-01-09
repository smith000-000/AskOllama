// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Function to create context menu items
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
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

    // New context menu for answering questions
    chrome.contextMenus.create({
      id: 'answerWithOllama',
      title: 'Answer with Ollama',
      contexts: ['page'] // Show anywhere on the page
    });
  });
}

// Create context menu items on install and on startup
chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

// Recreate context menus when service worker starts (fixes Edge issue)
chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

// Listen for keyboard shortcut
chrome.commands.onCommand.addListener((command, tab) => {
  console.log(`Command received: ${command}`); // DEBUG LOG
  if (command === 'answer_question') { // Updated command name
    console.log('Command "answer_question" matched. Calling handleAnswerQuestion.'); // DEBUG LOG
    handleAnswerQuestion(tab);
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'send-to-sidebar') {
    // Open sidebar
    chrome.sidePanel.open({ windowId: sender.tab.windowId });
    
    // Clear chat before sending new query
    chrome.runtime.sendMessage({ type: 'clear-chat' });
    
    // Wait a moment for panel to open, then process query
    // processQuery will handle sending the stream-start message
    setTimeout(() => {
      processQuery(message.query, sender.tab.windowId);
    }, 500);
  }
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sendToOllama') {
    // Open the side panel immediately in response to user click
    chrome.sidePanel.open({ windowId: tab.windowId });

    // Send message to clear chat *before* processing
    chrome.runtime.sendMessage({ type: 'clear-chat' });

    // Then process the text query
    processQuery(info.selectionText, tab.windowId);
  } else if (info.menuItemId === 'sendImageToOllama') {
    // Open the side panel immediately in response to user click
    chrome.sidePanel.open({ windowId: tab.windowId });

    // Send message to clear chat *before* processing
    chrome.runtime.sendMessage({ type: 'clear-chat' });

    // Then process the image
    processImageQuery(info.srcUrl, tab.windowId);
  } else if (info.menuItemId === 'answerWithOllama') {
    // Handle the new menu item
    console.log('Context menu "answerWithOllama" clicked. Calling handleAnswerQuestion.'); // DEBUG LOG
    handleAnswerQuestion(tab);
  }
});

// --- Function to handle the "Answer with Ollama" action ---
async function handleAnswerQuestion(tab) {
  console.log('--- handleAnswerQuestion START ---', 'Tab ID:', tab?.id); // DEBUG LOG
  if (!tab || !tab.id) {
    console.error('Invalid tab object received.');
    return;
  }

  try {
    // 1. Inject script to extract question and options
    console.log('Injecting extractQuestionAndOptionsFromPage...'); // DEBUG LOG
    let injectionResults;
    try {
        injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractQuestionAndOptionsFromPage,
        });
        console.log('Injection result (extract):', injectionResults); // DEBUG LOG
    } catch (injectionError) {
        console.error('Error injecting extract script:', injectionError); // DEBUG LOG
        return; // Stop if injection fails
    }

    // Check results from content script
    if (!injectionResults || injectionResults.length === 0 || !injectionResults[0].result) {
        console.error('Content script (extract) failed to execute or return data.'); // DEBUG LOG
        // Optionally notify user here if needed
        return; // Stop if no data extracted
    }

    const { question, options } = injectionResults[0].result;

    if (!question || !options || options.length === 0) {
      console.warn('Could not find question or options on the page.'); // DEBUG LOG
      // Optionally notify user
      return;
    }

    console.log('Extracted Data:', { question, options }); // DEBUG LOG

    // 2. Get Ollama settings
    const settings = await chrome.storage.sync.get({
      ollamaAddress: 'http://localhost:11434',
      selectedModel: 'mistral', // Or a default suitable for QA
      systemPrompt: '', // Use a specific system prompt for this task
      connectionType: 'local',
      apiKey: '',
      useInternet: false
    });
    const { ollamaAddress: address, selectedModel: model, connectionType, apiKey, useInternet } = settings;
    const baseAddress = address.replace(/\/+$/, ''); // normalize trailing slashes

    // 3. Construct the prompt for Ollama
    // Use a more specific system prompt if the user hasn't set one, otherwise prepend.
    let systemPrompt = settings.systemPrompt || "You are an expert assistant. Analyze the following question and answer options carefully.";
    const userPrompt = `
Given the following question and multiple-choice answers, please choose the single best answer from the list provided. Respond ONLY with the exact text of the chosen answer option, without any explanation, preamble, or quotation marks.

Question:
${question}

Answer Options:
${options.map(opt => `- ${opt}`).join('\n')}

Chosen Answer:`;

    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
    console.log('Sending prompt to Ollama:', fullPrompt); // DEBUG LOG


    // 4. Call Ollama API (adapting existing logic, but without streaming to side panel)
    let ollamaResponseText = '';
    let endpointUrl;
    const headers = { 'Content-Type': 'application/json' };
    if (connectionType === 'external' && apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let requestBody;
    if (connectionType === 'external') {
        endpointUrl = `${baseAddress}/api/chat/completions`; // Assuming OpenAI compatible
        const messages = [
            { role: "system", content: systemPrompt }, // Separate system prompt for OpenAI
            { role: "user", content: userPrompt }
        ];
        const requestObject = {
            model: model,
            messages: messages,
            stream: false, // Don't stream for this use case
            temperature: 0.1 // Lower temperature for more deterministic choice
        };
        if (useInternet) { requestObject.tool_ids = ["web_search"]; }
        requestBody = JSON.stringify(requestObject);
    } else {
        // Local Ollama format
        endpointUrl = `${baseAddress}/api/generate`;
        const requestObject = {
            model: model,
            prompt: fullPrompt, // Combine system and user prompt for Ollama
            stream: false, // Don't stream
            options: { // Add options if needed, e.g., temperature
                temperature: 0.1
            }
        };
        if (useInternet) { requestObject.tool_ids = ["web_search"]; }
        requestBody = JSON.stringify(requestObject);
    }

    try {
        console.log('Calling Ollama API...'); // DEBUG LOG
        const response = await fetch(endpointUrl, {
            method: 'POST',
            headers: headers,
            body: requestBody
        });

        if (!response.ok) {
            let errorBody = '';
            try { errorBody = await response.text(); } catch (e) { /* ignore */ }
            throw new Error(`Ollama API Error: ${response.status} ${response.statusText} - ${errorBody}`);
        }

        const responseData = await response.json();
        console.log('Ollama Raw Response:', responseData); // DEBUG LOG

        // Extract the response text based on connection type
        if (connectionType === 'external') {
            // OpenAI format: responseData.choices[0].message.content
            if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message) {
                ollamaResponseText = responseData.choices[0].message.content.trim();
            }
        } else {
            // Ollama format: responseData.response
            if (responseData.response) {
                ollamaResponseText = responseData.response.trim();
            }
        }

        if (!ollamaResponseText) {
            throw new Error("Received empty response from Ollama.");
        }

        console.log('Ollama Processed Answer:', ollamaResponseText); // DEBUG LOG

    } catch (apiError) {
      console.error('Error calling Ollama API:', apiError); // DEBUG LOG
      // Optionally notify user
      return; // Stop execution if API call fails
    }

    // 5. Inject script to select the answer
    console.log('Injecting selectAnswerOnPage...'); // DEBUG LOG
    let selectionResult;
    try {
        selectionResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: selectAnswerOnPage,
            args: [ollamaResponseText, options] // Pass Ollama's answer and original options
        });
        console.log('Injection result (select):', selectionResult); // DEBUG LOG
    } catch (injectionError) {
        console.error('Error injecting select script:', injectionError); // DEBUG LOG
        return; // Stop if injection fails
    }


    if (!selectionResult || selectionResult.length === 0 || !selectionResult[0].result || !selectionResult[0].result.success) {
        console.error('Failed to select the answer on the page. Ollama answer:', ollamaResponseText, 'Result:', selectionResult); // DEBUG LOG
        // Optionally notify user
    } else {
        console.log('Successfully selected answer:', selectionResult[0].result.selectedText); // DEBUG LOG
    }

  } catch (error) {
    console.error('Error in handleAnswerQuestion:', error); // DEBUG LOG
    // Optionally notify user about the error
  }
  console.log('--- handleAnswerQuestion END ---'); // DEBUG LOG
}

// --- Content script functions (to be injected) ---

// Function to extract question and options (runs in the context of the webpage)
function extractQuestionAndOptionsFromPage() {
  const questionDiv = document.getElementById('question_description');
  const optionsList = document.getElementById('answer_options');

  if (!questionDiv) {
    console.warn('AskOllama Extension: Could not find element with id="question_description"');
    return { question: null, options: [] };
  }
  if (!optionsList) {
    console.warn('AskOllama Extension: Could not find element with id="answer_options"');
    return { question: questionDiv.innerText, options: [] };
  }

  const questionText = questionDiv.innerText;
  const optionElements = optionsList.querySelectorAll('li span.rr_start');
  const optionsText = Array.from(optionElements).map(span => span.innerText.trim());

  return { question: questionText, options: optionsText };
}

// Function to select the answer radio button (runs in the context of the webpage)
function selectAnswerOnPage(ollamaAnswer, originalOptions) {
    console.log(`AskOllama Extension: Trying to select answer based on Ollama response: "${ollamaAnswer}"`);
    const optionsList = document.getElementById('answer_options');
    if (!optionsList) {
        console.error('AskOllama Extension: Could not find element with id="answer_options" to select answer.');
        return { success: false, error: 'Options list not found' };
    }

    const optionElements = optionsList.querySelectorAll('li');
    let bestMatchElement = null;
    let matchedText = null;

    // Find the best matching option. Prioritize exact match.
    // Also handle cases where Ollama might slightly rephrase or include the option within a sentence.
    let bestMatchScore = 0; // Higher score is better

    for (const li of optionElements) {
        const span = li.querySelector('span.rr_start');
        if (span) {
            const optionText = span.innerText.trim();

            // Exact match - highest priority
            if (optionText.toLowerCase() === ollamaAnswer.toLowerCase()) {
                bestMatchElement = li;
                matchedText = optionText;
                bestMatchScore = 3; // Exact match score
                break; // Found exact match, stop searching
            }

            // Check if option text is contained within Ollama response (case-insensitive)
            if (ollamaAnswer.toLowerCase().includes(optionText.toLowerCase())) {
                 if (bestMatchScore < 2) { // Prioritize containment over nothing
                    bestMatchElement = li;
                    matchedText = optionText;
                    bestMatchScore = 2; // Containment score
                 }
            }
             // Check if Ollama response is contained within option text (less likely but possible)
            else if (optionText.toLowerCase().includes(ollamaAnswer.toLowerCase())) {
                 if (bestMatchScore < 1) { // Lowest priority match
                    bestMatchElement = li;
                    matchedText = optionText;
                    bestMatchScore = 1; // Reverse containment score
                 }
            }
        }
    }


    if (bestMatchElement) {
        const radio = bestMatchElement.querySelector('input[type="radio"]');
        if (radio) {
            console.log(`AskOllama Extension: Found match "${matchedText}", clicking radio button:`, radio);
            radio.click();
            // Optional: Visually highlight the selected answer briefly?
            // bestMatchElement.style.outline = '2px solid green';
            // setTimeout(() => { bestMatchElement.style.outline = ''; }, 1000);
            return { success: true, selectedText: matchedText };
        } else {
            console.error(`AskOllama Extension: Found matching text "${matchedText}" but could not find radio button within:`, bestMatchElement);
            return { success: false, error: 'Radio button not found for matched text', matchedText: matchedText };
        }
    } else {
        console.warn(`AskOllama Extension: Could not find a matching answer option for Ollama response: "${ollamaAnswer}". Available options:`, originalOptions);
        return { success: false, error: 'No matching option found', ollamaAnswer: ollamaAnswer };
    }
}


// --- Existing functions below ---

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
        apiKey: '',
        useInternet: false // Fetch useInternet setting
    });
    const { ollamaAddress: address, selectedModel: model, systemPrompt, connectionType, apiKey, useInternet } = settings;
    const baseAddress = address.replace(/\/+$/, ''); // normalize trailing slashes

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
          endpointUrl = `${baseAddress}/api/chat/completions`;
          const requestObject = { // Prepare object first
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
          };
          if (useInternet) { // Conditionally add parameter
              requestObject.tool_ids = ["web_search"]; // OpenWebUI format
          }
          requestBody = JSON.stringify(requestObject); // Stringify at the end
      } else {
          // Local Ollama format
          endpointUrl = `${baseAddress}/api/generate`;
          const requestObject = { // Prepare object first
              model: model,
              prompt: imagePrompt,
              images: [imageBase64],
              stream: true
          };
          if (useInternet) { // Conditionally add parameter
              requestObject.tool_ids = ["web_search"]; // OpenWebUI format
          }
          requestBody = JSON.stringify(requestObject); // Stringify at the end
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
          
          // Skip [DONE] marker
          if (jsonData === '[DONE]' || jsonData.trim() === '[DONE]') {
            continue;
          }
          
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
        apiKey: '',
        useInternet: false // Fetch useInternet setting
    });
    const { ollamaAddress: address, selectedModel: model, systemPrompt, connectionType, apiKey, useInternet } = settings;
    const baseAddress = address.replace(/\/+$/, ''); // normalize trailing slashes

    // Wait a moment for the panel to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send the query to the side panel
    chrome.runtime.sendMessage({
      type: 'stream-start',
      query: selectedText
    });

    // Declare variables outside try block for error handler access
    let requestBody;
    let endpointUrl;
    const headers = {
        'Content-Type': 'application/json'
    };
    
    try {
      // --- Prepare API Request based on connectionType ---
      if (connectionType === 'external' && apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
      }

      if (connectionType === 'external') {
          endpointUrl = `${baseAddress}/api/chat/completions`;
          const messages = [];
          if (systemPrompt) {
              messages.push({ role: "system", content: systemPrompt });
          }
          messages.push({ role: "user", content: selectedText });
          const requestObject = { // Prepare object first
              model: model,
              messages: messages,
              stream: true
          };
          if (useInternet) { // Conditionally add parameter
              requestObject.tool_ids = ["web_search"]; // OpenWebUI format
          }
          requestBody = JSON.stringify(requestObject); // Stringify at the end
      } else {
          // Local Ollama format
          endpointUrl = `${baseAddress}/api/generate`;
          const prompt = systemPrompt ? `${systemPrompt}\n\n${selectedText}` : selectedText;
          const requestObject = { // Prepare object first
              model: model,
              prompt: prompt,
              stream: true
          };
          if (useInternet) { // Conditionally add parameter
              requestObject.tool_ids = ["web_search"]; // OpenWebUI format
          }
          requestBody = JSON.stringify(requestObject); // Stringify at the end
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
          
          // Skip [DONE] marker
          if (jsonData === '[DONE]' || jsonData.trim() === '[DONE]') {
            continue;
          }
          
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
