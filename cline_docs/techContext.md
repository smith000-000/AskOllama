# Tech Context

## Technologies Used

-   **HTML**: For structuring the options and side panel pages.
-   **CSS**: For styling the options page (`options.css`).
-   **JavaScript (ES Modules)**: For extension logic (`background.js`, `options.js`, `sidepanel.js`). Uses `async/await` for handling asynchronous operations (like `fetch` and `chrome.storage`).
-   **Chrome Extension APIs (Manifest V3)**:
    -   `chrome.storage.sync`: Storing settings.
    -   `chrome.contextMenus`: (Assumed, based on description) For adding right-click menu items.
    -   `chrome.sidePanel`: For managing the side panel UI.
    -   `chrome.tabs`: (Permission requested) Likely for interacting with browser tabs.
    -   `chrome.scripting`: (Permission requested) Potentially for injecting scripts into web pages.
-   **Fetch API**: For making HTTP requests to the LLM endpoint.

## Development Setup

-   Requires a Chromium-based browser (Chrome, Edge, etc.).
-   Developer mode must be enabled in the browser's extensions settings.
-   Load the extension using "Load Unpacked" and pointing to the project directory.
-   Requires a running Ollama instance (or compatible external API) accessible from the browser.
-   If using local Ollama (especially via Docker), specific environment variables (`OLLAMA_ORIGINS`, `OLLAMA_CORS`) need to be configured to allow requests from the extension.

## Technical Constraints

-   **Manifest V3 Restrictions**: Service workers have limitations compared to persistent background pages in V2. DOM access is not available in the service worker. Communication between different parts of the extension (e.g., content scripts, options page, side panel, background) typically happens via message passing (`chrome.runtime.sendMessage`, `chrome.runtime.onMessage`).
-   **CORS**: The LLM API endpoint must be configured to accept requests from the extension's origin (`chrome-extension://<EXTENSION_ID>`). The `readme.md` mentions setting `OLLAMA_ORIGINS` and `OLLAMA_CORS` for local Ollama. External APIs will also need appropriate CORS headers.
-   **API Key Security**: Storing API keys directly in `chrome.storage.sync` is convenient but might not be the most secure method for sensitive keys. However, for this project's scope, it's acceptable. Keys are accessible to the user if they inspect the extension's storage.
-   **External API Compatibility**: The current code assumes the external API uses the same `/api/tags` and `/api/generate` endpoints and request/response formats as Ollama. This might need adjustment depending on the specific external API being used. The plan assumes the `/api/tags` endpoint will work similarly for fetching models, and `/api/generate` will accept the API key via an `Authorization: Bearer <key>` header.
