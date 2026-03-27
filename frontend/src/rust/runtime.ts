const BASE_URL = import.meta.env.BASE_URL;
const APP_BASE_URL = new URL(BASE_URL, self.location.origin);
const RUST_RUNTIME_MANIFEST = new URL("rust/vrm2pmx_rust_manifest.json", APP_BASE_URL);

export type RustRuntimeAvailability = {
  available: boolean;
  manifestUrl: string;
  reason?: string;
  manifest?: RustRuntimeManifest;
};

export type RustRuntimeManifest = {
  name: string;
  version: string;
  status: string;
  entryJs: string;
  entryWasm: string;
  capabilities: string[];
  notes?: string[];
};

let rustAvailabilityPromise: Promise<RustRuntimeAvailability> | null = null;

export function resolveRustAssetUrl(relativePath: string): string {
  return new URL(relativePath, APP_BASE_URL).toString();
}

function isRustRuntimeManifest(value: unknown): value is RustRuntimeManifest {
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

export async function getRustRuntimeAvailability(): Promise<RustRuntimeAvailability> {
  if (rustAvailabilityPromise) {
    return rustAvailabilityPromise;
  }

  rustAvailabilityPromise = (async () => {
    const response = await fetch(RUST_RUNTIME_MANIFEST.toString());
    if (!response.ok) {
      return {
        available: false,
        manifestUrl: RUST_RUNTIME_MANIFEST.toString(),
        reason: `Rust runtime manifest was not found at ${RUST_RUNTIME_MANIFEST.toString()}`,
      };
    }

    const rawManifest = (await response.json()) as unknown;
    if (!isRustRuntimeManifest(rawManifest)) {
      return {
        available: false,
        manifestUrl: RUST_RUNTIME_MANIFEST.toString(),
        reason: `Rust runtime manifest is invalid at ${RUST_RUNTIME_MANIFEST.toString()}`,
      };
    }

    const manifest = rawManifest;
    return {
      available: true,
      manifestUrl: RUST_RUNTIME_MANIFEST.toString(),
      manifest,
    };
  })();

  return rustAvailabilityPromise;
}