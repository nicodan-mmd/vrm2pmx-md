import * as THREE from "three";

export function computePmxLightPreset(root: THREE.Object3D): {
  ambientIntensity: number;
  directionalIntensity: number;
  avgLuminance: number;
  brightMaterialRatio: number;
} {
  let totalLuminance = 0;
  let materialCount = 0;
  let brightMaterialCount = 0;

  root.traverse((node) => {
    const maybeMesh = node as THREE.Mesh;
    if (!maybeMesh.isMesh || !maybeMesh.material) {
      return;
    }

    const materials = Array.isArray(maybeMesh.material)
      ? maybeMesh.material
      : [maybeMesh.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      const mat = material as THREE.Material & { color?: THREE.Color };
      if (!mat.color) {
        continue;
      }

      const luminance =
        mat.color.r * 0.2126 + mat.color.g * 0.7152 + mat.color.b * 0.0722;
      totalLuminance += luminance;
      if (luminance >= 0.72) {
        brightMaterialCount += 1;
      }
      materialCount += 1;
    }
  });

  if (materialCount === 0) {
    return {
      ambientIntensity: 0.62,
      directionalIntensity: 0.86,
      avgLuminance: 0,
      brightMaterialRatio: 0,
    };
  }

  const avgLuminance = totalLuminance / materialCount;
  const brightMaterialRatio = brightMaterialCount / materialCount;

  let directionalIntensity = 0.88;
  let ambientIntensity = 0.64;

  if (avgLuminance >= 0.7) {
    directionalIntensity = 0.76;
    ambientIntensity = 0.54;
  } else if (avgLuminance >= 0.62) {
    directionalIntensity = 0.82;
    ambientIntensity = 0.58;
  } else if (avgLuminance >= 0.52) {
    directionalIntensity = 0.9;
    ambientIntensity = 0.64;
  } else if (avgLuminance < 0.3) {
    directionalIntensity = 1.04;
    ambientIntensity = 0.68;
  } else {
    directionalIntensity = 0.98;
    ambientIntensity = 0.66;
  }

  if (brightMaterialRatio > 0.35) {
    directionalIntensity -= 0.06;
    ambientIntensity -= 0.04;
  }

  directionalIntensity = THREE.MathUtils.clamp(directionalIntensity, 0.35, 1.6);
  ambientIntensity = THREE.MathUtils.clamp(ambientIntensity, 0.18, 1.0);

  return {
    ambientIntensity,
    directionalIntensity,
    avgLuminance,
    brightMaterialRatio,
  };
}

export function applyPmxLightTuning(
  baseAmbient: number,
  baseDirectional: number,
  brightnessScale: number,
  contrastFactor: number,
): { ambientIntensity: number; directionalIntensity: number } {
  const safeContrast = Math.max(0.5, contrastFactor);
  const ambientContrast = Math.pow(safeContrast, 1.7);
  const directionalIntensity = THREE.MathUtils.clamp(
    baseDirectional * brightnessScale * safeContrast,
    0.3,
    2.1,
  );
  const ambientIntensity = THREE.MathUtils.clamp(
    (baseAmbient * brightnessScale) / ambientContrast,
    0.05,
    1.3,
  );
  return { ambientIntensity, directionalIntensity };
}
