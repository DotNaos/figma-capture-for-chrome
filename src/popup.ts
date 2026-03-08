import {
    appendDebugLog,
    clearDebugLogs,
    formatDebugLogs,
    readDebugLogs,
    toDebugString,
} from "./debug";

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
const CAPTURE_GLOBAL = "__figmaCaptureExtension";

type VendorLoadResult = {
  loaded: boolean;
  alreadyPresent?: boolean;
  fromTopFrame?: boolean;
  error?: string;
  href?: string;
  readyState?: string;
};

type ScriptExecutionDiagnostic = {
  ok: boolean;
  world: "ISOLATED" | "MAIN";
  error?: string;
  href?: string;
  readyState?: string;
  hasDocumentElement?: boolean;
};

type VendorAppendResult = {
  appended: boolean;
  alreadyPresent?: boolean;
  href?: string;
  readyState?: string;
  error?: string;
};

function isCaptureApiUnavailableError(error?: string): boolean {
  return typeof error === "string"
    && (
      error.includes(`${CAPTURE_GLOBAL}.captureForDesign is unavailable`)
      || error.includes(`Vendored capture.js did not expose globalThis.${CAPTURE_GLOBAL}.captureForDesign`)
    );
}

let statusTimeout: number | undefined;
let debugLogEl: HTMLElement | null = null;

async function refreshDebugLogPanel(): Promise<void> {
  if (!debugLogEl) {
    return;
  }

  const entries = await readDebugLogs();
  debugLogEl.textContent = formatDebugLogs(entries);
}

function logPopupDebug(message: string, details?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {};

  if (details) {
    Object.assign(payload, details);
  }

  console.info("[Figma Capture][Popup]", message, payload);
  void appendDebugLog({
    timestamp: new Date().toISOString(),
    source: "popup",
    level: "info",
    message,
    details: payload,
  }).then(() => refreshDebugLogPanel());
}

function logPopupError(message: string, error: unknown, details?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    error,
    errorString: toDebugString(error),
  };

  if (details) {
    Object.assign(payload, details);
  }

  console.error("[Figma Capture][Popup]", message, {
    ...payload,
  });
  void appendDebugLog({
    timestamp: new Date().toISOString(),
    source: "popup",
    level: "error",
    message,
    details: payload,
  }).then(() => refreshDebugLogPanel());
}

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
    return `${fallbackMessage} (${toDebugString(error) || "Unknown error"})`;
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

function getScriptExecutionHint(tabUrl?: string): string {
  if (!tabUrl) {
    return "Chrome refused to run scripts in this tab.";
  }

  try {
    const url = new URL(tabUrl);
    return `Chrome refused to run scripts in ${url.origin}. Check the extension's site access for this site, then reload the tab.`;
  } catch {
    return "Chrome refused to run scripts in this tab. Check the extension's site access, then reload the tab.";
  }
}

function getSiteAccessGuidance(tabUrl?: string): string {
  const origin = (() => {
    try {
      return tabUrl ? new URL(tabUrl).origin : "this site";
    } catch {
      return "this site";
    }
  })();

  const hostname = origin.includes("http") ? new URL(origin).hostname : "this site";

  return `Chrome is blocking this extension on ${origin}. In Chrome, right-click the extension icon → This can read and change site data → choose On ${hostname} or On all sites, then reload the tab. If it still does not work in the current browser, please try the same page in normal Chrome.`;
}

function isScriptExecutionBlockedMessage(message?: string): boolean {
  return typeof message === "string"
    && message.includes("Chrome refused to run scripts");
}

async function runExecutionDiagnostic(
  tab: chrome.tabs.Tab,
  world: "ISOLATED" | "MAIN",
): Promise<ScriptExecutionDiagnostic> {
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world,
    func: (diagnosticWorld: "ISOLATED" | "MAIN") => ({
      ok: true,
      world: diagnosticWorld,
      href: globalThis.location.href,
      readyState: document.readyState,
      hasDocumentElement: Boolean(document.documentElement),
    }),
    args: [world],
  }).catch((error) => [{
    result: {
      ok: false,
      world,
      error: toDebugString(error),
    },
  }]);

  return result?.result ?? {
    ok: false,
    world,
    error: "No diagnostic result returned.",
  };
}

