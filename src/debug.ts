export type DebugLogLevel = "info" | "error";

export type DebugLogEntry = {
  timestamp: string;
  source: "popup" | "content" | "loader";
  level: DebugLogLevel;
  message: string;
  details?: Record<string, unknown>;
};

const DEBUG_LOGS_KEY = "figma_capture_debug_logs";
const MAX_DEBUG_LOGS = 80;

export function toDebugString(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export async function appendDebugLog(entry: DebugLogEntry): Promise<void> {
  try {
    const result = await chrome.storage.local.get(DEBUG_LOGS_KEY);
    const existing = Array.isArray(result[DEBUG_LOGS_KEY])
      ? result[DEBUG_LOGS_KEY] as DebugLogEntry[]
      : [];

    const next = [...existing, entry].slice(-MAX_DEBUG_LOGS);
    await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: next });
  } catch (error) {
    console.warn("[Figma Capture][Debug] Failed to persist debug log", error);
  }
}

export async function readDebugLogs(): Promise<DebugLogEntry[]> {
  const result = await chrome.storage.local.get(DEBUG_LOGS_KEY);
  return Array.isArray(result[DEBUG_LOGS_KEY])
    ? result[DEBUG_LOGS_KEY] as DebugLogEntry[]
    : [];
}

export async function clearDebugLogs(): Promise<void> {
  await chrome.storage.local.set({ [DEBUG_LOGS_KEY]: [] });
}

export function formatDebugLogs(entries: DebugLogEntry[]): string {
  if (entries.length === 0) {
    return "No debug entries yet.";
  }

  return entries.map((entry) => {
    const head = `[${entry.timestamp}] ${entry.source.toUpperCase()} ${entry.level.toUpperCase()} ${entry.message}`;
    const details = entry.details && Object.keys(entry.details).length > 0
      ? `\n${JSON.stringify(entry.details, null, 2)}`
      : "";

    return `${head}${details}`;
  }).join("\n\n");
}
