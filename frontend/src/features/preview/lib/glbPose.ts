import * as THREE from "three";

export type GlbChunk = {
  type: number;
  data: Uint8Array;
};

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const DEBUG_POSE = false;

export function poseDebug(label: string, payload: unknown): void {
  if (!DEBUG_POSE) {
    return;
  }
  console.info(`★POSE ${label}`, payload);
}

function parseGlbChunks(buffer: ArrayBuffer): GlbChunk[] {
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new Error("Input file is not a valid GLB container.");
  }

  const chunks: GlbChunk[] = [];
  let offset = 12;

  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > buffer.byteLength) {
      throw new Error("GLB chunk is out of range.");
    }

    chunks.push({
      type: chunkType,
      data: new Uint8Array(buffer.slice(chunkStart, chunkEnd)),
    });
    offset = chunkEnd;
  }

  return chunks;
}

function buildGlbBuffer(chunks: GlbChunk[]): ArrayBuffer {
  const totalLength =
    12 + chunks.reduce((acc, chunk) => acc + 8 + chunk.data.byteLength, 0);
  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);

  let offset = 12;
  for (const chunk of chunks) {
    view.setUint32(offset, chunk.data.byteLength, true);
    view.setUint32(offset + 4, chunk.type, true);
    bytes.set(chunk.data, offset + 8);
    offset += 8 + chunk.data.byteLength;
  }

  return output;
}

function findUpperArmNodeIndices(gltfJson: Record<string, unknown>): {
  leftNodeIndex: number | null;
  rightNodeIndex: number | null;
} {
  let leftNodeIndex: number | null = null;
  let rightNodeIndex: number | null = null;
  const extensions = (gltfJson.extensions ?? {}) as Record<string, unknown>;

  const vrm0 = extensions.VRM as
    | {
        humanoid?: {
          humanBones?: Array<{ bone?: string; node?: number }>;
        };
      }
    | undefined;
  const humanBones0 = vrm0?.humanoid?.humanBones ?? [];
  for (const item of humanBones0) {
    if (item.bone === "leftUpperArm" && typeof item.node === "number") {
      leftNodeIndex = item.node;
    }
    if (item.bone === "rightUpperArm" && typeof item.node === "number") {
      rightNodeIndex = item.node;
    }
  }

  const vrm1 = extensions.VRMC_vrm as
    | {
        humanoid?: {
          humanBones?: {
            leftUpperArm?: { node?: number };
            rightUpperArm?: { node?: number };
          };
        };
      }
    | undefined;

  if (leftNodeIndex == null) {
    const node = vrm1?.humanoid?.humanBones?.leftUpperArm?.node;
    if (typeof node === "number") {
      leftNodeIndex = node;
    }
  }

  if (rightNodeIndex == null) {
    const node = vrm1?.humanoid?.humanBones?.rightUpperArm?.node;
    if (typeof node === "number") {
      rightNodeIndex = node;
    }
  }

  return { leftNodeIndex, rightNodeIndex };
}

function findHumanoidBoneNodeIndex(
  gltfJson: Record<string, unknown>,
  boneName: string,
): number | null {
  const extensions = (gltfJson.extensions ?? {}) as Record<string, unknown>;

  const vrm0 = extensions.VRM as
    | {
        humanoid?: {
          humanBones?: Array<{ bone?: string; node?: number }>;
        };
      }
    | undefined;
  const hit0 = (vrm0?.humanoid?.humanBones ?? []).find(
    (item) => item.bone === boneName && typeof item.node === "number",
  );
  if (hit0 && typeof hit0.node === "number") {
    return hit0.node;
  }

  const vrm1 = extensions.VRMC_vrm as
    | {
        humanoid?: {
          humanBones?: Record<string, { node?: number }>;
        };
      }
    | undefined;
  const node = vrm1?.humanoid?.humanBones?.[boneName]?.node;
  return typeof node === "number" ? node : null;
}

function isVrm1Model(gltfJson: Record<string, unknown>): boolean {
  const extensions = (gltfJson.extensions ?? {}) as Record<string, unknown>;
  return "VRMC_vrm" in extensions;
}

