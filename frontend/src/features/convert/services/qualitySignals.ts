import * as Sentry from "@sentry/react";
import type { ConvertMode } from "../../../services/convertClient";

type ScopeWithAttachment = Sentry.Scope & {
  addAttachment?: (attachment: {
    filename: string;
    data: string | Uint8Array;
    contentType?: string;
  }) => void;
};

export type QualitySignalSource = "fallback" | "auto_detected" | "user_reported";
export type QualitySignalLevel = "warning" | "info";

export type QualitySignalReportInput = {
  source: QualitySignalSource;
  signals: string[];
  level: QualitySignalLevel;
  requestedMode: ConvertMode;
  usedMode: ConvertMode | null;
  backendEnabled: boolean;
  fileExtension?: "zip" | "pmx";
  dialogEnabled?: boolean;
  status: string;
  result: string;
  conversionReportId: string;
  previewSnapshots?: {
    vrmDataUrl?: string;
    pmxDataUrl?: string;
    width: number;
    height: number;
  };
  pmxPreviewDiagnostics?: {
    zipEntryCount: number;
    zipFileCount: number;
    zipTextureFileCount: number;
    zipTextureSamples: string[];
    zipPmxEntries: string[];
    selectedPmxPath: string;
    assetKeyCount: number;
    materialCount: number;
    materialSlotCount: number;
    colorTextureCount: number;
    loadedColorTextureCount: number;
    pendingColorTextureCount: number;
    textureCoverage: number;
    loadedTextureCoverage: number;
    materialRenderStats: {
      frontSideCount: number;
      doubleSideCount: number;
      backSideCount: number;
      transparentCount: number;
      alphaTestMaterialCount: number;
      hasAlphaMapCount: number;
      mapTransparentCount: number;
      depthWriteOffCount: number;
      depthTestOffCount: number;
    };
    materialRenderSamples: string[];
    materialRenderDiagnostics: Array<{
      name: string;
      meshName: string;
      meshRenderOrder: number;
      side: string;
      transparent: boolean;
      alphaTest: number;
      depthWrite: boolean;
      depthTest: boolean;
      opacity: number;
      hasMap: boolean;
      mapTransparent: boolean;
      hasAlphaMap: boolean;
    }>;
  };
};

export function detectQualityRiskSignals(logLines: string[]): string[] {
  const merged = logLines.join("\n").toLowerCase();
  const signals: string[] = [];

  if (/\bdeprecated\b/.test(merged)) {
    signals.push("deprecated-runtime-message");
  }
  if (/not a property of three\.meshtoonmaterial/.test(merged)) {
    signals.push("meshtoonmaterial-unsupported-property");
  }
  if (/\b(nan|infinity)\b/.test(merged)) {
    signals.push("invalid-numeric-value");
  }
  if (/\b(skipped|skip|unsupported|missing|not found)\b/.test(merged)) {
    signals.push("partial-conversion-hint");
  }

  return [...new Set(signals)];
}

function normalizeQualitySignalCode(signal: string): string {
  const normalized = signal
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

  return normalized || "UNKNOWN_SIGNAL";
}

export function createConversionReportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `convert-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function decodeBase64ToBytes(base64Value: string): Uint8Array {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function addPreviewAttachment(
  scope: ScopeWithAttachment,
  dataUrl: string,
  filenameBase: string,
): boolean {
  if (typeof scope.addAttachment !== "function") {
    return false;
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return false;
  }

  const contentType = match[1] || "image/jpeg";
  const payload = match[2] || "";
  if (!payload) {
    return false;
  }

  try {
    const bytes = decodeBase64ToBytes(payload);
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    scope.addAttachment({
      filename: `${filenameBase}.${ext}`,
      data: bytes,
      contentType,
    });
    return true;
  } catch {
    return false;
  }
}

export function reportQualitySignals({
  source,
  signals,
  level,
  requestedMode,
  usedMode,
  backendEnabled,
  fileExtension,
  dialogEnabled = false,
  status,
  result,
  conversionReportId,
  previewSnapshots,
  pmxPreviewDiagnostics,
}: QualitySignalReportInput): boolean {
  const normalizedSignals = [...new Set(signals.map(normalizeQualitySignalCode))];
  let firstEventId: string | undefined;

  if (normalizedSignals.length === 0) {
    return false;
  }

  normalizedSignals.forEach((signalCode, index) => {
    Sentry.withScope((scope) => {
      const attachableScope = scope as ScopeWithAttachment;
      scope.setLevel(level);
      scope.setTag("mode", requestedMode);
      scope.setTag("event_type", "quality_signal");
      scope.setTag("signal_source", source);
      scope.setTag("signal_code", signalCode);
      scope.setTag("signal_count", String(normalizedSignals.length));
      scope.setTag("result", result);
      scope.setTag("backend_enabled", backendEnabled ? "true" : "false");
      if (usedMode) {
        scope.setTag("used_mode", usedMode);
      }
      if (fileExtension) {
        scope.setTag("file_extension", fileExtension);
      }
      scope.setContext("convert", {
        status,
        requestedMode,
        usedMode,
        backendEnabled,
        fileExtension,
        detectedSignals: normalizedSignals,
        conversionReportId,
      });

      if (previewSnapshots) {
        scope.setContext("preview_snapshot_meta", {
          width: previewSnapshots.width,
          height: previewSnapshots.height,
          hasVrm: Boolean(previewSnapshots.vrmDataUrl),
          hasPmx: Boolean(previewSnapshots.pmxDataUrl),
        });

        const base = `${conversionReportId}_${signalCode}`;
        let attachedVrm = false;
        let attachedPmx = false;

        if (previewSnapshots.vrmDataUrl) {
          attachedVrm = addPreviewAttachment(
            attachableScope,
            previewSnapshots.vrmDataUrl,
            `${base}_preview_vrm`,
          );
          if (!attachedVrm) {
            scope.setExtra("preview_vrm_data_url_prefix", previewSnapshots.vrmDataUrl.slice(0, 160));
          }
        }
        if (previewSnapshots.pmxDataUrl) {
          attachedPmx = addPreviewAttachment(
            attachableScope,
            previewSnapshots.pmxDataUrl,
            `${base}_preview_pmx`,
          );
          if (!attachedPmx) {
            scope.setExtra("preview_pmx_data_url_prefix", previewSnapshots.pmxDataUrl.slice(0, 160));
          }
        }

        scope.setTag("preview_vrm_attached", attachedVrm ? "true" : "false");
        scope.setTag("preview_pmx_attached", attachedPmx ? "true" : "false");
      }

      if (pmxPreviewDiagnostics) {
        scope.setContext("pmx_preview_diagnostics", pmxPreviewDiagnostics);
      }

      const eventId = Sentry.captureMessage(
        `convert.quality_signal.${source}.${signalCode}`,
        level,
      );

      if (index === 0) {
        firstEventId = eventId;
      }
    });
  });

  if (dialogEnabled && firstEventId) {
    // Sentry.showReportDialog は使用しない（フォームを出さない）
    void firstEventId;
  }

  return true;
}
