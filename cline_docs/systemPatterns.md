# System Patterns

## Architecture Overview

This is a Chrome Extension (Manifest V3) designed to interact with LLM APIs.

-   **`manifest.json`**: Defines the extension's core properties, permissions, background script, options page, and side panel.
-   **`background.js`**: Service worker handling background tasks, likely including context menu creation and communication with the LLM API based on user actions. (Contents not yet read).
-   **`options.html` / `options.css` / `options.js`**: Provides the user interface for configuring the extension's settings, including the LLM endpoint address, model selection, system prompt, and connection testing. Settings are saved using `chrome.storage.sync`.
-   **`sidepanel.html` / `sidepanel.js`**: Provides a side panel interface, likely for displaying LLM responses or offering more complex interactions. (Contents not yet read).
-   **`popup.html` / `popup.js`**: Potentially used for a browser action popup, though the primary interaction seems to be via context menus and the side panel based on `manifest.json`. (Contents not yet read).

## Key Technical Decisions

-   **Manifest V3**: Uses the current standard for Chrome extensions.
-   **Service Worker (`background.js`)**: Handles persistent background logic required by Manifest V3.
-   **`chrome.storage.sync`**: Used for storing user settings, allowing them to sync across devices if the user is logged into Chrome.
-   **Direct API Calls from Options/Side Panel**: `options.js` makes direct `fetch` calls to the configured LLM endpoint (`/api/tags` for models, `/api/generate` for chat). This pattern might be replicated in `sidepanel.js` or handled via messages to `background.js`.
-   **Dynamic Model Loading**: The list of available models is fetched dynamically from the endpoint after a successful connection test.

## Planned Changes

-   Introduce a `connectionType` setting (`'local'` or `'external'`).
-   Introduce an `apiKey` setting.
-   Modify API calls in `options.js` (and potentially `background.js` / `sidepanel.js` later) to:
    -   Conditionally include an `Authorization: Bearer <apiKey>` header for the `'external'` connection type.
    -   Continue using the current fetch logic for the `'local'` connection type.