function snapshotBoneNodeState(
  nodes: Array<Record<string, unknown>>,
  nodeIndex: number | null,
) {
  if (nodeIndex == null || !nodes[nodeIndex]) {
    return null;
  }
  const node = nodes[nodeIndex];
  return {
    nodeIndex,
    nodeName: String(node.name ?? ""),
    translation: Array.isArray(node.translation)
      ? (node.translation as number[]).map((v) => Number(v))
      : null,
    rotation: Array.isArray(node.rotation)
      ? (node.rotation as number[]).map((v) => Number(v))
      : null,
    matrixTranslation:
      Array.isArray(node.matrix) && node.matrix.length === 16
        ? [
            Number((node.matrix as number[])[12] ?? 0),
            Number((node.matrix as number[])[13] ?? 0),
            Number((node.matrix as number[])[14] ?? 0),
          ]
        : null,
  };
}

export function poseUpperArmsInGlb(buffer: ArrayBuffer, angleDeg: number): ArrayBuffer {
  const chunks = parseGlbChunks(buffer);
  const jsonIndex = chunks.findIndex((chunk) => chunk.type === GLB_JSON_CHUNK);
  if (jsonIndex < 0) {
    throw new Error("GLB JSON chunk is missing.");
  }

  const jsonText = new TextDecoder()
    .decode(chunks[jsonIndex].data)
    .replace(/\u0000+$/g, "")
    .trimEnd();
  const gltfJson = JSON.parse(jsonText) as Record<string, unknown>;
  const vrm1 = isVrm1Model(gltfJson);
  if (angleDeg === 0 && !vrm1) {
    poseDebug("skip(angle=0, non-vrm1)", {});
    return buffer;
  }
  const nodes = (gltfJson.nodes ?? []) as Array<Record<string, unknown>>;

  // VRM1.0 is opposite in forward definition from legacy conversion assumptions.
  // Apply half turn on scene roots before arm posing so PMX conversion keeps facing.
  if (vrm1) {
    const scenes = (Array.isArray(gltfJson.scenes) ? gltfJson.scenes : []) as Array<
      Record<string, unknown>
    >;
    const sceneIndex = typeof gltfJson.scene === "number" ? gltfJson.scene : 0;
    const activeScene = scenes[sceneIndex] ?? scenes[0] ?? null;
    const rootNodeIndices = Array.isArray(activeScene?.nodes)
      ? (activeScene?.nodes as unknown[])
          .filter((value): value is number => typeof value === "number")
      : [];

    const halfTurn = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI,
    );

    for (const nodeIndex of rootNodeIndices) {
      const node = nodes[nodeIndex];
      if (!node) {
        continue;
      }

      if (Array.isArray(node.rotation) && node.rotation.length >= 4) {
        const before = new THREE.Quaternion(
          Number(node.rotation[0] ?? 0),
          Number(node.rotation[1] ?? 0),
          Number(node.rotation[2] ?? 0),
          Number(node.rotation[3] ?? 1),
        );
        const after = before.clone().multiply(halfTurn).normalize();
        node.rotation = [after.x, after.y, after.z, after.w];
        continue;
      }

      if (Array.isArray(node.matrix) && node.matrix.length === 16) {
        const matrix = new THREE.Matrix4().fromArray(
          (node.matrix as number[]).map((value) => Number(value)),
        );
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, rotation, scale);
        rotation.multiply(halfTurn).normalize();
        matrix.compose(position, rotation, scale);
        node.matrix = [...matrix.elements];
        continue;
      }

      node.rotation = [halfTurn.x, halfTurn.y, halfTurn.z, halfTurn.w];
    }

    poseDebug("vrm1 forward fix applied", {
      sceneIndex,
      rootNodeCount: rootNodeIndices.length,
    });
  }

  if (angleDeg !== 0) {
    const { leftNodeIndex, rightNodeIndex } = findUpperArmNodeIndices(gltfJson);
    if (leftNodeIndex == null || rightNodeIndex == null) {
      throw new Error("UpperArm bones were not found in VRM humanoid definition.");
    }
    poseDebug("humanoid nodes found", {
      leftNodeIndex,
      rightNodeIndex,
      angleDeg,
      nodeCount: nodes.length,
    });

    const angleRad = THREE.MathUtils.degToRad(angleDeg);
    const armSign = vrm1 ? -1 : 1;
    const leftDelta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      angleRad * armSign,
    );
    const rightDelta = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -angleRad * armSign,
    );
    poseDebug("profile-aware pose sign", {
      angleDeg,
      vrm1,
      armSign,
    });

    const trackedBones = [
      "leftUpperArm",
      "leftLowerArm",
      "leftHand",
      "rightUpperArm",
      "rightLowerArm",
      "rightHand",
    ];
    const boneNodeIndices = Object.fromEntries(
      trackedBones.map((boneName) => [
        boneName,
        findHumanoidBoneNodeIndex(gltfJson, boneName),
      ]),
    ) as Record<string, number | null>;
    const beforeState = Object.fromEntries(
      trackedBones.map((boneName) => [
        boneName,
        snapshotBoneNodeState(nodes, boneNodeIndices[boneName]),
      ]),
    );
    poseDebug("tracked bone states(before)", beforeState);

    const rotateNodeLocalRotation = (nodeIndex: number, delta: THREE.Quaternion) => {
      const node = nodes[nodeIndex];
      if (!node) {
        return { nodeIndex, mode: "missing", before: null, after: null };
      }

      if (Array.isArray(node.rotation) && node.rotation.length >= 4) {
        const beforeValues = (node.rotation as number[]).map((value) => Number(value));
        const before = new THREE.Quaternion(
          beforeValues[0] ?? 0,
          beforeValues[1] ?? 0,
          beforeValues[2] ?? 0,
          beforeValues[3] ?? 1,
        );
        const after = before.clone().multiply(delta).normalize();
        node.rotation = [after.x, after.y, after.z, after.w];
        return {
          nodeIndex,
          mode: "rotation",
          before: [before.x, before.y, before.z, before.w],
          after: [after.x, after.y, after.z, after.w],
        };
      }

      if (Array.isArray(node.matrix) && node.matrix.length === 16) {
        const matrixValues = (node.matrix as number[]).map((value) => Number(value));
        const matrix = new THREE.Matrix4().fromArray(matrixValues);
        const position = new THREE.Vector3();
        const rotation = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        matrix.decompose(position, rotation, scale);
        const before = [rotation.x, rotation.y, rotation.z, rotation.w];
        rotation.multiply(delta).normalize();
        const after = [rotation.x, rotation.y, rotation.z, rotation.w];
        matrix.compose(position, rotation, scale);
        node.matrix = [...matrix.elements];
        return { nodeIndex, mode: "matrix", before, after };
      }

      node.rotation = [delta.x, delta.y, delta.z, delta.w];
      return {
        nodeIndex,
        mode: "created-rotation",
        before: [0, 0, 0, 1],
        after: [delta.x, delta.y, delta.z, delta.w],
      };
    };

    const leftStats = rotateNodeLocalRotation(leftNodeIndex, leftDelta);
    const rightStats = rotateNodeLocalRotation(rightNodeIndex, rightDelta);
    poseDebug("upperArm local rotation stats", { leftStats, rightStats });

    const afterState = Object.fromEntries(
      trackedBones.map((boneName) => [
        boneName,
        snapshotBoneNodeState(nodes, boneNodeIndices[boneName]),
      ]),
    );
    poseDebug("tracked bone states(after)", afterState);
  }

  const encodedJson = new TextEncoder().encode(JSON.stringify(gltfJson));
  const paddedLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const paddedJson = new Uint8Array(paddedLength);
  paddedJson.fill(0x20);
  paddedJson.set(encodedJson);
  chunks[jsonIndex].data = paddedJson;
  poseDebug("glb json rewritten", {
    originalJsonBytes: encodedJson.byteLength,
    paddedJsonBytes: paddedLength,
  });

  return buildGlbBuffer(chunks);
}
