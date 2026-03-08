type CaptureConfig = {
  captureId: string;
  endpoint: string;
};

const STORAGE_KEY = "figma_capture_config";

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
  el.className = `status ${type}`;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 3000);
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
  const saveBtn = document.getElementById("btn-save") as HTMLButtonElement;
  const statusEl = document.getElementById("status") as HTMLElement;

  const config = await loadConfig();
  captureIdInput.value = config.captureId;
  endpointInput.value = config.endpoint;

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
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        showStatus(statusEl, "No active tab found.", "error");
        return;
      }

      captureBtn.disabled = true;
      captureBtn.textContent = "Capturing…";
      statusEl.hidden = true;

      try {
        type CaptureResponse = { success: boolean; error?: string };
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: "FIGMA_CAPTURE",
          captureId: captureIdInput.value.trim(),
          endpoint: endpointInput.value.trim(),
        }) as CaptureResponse;

        if (response?.success) {
          showStatus(statusEl, "Capture complete.", "success");
        } else {
          showStatus(
            statusEl,
            response?.error ?? "Capture failed.",
            "error",
          );
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Capture failed.";
        showStatus(statusEl, message, "error");
      } finally {
        captureBtn.disabled = false;
        captureBtn.textContent = "Capture current tab";
      }
    })();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
