/**
 * pmxWriter.js — PMX 2.0 binary writer (pure JS, no Wasm dependency)
 *
 * Converts parsed glTF JSON + binary BIN buffer into a PMX 2.0 Uint8Array.
 * Scope (minimal-viable "動くところまで"):
 *   - All mesh primitives → merged vertex / face buffers
 *   - Correct coordinate conversion (X-flip, MIKU_METER scale, winding reversal)
 *   - One material per glTF primitive (white diffuse, no textures)
 *   - One bone: センター at origin (Bdef1 → all vertices)
 *   - No morphs, no rigid bodies, no joints
 *   - Standard display frames: Root + 表情
 */

// ── Constants ──────────────────────────────────────────────────────────────

const MIKU_METER = 12.5;

// glTF componentType id → { bytes, read(DataView, byteOffset) }
const GLTF_COMPONENT = {
  5120: { bytes: 1, read: (dv, o) => dv.getInt8(o) },
  5121: { bytes: 1, read: (dv, o) => dv.getUint8(o) },
  5122: { bytes: 2, read: (dv, o) => dv.getInt16(o, true) },
  5123: { bytes: 2, read: (dv, o) => dv.getUint16(o, true) },
  5124: { bytes: 4, read: (dv, o) => dv.getInt32(o, true) },
  5125: { bytes: 4, read: (dv, o) => dv.getUint32(o, true) },
  5126: { bytes: 4, read: (dv, o) => dv.getFloat32(o, true) },
};

const GLTF_TYPE_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
};

// ── BinaryWriter ───────────────────────────────────────────────────────────

class BinaryWriter {
  constructor() {
    this._buf = new ArrayBuffer(4 * 1024 * 1024); // 4 MB initial
    this._view = new DataView(this._buf);
    this._pos = 0;
  }

  _ensure(n) {
    if (this._pos + n <= this._buf.byteLength) return;
    let len = this._buf.byteLength;
    while (len < this._pos + n) len *= 2;
    const next = new ArrayBuffer(len);
    new Uint8Array(next).set(new Uint8Array(this._buf));
    this._buf = next;
    this._view = new DataView(next);
  }

  i8(v) {
    this._ensure(1);
    this._view.setInt8(this._pos, v);
    this._pos += 1;
  }
  i16(v) {
    this._ensure(2);
    this._view.setInt16(this._pos, v, true);
    this._pos += 2;
  }
  i32(v) {
    this._ensure(4);
    this._view.setInt32(this._pos, v, true);
    this._pos += 4;
  }
  f32(v) {
    this._ensure(4);
    this._view.setFloat32(this._pos, v, true);
    this._pos += 4;
  }

  bytes(arr) {
    this._ensure(arr.length);
    new Uint8Array(this._buf).set(arr, this._pos);
    this._pos += arr.length;
  }

  /** PMX text field: int32 byteLength + UTF-16-LE bytes */
  text(str) {
    const s = str ?? "";
    // Encode as UTF-16-LE (BMP only; surrogate pairs not needed for model names)
    const utf16 = new Uint8Array(s.length * 2);
    const dv = new DataView(utf16.buffer);
    for (let i = 0; i < s.length; i++) {
      dv.setUint16(i * 2, s.charCodeAt(i), true);
    }
    this.i32(utf16.length); // byte count
    this.bytes(utf16);
  }

  /** Write a PMX index value with the specified byte size (1/2/4). */
  idx(v, size) {
    if (size === 1) this.i8(v);
    else if (size === 2) this.i16(v);
    else this.i32(v);
  }

