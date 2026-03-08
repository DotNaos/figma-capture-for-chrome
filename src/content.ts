type CaptureMessage = {
  type: "FIGMA_CAPTURE";
  captureId: string;
  endpoint: string;
};

type CaptureResponse = {
  success: boolean;
  error?: string;
};

type InjectedMessage = {
  type: "FIGMA_CAPTURE_RESULT";
  success: boolean;
  error?: string;
};

function parseHashConfig(): { captureId: string; endpoint: string } {
  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  const params = new URLSearchParams(hash);
  return {
    captureId: params.get("figmacapture") ?? "",
    endpoint: params.get("figmaendpoint") ?? "",
  };
}

function injectScript(): void {
  const existing = document.getElementById("figma-capture-injected");
  if (existing) return;

  const script = document.createElement("script");
  script.id = "figma-capture-injected";
  script.src = chrome.runtime.getURL("injected.js");
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();
}

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: CaptureResponse) => void,
  ) => {
    const message = rawMessage as CaptureMessage;
    if (message.type !== "FIGMA_CAPTURE") return false;

    injectScript();

    const hashConfig = parseHashConfig();
    const resolvedCaptureId =
      hashConfig.captureId || message.captureId;
    const resolvedEndpoint =
      hashConfig.endpoint || message.endpoint;

    const onResult = (event: MessageEvent<unknown>): void => {
      const data = event.data as InjectedMessage;
      if (data?.type !== "FIGMA_CAPTURE_RESULT") return;
      window.removeEventListener("message", onResult);
      sendResponse({ success: data.success, error: data.error });
    };

    window.addEventListener("message", onResult);

    window.postMessage(
      {
        type: "FIGMA_CAPTURE_REQUEST",
        captureId: resolvedCaptureId,
        endpoint: resolvedEndpoint,
      },
      "*",
    );

    return true;
  },
);
