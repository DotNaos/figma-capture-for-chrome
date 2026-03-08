import "./vendor/capture.js";

type CaptureMessage = {
  type: "FIGMA_CAPTURE";
  captureId: string;
  endpoint: string;
};

type PrepareMessage = {
  type: "FIGMA_CAPTURE_PREPARE";
};

type ContentExtensionMessage = CaptureMessage | PrepareMessage;

type CaptureResponse = {
  accepted: boolean;
  error?: string;
};

type ContentFigmaCaptureApi = {
  captureForDesign: (args: {
    captureId: string;
    endpoint: string;
    selector: string;
  }) => Promise<unknown>;
};

type FigmaCaptureContentWindow = Window & typeof globalThis & {
  __figmaCaptureListenerRegistered__?: boolean;
  [key: string]: unknown;
};

const CAPTURE_GLOBAL = "__figmaCaptureExtension";
const figmaCaptureWindow = globalThis as FigmaCaptureContentWindow;

function parseHashConfig(): { captureId: string; endpoint: string } {
  const hash = globalThis.location.hash.startsWith("#")
    ? globalThis.location.hash.slice(1)
    : globalThis.location.hash;
  const params = new URLSearchParams(hash);
  return {
    captureId: params.get("figmacapture") ?? "",
    endpoint: params.get("figmaendpoint") ?? "",
  };
}

function getCaptureApi(): ContentFigmaCaptureApi | undefined {
  return figmaCaptureWindow[CAPTURE_GLOBAL] as ContentFigmaCaptureApi | undefined;
}

if (!figmaCaptureWindow.__figmaCaptureListenerRegistered__) {
  chrome.runtime.onMessage.addListener(
    (
      rawMessage: unknown,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: CaptureResponse) => void,
    ) => {
      const message = rawMessage as ContentExtensionMessage;
      if (
        message.type !== "FIGMA_CAPTURE"
        && message.type !== "FIGMA_CAPTURE_PREPARE"
      ) {
        return;
      }

      const api = getCaptureApi();
      if (!api?.captureForDesign) {
        sendResponse({
          accepted: false,
          error: `Vendored capture.js did not expose globalThis.${CAPTURE_GLOBAL}.captureForDesign`,
        });
        return;
      }

      if (message.type === "FIGMA_CAPTURE_PREPARE") {
        sendResponse({ accepted: true });
        return;
      }

      try {
        const hashConfig = parseHashConfig();
        const resolvedCaptureId =
          hashConfig.captureId || message.captureId;
        const resolvedEndpoint =
          hashConfig.endpoint || message.endpoint;

        void api.captureForDesign({
          captureId: resolvedCaptureId,
          endpoint: resolvedEndpoint,
          selector: "body",
        }).then(() => {
          console.info("[Figma Capture] Capture completed.");
        }).catch((error) => {
          console.error("[Figma Capture] Capture failed:", error);
        });

        sendResponse({ accepted: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        sendResponse({ accepted: false, error });
      }
    },
  );

  figmaCaptureWindow.__figmaCaptureListenerRegistered__ = true;
}
