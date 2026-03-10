# ChatGPT Response Notifier

Chrome extension that plays a short notification sound when a ChatGPT response finishes on `https://chatgpt.com/`.

## Features

- Detects when ChatGPT finishes streaming a response
- Plays one notification sound per completed response
- Includes a popup with `Enabled`, `Volume`, and `Test sound`
- Stores the enabled state with Chrome sync storage

## Install locally

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select `/Users/kani3camp/GitHub/my-chatgpt-extension`

## Notes

- The completion detection relies on ChatGPT's current DOM and stop-generation controls.
- If ChatGPT changes its markup significantly, the selector logic in `/Users/kani3camp/GitHub/my-chatgpt-extension/content.js` may need to be updated.
