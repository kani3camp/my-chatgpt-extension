const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.8
};

const enabledInput = document.getElementById("enabled");
const volumeInput = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const testButton = document.getElementById("testButton");
const statusNode = document.getElementById("status");
const debugStatusNode = document.getElementById("debugStatus");
const SUPPORTED_URL_PREFIXES = [
  "https://chatgpt.com/",
  "https://chat.openai.com/",
  "https://gemini.google.com/"
];

initialize().catch((error) => {
  showStatus(error instanceof Error ? error.message : String(error));
});

enabledInput.addEventListener("change", async () => {
  const enabled = enabledInput.checked;
  await chrome.storage.sync.set({ enabled });
  showStatus(enabled ? "Notifications enabled." : "Notifications disabled.");
});

volumeInput.addEventListener("input", async () => {
  const volume = Number(volumeInput.value) / 100;
  updateVolumeLabel(volume);
  await chrome.storage.sync.set({ volume });
  showStatus(`Volume set to ${Math.round(volume * 100)}%.`);
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  showStatus("Testing in active AI tab...");

  try {
    const tab = await getActiveSupportedTab();
    if (!tab?.id) {
      throw new Error("Open ChatGPT or Gemini in an active tab first.");
    }

    const result = await chrome.tabs.sendMessage(tab.id, {
      type: "play-page-test-notification"
    });

    if (!result?.ok) {
      throw new Error(result?.error || "The active AI tab test failed.");
    }

    showStatus("Active AI tab test sound played.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error));
  } finally {
    await refreshDebugStatus();
    testButton.disabled = false;
  }
});

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = Boolean(settings.enabled);
  volumeInput.value = String(Math.round((settings.volume || DEFAULT_SETTINGS.volume) * 100));
  updateVolumeLabel(settings.volume || DEFAULT_SETTINGS.volume);
  await refreshDebugStatus();
  showStatus("Open ChatGPT or Gemini and wait for a reply to finish.");
}

function showStatus(message) {
  statusNode.textContent = message;
}

function updateVolumeLabel(volume) {
  volumeValue.textContent = `${Math.round(volume * 100)}%`;
}

async function refreshDebugStatus() {
  const data = await chrome.storage.local.get("debugStatus");
  const status = data.debugStatus;

  if (!status) {
    debugStatusNode.textContent = "No debug data yet.";
    return;
  }

  debugStatusNode.textContent = JSON.stringify(status, null, 2);
}

async function getActiveSupportedTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  const tab = tabs[0];

  if (!tab?.url) {
    return null;
  }

  if (!SUPPORTED_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))) {
    return null;
  }

  return tab;
}
