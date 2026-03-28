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

  // ── 1. Collect vertices and faces from all mesh primitives ──────────────

  const vertices = []; // { pos:[x,y,z], nrm:[x,y,z], uv:[u,v] }
  const faceVerts = []; // flat list of vertex indices (3 per triangle)
  const materials = []; // { nameJp, faceVertCount }

  for (const mesh of gltfJson.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const baseVertex = vertices.length;
      const attrs = prim.attributes || {};

      const positions = readAcc(gltfJson, binBuffer, attrs.POSITION);
      const normals = readAcc(gltfJson, binBuffer, attrs.NORMAL);
      const uvs = readAcc(gltfJson, binBuffer, attrs.TEXCOORD_0);
      const rawIndices = readAcc(gltfJson, binBuffer, prim.indices);

      const vertCount = positions ? Math.floor(positions.length / 3) : 0;

      for (let i = 0; i < vertCount; i++) {
        // Position: glTF right-hand → PMX left-hand (X flip) + MMD unit scale
        const px = (positions[i * 3] ?? 0) * MIKU_METER * -1;
        const py = (positions[i * 3 + 1] ?? 0) * MIKU_METER;
        const pz = (positions[i * 3 + 2] ?? 0) * MIKU_METER;

        // Normal: same X flip, no scale
        const nx = normals ? (normals[i * 3] ?? 0) * -1 : 0;
        const ny = normals ? (normals[i * 3 + 1] ?? 0) : 0;
        const nz = normals ? (normals[i * 3 + 2] ?? 0) : 0;

        // UV: pass through as-is
        const u = uvs ? (uvs[i * 2] ?? 0) : 0;
        const v = uvs ? (uvs[i * 2 + 1] ?? 0) : 0;

        vertices.push({ pos: [px, py, pz], nrm: [nx, ny, nz], uv: [u, v] });
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
        textureIndex: resolvePrimitiveTextureIndex(gltfJson, prim, imageIndexToTextureIndex),
      });
    }
  }

  // ── 2. Determine index sizes ────────────────────────────────────────────

  const vIdxSz = idxSize(vertices.length); // vertex index size
  const tIdxSz = idxSize(texturePaths.length); // texture index size
  const mIdxSz = idxSize(materials.length); // material index size
  const bIdxSz = 1; // bone index size      (1 bone)
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
    // deform type: 0 = Bdef1
    w.i8(0);
    // bone index 0 (センター)
    w.idx(0, bIdxSz);
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
    // diffuse RGBA (white)
    w.f32(1.0);
    w.f32(1.0);
    w.f32(1.0);
    w.f32(1.0);
    // specular RGB + shininess factor
    w.f32(0.0);
    w.f32(0.0);
    w.f32(0.0);
    w.f32(0.0);
    // ambient RGB
    w.f32(0.5);
    w.f32(0.5);
    w.f32(0.5);
    // flag: 0x01 = double-sided
    w.i8(0x01);
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
    // toon sharing flag: 1 = shared toon
    w.i8(1);
    // shared toon index (0 = toon01.bmp)
    w.i8(0);
    // comment
    w.text("");
    // face vertex count for this material
    w.i32(mat.faceVertCount);
  }

  // ── Bones ─────────────────────────────────────────────────────────────────
  // 1 bone: センター at origin
  w.i32(1);
  w.text("\u30bb\u30f3\u30bf\u30fc"); // "センター"
  w.text("center");
  w.f32(0.0);
  w.f32(0.0);
  w.f32(0.0); // position
  w.idx(-1, bIdxSz); // parent bone index: none
  w.i32(0); // layer
  // flags: 0x0002=rotatable, 0x0004=translatable, 0x0008=visible, 0x0010=operable
  // bit 0x0001 NOT set → connection destination is tail position (float3)
  w.i16(0x0002 | 0x0004 | 0x0008 | 0x0010);
  // tail position (bone display direction)
  w.f32(0.0);
  w.f32(1.0);
  w.f32(0.0);

  // ── Morphs (none) ─────────────────────────────────────────────────────────
  w.i32(0);

  // ── Display frames ────────────────────────────────────────────────────────
  w.i32(2);
  // Root frame (special)
  w.text("Root");
  w.text("Root");
  w.i8(1); // special flag
  w.i32(1); // 1 element
  w.i8(0); // element type: bone
  w.idx(0, bIdxSz); // センター

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