  toUint8Array() {
    return new Uint8Array(this._buf, 0, this._pos).slice();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Mirror of Python define_index_size(). */
function idxSize(count) {
  if (count > 32768) return 4;
  if (count > 128) return 2;
  return 1;
}

function inferTextureExtension(mimeType) {
  if (!mimeType) return "png";
  const normalized = String(mimeType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("bmp")) return "bmp";
  if (normalized.includes("webp")) return "webp";
  return "bin";
}

function normalizeTextureBaseName(raw, fallback) {
  const base = String(raw || "")
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  return base || fallback;
}

function buildTexturePathMap(gltfJson) {
  const paths = [];
  const imageIndexToTextureIndex = new Map();
  const used = new Set();
  const images = Array.isArray(gltfJson.images) ? gltfJson.images : [];

  for (let i = 0; i < images.length; i++) {
    const image = images[i] || {};
    const extension = inferTextureExtension(image.mimeType);
    const baseName = normalizeTextureBaseName(
      typeof image.name === "string" ? image.name : typeof image.uri === "string" ? image.uri : "",
      `texture_${i}`,
    );

    let candidate = `textures/${baseName}.${extension}`;
    let serial = 1;
    while (used.has(candidate.toLowerCase())) {
      candidate = `textures/${baseName}_${serial}.${extension}`;
      serial += 1;
    }
    used.add(candidate.toLowerCase());

    imageIndexToTextureIndex.set(i, paths.length);
    paths.push(candidate);
  }

  return { paths, imageIndexToTextureIndex };
}

function resolvePrimitiveTextureIndex(gltfJson, prim, imageIndexToTextureIndex) {
  const matIdx = prim && typeof prim.material === "number" ? prim.material : -1;
  if (matIdx < 0) return -1;
  const mat = Array.isArray(gltfJson.materials) ? gltfJson.materials[matIdx] : null;
  if (!mat || typeof mat !== "object") return -1;

  const pbr = mat.pbrMetallicRoughness;
  const baseColor = pbr && typeof pbr === "object" ? pbr.baseColorTexture : null;
  const texIndex = baseColor && typeof baseColor === "object" ? baseColor.index : null;
  if (typeof texIndex !== "number") return -1;

  const tex = Array.isArray(gltfJson.textures) ? gltfJson.textures[texIndex] : null;
  if (!tex || typeof tex !== "object" || typeof tex.source !== "number") return -1;

  return imageIndexToTextureIndex.get(tex.source) ?? -1;
}

function resolvePrimitiveMaterialInfo(gltfJson, prim, imageIndexToTextureIndex) {
  const defaults = {
    textureIndex: -1,
    diffuse: [1.0, 1.0, 1.0, 1.0],
    ambient: [0.5, 0.5, 0.5],
    doubleSided: true,
  };

  const matIdx = prim && typeof prim.material === "number" ? prim.material : -1;
  if (matIdx < 0) return defaults;

  const mat = Array.isArray(gltfJson.materials) ? gltfJson.materials[matIdx] : null;
  if (!mat || typeof mat !== "object") return defaults;

  const pbr = mat.pbrMetallicRoughness && typeof mat.pbrMetallicRoughness === "object"
    ? mat.pbrMetallicRoughness
    : {};
  const factor = Array.isArray(pbr.baseColorFactor) ? pbr.baseColorFactor : [1, 1, 1, 1];
  const alphaMode = typeof mat.alphaMode === "string" ? mat.alphaMode.toUpperCase() : "OPAQUE";
  const alpha = alphaMode === "OPAQUE" ? 1.0 : Number(factor[3] ?? 1.0);

  const r = Number(factor[0] ?? 1.0);
  const g = Number(factor[1] ?? 1.0);
  const b = Number(factor[2] ?? 1.0);

  return {
    textureIndex: resolvePrimitiveTextureIndex(gltfJson, prim, imageIndexToTextureIndex),
    diffuse: [r, g, b, alpha],
    ambient: [r * 0.6, g * 0.6, b * 0.6],
    doubleSided: Boolean(mat.doubleSided),
  };
}

function buildNodeParentIndices(gltfJson) {
  const nodes = Array.isArray(gltfJson.nodes) ? gltfJson.nodes : [];
  const parents = new Array(nodes.length).fill(-1);
  for (let i = 0; i < nodes.length; i++) {
    const children = Array.isArray(nodes[i] && nodes[i].children) ? nodes[i].children : [];
    for (const child of children) {
      if (typeof child === "number" && child >= 0 && child < nodes.length) {
        parents[child] = i;
      }
    }
  }
  return parents;
}

function identityMat4() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function invertMat4(m) {
  const out = new Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det || !Number.isFinite(det)) {
    return null;
  }
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

  return out;
}

function finiteNumber(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function mulMat4(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function addWeightedMat4(out, m, w) {
  for (let i = 0; i < 16; i++) {
    out[i] += m[i] * w;
  }
}

function transformPointMat4(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function transformDirMat4(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!len || !Number.isFinite(len)) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function nodeLocalMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.map((v) => Number(v));
  }

  const t = Array.isArray(node.translation) ? node.translation : [0, 0, 0];
  const r = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1];
  const s = Array.isArray(node.scale) ? node.scale : [1, 1, 1];

  const tx = Number(t[0] ?? 0);
  const ty = Number(t[1] ?? 0);
  const tz = Number(t[2] ?? 0);
  const x = Number(r[0] ?? 0);
  const y = Number(r[1] ?? 0);
  const z = Number(r[2] ?? 0);
  const w = Number(r[3] ?? 1);
  const sx = Number(s[0] ?? 1);
  const sy = Number(s[1] ?? 1);
  const sz = Number(s[2] ?? 1);

  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

function buildWorldMatrices(gltfJson, parentIndices) {
  const nodes = Array.isArray(gltfJson.nodes) ? gltfJson.nodes : [];
  const world = new Array(nodes.length);

  function compute(nodeIndex) {
    if (nodeIndex < 0 || nodeIndex >= nodes.length) return identityMat4();
    if (world[nodeIndex]) return world[nodeIndex];
    const local = nodeLocalMatrix(nodes[nodeIndex] || {});
    const p = parentIndices[nodeIndex];
    world[nodeIndex] = p >= 0 ? mulMat4(compute(p), local) : local;
    return world[nodeIndex];
  }

  for (let i = 0; i < nodes.length; i++) {
    compute(i);
  }
  return world;
}

function toPmxPosFromGlbWorld(worldMat) {
  return [
    finiteNumber(Number(worldMat[12] || 0) * MIKU_METER * -1),
    finiteNumber(Number(worldMat[13] || 0) * MIKU_METER),
    finiteNumber(Number(worldMat[14] || 0) * MIKU_METER),
  ];
}

function buildRigFromSkins(gltfJson, binBuffer, usedSkinIndices) {
  const centerBone = {
    nameJp: "\u30bb\u30f3\u30bf\u30fc",
    nameEn: "center",
    pos: [0, 0, 0],
    parent: -1,
  };

  if (!Array.isArray(gltfJson.skins) || usedSkinIndices.size === 0) {
    return {
      bones: [centerBone],
      boneIndexByNodeIndex: new Map(),
    };
  }

  const nodes = Array.isArray(gltfJson.nodes) ? gltfJson.nodes : [];
  const parentIndices = buildNodeParentIndices(gltfJson);
  const world = buildWorldMatrices(gltfJson, parentIndices);
  const jointBindPosByNode = new Map();

  for (const skinIndex of usedSkinIndices) {
    const skin = Array.isArray(gltfJson.skins) ? gltfJson.skins[skinIndex] : null;
    const joints = Array.isArray(skin && skin.joints) ? skin.joints : [];
    const ibmAccessor = skin && typeof skin.inverseBindMatrices === "number"
      ? skin.inverseBindMatrices
      : null;
    if (ibmAccessor == null) continue;

    const ibm = readAcc(gltfJson, binBuffer, ibmAccessor);
    if (!ibm) continue;

    for (let i = 0; i < joints.length; i++) {
      const nodeIdx = joints[i];
      if (typeof nodeIdx !== "number" || nodeIdx < 0 || nodeIdx >= nodes.length) continue;
      const start = i * 16;
      if (start + 15 >= ibm.length) continue;
      const invBind = ibm.slice(start, start + 16).map((v) => Number(v));
      const bind = invertMat4(invBind);
      if (!bind) continue;
      jointBindPosByNode.set(nodeIdx, toPmxPosFromGlbWorld(bind));
    }
  }

  const jointSet = new Set();
  for (const skinIndex of usedSkinIndices) {
    const skin = gltfJson.skins[skinIndex];
    const joints = Array.isArray(skin && skin.joints) ? skin.joints : [];
    for (const joint of joints) {
      if (typeof joint === "number" && joint >= 0 && joint < nodes.length) {
        jointSet.add(joint);
        let p = parentIndices[joint];
        while (p >= 0) {
          jointSet.add(p);
          p = parentIndices[p];
        }
      }
    }
  }

  const orderedNodeIndices = Array.from(jointSet).sort((a, b) => a - b);
  const boneIndexByNodeIndex = new Map();
  for (let i = 0; i < orderedNodeIndices.length; i++) {
    boneIndexByNodeIndex.set(orderedNodeIndices[i], i + 1); // 0 is center
  }

  const bones = [centerBone];
  for (const nodeIndex of orderedNodeIndices) {
    const node = nodes[nodeIndex] || {};
    const parentNode = parentIndices[nodeIndex];
    const parentBone = boneIndexByNodeIndex.has(parentNode)
      ? boneIndexByNodeIndex.get(parentNode)
      : 0;
    bones.push({
      nameJp: typeof node.name === "string" && node.name ? node.name : `bone_${nodeIndex}`,
      nameEn: typeof node.name === "string" && node.name ? node.name : `bone_${nodeIndex}`,
      pos:
        jointBindPosByNode.get(nodeIndex) ||
        toPmxPosFromGlbWorld(world[nodeIndex] || identityMat4()),
      parent: typeof parentBone === "number" ? parentBone : 0,
    });
  }

  return { bones, boneIndexByNodeIndex };
}

function buildSkinPoseData(gltfJson, binBuffer, skinIndex, worldMatrices) {
  if (!Array.isArray(gltfJson.skins) || skinIndex < 0 || skinIndex >= gltfJson.skins.length) {
    return null;
  }
  const skin = gltfJson.skins[skinIndex];
  const joints = Array.isArray(skin && skin.joints) ? skin.joints : null;
  if (!joints || joints.length === 0) return null;

  const ibmAccessor = typeof skin.inverseBindMatrices === "number" ? skin.inverseBindMatrices : null;
  const ibm = ibmAccessor != null ? readAcc(gltfJson, binBuffer, ibmAccessor) : null;
  if (!ibm) return null;

  const jointMatrices = new Array(joints.length);
  for (let i = 0; i < joints.length; i++) {
    const nodeIdx = joints[i];
    const start = i * 16;
    if (
      typeof nodeIdx !== "number" ||
      nodeIdx < 0 ||
      nodeIdx >= worldMatrices.length ||
      start + 15 >= ibm.length
    ) {
      jointMatrices[i] = identityMat4();
      continue;
    }

    const invBind = ibm.slice(start, start + 16).map((v) => Number(v));
    const jointWorld = worldMatrices[nodeIdx] || identityMat4();
    jointMatrices[i] = mulMat4(jointWorld, invBind);
  }

  return { joints, jointMatrices };
}

function skinVertexPose(pos, nrm, jointsRaw, weightsRaw, vertIndex, poseData) {
  if (!poseData || !jointsRaw || !weightsRaw) {
    return {
      pos: [pos[0], pos[1], pos[2]],
      nrm: [nrm[0], nrm[1], nrm[2]],
    };
  }

  const blended = new Array(16).fill(0);
  let sumW = 0;
  for (let k = 0; k < 4; k++) {
    const j = Number(jointsRaw[vertIndex * 4 + k] ?? -1);
    const w = Number(weightsRaw[vertIndex * 4 + k] ?? 0);
    if (j < 0 || j >= poseData.jointMatrices.length || w <= 0) continue;
    addWeightedMat4(blended, poseData.jointMatrices[j], w);
    sumW += w;
  }

  if (sumW <= 0) {
    return {
      pos: [pos[0], pos[1], pos[2]],
      nrm: [nrm[0], nrm[1], nrm[2]],
    };
  }

  if (Math.abs(sumW - 1) > 1e-6) {
    for (let i = 0; i < 16; i++) blended[i] /= sumW;
  }

  const sp = transformPointMat4(blended, pos[0], pos[1], pos[2]);
  const sn = normalize3(transformDirMat4(blended, nrm[0], nrm[1], nrm[2]));
  return { pos: sp, nrm: sn };
}

function resolveVertexDeform(
  jointsRaw,
  weightsRaw,
  vertIndex,
  skinJoints,
  boneIndexByNodeIndex,
) {
  if (!jointsRaw || !weightsRaw || !skinJoints) {
    return { type: 0, bone0: 0 };
  }

  const inf = [];
  for (let k = 0; k < 4; k++) {
    const jointLocal = Number(jointsRaw[vertIndex * 4 + k] ?? -1);
    const weight = Number(weightsRaw[vertIndex * 4 + k] ?? 0);
    if (jointLocal < 0 || jointLocal >= skinJoints.length || weight <= 0) continue;
    const nodeIdx = skinJoints[jointLocal];
    const boneIdx = boneIndexByNodeIndex.get(nodeIdx);
    if (typeof boneIdx !== "number") continue;
    inf.push({ boneIdx, weight });
  }

  if (inf.length === 0) {
    return { type: 0, bone0: 0 };
  }

  inf.sort((a, b) => b.weight - a.weight);
  const top = inf.slice(0, 4);
  const sum = top.reduce((acc, v) => acc + v.weight, 0);
  for (const item of top) {
    item.weight = sum > 0 ? item.weight / sum : 0;
  }

  if (top.length === 1) {
    return { type: 0, bone0: top[0].boneIdx };
  }
  if (top.length === 2) {
    return { type: 1, bone0: top[0].boneIdx, bone1: top[1].boneIdx, weight0: top[0].weight };
  }

  while (top.length < 4) {
    top.push({ boneIdx: 0, weight: 0 });
  }
  return {
    type: 2,
    bone0: top[0].boneIdx,
    bone1: top[1].boneIdx,
    bone2: top[2].boneIdx,
    bone3: top[3].boneIdx,
    weight0: top[0].weight,
    weight1: top[1].weight,
    weight2: top[2].weight,
    weight3: top[3].weight,
  };
}

/**
 * Read all elements from a glTF accessor into a flat JS number array.
 * Returns null if the accessor or bufferView is absent.
 */
function readAcc(gltfJson, binBuffer, accessorIndex) {
  if (accessorIndex == null) return null;
  const accessor = gltfJson.accessors && gltfJson.accessors[accessorIndex];
  if (!accessor) return null;

  const bvIdx = accessor.bufferView ?? accessor.bufferViewIndex;
  const bv = gltfJson.bufferViews && gltfJson.bufferViews[bvIdx];
  if (!bv) return null;

  const comp = GLTF_COMPONENT[accessor.componentType];
  if (!comp) return null;
  const numComp = GLTF_TYPE_COUNT[accessor.type];
  if (!numComp) return null;

  const baseOffset = (bv.byteOffset || 0) + (accessor.byteOffset || 0);
  const byteStride = bv.byteStride || comp.bytes * numComp;
  const dv = new DataView(binBuffer);
  const out = new Array(accessor.count * numComp);

  for (let i = 0; i < accessor.count; i++) {
    const base = baseOffset + i * byteStride;
    for (let c = 0; c < numComp; c++) {
      out[i * numComp + c] = comp.read(dv, base + c * comp.bytes);
    }
  }
  return out;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Build PMX 2.0 binary from a parsed glTF JSON object and its BIN buffer.
 *
 * @param {object}       gltfJson  - Parsed JSON from the GLB JSON chunk.
 * @param {ArrayBuffer}  binBuffer - Raw bytes from the GLB BIN chunk (may be null).
 * @param {object}       [opts]
 * @param {string}       [opts.modelName]  - JP model name written into PMX header.
 * @returns {Uint8Array} PMX 2.0 binary data ready for .pmx file output.
 */
export function buildPmxFromGltf(gltfJson, binBuffer, opts = {}) {
  const modelName = opts.modelName || "VRM Model";

  const { paths: texturePaths, imageIndexToTextureIndex } = buildTexturePathMap(gltfJson);
  const nodes = Array.isArray(gltfJson.nodes) ? gltfJson.nodes : [];
  const meshes = Array.isArray(gltfJson.meshes) ? gltfJson.meshes : [];
  const parentIndices = buildNodeParentIndices(gltfJson);
  const worldMatrices = buildWorldMatrices(gltfJson, parentIndices);

  const meshBindings = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] || {};
    if (typeof node.mesh === "number" && node.mesh >= 0 && node.mesh < meshes.length) {
      meshBindings.push({
        nodeIndex: i,
        meshIndex: node.mesh,
        skinIndex: typeof node.skin === "number" ? node.skin : -1,
      });
    }
  }
  if (meshBindings.length === 0) {
    for (let i = 0; i < meshes.length; i++) {
      meshBindings.push({ nodeIndex: -1, meshIndex: i, skinIndex: -1 });
    }
  }

  const usedSkinIndices = new Set(
    meshBindings
      .map((b) => b.skinIndex)
      .filter((v) => typeof v === "number" && v >= 0),
  );
  const { bones, boneIndexByNodeIndex } = buildRigFromSkins(gltfJson, binBuffer, usedSkinIndices);

  // ── 1. Collect vertices and faces from all mesh primitives ──────────────

  const vertices = []; // { pos:[x,y,z], nrm:[x,y,z], uv:[u,v], deform }
  const faceVerts = []; // flat list of vertex indices (3 per triangle)
  const materials = []; // { nameJp, faceVertCount }

  for (const binding of meshBindings) {
    const mesh = meshes[binding.meshIndex];
    const skin =
      binding.skinIndex >= 0 && Array.isArray(gltfJson.skins) ? gltfJson.skins[binding.skinIndex] : null;
    const skinJoints = Array.isArray(skin && skin.joints) ? skin.joints : null;
    const skinPoseData = buildSkinPoseData(gltfJson, binBuffer, binding.skinIndex, worldMatrices);

    for (const prim of mesh.primitives || []) {
      const baseVertex = vertices.length;
      const attrs = prim.attributes || {};

      const positions = readAcc(gltfJson, binBuffer, attrs.POSITION);
      const normals = readAcc(gltfJson, binBuffer, attrs.NORMAL);
      const uvs = readAcc(gltfJson, binBuffer, attrs.TEXCOORD_0);
      const joints = readAcc(gltfJson, binBuffer, attrs.JOINTS_0);
      const weights = readAcc(gltfJson, binBuffer, attrs.WEIGHTS_0);
      const rawIndices = readAcc(gltfJson, binBuffer, prim.indices);

      const vertCount = positions ? Math.floor(positions.length / 3) : 0;

      for (let i = 0; i < vertCount; i++) {
        const srcPos = [
          Number(positions[i * 3] ?? 0),
          Number(positions[i * 3 + 1] ?? 0),
          Number(positions[i * 3 + 2] ?? 0),
        ];
        const srcNrm = normals
          ? [
              Number(normals[i * 3] ?? 0),
              Number(normals[i * 3 + 1] ?? 1),
              Number(normals[i * 3 + 2] ?? 0),
            ]
          : [0, 1, 0];
        const skinned = skinVertexPose(srcPos, srcNrm, joints, weights, i, skinPoseData);

        // Position: glTF right-hand → PMX left-hand (X flip) + MMD unit scale
        const px = skinned.pos[0] * MIKU_METER * -1;
        const py = skinned.pos[1] * MIKU_METER;
        const pz = skinned.pos[2] * MIKU_METER;

        // Normal: same X flip, no scale
        const nx = skinned.nrm[0] * -1;
        const ny = skinned.nrm[1];
        const nz = skinned.nrm[2];

        // UV: pass through as-is
        const u = uvs ? (uvs[i * 2] ?? 0) : 0;
        const v = uvs ? (uvs[i * 2 + 1] ?? 0) : 0;

        vertices.push({
          pos: [px, py, pz],
          nrm: [nx, ny, nz],
          uv: [u, v],
          deform: resolveVertexDeform(joints, weights, i, skinJoints, boneIndexByNodeIndex),
        });
      }

      // Faces: reverse winding order (glTF CCW → PMX CW)
      let primFaceCount = 0;
      if (rawIndices) {
        const triCount = Math.floor(rawIndices.length / 3);
        for (let t = 0; t < triCount; t++) {
          const a = baseVertex + rawIndices[t * 3];
          const b = baseVertex + rawIndices[t * 3 + 1];
          const c = baseVertex + rawIndices[t * 3 + 2];
          faceVerts.push(c, b, a); // winding reversal
        }
        primFaceCount = triCount * 3;
      }

      materials.push({
        nameJp: mesh.name || `Material_${materials.length}`,
        faceVertCount: primFaceCount,
        ...resolvePrimitiveMaterialInfo(gltfJson, prim, imageIndexToTextureIndex),
      });
    }
  }

  // ── 2. Determine index sizes ────────────────────────────────────────────

  const vIdxSz = idxSize(vertices.length); // vertex index size
  const tIdxSz = idxSize(texturePaths.length); // texture index size
  const mIdxSz = idxSize(materials.length); // material index size
  const bIdxSz = idxSize(bones.length); // bone index size
  const phIdxSz = 1; // morph index size    (0 morphs)
  const rbIdxSz = 1; // rigid body idx size (0 rigid bodies)

  // ── 3. Write PMX binary ─────────────────────────────────────────────────

  const w = new BinaryWriter();

  // Header signature + version
  w.bytes([0x50, 0x4d, 0x58, 0x20]); // "PMX "
  w.f32(2.0); // version 2.0

  // Global settings (always 8 bytes)
  w.i8(8);
  w.i8(0); // encoding: 0 = UTF-16-LE
  w.i8(0); // additional UV count
  w.i8(vIdxSz);
  w.i8(tIdxSz);
  w.i8(mIdxSz);
  w.i8(bIdxSz);
  w.i8(phIdxSz);
  w.i8(rbIdxSz);

  // Model names + comments
  w.text(modelName);
  w.text("VRM Model");
  w.text("vrm2pmx-wasm \u304b\u3089\u5909\u63db"); // "vrm2pmx-wasmから変換"
  w.text("");

  // ── Vertices ─────────────────────────────────────────────────────────────
  w.i32(vertices.length);
  for (const vert of vertices) {
    // position (3 floats)
    w.f32(vert.pos[0]);
    w.f32(vert.pos[1]);
    w.f32(vert.pos[2]);
    // normal (3 floats)
    w.f32(vert.nrm[0]);
    w.f32(vert.nrm[1]);
    w.f32(vert.nrm[2]);
    // UV (2 floats)
    w.f32(vert.uv[0]);
    w.f32(vert.uv[1]);
    const d = vert.deform || { type: 0, bone0: 0 };
    if (d.type === 2) {
      // Bdef4
      w.i8(2);
      w.idx(d.bone0 ?? 0, bIdxSz);
      w.idx(d.bone1 ?? 0, bIdxSz);
      w.idx(d.bone2 ?? 0, bIdxSz);
      w.idx(d.bone3 ?? 0, bIdxSz);
      w.f32(d.weight0 ?? 1);
      w.f32(d.weight1 ?? 0);
      w.f32(d.weight2 ?? 0);
      w.f32(d.weight3 ?? 0);
    } else if (d.type === 1) {
      // Bdef2
      w.i8(1);
      w.idx(d.bone0 ?? 0, bIdxSz);
      w.idx(d.bone1 ?? 0, bIdxSz);
      w.f32(d.weight0 ?? 1);
    } else {
      // Bdef1
      w.i8(0);
      w.idx(d.bone0 ?? 0, bIdxSz);
    }
    // edge factor
    w.f32(1.0);
  }

  // ── Faces ─────────────────────────────────────────────────────────────────
  w.i32(faceVerts.length);
  for (const vi of faceVerts) {
    w.idx(vi, vIdxSz);
  }

  // ── Textures ──────────────────────────────────────────────────────────────
  w.i32(texturePaths.length);
  for (const path of texturePaths) {
    w.text(path);
  }

  // ── Materials ─────────────────────────────────────────────────────────────
  w.i32(materials.length);
  for (const mat of materials) {
    w.text(mat.nameJp); // JP name
    w.text(mat.nameJp); // EN name
    // diffuse RGBA
    w.f32(mat.diffuse[0]);
    w.f32(mat.diffuse[1]);
    w.f32(mat.diffuse[2]);
    w.f32(mat.diffuse[3]);
    // specular RGB + shininess factor
    w.f32(0.0);
    w.f32(0.0);
    w.f32(0.0);
    w.f32(0.0);
    // ambient RGB
    w.f32(mat.ambient[0]);
    w.f32(mat.ambient[1]);
    w.f32(mat.ambient[2]);
    // flag: 0x01 = disable culling (double-sided)
    w.i8(mat.doubleSided ? 0x01 : 0x00);
    // edge color RGBA + size
    w.f32(0.0);
    w.f32(0.0);
    w.f32(0.0);
    w.f32(1.0);
    w.f32(1.0);
    // texture index, sphere texture index (-1 = none)
    w.idx(typeof mat.textureIndex === "number" ? mat.textureIndex : -1, tIdxSz);
    w.idx(-1, tIdxSz);
    // sphere mode: 0 = off
    w.i8(0);
    // toon sharing flag: 0 = individual toon texture
    // Avoid forcing shared toon01.bmp because it introduces gray blotches on some faces.
    w.i8(0);
    // individual toon texture index (-1 = none)
    w.idx(-1, tIdxSz);
    // comment
    w.text("");
    // face vertex count for this material
    w.i32(mat.faceVertCount);
  }

  // ── Bones ─────────────────────────────────────────────────────────────────
  w.i32(bones.length);
  for (const bone of bones) {
    w.text(bone.nameJp);
    w.text(bone.nameEn);
    w.f32(bone.pos[0]);
    w.f32(bone.pos[1]);
    w.f32(bone.pos[2]);
    w.idx(typeof bone.parent === "number" ? bone.parent : -1, bIdxSz);
    w.i32(0); // layer
    // flags: rotatable, translatable, visible, operable
    w.i16(0x0002 | 0x0004 | 0x0008 | 0x0010);
    // tail position offset
    w.f32(0.0);
    w.f32(1.0);
    w.f32(0.0);
  }

  // ── Morphs (none) ─────────────────────────────────────────────────────────
  w.i32(0);

  // ── Display frames ────────────────────────────────────────────────────────
  w.i32(2);
  // Root frame (special)
  w.text("Root");
  w.text("Root");
  w.i8(1); // special flag
  w.i32(bones.length);
  for (let i = 0; i < bones.length; i++) {
    w.i8(0); // element type: bone
    w.idx(i, bIdxSz);
  }

  // 表情 frame (special, empty)
  w.text("\u8868\u60c5"); // "表情"
  w.text("Exp");
  w.i8(1); // special flag
  w.i32(0); // 0 elements

  // ── Rigid bodies (none) ───────────────────────────────────────────────────
  w.i32(0);

  // ── Joints (none) ─────────────────────────────────────────────────────────
  w.i32(0);

  return w.toUint8Array();
}
