# Progress

## What Works

Based on the initial code review (`options.html`, `options.js`, `manifest.json`):

-   Extension loads unpacked in developer mode.
-   Options page UI allows setting:
    -   Ollama Address (defaults to `http://localhost:11434`).
    -   System Prompt.
-   "Test Connection" button:
    -   Fetches models from the `/api/tags` endpoint of the specified Ollama Address.
    -   Populates the "Model" dropdown on success.
    -   Shows status messages.
-   "Model" dropdown allows selecting a model after a successful connection test.
-   "Test Chat" button:
    -   Sends the test prompt (prepended with the system prompt if provided) to the `/api/generate` endpoint of the specified Ollama Address using the selected model.
    -   Displays the response.
    -   Shows status messages.
-   "Save Settings" button:
    -   Saves `ollamaAddress`, `selectedModel`, and `systemPrompt` to `chrome.storage.sync`.
    -   Shows a success message.
-   Settings (`ollamaAddress`, `selectedModel`, `systemPrompt`) are loaded when the options page opens. If an address is saved, it attempts to connect and load models automatically.

## What's Left to Build (Current Task)

-   **UI Changes (`options.html`):**
    -   Add radio buttons for "Connection Type" (Local Ollama / External API).
    -   Add an input field for "API Key", initially hidden.
-   **Logic Changes (`options.js`):**
    -   Add event listeners for radio buttons to show/hide the API Key field.
    -   Load/Save `connectionType` and `apiKey` settings from/to `chrome.storage.sync`.
    -   Update `fetchModels` and `testChat` to:
        -   Read `connectionType` and `apiKey` from storage or UI.
        -   Conditionally add `Authorization: Bearer <apiKey>` header to `fetch` requests when `connectionType` is 'external' and `apiKey` is present.
    -   Ensure the "Ollama Address" label is updated to "API Endpoint URL" or similar for clarity.
    -   Ensure model loading and testing work correctly for both connection types.

## Progress Status

-   **Planning Phase:** Memory Bank initialized. Plan formulated. Ready for user review.