async function ensureVendorLoadedInPage(tab: chrome.tabs.Tab): Promise<VendorLoadResult> {
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  const isolatedDiagnostic = await runExecutionDiagnostic(tab, "ISOLATED");
  const mainDiagnostic = await runExecutionDiagnostic(tab, "MAIN");

  logPopupDebug("executeScript preflight diagnostics", {
    tabId: tab.id,
    tabUrl: tab.url,
    isolatedDiagnostic,
    mainDiagnostic,
  });

  if (!isolatedDiagnostic.ok) {
    throw new Error(
      `${getScriptExecutionHint(tab.url)} (${isolatedDiagnostic.error ?? "Unknown error"})`,
    );
  }

  const vendorScriptUrl = chrome.runtime.getURL("vendor/capture.js");
  const [appendResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (scriptUrl: string, captureGlobal: string): VendorAppendResult => {
      try {
        const existingCaptureApi = (globalThis as Record<string, unknown>)[captureGlobal] as {
          captureForDesign?: unknown;
        } | undefined;

        if (existingCaptureApi?.captureForDesign) {
          return {
            appended: true,
            alreadyPresent: true,
            href: globalThis.location.href,
            readyState: document.readyState,
          };
        }

        const selector = 'script[data-figma-capture-vendor="true"]';
        const existingScript = document.querySelector<HTMLScriptElement>(selector);
        if (existingScript) {
          return {
            appended: true,
            alreadyPresent: true,
            href: globalThis.location.href,
            readyState: document.readyState,
          };
        }

        const script = document.createElement("script");
        script.src = scriptUrl;
        script.async = false;
        script.dataset.figmaCaptureVendor = "true";
        (document.head ?? document.documentElement).appendChild(script);

        return {
          appended: true,
          alreadyPresent: false,
          href: globalThis.location.href,
          readyState: document.readyState,
        };
      } catch (error) {
        return {
          appended: false,
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          href: globalThis.location.href,
          readyState: document.readyState,
        };
      }
    },
    args: [vendorScriptUrl, CAPTURE_GLOBAL],
  }).catch((error) => {
    throw new Error(`Direct vendor append execution failed: ${toDebugString(error)}`);
  });

  logPopupDebug("Direct vendor append result", {
    tabId: tab.id,
    tabUrl: tab.url,
    appendResult: appendResult?.result,
  });

  if (!appendResult?.result?.appended) {
    throw new Error(appendResult?.result?.error ?? "Direct vendor append returned no result.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: async (captureGlobal: string): Promise<VendorLoadResult> => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const captureApi = (globalThis as Record<string, unknown>)[captureGlobal] as {
          captureForDesign?: unknown;
        } | undefined;

        if (captureApi?.captureForDesign) {
          return {
            loaded: true,
            alreadyPresent: attempt > 0,
            fromTopFrame: globalThis.top === globalThis.window,
            href: globalThis.location.href,
            readyState: document.readyState,
          };
        }

        await new Promise((resolve) => globalThis.setTimeout(resolve, 125));
      }

      return {
        loaded: false,
        error: `Timed out waiting for ${captureGlobal}.captureForDesign in page context`,
        fromTopFrame: globalThis.top === globalThis.window,
        href: globalThis.location.href,
        readyState: document.readyState,
      };
    },
    args: [CAPTURE_GLOBAL],
  }).catch((error) => {
    throw new Error(`Direct vendor probe failed: ${toDebugString(error)}`);
  });

  return result?.result ?? {
    loaded: false,
    error: "Vendor probe returned no result.",
  };
}

async function directPrepareFallback(tab: chrome.tabs.Tab): Promise<CaptureStartResponse> {
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  const vendorLoadResult = await ensureVendorLoadedInPage(tab);

  logPopupDebug("Direct prepare vendor load result", {
    tabId: tab.id,
    tabUrl: tab.url,
    vendorLoadResult,
  });

  if (!vendorLoadResult.loaded) {
    throw new Error(vendorLoadResult.error ?? "Direct prepare vendor injection failed.");
  }

  const results = await chrome.scripting.executeScript({
    target: {
      tabId: tab.id,
    },
    world: "MAIN",
    func: (captureGlobal: string) => {
      const captureApi = (globalThis as Record<string, unknown>)[captureGlobal] as {
        captureForDesign?: unknown;
      } | undefined;

      return {
        href: globalThis.location.href,
        isTopFrame: globalThis.top === globalThis.window,
        readyState: document.readyState,
        captureGlobalPresent: Boolean(captureApi?.captureForDesign),
      };
    },
    args: [CAPTURE_GLOBAL],
  }).catch((error) => {
    throw new Error(`Direct prepare probe failed: ${toDebugString(error)}`);
  });

  const frameResults = results.map((result) => result.result).filter(Boolean);
  logPopupDebug("Direct prepare fallback diagnostics", {
    tabId: tab.id,
    tabUrl: tab.url,
    frameResults,
  });

  if (frameResults.some((result) => result?.captureGlobalPresent)) {
    return { accepted: true };
  }

  return {
    accepted: false,
    error: `Direct prepare fallback could not find ${CAPTURE_GLOBAL}.captureForDesign`,
  };
}

