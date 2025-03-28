# Active Context

## Current Task

Modify the Chrome extension's options page (`options.html` and `options.js`) to support multiple LLM connection types:

1.  **Local Ollama:** (Existing functionality) Connects using the provided Ollama Address.
2.  **External API:** Connects using the provided Ollama Address (acting as a generic API endpoint) and an optional API Key.

## Implementation Details

-   Add radio buttons to `options.html` to select the connection type ("Local Ollama" or "External API").
-   Add a text input field for the API Key in `options.html`, which should only be visible when "External API" is selected.
-   Update `options.js` to:
    -   Show/hide the API Key field based on the selected radio button.
    -   Save the selected connection type and the API Key (if provided) to `chrome.storage.sync`.
    -   Load the saved connection type and API Key when the options page loads.
    -   Modify the `fetchModels` and `testChat` functions to handle the different connection types:
        -   For "Local Ollama", use the existing logic.
        -   For "External API", include the API Key in the request headers if it's provided. (Need to determine the correct header format for external APIs - likely `Authorization: Bearer <API_KEY>`).
-   The "Ollama Address" field will now serve as the generic "API Endpoint URL".
-   Model selection, system prompt, and test prompt functionality should remain consistent for both connection types.

## Recent Changes

-   Initial Memory Bank setup in progress.

## Next Steps

1.  Finish creating Memory Bank files (`systemPatterns.md`, `techContext.md`, `progress.md`).
2.  Present the implementation plan to the user for review.
3.  Request the user to switch to ACT MODE.
4.  Implement the changes in `options.html` and `options.js`.
