const BASE_URL = import.meta.env.BASE_URL;
const APP_BASE_URL = new URL(BASE_URL, self.location.origin);
const NIM_RUNTIME_MANIFEST = new URL(
  "nim/vrm2pmx_nim_manifest.json",
  APP_BASE_URL,
);

export type NimRuntimeAvailability = {
  available: boolean;
  manifestUrl: string;
  reason?: string;
  manifest?: NimRuntimeManifest;
};

export type NimRuntimeManifest = {
  name: string;
  version: string;
  status: string;
  entryJs: string;
  entryWasm: string;
  capabilities: string[];
  notes?: string[];
};

let nimAvailabilityPromise: Promise<NimRuntimeAvailability> | null = null;

export function resolveNimAssetUrl(relativePath: string): string {
  return new URL(relativePath, APP_BASE_URL).toString();
}

function isNimRuntimeManifest(value: unknown): value is NimRuntimeManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const manifest = value as Record<string, unknown>;
  return (
    typeof manifest.name === "string" &&
    typeof manifest.version === "string" &&
    typeof manifest.status === "string" &&
    typeof manifest.entryJs === "string" &&
    typeof manifest.entryWasm === "string" &&
    Array.isArray(manifest.capabilities)
  );
}

export async function getNimRuntimeAvailability(): Promise<NimRuntimeAvailability> {
  if (nimAvailabilityPromise) {
    return nimAvailabilityPromise;
  }

  nimAvailabilityPromise = (async () => {
    const response = await fetch(NIM_RUNTIME_MANIFEST.toString());
    if (!response.ok) {
      return {
        available: false,
        manifestUrl: NIM_RUNTIME_MANIFEST.toString(),
        reason: `Nim runtime manifest was not found at ${NIM_RUNTIME_MANIFEST.toString()}`,
      };
    }

    const rawManifest = (await response.json()) as unknown;
    if (!isNimRuntimeManifest(rawManifest)) {
      return {
        available: false,
        manifestUrl: NIM_RUNTIME_MANIFEST.toString(),
        reason: `Nim runtime manifest is invalid at ${NIM_RUNTIME_MANIFEST.toString()}`,
      };
    }

    return {
      available: true,
      manifestUrl: NIM_RUNTIME_MANIFEST.toString(),
      manifest: rawManifest,
    };
  })();

  return nimAvailabilityPromise;
}
