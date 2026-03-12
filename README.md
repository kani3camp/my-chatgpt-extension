# AI Response Notifier

Chrome extension that plays a short notification sound when a ChatGPT or Gemini response finishes.

## Features

- Detects when ChatGPT or Gemini finishes streaming a response
- Uses a different notification sound for ChatGPT and Gemini
- Plays one notification sound per completed response
- Includes a popup with `Enabled`, `Volume`, and `Test sound`
- Stores the enabled state with Chrome sync storage

## Install locally

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `/Users/kani3camp/GitHub/my-chatgpt-extension`

## Notes

- Supported sites: `https://chatgpt.com/`, `https://chat.openai.com/`, and `https://gemini.google.com/`
- The completion detection relies on each site's current DOM and stop-generation controls.
- If ChatGPT or Gemini changes its markup significantly, the selector logic in `/Users/kani3camp/GitHub/my-chatgpt-extension/content.js` may need to be updated.
