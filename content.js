(function () {
  const RESPONSE_SETTLE_MS = 650;
  const POLL_INTERVAL_MS = 1000;
  const DEFAULT_SETTINGS = {
    enabled: true,
    volume: 0.8
  };
  const DEBUG_KEY = "debugStatus";
  const PROVIDERS = {
    chatgpt: {
      id: "chatgpt",
      hosts: ["chatgpt.com", "chat.openai.com"],
      stopLabels: [
        "stop",
        "stop generating",
        "stop streaming",
        "stop recording",
        "生成を停止",
        "停止"
      ],
      sendLabels: [
        "send",
        "send message",
        "send prompt",
        "submit",
        "メッセージを送信",
        "送信"
      ],
      assistantSelectors: [
        '[data-message-author-role="assistant"]',
        'article[data-testid^="conversation-turn-"] .markdown',
        'article[data-testid^="conversation-turn-"] .prose',
        '[data-testid^="conversation-turn-"] .markdown',
        '[data-testid^="conversation-turn-"] .prose'
      ],
      messageRootSelectors: [
        '[data-message-author-role="assistant"]',
        '[data-testid^="conversation-turn-"]',
        "article"
      ],
      textSelectors: [
        ".markdown",
        ".prose"
      ],
      soundPattern: [
        { frequency: 1046.5, offset: 0, duration: 0.045, type: "square", gain: 0.8, attack: 0.002, release: 0.025 },
        { frequency: 1318.51, offset: 0.055, duration: 0.05, type: "square", gain: 0.72, attack: 0.002, release: 0.03 },
        {
          frequency: 1567.98,
          offset: 0.115,
          duration: 0.12,
          type: "square",
          gain: 0.58,
          attack: 0.003,
          release: 0.06,
          endFrequency: 1396.91
        },
        { frequency: 783.99, offset: 0.115, duration: 0.1, type: "triangle", gain: 0.25, attack: 0.003, release: 0.06 }
      ]
    },
    gemini: {
      id: "gemini",
      hosts: ["gemini.google.com"],
      stopLabels: [
        "stop",
        "stop response",
        "stop generating",
        "cancel response",
        "停止"
      ],
      sendLabels: [
        "send",
        "send message",
        "submit",
        "run",
        "送信"
      ],
      assistantSelectors: [
        "model-response",
        "model-response message-content",
        "[data-response-role='model']",
        "[data-message-author='model']",
        "[data-response-author='model']",
        ".model-response-text",
        ".response-content"
      ],
      messageRootSelectors: [
        "model-response",
        "[data-response-role='model']",
        "[data-message-author='model']",
        "[data-response-author='model']",
        "message-content",
        "article",
        "section"
      ],
      textSelectors: [
        "message-content",
        ".model-response-text",
        ".response-content"
      ],
      soundPattern: [
        {
          frequency: 659.25,
          offset: 0,
          duration: 0.12,
          type: "triangle",
          gain: 0.45,
          attack: 0.01,
          release: 0.08,
          endFrequency: 739.99
        },
        {
          frequency: 987.77,
          offset: 0.07,
          duration: 0.16,
          type: "sine",
          gain: 0.32,
          attack: 0.012,
          release: 0.09,
          endFrequency: 1174.66
        },
        {
          frequency: 1318.51,
          offset: 0.16,
          duration: 0.22,
          type: "triangle",
          gain: 0.42,
          attack: 0.012,
          release: 0.1,
          endFrequency: 1567.98
        },
        { frequency: 1975.53, offset: 0.16, duration: 0.12, type: "sine", gain: 0.18, attack: 0.01, release: 0.08 }
      ]
    }
  };

  const state = {
    provider: detectProvider(),
    currentUrl: location.href,
    inspectionQueued: false,
    settleTimer: null,
    awaitingResponse: false,
    responseToken: 0,
    responseActivitySeen: false,
    lastResponseActivityAt: 0,
    latestObservedSignature: null,
    pendingSignature: null,
    lastSettledSignature: null,
    lastNotifiedSignature: null,
    lastNotifiedResponseToken: 0,
    audioContext: null,
    audioPrimed: false
  };

  const observer = new MutationObserver(() => {
    queueInspection();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "play-page-test-notification") {
      return false;
    }

    void playPageTestNotification()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        void setDebugStatus("page-test-failed", {
          error: error instanceof Error ? error.message : String(error)
        });
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });

    return true;
  });

  patchHistoryMethods();
  attachInteractionListeners();
  resetBaseline();
  void setDebugStatus("content-loaded", {
    href: location.href,
    provider: state.provider
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  window.addEventListener("popstate", resetBaseline);
  window.setInterval(inspectPage, POLL_INTERVAL_MS);

  function inspectPage() {
    state.inspectionQueued = false;

    const nextProvider = detectProvider();
    if (location.href !== state.currentUrl || nextProvider !== state.provider) {
      resetBaseline();
    }

    const provider = getProviderConfig();
    if (!provider) {
      return;
    }

    const stopVisible = hasVisibleStopButton(provider);
    const latestMessage = getLatestAssistantMessage(provider);
    const latestSignature = latestMessage ? buildMessageSignature(provider, latestMessage) : null;

    if (stopVisible) {
      state.awaitingResponse = true;
      markResponseActivity("stop-visible");
      void setDebugStatus("response-active", {
        stopVisible: true
      });
    }

    if (latestSignature && latestSignature !== state.latestObservedSignature) {
      state.latestObservedSignature = latestSignature;

      if (state.awaitingResponse || stopVisible) {
        markResponseActivity("assistant-signature");
        state.pendingSignature = latestSignature;
        void setDebugStatus("assistant-message-updated", {
          pendingLength: latestSignature.length
        });
        scheduleSettleCheck({ reset: true, reason: "assistant-updated" });
      } else if (!state.lastSettledSignature) {
        state.lastSettledSignature = latestSignature;
      }
    }

    if (!stopVisible && state.pendingSignature) {
      scheduleSettleCheck({ reason: "pending-signature" });
    }

    if (
      state.awaitingResponse &&
      state.responseActivitySeen &&
      !stopVisible &&
      Date.now() - state.lastResponseActivityAt >= RESPONSE_SETTLE_MS
    ) {
      scheduleSettleCheck({ reason: "activity-settled" });
    }
  }

  function scheduleSettleCheck({ reset = false, reason = "unknown" } = {}) {
    if (state.settleTimer && !reset) {
      return;
    }

    clearSettleTimer();
    state.settleTimer = window.setTimeout(() => {
      void finalizeResponseIfStable();
    }, RESPONSE_SETTLE_MS);
    void setDebugStatus("settle-scheduled", {
      reason
    });
  }

  async function finalizeResponseIfStable() {
    clearSettleTimer();

    const provider = getProviderConfig();
    if (!provider) {
      return;
    }

    if (hasVisibleStopButton(provider)) {
      void setDebugStatus("response-still-streaming");
      scheduleSettleCheck({ reset: true, reason: "still-streaming" });
      return;
    }

    const latestMessage = getLatestAssistantMessage(provider);
    const latestSignature = latestMessage ? buildMessageSignature(provider, latestMessage) : null;
    const hasStableActivityOnly =
      state.responseActivitySeen &&
      !state.pendingSignature &&
      Date.now() - state.lastResponseActivityAt >= RESPONSE_SETTLE_MS;

    if (!hasStableActivityOnly && state.pendingSignature && latestSignature !== state.pendingSignature) {
      void setDebugStatus("settle-skip", {
        hasLatest: Boolean(latestSignature),
        hasPendingSignature: Boolean(state.pendingSignature),
        matchesPending: latestSignature === state.pendingSignature
      });
      return;
    }

    const awaitingResponseBeforeReset = state.awaitingResponse;
    const responseActivitySeenBeforeReset = state.responseActivitySeen;
    const lastSettledBeforeReset = state.lastSettledSignature;
    const lastNotifiedBeforeReset = state.lastNotifiedSignature;

    const shouldNotify =
      awaitingResponseBeforeReset &&
      responseActivitySeenBeforeReset &&
      (
        latestSignature === null ||
        (
          latestSignature !== lastSettledBeforeReset &&
          latestSignature !== lastNotifiedBeforeReset
        )
      ) &&
      state.responseToken !== state.lastNotifiedResponseToken;

    state.awaitingResponse = false;
    state.pendingSignature = null;
    state.responseActivitySeen = false;

    if (latestSignature) {
      state.lastSettledSignature = latestSignature;
    }

    if (!shouldNotify) {
      void setDebugStatus("notify-skipped", {
        awaitingResponse: awaitingResponseBeforeReset,
        responseActivitySeen: responseActivitySeenBeforeReset,
        responseToken: state.responseToken,
        changedFromLastSettled: latestSignature
          ? latestSignature !== lastSettledBeforeReset
          : null,
        changedFromLastNotified: latestSignature
          ? latestSignature !== lastNotifiedBeforeReset
          : null
      });
      return;
    }

    try {
      const played = await playNotificationFromPage();
      if (!played) {
        void setDebugStatus("play-skipped");
        return;
      }

      state.lastNotifiedSignature = latestSignature;
      state.lastNotifiedResponseToken = state.responseToken;
      void setDebugStatus("played", {
        notifiedLength: latestSignature?.length || null,
        responseToken: state.responseToken
      });
    } catch (_error) {
      state.lastNotifiedSignature = null;
      void setDebugStatus("play-failed", {
        error: _error instanceof Error ? _error.message : String(_error)
      });
    }
  }

  function resetBaseline() {
    state.provider = detectProvider();
    state.currentUrl = location.href;
    state.awaitingResponse = false;
    state.responseActivitySeen = false;
    state.lastResponseActivityAt = 0;
    state.pendingSignature = null;
    clearSettleTimer();

    const provider = getProviderConfig();
    const latestMessage = provider ? getLatestAssistantMessage(provider) : null;
    const latestSignature = provider && latestMessage
      ? buildMessageSignature(provider, latestMessage)
      : null;

    state.latestObservedSignature = latestSignature;
    state.lastSettledSignature = latestSignature;
    state.lastNotifiedSignature = null;
    void setDebugStatus("baseline-reset", {
      href: location.href,
      hasSignature: Boolean(latestSignature)
    });
  }

  function clearSettleTimer() {
    if (!state.settleTimer) {
      return;
    }

    window.clearTimeout(state.settleTimer);
    state.settleTimer = null;
  }

  function getLatestAssistantMessage(provider) {
    const nodes = new Set();

    for (const selector of provider.assistantSelectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (isValidAssistantCandidate(provider, node)) {
          nodes.add(node);
        }
      }
    }

    const candidates = Array.from(nodes);
    return candidates.length ? candidates[candidates.length - 1] : null;
  }

  function isValidAssistantCandidate(provider, node) {
    if (!isVisible(node)) {
      return false;
    }

    const root = findMessageRoot(provider, node);
    const text = extractMessageText(root, provider);

    if (!text) {
      return false;
    }

    if (provider.id === "gemini" && node.closest("user-query")) {
      return false;
    }

    return true;
  }

  function buildMessageSignature(provider, node) {
    const root = findMessageRoot(provider, node);
    const text = extractMessageText(root, provider);

    if (!text) {
      return null;
    }

    const idPart =
      root.getAttribute("data-message-id") ||
      root.getAttribute("data-response-id") ||
      root.getAttribute("data-testid") ||
      root.id ||
      provider.id;

    return [provider.id, location.pathname, idPart, text.length, text.slice(-200)].join("::");
  }

  function findMessageRoot(provider, node) {
    for (const selector of provider.messageRootSelectors) {
      const root = node.closest(selector);
      if (root) {
        return root;
      }
    }

    return node;
  }

  function extractMessageText(node, provider) {
    const candidates = [];

    for (const selector of provider.textSelectors) {
      const nested = node.querySelector(selector);
      if (nested) {
        candidates.push(nested);
      }
    }

    candidates.push(node);

    for (const candidate of candidates) {
      const text = normalizeText(candidate.textContent || "");
      if (text) {
        return text;
      }
    }

    return "";
  }

  function hasVisibleStopButton(provider) {
    return findMatchingVisibleButton(provider.stopLabels) !== null;
  }

  function findMatchingVisibleButton(keywords) {
    for (const button of document.querySelectorAll("button, [role='button']")) {
      if (!isVisible(button)) {
        continue;
      }

      const label = getElementLabel(button);
      if (keywords.some((keyword) => label.includes(keyword))) {
        return button;
      }
    }

    return null;
  }

  function getElementLabel(node) {
    return normalizeText(
      [
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.textContent
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
    );
  }

  function attachInteractionListeners() {
    document.addEventListener(
      "keydown",
      (event) => {
        void primeAudio("keydown");

        const target = event.target;
        if (isSupportedTypingSurface(target) && isPlainEnter(event)) {
          beginAwaitingResponse();
          void setDebugStatus("user-send-keydown");
        }
      },
      true
    );

    document.addEventListener(
      "click",
      (event) => {
        void primeAudio("click");

        const provider = getProviderConfig();
        if (!provider) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        const button = target.closest("button, [role='button']");
        if (!button || !isVisible(button)) {
          return;
        }

        const label = getElementLabel(button);
        if (provider.sendLabels.some((keyword) => label.includes(keyword))) {
          beginAwaitingResponse();
          void setDebugStatus("user-send-click", {
            label
          });
        }
      },
      true
    );
  }

  function isSupportedTypingSurface(target) {
    return (
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.matches("[role='textbox']") ||
        target.closest("rich-textarea") !== null
      ))
    );
  }

  function isPlainEnter(event) {
    return (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    );
  }

  async function playNotificationFromPage() {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    if (!settings.enabled) {
      await setDebugStatus("disabled");
      return false;
    }

    const context = await getAudioContext();
    const now = context.currentTime;
    const masterGain = context.createGain();
    const volume = normalizeVolume(settings.volume);
    const provider = getProviderConfig();
    const soundPattern = provider?.soundPattern || PROVIDERS.chatgpt.soundPattern;

    masterGain.gain.value = volume;
    masterGain.connect(context.destination);

    for (const tone of soundPattern) {
      playPartial(
        context,
        masterGain,
        {
          frequency: tone.frequency,
          startTime: now + tone.offset,
          duration: tone.duration,
          type: tone.type,
          gain: tone.gain,
          attack: tone.attack,
          release: tone.release,
          endFrequency: tone.endFrequency
        }
      );
    }

    return true;
  }

  async function playPageTestNotification() {
    await primeAudio("popup-test");
    const played = await playNotificationFromPage();

    if (!played) {
      throw new Error("Audio playback was skipped.");
    }

    await setDebugStatus("page-test-played");
  }

  async function primeAudio(source) {
    if (state.audioPrimed && state.audioContext?.state === "running") {
      return;
    }

    const context = await getAudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    gain.gain.value = 0.00001;
    oscillator.frequency.value = 440;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.01);

    state.audioPrimed = true;
    await setDebugStatus("audio-primed", {
      source,
      state: context.state
    });
  }

  async function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Web Audio is not supported on this page.");
    }

    if (!state.audioContext) {
      state.audioContext = new AudioContextClass();
    }

    if (state.audioContext.state === "suspended") {
      await state.audioContext.resume();
    }

    return state.audioContext;
  }

  function playPartial(context, destination, {
    frequency,
    startTime,
    duration,
    type = "sine",
    gain: peakGain = 1,
    attack = 0.01,
    release = 0.06,
    endFrequency = frequency
  }) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const attackEnd = startTime + Math.max(attack, 0.002);
    const releaseStart = startTime + duration;
    const stopTime = releaseStart + Math.max(release, 0.03);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startTime);
    oscillator.frequency.linearRampToValueAtTime(endFrequency, releaseStart);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(peakGain, 0.0002), attackEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(startTime);
    oscillator.stop(stopTime);
  }

  function normalizeVolume(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return DEFAULT_SETTINGS.volume;
    }

    return Math.min(1, Math.max(0, value));
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (node.hidden) {
      return false;
    }

    return node.offsetWidth > 0 || node.offsetHeight > 0 || node.getClientRects().length > 0;
  }

  function patchHistoryMethods() {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function pushState() {
      const result = originalPushState.apply(this, arguments);
      window.setTimeout(resetBaseline, 0);
      return result;
    };

    history.replaceState = function replaceState() {
      const result = originalReplaceState.apply(this, arguments);
      window.setTimeout(resetBaseline, 0);
      return result;
    };
  }

  function queueInspection() {
    if (state.inspectionQueued) {
      return;
    }

    state.inspectionQueued = true;
    window.requestAnimationFrame(() => {
      inspectPage();
    });
  }

  function beginAwaitingResponse() {
    state.awaitingResponse = true;
    state.responseToken += 1;
    state.responseActivitySeen = false;
    state.lastResponseActivityAt = Date.now();
    state.pendingSignature = null;
  }

  function markResponseActivity(source) {
    const provider = getProviderConfig();
    if (!provider) {
      return;
    }

    if (!state.awaitingResponse && !hasVisibleStopButton(provider)) {
      return;
    }

    state.responseActivitySeen = true;
    state.lastResponseActivityAt = Date.now();
    void setDebugStatus("response-activity", {
      source
    });
  }

  async function setDebugStatus(event, extra = {}) {
    try {
      await chrome.storage.local.set({
        [DEBUG_KEY]: {
          event,
          provider: state.provider,
          href: location.href,
          audioPrimed: state.audioPrimed,
          awaitingResponse: state.awaitingResponse,
          timestamp: new Date().toISOString(),
          ...extra
        }
      });
    } catch (_error) {
      // Ignore storage failures in page logic.
    }
  }

  function detectProvider() {
    const hostname = location.hostname;

    for (const provider of Object.values(PROVIDERS)) {
      if (provider.hosts.includes(hostname)) {
        return provider.id;
      }
    }

    return null;
  }

  function getProviderConfig() {
    return state.provider ? PROVIDERS[state.provider] : null;
  }
})();
