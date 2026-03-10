const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.8
};

const OFFSCREEN_PATH = "offscreen.html";
let offscreenCreationPromise = null;

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "play-notification") {
    void handlePlayNotification(message)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  if (message?.type === "get-settings") {
    void chrome.storage.sync
      .get(DEFAULT_SETTINGS)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  return false;
});

async function ensureSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  if (typeof settings.enabled !== "boolean") {
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
  }
}

async function handlePlayNotification(message) {
  await ensureSettings();

  const { enabled, volume } = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!enabled && !message.force) {
    return { ok: true, skipped: true };
  }

  await playViaOffscreen(volume);

  return { ok: true };
}

async function ensureOffscreenDocument() {
  if (await offscreenDocumentExists()) {
    return;
  }

  if (!offscreenCreationPromise) {
    offscreenCreationPromise = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play a short notification sound when ChatGPT finishes responding."
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Only a single offscreen document")) {
          throw error;
        }
      })
      .finally(() => {
        offscreenCreationPromise = null;
      });
  }

  await offscreenCreationPromise;
}

async function playViaOffscreen(volume) {
  await ensureOffscreenDocument();

  try {
    const result = await chrome.runtime.sendMessage({
      type: "offscreen-play-notification",
      volume
    });

    if (!result?.ok) {
      throw new Error(result?.error || "Offscreen playback failed.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Receiving end does not exist")) {
      throw error;
    }

    await chrome.offscreen.closeDocument().catch(() => {});
    await ensureOffscreenDocument();

    const retryResult = await chrome.runtime.sendMessage({
      type: "offscreen-play-notification",
      volume
    });

    if (!retryResult?.ok) {
      throw new Error(retryResult?.error || "Offscreen playback retry failed.");
    }
  }
}

async function offscreenDocumentExists() {
  if (typeof chrome.runtime.getContexts !== "function") {
    return false;
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });

  return contexts.length > 0;
}
