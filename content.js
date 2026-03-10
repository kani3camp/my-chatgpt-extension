(function () {
  const FINALIZE_DEBOUNCE_MS = 1200;
  const POLL_INTERVAL_MS = 1000;
  const STOP_LABELS = [
    "stop",
    "stop generating",
    "stop streaming",
    "生成を停止",
    "停止"
  ];
  const ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    'article [data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]'
  ];
  const CONTENT_SELECTORS = [
    "[data-message-author-role]",
    "[data-testid^='conversation-turn-']",
    ".markdown",
    ".prose"
  ];

  const state = {
    currentUrl: location.href,
    finalizeTimer: null,
    generationActive: false,
    lastSettledSignature: null,
    lastNotifiedSignature: null,
    inspectionQueued: false
  };

  const observer = new MutationObserver(() => {
    queueInspection();
  });

  patchHistoryMethods();
  resetBaseline();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  window.addEventListener("popstate", resetBaseline);
  setInterval(inspectPage, POLL_INTERVAL_MS);

  function inspectPage() {
    state.inspectionQueued = false;

    if (location.href !== state.currentUrl) {
      resetBaseline();
    }

    const stopVisible = hasVisibleStopButton();
    const latestMessage = getLatestAssistantMessage();
    const latestSignature = latestMessage ? buildMessageSignature(latestMessage) : null;

    if (stopVisible) {
      state.generationActive = true;
      clearFinalizeTimer();
      return;
    }

    if (state.generationActive) {
      scheduleFinalize();
      return;
    }

    if (!state.lastSettledSignature && latestSignature) {
      state.lastSettledSignature = latestSignature;
    }
  }

  function scheduleFinalize() {
    if (state.finalizeTimer) {
      return;
    }

    state.finalizeTimer = window.setTimeout(() => {
      void finalizeGeneration();
    }, FINALIZE_DEBOUNCE_MS);
  }

  async function finalizeGeneration() {
    clearFinalizeTimer();

    if (hasVisibleStopButton()) {
      return;
    }

    const latestMessage = getLatestAssistantMessage();
    const latestSignature = latestMessage ? buildMessageSignature(latestMessage) : null;
    const shouldNotify =
      Boolean(latestSignature) &&
      latestSignature !== state.lastSettledSignature &&
      latestSignature !== state.lastNotifiedSignature;

    state.generationActive = false;

    if (!latestSignature) {
      return;
    }

    state.lastSettledSignature = latestSignature;

    if (!shouldNotify) {
      return;
    }

    state.lastNotifiedSignature = latestSignature;

    try {
      await chrome.runtime.sendMessage({
        type: "play-notification"
      });
    } catch (_error) {
      state.lastNotifiedSignature = null;
    }
  }

  function resetBaseline() {
    state.currentUrl = location.href;
    state.generationActive = false;
    clearFinalizeTimer();

    const latestMessage = getLatestAssistantMessage();
    const latestSignature = latestMessage ? buildMessageSignature(latestMessage) : null;

    state.lastSettledSignature = latestSignature;
    state.lastNotifiedSignature = null;
  }

  function clearFinalizeTimer() {
    if (!state.finalizeTimer) {
      return;
    }

    window.clearTimeout(state.finalizeTimer);
    state.finalizeTimer = null;
  }

  function getLatestAssistantMessage() {
    const nodes = new Set();

    for (const selector of ASSISTANT_SELECTORS) {
      for (const node of document.querySelectorAll(selector)) {
        if (isVisible(node)) {
          nodes.add(node);
        }
      }
    }

    if (!nodes.size) {
      return null;
    }

    return Array.from(nodes).at(-1) || null;
  }

  function buildMessageSignature(node) {
    const root = findMessageRoot(node);
    const text = extractMessageText(root);

    if (!text) {
      return null;
    }

    const idPart =
      root.getAttribute("data-message-id") ||
      root.getAttribute("data-testid") ||
      root.id ||
      "assistant";

    return [location.pathname, idPart, text.length, text.slice(-160)].join("::");
  }

  function findMessageRoot(node) {
    for (const selector of CONTENT_SELECTORS) {
      const root = node.closest(selector);
      if (root) {
        return root;
      }
    }

    return node;
  }

  function extractMessageText(node) {
    const candidates = [
      node.querySelector(".markdown"),
      node.querySelector(".prose"),
      node
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      const text = normalizeText(candidate.textContent || "");
      if (text) {
        return text;
      }
    }

    return "";
  }

  function hasVisibleStopButton() {
    for (const button of document.querySelectorAll("button")) {
      if (!isVisible(button)) {
        continue;
      }

      const label = normalizeText(
        [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          button.textContent
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      );

      if (STOP_LABELS.some((keyword) => label.includes(keyword))) {
        return true;
      }
    }

    return false;
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
})();