async function directCaptureFallback(
  tab: chrome.tabs.Tab,
  payload: CaptureMessage,
): Promise<CaptureStartResponse> {
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  const vendorLoadResult = await ensureVendorLoadedInPage(tab);

  logPopupDebug("Direct capture vendor load result", {
    tabId: tab.id,
    tabUrl: tab.url,
    vendorLoadResult,
  });

  if (!vendorLoadResult.loaded) {
    throw new Error(vendorLoadResult.error ?? "Direct capture vendor injection failed.");
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: (captureGlobal: string, captureId: string, endpoint: string) => {
      const captureApi = (globalThis as Record<string, unknown>)[captureGlobal] as {
        captureForDesign?: (args: {
          captureId: string;
          endpoint: string;
          selector: string;
        }) => Promise<unknown>;
      } | undefined;

      const baseResult = {
        href: globalThis.location.href,
        isTopFrame: globalThis.top === globalThis.window,
        readyState: document.readyState,
        captureGlobalPresent: Boolean(captureApi?.captureForDesign),
      };

      if (!captureApi?.captureForDesign) {
        return {
          accepted: false,
          error: `${captureGlobal}.captureForDesign is unavailable`,
          ...baseResult,
        };
      }

      void captureApi.captureForDesign({
        captureId,
        endpoint,
        selector: "body",
      }).catch((error) => {
        console.error("[Figma Capture][DirectFallback] Capture failed", error);
      });

      return {
        accepted: true,
        ...baseResult,
      };
    },
    args: [CAPTURE_GLOBAL, payload.captureId, payload.endpoint],
  }).catch((error) => {
    throw new Error(`Direct capture invocation failed: ${toDebugString(error)}`);
  });

  logPopupDebug("Direct capture fallback result", {
    tabId: tab.id,
    tabUrl: tab.url,
    result: result?.result,
  });

  return result?.result ?? {
    accepted: false,
    error: "Direct capture fallback returned no result.",
  };
}

async function fallbackWithoutListener(
  tab: chrome.tabs.Tab,
  payload: PopupExtensionMessage,
): Promise<CaptureStartResponse> {
  logPopupDebug("Falling back to direct executeScript invocation", {
    payloadType: payload.type,
    tabId: tab.id,
    tabUrl: tab.url,
  });

  if (payload.type === "FIGMA_CAPTURE_PREPARE") {
    return await directPrepareFallback(tab);
  }

  return await directCaptureFallback(tab, payload);
}

async function sendExtensionMessage(
  tab: chrome.tabs.Tab,
  payload: PopupExtensionMessage,
): Promise<CaptureStartResponse> {
  if (!tab.id) {
    throw new Error("No active tab found.");
  }

  try {
    logPopupDebug("Sending message to tab", {
      payloadType: payload.type,
      tabId: tab.id,
      tabUrl: tab.url,
    });
    return await chrome.tabs.sendMessage(tab.id, payload) as CaptureStartResponse;
  } catch (error) {
    if (!isRetryableConnectionError(error)) {
      logPopupError("Message to content script failed without retry", error, {
        payloadType: payload.type,
        tabId: tab.id,
        tabUrl: tab.url,
      });
      throw error;
    }

    logPopupError("Initial message failed, attempting content-script reinjection", error, {
      payloadType: payload.type,
      tabId: tab.id,
      tabUrl: tab.url,
    });

    let reinjectionError: unknown;

    try {
      await chrome.scripting.executeScript({
        target: {
          tabId: tab.id,
          allFrames: true,
        },
        files: ["content.js"],
      });
    } catch (error_) {
      logPopupError("Content-script reinjection failed", error_, {
        payloadType: payload.type,
        tabId: tab.id,
        tabUrl: tab.url,
      });
      reinjectionError = error_;
    }

    logPopupDebug("Retrying message after reinjection", {
      payloadType: payload.type,
      tabId: tab.id,
      tabUrl: tab.url,
    });

    try {
      return await chrome.tabs.sendMessage(tab.id, payload) as CaptureStartResponse;
    } catch (retryError) {
      logPopupError("Retry after reinjection failed", retryError, {
        payloadType: payload.type,
        tabId: tab.id,
        tabUrl: tab.url,
        hadInjectionError: reinjectionError !== undefined,
      });

      let directFallbackErrorMessage: string | null = null;
      const directFallbackResult = await fallbackWithoutListener(tab, payload).catch((directFallbackError) => {
        directFallbackErrorMessage = toDebugString(directFallbackError);
        logPopupError("Direct executeScript fallback failed", directFallbackError, {
          payloadType: payload.type,
          tabId: tab.id,
          tabUrl: tab.url,
        });
        return null;
      });

      if (directFallbackResult) {
        return directFallbackResult;
      }

      if (reinjectionError !== undefined) {
        throw new Error(
          `${describeScriptInjectionError(reinjectionError, tab.url)} (retry failed: ${toDebugString(retryError)}${directFallbackErrorMessage ? `; direct fallback failed: ${directFallbackErrorMessage}` : ""})`,
        );
      }

      if (directFallbackErrorMessage) {
        throw new Error(`Direct executeScript fallback failed: ${directFallbackErrorMessage}`);
      }

      throw retryError;
    }
  }
}

