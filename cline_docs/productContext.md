# Product Context

## Why This Project Exists

To provide a seamless way for users to send highlighted text and potentially images from their web browser directly to a Large Language Model (LLM) API endpoint.

## Problems It Solves

- Eliminates the need for manual copy-pasting of browser content into separate LLM interfaces.
- Streamlines the workflow for interacting with LLMs while browsing.

## How It Should Work

The extension adds context menu items (when text is highlighted) and potentially uses a side panel. Selecting a context menu item sends the highlighted content to a configured LLM endpoint.

Users can configure the LLM connection via the extension's options page:
- Specify the API endpoint URL.
- Select the desired LLM model.
- Set a default system prompt.
- Test the connection and chat functionality.
- Choose between connecting to a local Ollama instance or an external API (requiring an optional API key).
