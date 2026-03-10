const DEFAULT_VOLUME = 0.8;
let audioContext = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "offscreen-play-notification") {
    return false;
  }

  void playNotificationTone(message.volume)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function playNotificationTone(messageVolume) {
  const settings = await chrome.storage.sync.get({
    volume: DEFAULT_VOLUME
  });
  const context = await getAudioContext();
  const now = context.currentTime;
  const volume = normalizeVolume(
    typeof messageVolume === "number" ? messageVolume : settings.volume
  );

  const masterGain = context.createGain();
  masterGain.gain.value = volume;
  masterGain.connect(context.destination);

  playPartial(context, masterGain, {
    frequency: 880,
    startTime: now,
    duration: 0.12
  });

  playPartial(context, masterGain, {
    frequency: 1318.51,
    startTime: now + 0.11,
    duration: 0.2
  });

  await wait(380);
}

function normalizeVolume(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return DEFAULT_VOLUME;
  }

  return Math.min(1, Math.max(0, value));
}

async function getAudioContext() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Web Audio is not available in the offscreen document.");
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  return audioContext;
}

function playPartial(context, destination, { frequency, startTime, duration }) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const attack = 0.01;
  const release = 0.06;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(1, startTime + attack);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    startTime + duration + release
  );

  oscillator.connect(gain);
  gain.connect(destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + release);
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