async function prepareCapture(tab: chrome.tabs.Tab): Promise<void> {
  const response = await sendExtensionMessage(tab, {
    type: "FIGMA_CAPTURE_PREPARE",
  });

  if (isCaptureApiUnavailableError(response?.error)) {
    logPopupDebug("Prepare reported missing capture API; direct prepare fallback will be used on demand", {
      tabId: tab.id,
      tabUrl: tab.url,
      response,
    });
    return;
  }

  if (!response?.accepted) {
    throw new Error(response?.error ?? getUnsupportedPageMessage(tab.url));
  }
}

function normalizeUserFacingError(error: unknown, tabUrl?: string): string {
  if (!(error instanceof Error)) {
    return typeof error === "string" ? error : getUnsupportedPageMessage(tabUrl);
  }

  if (isScriptExecutionBlockedMessage(error.message)) {
    return getSiteAccessGuidance(tabUrl);
  }

  return error.message;
}

async function triggerCapture(
  tab: chrome.tabs.Tab,
  config: CaptureArgs,
): Promise<CaptureStartResponse> {
  const response = await sendExtensionMessage(tab, {
    type: "FIGMA_CAPTURE",
    captureId: config.captureId,
    endpoint: config.endpoint,
  });

  if (isCaptureApiUnavailableError(response?.error)) {
    logPopupDebug("Content listener reported missing capture API; switching to direct capture fallback", {
      tabId: tab.id,
      tabUrl: tab.url,
      response,
    });

    return await directCaptureFallback(tab, {
      type: "FIGMA_CAPTURE",
      captureId: config.captureId,
      endpoint: config.endpoint,
    });
  }

  return response;
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
  const copyDebugBtn = document.getElementById(
    "btn-copy-debug",
  ) as HTMLButtonElement;
  const clearDebugBtn = document.getElementById(
    "btn-clear-debug",
  ) as HTMLButtonElement;
  const statusEl = document.getElementById("status") as HTMLElement;
  debugLogEl = document.getElementById("debug-log");

  await refreshDebugLogPanel();

  const config = await loadConfig();
  captureIdInput.value = config.captureId;
  endpointInput.value = config.endpoint;

  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  logPopupDebug("Popup initialized", {
    activeTabId: activeTab?.id,
    activeTabUrl: activeTab?.url,
  });

  if (activeTab?.id) {
    try {
      await prepareCapture(activeTab);
    } catch (err) {
      logPopupError("Prepare capture failed", err, {
        activeTabId: activeTab.id,
        activeTabUrl: activeTab.url,
      });
      const message = normalizeUserFacingError(err, activeTab.url);
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

  clearDebugBtn.addEventListener("click", () => {
    void (async () => {
      await clearDebugLogs();
      await refreshDebugLogPanel();
      logPopupDebug("Debug logs cleared");
    })();
  });

  copyDebugBtn.addEventListener("click", () => {
    void (async () => {
      const entries = await readDebugLogs();
      const formattedLogs = formatDebugLogs(entries);

      try {
        await navigator.clipboard.writeText(formattedLogs);
        logPopupDebug("Debug logs copied to clipboard", {
          entryCount: entries.length,
        });
        showStatus(statusEl, "Debug log copied.", "success");
      } catch (error) {
        logPopupError("Copying debug logs failed", error, {
          entryCount: entries.length,
        });
        showStatus(statusEl, "Could not copy debug log.", "error");
      }
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

      logPopupDebug("Starting capture", {
        tabId: tab.id,
        tabUrl: tab.url,
        hasCaptureId: draftConfig.captureId.length > 0,
        hasEndpoint: draftConfig.endpoint.length > 0,
      });

      captureBtn.disabled = true;
      captureBtnLabel.textContent = "Starting capture…";
      hideStatus(statusEl);

      try {
        await saveConfig(draftConfig);

        const response = await triggerCapture(tab, draftConfig);

        if (!response?.accepted) {
          logPopupDebug("Capture request rejected", {
            tabId: tab.id,
            tabUrl: tab.url,
            response,
          });
          showStatus(
            statusEl,
            response?.error ?? "Capture failed.",
            "error",
          );
          return;
        }

        globalThis.close();
      } catch (err) {
        logPopupError("Capture request failed", err, {
          tabId: tab.id,
          tabUrl: tab.url,
        });
        const message = normalizeUserFacingError(err, tab.url);
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
