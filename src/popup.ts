type CaptureConfig = {
  captureId: string;
  endpoint: string;
};

type CaptureStartResponse = {
  accepted: boolean;
  error?: string;
};

type CaptureArgs = {
  captureId: string;
  endpoint: string;
};

type CaptureMessage = {
  type: "FIGMA_CAPTURE";
  captureId: string;
  endpoint: string;
};

type PrepareMessage = {
  type: "FIGMA_CAPTURE_PREPARE";
};

type PopupExtensionMessage = CaptureMessage | PrepareMessage;

const STORAGE_KEY = "figma_capture_config";
const STATUS_CLASSES: Record<"success" | "error", string> = {
  success: "status-banner status-success",
  error: "status-banner status-error",
};

let statusTimeout: number | undefined;

function isRetryableConnectionError(error: unknown): boolean {
  return error instanceof Error
    && error.message.includes("Could not establish connection");
}

function getUnsupportedPageMessage(tabUrl?: string): string {
  if (!tabUrl) {
    return "This tab is not available for capture. Try reloading the page and opening the popup again.";
  }

  try {
    const { protocol } = new URL(tabUrl);
    if (["chrome:", "edge:", "about:", "chrome-extension:"].includes(protocol)) {
      return "Chrome internal pages can't be captured. Open a normal website tab and try again.";
    }
  } catch {
    // Ignore malformed URLs and fall back to the generic message below.
  }

  return "The page could not be prepared for capture. Reload the page and try again.";
}

function describeScriptInjectionError(error: unknown, tabUrl?: string): string {
  const fallbackMessage = getUnsupportedPageMessage(tabUrl);
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  if (
    error.message.includes("Cannot access contents of url")
    || error.message.includes("Cannot access a chrome:// URL")
    || error.message.includes("extensions gallery cannot be scripted")
  ) {
    return fallbackMessage;
  }

  return `${fallbackMessage} (${error.message})`;
}

async function sendExtensionMessage(
  tab: chrome.tabs.Tab,
  payload: PopupExtensionMessage,
): Promise<CaptureStartResponse> {
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, payload) as CaptureStartResponse;
  } catch (error) {
    if (!isRetryableConnectionError(error)) {
      throw error;
    }

    try {
      await chrome.scripting.executeScript({
        target: {
          tabId: tab.id,
          allFrames: true,
        },
        files: ["content.js"],
      });
    } catch (injectionError) {
      throw new Error(describeScriptInjectionError(injectionError, tab.url));
    }

    return await chrome.tabs.sendMessage(tab.id, payload) as CaptureStartResponse;
  }
}

async function prepareCapture(tab: chrome.tabs.Tab): Promise<void> {
  const response = await sendExtensionMessage(tab, {
    type: "FIGMA_CAPTURE_PREPARE",
  });

  if (!response?.accepted) {
    throw new Error(response?.error ?? getUnsupportedPageMessage(tab.url));
  }
}

async function triggerCapture(
  tab: chrome.tabs.Tab,
  config: CaptureArgs,
): Promise<CaptureStartResponse> {
  return await sendExtensionMessage(tab, {
    type: "FIGMA_CAPTURE",
    captureId: config.captureId,
    endpoint: config.endpoint,
  });
}

async function loadConfig(): Promise<CaptureConfig> {
  const result = await chrome.storage.sync.get(STORAGE_KEY);
  const stored = (result[STORAGE_KEY] as Partial<CaptureConfig>) ?? {};
  return {
    captureId: stored.captureId ?? "",
    endpoint: stored.endpoint ?? "",
  };
}

async function saveConfig(config: CaptureConfig): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEY]: config });
}

function showStatus(
  el: HTMLElement,
  message: string,
  type: "success" | "error",
): void {
  el.textContent = message;
  el.className = STATUS_CLASSES[type];
  el.hidden = false;

  if (statusTimeout) {
    globalThis.clearTimeout(statusTimeout);
  }

  statusTimeout = globalThis.setTimeout(() => {
    el.hidden = true;
  }, 3000);
}

function hideStatus(el: HTMLElement): void {
  el.hidden = true;
  el.textContent = "";
}

async function init(): Promise<void> {
  const captureIdInput = document.getElementById(
    "input-capture-id",
  ) as HTMLInputElement;
  const endpointInput = document.getElementById(
    "input-endpoint",
  ) as HTMLInputElement;
  const captureBtn = document.getElementById(
    "btn-capture",
  ) as HTMLButtonElement;
  const captureBtnLabel = document.getElementById(
    "capture-label",
  ) as HTMLSpanElement;
  const saveBtn = document.getElementById("btn-save") as HTMLButtonElement;
  const statusEl = document.getElementById("status") as HTMLElement;

  const config = await loadConfig();
  captureIdInput.value = config.captureId;
  endpointInput.value = config.endpoint;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (activeTab?.id) {
    try {
      await prepareCapture(activeTab);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : getUnsupportedPageMessage(activeTab.url);
      showStatus(statusEl, message, "error");
    }
  }

  saveBtn.addEventListener("click", () => {
    void (async () => {
      await saveConfig({
        captureId: captureIdInput.value.trim(),
        endpoint: endpointInput.value.trim(),
      });
      showStatus(statusEl, "Config saved.", "success");
    })();
  });

  captureBtn.addEventListener("click", () => {
    void (async () => {
      const draftConfig: CaptureConfig = {
        captureId: captureIdInput.value.trim(),
        endpoint: endpointInput.value.trim(),
      };

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        showStatus(statusEl, "No active tab found.", "error");
        return;
      }

      captureBtn.disabled = true;
      captureBtnLabel.textContent = "Starting capture…";
      hideStatus(statusEl);

      try {
        await saveConfig(draftConfig);

        const response = await triggerCapture(tab, draftConfig);

        if (!response?.accepted) {
          showStatus(
            statusEl,
            response?.error ?? "Capture failed.",
            "error",
          );
          return;
        }

        globalThis.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Capture failed.";
        showStatus(statusEl, message, "error");
      } finally {
        captureBtn.disabled = false;
        captureBtnLabel.textContent = "Capture current tab";
      }
    })();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
