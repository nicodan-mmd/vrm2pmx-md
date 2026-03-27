export type RuntimeLogLevel = "debug" | "info" | "warn" | "error" | "silent";
export type ConsoleLogLevel = "log" | "info" | "warn" | "error" | "debug";

const LOG_SEVERITY: Record<Exclude<RuntimeLogLevel, "silent">, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizeRuntimeLogLevel(rawLevel: string | undefined): RuntimeLogLevel | null {
  if (!rawLevel) {
    return null;
  }

  const normalized = rawLevel.trim().toLowerCase();
  if (
    normalized === "debug"
    || normalized === "info"
    || normalized === "warn"
    || normalized === "error"
    || normalized === "silent"
  ) {
    return normalized;
  }

  return null;
}

export function getRuntimeLogLevel(): RuntimeLogLevel {
  const envLevel = normalizeRuntimeLogLevel(import.meta.env.VITE_LOG_LEVEL as string | undefined);
  if (envLevel) {
    return envLevel;
  }

  return import.meta.env.DEV ? "debug" : "warn";
}

export function toRuntimeLogLevel(level: ConsoleLogLevel): Exclude<RuntimeLogLevel, "silent"> {
  return level === "log" ? "info" : level;
}

export function shouldCaptureLog(
  level: ConsoleLogLevel | Exclude<RuntimeLogLevel, "silent">,
  threshold: RuntimeLogLevel,
): boolean {
  if (threshold === "silent") {
    return false;
  }

  const runtimeLevel = level === "log" ? "info" : level;
  return LOG_SEVERITY[runtimeLevel] >= LOG_SEVERITY[threshold];
}