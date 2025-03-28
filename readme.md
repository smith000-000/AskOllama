The ask co-pilot extension was nerfed. You couldn't paste images and you had to use whatever model they have it pointed to. I didn't like that so I made this.

I just vibe coded this in windsurf. I don't even know javascript.

Make sure your ollama has the following env's set (I'm using docker so this is in my compose file):
    'OLLAMA_ORIGINS=chrome-extension://*'
    'OLLAMA_CORS=*'

Just go to your extensions settings in chrome/edge/whatever and turn on developer mode. "Load Unpacked" and point it to the directory.

I have no idea how to publish this to the web store. If you want to, have at it.
