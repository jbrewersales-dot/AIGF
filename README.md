# AI Girlfriend

A simple chat app with an AI companion. You pick her name and personality, then text back and forth.

## How to run it

1. Install [Node.js](https://nodejs.org) (version 20 or newer).
2. Get an API key from <https://console.anthropic.com> (this costs money per message, usually a fraction of a cent).
3. Copy `.env.example` to a new file called `.env` and paste your key after `ANTHROPIC_API_KEY=`.
4. In a terminal, inside this folder, run:

   ```
   npm install
   npm start
   ```

5. Open <http://localhost:3000> in your browser.

## Good to know

- You can give her a picture on the setup screen. It shows above the chat and moves gently. Tap it to see it full size.
- You can also give her short video clips on the setup screen: one "relaxed" clip that loops, and one "talking" clip that plays while she replies. Make these in any video tool (for example DeeVid's Talking Avatar or image-to-video), download them, and choose the files.
- Tap "Voice off" to switch her voice on, and she reads her replies out loud (uses your browser's built-in voice).
- Your chat and her picture are saved only in your own browser. "New chat" erases the chat.
- She remembers everything in the current chat, nothing from erased ones.
- She is an AI and will say so if sincerely asked. The chat stays non-explicit, and the app is for adults (18+).
- Her personality and rules live in `buildSystemPrompt` in `server.js` if you want to change them.
