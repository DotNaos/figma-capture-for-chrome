type FigmaCaptureApi = {
  captureForDesign: (args: {
    captureId: string;
    endpoint: string;
    selector: string;
  }) => Promise<unknown>;
};

type FigmaWindow = Window &
  typeof globalThis & {
    figma?: FigmaCaptureApi;
  };

type CaptureRequest = {
  type: "FIGMA_CAPTURE_REQUEST";
  captureId: string;
  endpoint: string;
};

const CAPTURE_SCRIPT_URL =
  "https://mcp.figma.com/mcp/html-to-design/capture.js";

function ensureCaptureScriptLoaded(): Promise<void> {
  const figmaWindow = window as FigmaWindow;
  if (figmaWindow.figma?.captureForDesign) {
    return Promise.resolve();
  }

  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-figma-capture="true"]',
  );

  if (existing) {
    return new Promise<void>((resolve) => {
      if ((window as FigmaWindow).figma?.captureForDesign) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
    });
  }

  return new Promise<void>((resolve) => {
    const script = document.createElement("script");
    script.src = CAPTURE_SCRIPT_URL;
    script.async = true;
    script.dataset.figmaCapture = "true";
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data as CaptureRequest;
  if (data?.type !== "FIGMA_CAPTURE_REQUEST") return;

  void (async () => {
    try {
      await ensureCaptureScriptLoaded();

      const figmaWindow = window as FigmaWindow;
      if (!figmaWindow.figma?.captureForDesign) {
        window.postMessage(
          {
            type: "FIGMA_CAPTURE_RESULT",
            success: false,
            error: "capture.js did not expose window.figma.captureForDesign",
          },
          "*",
        );
        return;
      }

      await figmaWindow.figma.captureForDesign({
        captureId: data.captureId,
        endpoint: data.endpoint,
        selector: "body",
      });

      window.postMessage(
        { type: "FIGMA_CAPTURE_RESULT", success: true },
        "*",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.postMessage(
        { type: "FIGMA_CAPTURE_RESULT", success: false, error: message },
        "*",
      );
    }
  })();
});
