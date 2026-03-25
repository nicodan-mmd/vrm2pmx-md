export type ProfileDetectionResult = {
  profile: "generic" | "vroid";
  reason: string;
  hasVrm0Extension: boolean;
  hasVrm1Extension: boolean;
  hasSpringExtension: boolean;
  generator: string;
};

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function detectProfileFromJson(
  jsonData: Record<string, unknown> | null,
  sourcePath = "",
): ProfileDetectionResult {
  const data = asRecord(jsonData);
  const extensions = asRecord(data.extensions);
  const asset = asRecord(data.asset);

  const hasVrm0 = "VRM" in extensions;
  const hasVrm1 = "VRMC_vrm" in extensions;
  const hasSpring = "VRMC_springBone" in extensions;
  const generator = typeof asset.generator === "string" ? asset.generator : "";

  const normalizedPath = sourcePath.toLowerCase();
  const normalizedGenerator = generator.toLowerCase();
  const isVroidHint =
    normalizedPath.includes("vroid") || normalizedGenerator.includes("vroid");

  if (isVroidHint && (hasVrm0 || hasVrm1)) {
    return {
      profile: "vroid",
      reason: "vroid hint detected in file name/generator",
      hasVrm0Extension: hasVrm0,
      hasVrm1Extension: hasVrm1,
      hasSpringExtension: hasSpring,
      generator,
    };
  }

  if (hasVrm1) {
    return {
      profile: "generic",
      reason: "VRMC_vrm extension detected",
      hasVrm0Extension: hasVrm0,
      hasVrm1Extension: hasVrm1,
      hasSpringExtension: hasSpring,
      generator,
    };
  }

  if (hasVrm0) {
    return {
      profile: "generic",
      reason: "VRM extension detected",
      hasVrm0Extension: hasVrm0,
      hasVrm1Extension: hasVrm1,
      hasSpringExtension: hasSpring,
      generator,
    };
  }

  return {
    profile: "generic",
    reason: "unknown metadata, fallback to generic",
    hasVrm0Extension: hasVrm0,
    hasVrm1Extension: hasVrm1,
    hasSpringExtension: hasSpring,
    generator,
  };
}

function parseGlbJson(buffer: ArrayBuffer): Record<string, unknown> | null {
  if (buffer.byteLength < 20) {
    return null;
  }

  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    offset += 8;

    if (offset + chunkLength > buffer.byteLength) {
      return null;
    }

    if (chunkType === JSON_CHUNK_TYPE) {
      const chunk = new Uint8Array(buffer, offset, chunkLength);
      const jsonText = new TextDecoder().decode(chunk).replace(/\u0000+$/u, "");
      const parsed = JSON.parse(jsonText) as unknown;
      return asRecord(parsed);
    }

    offset += chunkLength;
  }

  return null;
}

export async function detectProfileFromFile(
  file: File,
): Promise<ProfileDetectionResult | null> {
  try {
    const buffer = await file.arrayBuffer();
    const jsonData = parseGlbJson(buffer);
    if (!jsonData) {
      return null;
    }

    return detectProfileFromJson(jsonData, file.name);
  } catch {
    return null;
  }
}
