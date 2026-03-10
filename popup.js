const DEFAULT_SETTINGS = {
  enabled: true,
  volume: 0.8
};

const enabledInput = document.getElementById("enabled");
const volumeInput = document.getElementById("volume");
const volumeValue = document.getElementById("volumeValue");
const testButton = document.getElementById("testButton");
const statusNode = document.getElementById("status");

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
  showStatus("Playing test sound...");

  try {
    await playPreviewTone(Number(volumeInput.value) / 100);
    showStatus("Test sound played.");
  } catch (error) {
    showStatus(error instanceof Error ? error.message : String(error));
  } finally {
    testButton.disabled = false;
  }
});

async function initialize() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledInput.checked = Boolean(settings.enabled);
  volumeInput.value = String(Math.round((settings.volume || DEFAULT_SETTINGS.volume) * 100));
  updateVolumeLabel(settings.volume || DEFAULT_SETTINGS.volume);
  showStatus("Open ChatGPT and wait for a reply to finish.");
}

function showStatus(message) {
  statusNode.textContent = message;
}

function updateVolumeLabel(volume) {
  volumeValue.textContent = `${Math.round(volume * 100)}%`;
}

async function playPreviewTone(volume) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("This browser does not support Web Audio.");
  }

  const context = new AudioContextClass();
  const now = context.currentTime;
  const masterGain = context.createGain();

  masterGain.gain.value = Math.min(1, Math.max(0, volume));
  masterGain.connect(context.destination);

  playPartial(context, masterGain, 880, now, 0.12);
  playPartial(context, masterGain, 1318.51, now + 0.11, 0.2);

  await wait(420);
  await context.close();
}

function playPartial(context, destination, frequency, startTime, duration) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(1, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + 0.06);

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.06);
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
