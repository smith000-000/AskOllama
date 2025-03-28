# Ollama Helper Chrome Extension

This Chrome extension allows you to easily send selected text or images from your browser to a configured LLM endpoint (like Ollama or an OpenAI-compatible API) and view the response in the browser's side panel. It has been tested with my local ollama instance and the open-webui sitting on top of it. I am able to call both local and OpenAI models that open-webui exposes reliably. 

## Features

*   Send selected text via the right-click context menu.
*   Send images via the right-click context menu (requires a multimodal model like LLaVA).
*   View responses streamed into the Chrome side panel.
*   Continue the conversation with follow-up messages in the side panel.
*   Configure connection settings via the extension options page:
    *   Supports local Ollama instances.
    *   Supports external OpenAI-compatible APIs (e.g., Open WebUI, Groq, Together AI) with optional API key authentication.
    *   Select the model to use.
    *   Set a custom system prompt.
    *   Test connection and chat functionality.

## Installation

1.  **Download:** Download or clone this repository to your local machine.
2.  **Open Extensions Page:** Open your Chromium-based browser (Chrome, Edge, Brave, etc.) and navigate to the extensions page. You can usually find this at `chrome://extensions`.
3.  **Enable Developer Mode:** Ensure the "Developer mode" toggle switch (usually in the top-right corner) is enabled.
4.  **Load Unpacked:** Click the "Load unpacked" button.
5.  **Select Directory:** Browse to the directory where you downloaded/cloned this repository and select it.

The extension icon should now appear in your browser's toolbar.

## Configuration

1.  **Open Options:** Right-click the extension icon in your toolbar and select "Options", or find the extension on the `chrome://extensions` page and click "Details" -> "Extension options".
2.  **Connection Type:**
    *   **Local Ollama:** Select this if you are running Ollama locally.
    *   **External API:** Select this if you are connecting to an OpenAI-compatible API endpoint (like [Open WebUI](https://github.com/open-webui/open-webui), Groq, Together AI, etc.).
3.  **API Endpoint URL:**
    *   For **Local Ollama**, enter the address of your Ollama instance (default: `http://localhost:11434`).
    *   For **External API**, enter the base URL of the API endpoint (e.g., `https://api.groq.com/openai/v1`).
4.  **API Key (External API only):** If the external API requires an API key, enter it here. It will be sent as a Bearer token in the `Authorization` header.
5.  **Test Connection:** Click "Test Connection". This will attempt to fetch available models from the specified endpoint using the selected connection type and API key (if applicable).
6.  **Model:** Once the connection is successful, select the desired model from the dropdown list.
    *   *Note:* For image analysis via the context menu, ensure you select a multimodal model (like `llava`).
7.  **System Prompt (Optional):** Enter any system prompt you want to prepend to your requests.
    *   *Tip:* To get basic formatting in the response (like paragraphs and lists), you can instruct the LLM here. Example: "Format your response clearly. Use double newlines between paragraphs. Use hyphens (-) for bullet points."
8.  **Test Chat (Optional):** Enter a test prompt and click "Test Chat" to verify end-to-end communication.
9.  **Save Settings:** Click "Save Settings".

### Ollama CORS Configuration (If using Local Ollama)

If you are running Ollama locally, especially in Docker, you need to ensure it's configured to accept requests from the extension. Set the following environment variables for your Ollama instance:

*   `OLLAMA_ORIGINS=chrome-extension://*` (Or replace `*` with the specific extension ID shown on the `chrome://extensions` page for better security)
*   `OLLAMA_CORS_ALLOWED_ORIGINS=*` (Or specify the extension origin)

Consult the Ollama documentation for the most up-to-date way to configure CORS.

## Usage

1.  **Sending Text:** Highlight text on any webpage, right-click, and select "Ask Ollama about this text".
2.  **Sending Images:** Right-click on an image on any webpage and select "Ask Ollama about this image". (Requires a multimodal model configured in options).
3.  **Viewing Response:** The side panel will automatically open (if not already open) and display the streamed response from the LLM.
4.  **Follow-up:** Type follow-up messages into the input box at the bottom of the side panel and press Enter or click "Send". The conversation history is maintained within the current session.
5.  **Clear Chat:** Click the "Clear Chat" button in the side panel header to clear the current conversation.

## Debugging

*   **Options Page:** Open the options page and use standard browser DevTools (F12 or right-click -> Inspect) to check the console for errors related to settings or testing.
*   **Side Panel:** Right-click *inside* the side panel and select "Inspect" to open DevTools for the side panel context. Check the console for errors related to sending/receiving messages.
*   **Background Script:** Go to `chrome://extensions`, find the "Ollama Helper" extension, and click the "Service worker" link to open DevTools for the background script. This is useful for debugging context menu actions and API calls initiated from there.


## ToDo

* Not sure sending images works. This needs to be tested and debugged probably
* Test with direct OpenAI compatible endpoints. As mentioned above it should work, but has only been tested against open-webui
  
## Disclaimers
* I don't really know javascript. I vibecoded this whole thing in windsurf/cline. It's probably not at all secure. Use at your own risk.
* This extension supports APIs compatible with the OpenAI API specification. OpenAI is a trademark of OpenAI, L.L.C. This project is not affiliated with, endorsed by, or sponsored by OpenAI.
*   Ollama is a product developed by Ollama. This project is not affiliated with, endorsed by, or sponsored by Ollama.
*   References to other third-party products or services (like Open WebUI, Groq, Together AI) are for identification purposes only and do not imply endorsement.
*   If you use your own API key to a paid endpoint I would set usage limits! No idea what this thing is doing in the background. It doesn't appear to be making loads of requests though.

## Usage
* I will absolutely accept PRs for this thing. If you fork it and make it better please share the love.
