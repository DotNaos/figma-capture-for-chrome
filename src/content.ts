import { appendDebugLog, toDebugString } from "./debug";

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

function getFrameDebugInfo(): Record<string, unknown> {
  return {
    href: globalThis.location.href,
    isTopFrame: globalThis.top === globalThis.window,
    readyState: document.readyState,
    hasBody: Boolean(document.body),
    hasDocumentElement: Boolean(document.documentElement),
  };
}

function logContentDebug(message: string, details?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    ...getFrameDebugInfo(),
  };

  if (details) {
    Object.assign(payload, details);
  }

  console.info("[Figma Capture][Content]", message, {
    ...payload,
  });
  void appendDebugLog({
    timestamp: new Date().toISOString(),
    source: "content",
    level: "info",
    message,
    details: payload,
  });
}

function logContentError(message: string, error: unknown, details?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = {
    ...getFrameDebugInfo(),
  };

  if (details) {
    Object.assign(payload, details);
  }

  console.error("[Figma Capture][Content]", message, {
    ...payload,
    error,
    errorString: toDebugString(error),
  });
  void appendDebugLog({
    timestamp: new Date().toISOString(),
    source: "content",
    level: "error",
    message,
    details: {
      ...payload,
      errorString: toDebugString(error),
    },
  });
}

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

logContentDebug("Content script loaded", {
  captureGlobalPresent: Boolean(getCaptureApi()?.captureForDesign),
});

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

      logContentDebug("Received extension message", {
        messageType: message.type,
      });

      const api = getCaptureApi();
      if (!api?.captureForDesign) {
        logContentError(
          "Capture API missing on content window",
          new Error("captureForDesign missing"),
          {
            messageType: message.type,
            captureGlobal: CAPTURE_GLOBAL,
          },
        );
        sendResponse({
          accepted: false,
          error: `Vendored capture.js did not expose globalThis.${CAPTURE_GLOBAL}.captureForDesign`,
        });
        return;
      }

      if (message.type === "FIGMA_CAPTURE_PREPARE") {
        logContentDebug("Prepare check completed", {
          messageType: message.type,
          captureGlobalPresent: Boolean(api?.captureForDesign),
        });
        logContentDebug("Prepare succeeded", {
          messageType: message.type,
        });
        sendResponse({ accepted: true });
        return;
      }

      try {
        const hashConfig = parseHashConfig();
        const resolvedCaptureId =
          hashConfig.captureId || message.captureId;
        const resolvedEndpoint =
          hashConfig.endpoint || message.endpoint;

        logContentDebug("Invoking captureForDesign", {
          messageType: message.type,
          hasCaptureId: resolvedCaptureId.length > 0,
          hasEndpoint: resolvedEndpoint.length > 0,
          selector: "body",
        });

        void api.captureForDesign({
          captureId: resolvedCaptureId,
          endpoint: resolvedEndpoint,
          selector: "body",
        }).then(() => {
          logContentDebug("Capture completed");
        }).catch((error) => {
          logContentError("Capture failed asynchronously", error);
        });

        sendResponse({ accepted: true });
      } catch (err) {
        logContentError("Capture threw synchronously", err, {
          messageType: message.type,
        });
        const error = err instanceof Error ? err.message : String(err);
        sendResponse({ accepted: false, error });
      }
    },
  );

  figmaCaptureWindow.__figmaCaptureListenerRegistered__ = true;
}
