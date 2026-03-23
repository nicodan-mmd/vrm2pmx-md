import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import { type ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MMDLoader } from "three-stdlib";
import {
  type ConvertMode,
  convertWithMode,
  isBackendFallbackEnabled,
  toUserFriendlyConvertError,
} from "./services/convertClient";
import type { WorkerLogResponse } from "./types/convert";

type Status = "idle" | "uploading" | "done" | "error" | "canceled";

type UpperArmState = {
  leftBone: THREE.Object3D | null;
  rightBone: THREE.Object3D | null;
  leftBaseQuaternion: THREE.Quaternion | null;
  rightBaseQuaternion: THREE.Quaternion | null;
};

type ConvertedOutput = {
  blob: Blob;
  fileExtension: "zip" | "pmx";
};

type GlbChunk = {
  type: number;
  data: Uint8Array;
};

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const DEBUG_POSE = false;
const DEBUG_PMX = false;

function poseDebug(label: string, payload: unknown): void {
  if (!DEBUG_POSE) {
    return;
  }
  console.info(`★POSE ${label}`, payload);
}

function pmxDebug(label: string, payload: unknown): void {
  if (!DEBUG_PMX) {
    return;
  }
  console.info(`★PMX ${label}`, payload);
}

function createThreeWarnFilter() {
  const noisyPatterns = [
    "'skinning' is not a property of THREE.MeshToonMaterial",
    "'morphTargets' is not a property of THREE.MeshToonMaterial",
    "'envMap' is not a property of THREE.MeshToonMaterial",
    "'combine' is not a property of THREE.MeshToonMaterial",
  ];

  return (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : String(args[0] ?? "");
    return noisyPatterns.some((pattern) => first.includes(pattern));
  };
}

function normalizeAssetPath(path: string): string {
  const noQuery = path.split("?")[0].split("#")[0] || "";
  const decoded = decodeURIComponent(noQuery);
  return decoded
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
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

function poseUpperArmsInGlb(buffer: ArrayBuffer, angleDeg: number): ArrayBuffer {
  if (angleDeg === 0) {
    poseDebug("skip(angle=0)", {});
    return buffer;
  }

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
  const nodes = (gltfJson.nodes ?? []) as Array<Record<string, unknown>>;

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
  const leftDelta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angleRad);
  const rightDelta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -angleRad);

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

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<ConvertMode>("wasm");
  const [taPoseAngle, setTaPoseAngle] = useState(0);
  const [orbitSyncEnabled, setOrbitSyncEnabled] = useState(true);
  const orbitSyncEnabledRef = useRef(true);
  const [logEnabled, setLogEnabled] = useState(false);
  const logEnabledRef = useRef(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "failed">("idle");
  const logAreaRef = useRef<HTMLDivElement | null>(null);
  const [isVrmReady, setIsVrmReady] = useState(false);
  const [message, setMessage] = useState("VRM file is not selected yet.");
  const [errorDetail, setErrorDetail] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [convertedOutput, setConvertedOutput] = useState<ConvertedOutput | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const vrmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pmxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewCleanupRef = useRef<(() => void) | null>(null);
  const pmxPreviewCleanupRef = useRef<(() => void) | null>(null);
  const vrmViewRef = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    baseDistance: number;
    anchorTarget: THREE.Vector3;
  } | null>(null);
  const pmxViewRef = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    baseDistance: number;
    anchorTarget: THREE.Vector3;
  } | null>(null);
  const orbitSyncLockRef = useRef(false);
  const upperArmStateRef = useRef<UpperArmState>({
    leftBone: null,
    rightBone: null,
    leftBaseQuaternion: null,
    rightBaseQuaternion: null,
  });
  const backendEnabled = isBackendFallbackEnabled();

  const canConvert = useMemo(
    () => !!file && status !== "uploading" && !isPreviewing && isVrmReady,
    [file, isPreviewing, isVrmReady, status],
  );
  const canDownload = useMemo(
    () => !!convertedOutput && status !== "uploading",
    [convertedOutput, status],
  );
  const logText = useMemo(() => logLines.join("\n"), [logLines]);

  function formatLogArg(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Error) {
      return value.stack || value.message;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  function appendConsoleLine(args: unknown[]) {
    const line = args.map((value) => formatLogArg(value)).join(" ");
    setLogLines((prev) => {
      const next = [...prev, line];
      if (next.length > 1000) {
        next.splice(0, next.length - 1000);
      }
      return next;
    });
  }

  function appendWorkerLog(log: WorkerLogResponse) {
    appendConsoleLine(log.args);
  }

  function isErrorLogLine(line: string): boolean {
    return /(error|failed|exception|traceback|aborterror|convert\.failed)/i.test(line);
  }

  async function onCopyLog() {
    try {
      await navigator.clipboard.writeText(logText);
      setCopyStatus("done");
    } catch {
      try {
        const fallback = document.createElement("textarea");
        fallback.value = logText;
        fallback.setAttribute("readonly", "true");
        fallback.style.position = "fixed";
        fallback.style.opacity = "0";
        document.body.appendChild(fallback);
        fallback.select();
        document.execCommand("copy");
        document.body.removeChild(fallback);
        setCopyStatus("done");
      } catch {
        setCopyStatus("failed");
      }
    }
  }

  async function buildConvertInputFile(sourceFile: File): Promise<File> {
    const sourceBuffer = await sourceFile.arrayBuffer();
    const posedBuffer = poseUpperArmsInGlb(sourceBuffer, taPoseAngle);
    poseDebug("convert input built", {
      fileName: sourceFile.name,
      angleDeg: taPoseAngle,
      inputBytes: sourceBuffer.byteLength,
      outputBytes: posedBuffer.byteLength,
    });
    return new File([posedBuffer], sourceFile.name, {
      type: sourceFile.type || "model/gltf-binary",
    });
  }

  function cleanupPmxPreview() {
    pmxPreviewCleanupRef.current?.();
    pmxPreviewCleanupRef.current = null;
    pmxViewRef.current = null;
  }

  function syncOrbitBetweenViews(sourceView: "vrm" | "pmx", forceSync = false) {
    if (!forceSync && !orbitSyncEnabledRef.current) {
      return;
    }

    const source = sourceView === "vrm" ? vrmViewRef.current : pmxViewRef.current;
    const target = sourceView === "vrm" ? pmxViewRef.current : vrmViewRef.current;
    if (!source || !target || orbitSyncLockRef.current) {
      return;
    }

    const sourceOffset = source.camera.position.clone().sub(source.controls.target);
    const sourceDistance = sourceOffset.length();
    const sourceBaseDistance = Math.max(source.baseDistance, 1e-6);
    const targetBaseDistance = Math.max(target.baseDistance, 1e-6);
    if (sourceOffset.lengthSq() <= 1e-8) {
      return;
    }

    const sourceDirection = sourceOffset.normalize();
    const zoomRatio = sourceDistance / sourceBaseDistance;
    const targetDistance = THREE.MathUtils.clamp(
      targetBaseDistance * zoomRatio,
      target.controls.minDistance,
      target.controls.maxDistance,
    );
    const sourcePanDelta = source.controls.target.clone().sub(source.anchorTarget);
    const panScale = targetBaseDistance / sourceBaseDistance;
    const targetPanDelta = sourcePanDelta.multiplyScalar(panScale);
    const targetOrbitTarget = target.anchorTarget.clone().add(targetPanDelta);

    orbitSyncLockRef.current = true;
    try {
      // Sync pan by transferring anchor-relative movement with scale compensation.
      target.controls.target.copy(targetOrbitTarget);
      target.camera.position
        .copy(target.controls.target)
        .add(sourceDirection.multiplyScalar(targetDistance));
      target.controls.update();
    } finally {
      orbitSyncLockRef.current = false;
    }
  }

  function resetOrbitView(view: {
    controls: OrbitControls;
  } | null) {
    if (!view) {
      return;
    }

    view.controls.reset();
  }

  function onOrbitReset() {
    orbitSyncLockRef.current = true;
    try {
      resetOrbitView(vrmViewRef.current);
      resetOrbitView(pmxViewRef.current);
    } finally {
      orbitSyncLockRef.current = false;
    }
  }

  async function previewPmxFromZip(zipBlob: Blob, syncOrbitFromVrm = false): Promise<void> {
    if (!pmxCanvasRef.current) {
      return;
    }

    cleanupPmxPreview();

    const canvas = pmxCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const loadingManager = new THREE.LoadingManager();
    let onPmxOrbitChanged: (() => void) | null = null;
    let frameId = 0;
    let loadedMesh: THREE.Object3D | null = null;
    const objectUrls: string[] = [];
    const assetMap = new Map<string, string>();

    const fitRendererSize = () => {
      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 320;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const disposePreview = () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", fitRendererSize);
      if (onPmxOrbitChanged) {
        controls.removeEventListener("change", onPmxOrbitChanged);
      }
      controls.dispose();
      if (loadedMesh) {
        scene.remove(loadedMesh);
      }
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      renderer.dispose();
      loadingManager.setURLModifier((url) => url);
    };

    pmxPreviewCleanupRef.current = disposePreview;

    try {
      scene.background = new THREE.Color("#eef4fb");
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
      keyLight.position.set(1.2, 2.5, 2.0);
      scene.add(keyLight);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      fitRendererSize();
      window.addEventListener("resize", fitRendererSize);

      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 1;
      controls.maxDistance = 300;

      const zipReader = new ZipReader(new BlobReader(zipBlob));
      const entries = await zipReader.getEntries();
      pmxDebug("zip entries", {
        count: entries.length,
        files: entries
          .map((entry) => {
            const current = entry as unknown as { filename?: string; directory?: boolean };
            return {
              name: current.filename ?? "",
              directory: !!current.directory,
            };
          })
          .slice(0, 80),
      });

      for (const entry of entries) {
        const current = entry as unknown as {
          filename?: string;
          directory?: boolean;
          getData?: (writer: BlobWriter) => Promise<Blob>;
        };
        if (current.directory || !current.filename || !current.getData) {
          continue;
        }

        const blob = await current.getData(new BlobWriter());
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);

        const normalizedPath = normalizeAssetPath(current.filename);
        assetMap.set(normalizedPath, objectUrl);
        assetMap.set(normalizedPath.toLowerCase(), objectUrl);
        const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
        assetMap.set(fileName, objectUrl);
        assetMap.set(fileName.toLowerCase(), objectUrl);
      }

      await zipReader.close();

      const pmxEntryName = [...assetMap.keys()].find((key) => /\.pmx$/i.test(key));
      if (!pmxEntryName) {
        throw new Error("PMX file was not found in converted ZIP.");
      }

      const pmxPath = normalizeAssetPath(pmxEntryName);
      pmxDebug("pmx path selected", { pmxPath });
      loadingManager.setURLModifier((url) => {
        if (url.startsWith("blob:")) {
          return url;
        }
        const normalized = normalizeAssetPath(url);
        return (
          assetMap.get(normalized) ??
          assetMap.get(normalized.toLowerCase()) ??
          assetMap.get((normalized.split("/").pop() ?? normalized).toLowerCase()) ??
          url
        );
      });

      const loader = new MMDLoader(loadingManager);
      const originalConsoleWarn = console.warn;
      const shouldSuppressWarn = createThreeWarnFilter();
      let mesh: THREE.SkinnedMesh;
      try {
        console.warn = (...args: unknown[]) => {
          if (shouldSuppressWarn(...args)) {
            return;
          }
          originalConsoleWarn(...args);
        };
        mesh = await loader.loadAsync(pmxPath);
      } finally {
        console.warn = originalConsoleWarn;
      }
      loadedMesh = mesh;
      scene.add(mesh);

      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      const materialNames: string[] = [];
      mesh.traverse((object) => {
        const maybeSkinnedMesh = object as THREE.SkinnedMesh;
        if (maybeSkinnedMesh.isSkinnedMesh) {
          skinnedMeshes.push(maybeSkinnedMesh);
        }

        const maybeMesh = object as THREE.Mesh;
        if (!maybeMesh.isMesh) {
          return;
        }

        const materials = Array.isArray(maybeMesh.material)
          ? maybeMesh.material
          : [maybeMesh.material];
        for (const material of materials) {
          if (material && typeof material.name === "string" && material.name) {
            materialNames.push(material.name);
          }
        }
      });

      pmxDebug("mesh summary", {
        type: mesh.type,
        childCount: mesh.children.length,
        skinnedMeshCount: skinnedMeshes.length,
        materialCount: new Set(materialNames).size,
        sampleMaterials: [...new Set(materialNames)].slice(0, 40),
      });

      const armBonePattern = /(腕|ひじ|手首|手捩|UpperArm|LowerArm|Hand|Elbow|Wrist)/i;
      const armBoneSnapshots: Array<{ name: string; local: [number, number, number]; world: [number, number, number] }> = [];
      for (const skinned of skinnedMeshes) {
        const skeleton = skinned.skeleton;
        if (!skeleton) {
          continue;
        }

        for (const bone of skeleton.bones) {
          if (!armBonePattern.test(bone.name)) {
            continue;
          }
          const world = new THREE.Vector3();
          bone.getWorldPosition(world);
          armBoneSnapshots.push({
            name: bone.name,
            local: [bone.position.x, bone.position.y, bone.position.z],
            world: [world.x, world.y, world.z],
          });
        }
      }

      pmxDebug("arm bone snapshots", {
        count: armBoneSnapshots.length,
        bones: armBoneSnapshots.slice(0, 80),
      });

      const bounds = new THREE.Box3().setFromObject(mesh);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      pmxDebug("bbox before center", {
        center: [center.x, center.y, center.z],
        size: [size.x, size.y, size.z],
      });
      mesh.position.sub(center);

      const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
      const fitHeightDistance = (size.y * 0.5) / Math.tan(halfFov);
      const fitWidthDistance = (size.x * 0.5) / (Math.tan(halfFov) * camera.aspect);
      const distance = Math.max(fitHeightDistance, fitWidthDistance, size.z) * 1.45;
      const targetY = size.y * 0.08;

      camera.position.set(0, targetY, Math.max(distance, 4));
      controls.target.set(0, targetY, 0);
      controls.update();
      controls.saveState();

      onPmxOrbitChanged = () => {
        syncOrbitBetweenViews("pmx");
      };

      pmxViewRef.current = {
        camera,
        controls,
        baseDistance: camera.position.distanceTo(controls.target),
        anchorTarget: controls.target.clone(),
      };
      controls.addEventListener("change", onPmxOrbitChanged);

      if (syncOrbitFromVrm) {
        syncOrbitBetweenViews("vrm", true);
      }

      const renderLoop = () => {
        frameId = window.requestAnimationFrame(renderLoop);
        controls.update();
        renderer.render(scene, camera);
      };
      renderLoop();
    } catch (error) {
      disposePreview();
      pmxPreviewCleanupRef.current = null;
      throw error;
    }
  }

  async function onConvert() {
    if (!file) {
      return;
    }

    if (taPoseAngle === 0) {
      const shouldContinue = window.confirm(
        "T/A Pose Convert is set to 0 degrees. Do you want to continue conversion?",
      );
      if (!shouldContinue) {
        setErrorDetail("");
        setMessage("Conversion canceled at 0 degree pose setting.");
        return;
      }
    }

    setStatus("uploading");
    setErrorDetail("");
    setConvertedOutput(null);
    abortControllerRef.current = new AbortController();
    setMessage(
      mode === "backend"
        ? "Converting with backend... this can take a while for large files."
        : backendEnabled
          ? "Trying Wasm first. If it fails, backend fallback will run."
          : "Converting with Wasm mode...",
    );

    try {
      const convertInput = await buildConvertInputFile(file);
      poseDebug("convert start", {
        requestedMode: mode,
        fileName: file.name,
        convertInputBytes: convertInput.size,
      });
      const result = await convertWithMode(convertInput, mode, {
        onProgress: (progress) => {
          setMessage(progress.message);
        },
        onLog: appendWorkerLog,
        signal: abortControllerRef.current.signal,
      });

      const nextOutput: ConvertedOutput = {
        blob: result.blob,
        fileExtension: result.fileExtension,
      };
      setConvertedOutput(nextOutput);

      if (result.fileExtension === "zip") {
        await previewPmxFromZip(result.blob, orbitSyncEnabled);
      } else {
        throw new Error("Current preview supports ZIP output with PMX resources.");
      }

      setStatus("done");
      if (result.fallbackReason) {
        setMessage(
          `Converted and previewed with fallback. Requested: ${mode}, used: ${result.usedMode}. Reason: ${result.fallbackReason} / Press Download ZIP to save file.`,
        );
      } else {
        setMessage(`Converted and previewed via ${result.usedMode}. Press Download ZIP to save file.`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatus("canceled");
        setMessage("Conversion canceled.");
      } else {
        const rawDetail = error instanceof Error ? error.message : String(error);
        console.error("convert.failed", {
          mode,
          backendEnabled,
          fileName: file?.name,
          detail: rawDetail,
          error,
        });

        setStatus("error");
        setErrorDetail(rawDetail);
        setMessage(
          toUserFriendlyConvertError(error, {
            mode,
            backendEnabled,
          }),
        );
        window.alert("Convert error. Please see Log View.");
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void onConvert();
  }

  function onDownload() {
    if (!file || !convertedOutput) {
      return;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "converted";
    const extension = convertedOutput.fileExtension;
    const url = URL.createObjectURL(convertedOutput.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Downloaded: ${baseName}.${extension}`);
  }

  function onCancel() {
    abortControllerRef.current?.abort();
  }

  function cleanupPreview() {
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
    vrmViewRef.current = null;
    upperArmStateRef.current = {
      leftBone: null,
      rightBone: null,
      leftBaseQuaternion: null,
      rightBaseQuaternion: null,
    };
  }

  function applyUpperArmAngle(angleDeg: number) {
    const angleRad = THREE.MathUtils.degToRad(angleDeg);
    const state = upperArmStateRef.current;

    if (state.leftBone && state.leftBaseQuaternion) {
      state.leftBone.quaternion.copy(state.leftBaseQuaternion);
      state.leftBone.rotateZ(angleRad);
    }

    if (state.rightBone && state.rightBaseQuaternion) {
      state.rightBone.quaternion.copy(state.rightBaseQuaternion);
      state.rightBone.rotateZ(-angleRad);
    }
  }

  useEffect(() => {
    orbitSyncEnabledRef.current = orbitSyncEnabled;
  }, [orbitSyncEnabled]);

  useEffect(() => {
    logEnabledRef.current = logEnabled;
  }, [logEnabled]);

  useEffect(() => {
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;

    console.log = (...args: unknown[]) => {
      originalLog(...args);
      appendConsoleLine(args);
    };
    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      appendConsoleLine(args);
    };
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      appendConsoleLine(args);
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      appendConsoleLine(args);
    };
    console.debug = (...args: unknown[]) => {
      originalDebug(...args);
      appendConsoleLine(args);
    };

    return () => {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
      console.error = originalError;
      console.debug = originalDebug;
    };
  }, []);

  useEffect(() => {
    if (!logEnabled || status !== "uploading") {
      return;
    }
    if (!logAreaRef.current) {
      return;
    }
    logAreaRef.current.scrollTop = logAreaRef.current.scrollHeight;
  }, [logEnabled, logLines, status]);

  useEffect(() => {
    if (copyStatus === "idle") {
      return;
    }

    const timer = window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1400);

    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    return () => {
      cleanupPreview();
      cleanupPmxPreview();
    };
  }, []);

  useEffect(() => {
    applyUpperArmAngle(taPoseAngle);
  }, [taPoseAngle]);

  async function previewVrmFile(targetFile: File) {
    if (!vrmCanvasRef.current) return;

    setIsPreviewing(true);
    setIsVrmReady(false);
    setErrorDetail("");
    setMessage("Loading VRM preview...");
    cleanupPreview();

    const canvas = vrmCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    let onVrmOrbitChanged: (() => void) | null = null;
    const clock = new THREE.Clock();
    let frameId = 0;
    let vrm: VRM | null = null;

    const fitRendererSize = () => {
      const width = canvas.clientWidth || 320;
      const height = canvas.clientHeight || 320;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const disposePreview = () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", fitRendererSize);
      if (onVrmOrbitChanged) {
        controls.removeEventListener("change", onVrmOrbitChanged);
      }
      controls.dispose();
      if (vrm) {
        scene.remove(vrm.scene);
      }
      renderer.dispose();
    };

    previewCleanupRef.current = disposePreview;

    try {
      scene.background = new THREE.Color("#eaf1fb");
      scene.add(new THREE.AmbientLight(0xffffff, 0.65));
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
      keyLight.position.set(1.5, 2.0, 2.0);
      scene.add(keyLight);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      fitRendererSize();
      window.addEventListener("resize", fitRendererSize);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 0.4;
      controls.maxDistance = 30;

      const loader = new GLTFLoader();
      loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));
      const arrayBuffer = await targetFile.arrayBuffer();
      const gltf = await loader.parseAsync(arrayBuffer, "");
      vrm = (gltf.userData.vrm as VRM | undefined) ?? null;

      if (!vrm) {
        throw new Error("Selected file does not contain VRM data.");
      }

      scene.add(vrm.scene);
      vrm.scene.rotation.y = Math.PI;

      const humanoid = vrm.humanoid;
      const leftUpperArm =
        humanoid?.getNormalizedBoneNode?.("leftUpperArm" as never) ??
        humanoid?.getRawBoneNode?.("leftUpperArm" as never) ??
        null;
      const rightUpperArm =
        humanoid?.getNormalizedBoneNode?.("rightUpperArm" as never) ??
        humanoid?.getRawBoneNode?.("rightUpperArm" as never) ??
        null;

      upperArmStateRef.current = {
        leftBone: leftUpperArm,
        rightBone: rightUpperArm,
        leftBaseQuaternion: leftUpperArm ? leftUpperArm.quaternion.clone() : null,
        rightBaseQuaternion: rightUpperArm ? rightUpperArm.quaternion.clone() : null,
      };
      applyUpperArmAngle(taPoseAngle);

      const bounds = new THREE.Box3().setFromObject(vrm.scene);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      vrm.scene.position.sub(center);

      const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
      const fitHeightDistance = (size.y * 0.5) / Math.tan(halfFov);
      const fitWidthDistance = (size.x * 0.5) / (Math.tan(halfFov) * camera.aspect);
      const distance = Math.max(fitHeightDistance, fitWidthDistance, size.z) * 1.25;
      const targetY = size.y * 0.1;

      camera.position.set(0, targetY, Math.max(distance, 1.2));
      controls.target.set(0, targetY, 0);
      controls.update();
      controls.saveState();

      onVrmOrbitChanged = () => {
        syncOrbitBetweenViews("vrm");
      };

      vrmViewRef.current = {
        camera,
        controls,
        baseDistance: camera.position.distanceTo(controls.target),
        anchorTarget: controls.target.clone(),
      };
      controls.addEventListener("change", onVrmOrbitChanged);

      const renderLoop = () => {
        frameId = window.requestAnimationFrame(renderLoop);
        vrm?.update(clock.getDelta());
        controls.update();
        renderer.render(scene, camera);
      };

      renderLoop();
      setIsVrmReady(true);
      setMessage(`Preview loaded: ${targetFile.name}. Drag to rotate, wheel to zoom.`);
    } catch (error) {
      const rawDetail = error instanceof Error ? error.message : String(error);
      setErrorDetail(rawDetail);
      setMessage("Failed to load VRM preview.");
      disposePreview();
      previewCleanupRef.current = null;
    } finally {
      setIsPreviewing(false);
    }
  }

  async function onPreviewVrm() {
    if (!file) return;
    await previewVrmFile(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setIsVrmReady(false);

    if (!selected) {
      cleanupPreview();
      cleanupPmxPreview();
      setConvertedOutput(null);
      setMessage("VRM file is not selected yet.");
      return;
    }

    void previewVrmFile(selected);
  }

  return (
    <main className="page">
      <div className="halo" />
      <section className="card">
        <h1>VRM to PMX Converter</h1>
        <section className="preview-grid" aria-label="Model previews">
          <figure className="preview-panel">
            <figcaption>VRM Preview</figcaption>
            <canvas
              ref={vrmCanvasRef}
              className="preview-canvas"
              aria-label="VRM preview canvas"
            />
          </figure>
          <figure className="preview-panel">
            <figcaption>PMX Preview</figcaption>
            <canvas
              ref={pmxCanvasRef}
              className="preview-canvas"
              aria-label="PMX preview canvas"
            />
          </figure>
        </section>

        <form className="form" onSubmit={onSubmit}>
          {/*
          <label htmlFor="mode" className="input-label">
            Convert mode
          </label>
          <select
            id="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as ConvertMode)}
            disabled={status === "uploading"}
          >
            <option value="wasm">Wasm (Pyodide runtime init)</option>
            {backendEnabled && (
              <option value="auto">
                Auto (Wasm first, then Backend fallback)
              </option>
            )}
            {backendEnabled && <option value="backend">Backend (FastAPI)</option>}
          </select>
          */}

          <div className="pose-and-pmx-tools-row" aria-label="Pose and PMX options">
            <div className="ta-pose-group">
              <div className="ta-pose-header">
                <label htmlFor="ta-pose-angle" className="input-label">
                  T/A Pose Convert
                </label>
                <span className="ta-pose-value">{taPoseAngle} deg</span>
              </div>
              <input
                id="ta-pose-angle"
                type="range"
                min={0}
                max={90}
                step={5}
                value={taPoseAngle}
                onChange={(event) => setTaPoseAngle(Number(event.target.value))}
                disabled={!file || isPreviewing || !isVrmReady}
              />
            </div>
            <div className="pmx-tools">
              <button
                type="button"
                className="pmx-tool-button"
                onClick={onOrbitReset}
              >
                Orbit Reset
              </button>
              <label className="pmx-tool-checkbox">
                <input
                  type="checkbox"
                  name="orbit-sync"
                  checked={orbitSyncEnabled}
                  onChange={(event) => setOrbitSyncEnabled(event.target.checked)}
                />
                <span>Orbit Sync</span>
              </label>
              <label className="pmx-tool-checkbox">
                <input
                  type="checkbox"
                  name="pmx-log"
                  checked={logEnabled}
                  onChange={(event) => setLogEnabled(event.target.checked)}
                />
                <span>Log</span>
              </label>
            </div>
          </div>

          <label htmlFor="vrm-input" className="input-label">
            Choose VRM file
          </label>
          <div className="file-picker-row">
            <input
              id="vrm-input"
              type="file"
              accept=".vrm,.glb"
              onChange={onFileChange}
            />
            <button
              type="button"
              className="preview-button"
              onClick={onPreviewVrm}
              disabled={!file || status === "uploading" || isPreviewing}
            >
              {isPreviewing ? "Previewing..." : "Preview VRM"}
            </button>
          </div>

          <div className="convert-actions">
            <button type="submit" disabled={!canConvert}>
              {status === "uploading" ? "Converting..." : "Convert"}
            </button>
            <button
              type="button"
              className="download-button"
              onClick={onDownload}
              disabled={!canDownload}
            >
              Download ZIP
            </button>
          </div>
          {status === "uploading" && (
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </form>

        <p className={`status status-${status}`}>{message}</p>
        {status === "error" && errorDetail && (
          <details>
            <summary>Show technical details</summary>
            <pre>{errorDetail}</pre>
          </details>
        )}
        {logEnabled && (
          <section className="log-panel" aria-label="Conversion log output">
            <div className="log-panel-header">
              <h2 className="log-panel-title">Log View</h2>
              <button
                type="button"
                className="log-copy-button"
                onClick={() => {
                  void onCopyLog();
                }}
              >
                {copyStatus === "done"
                  ? "Copied"
                  : copyStatus === "failed"
                    ? "Copy Failed"
                    : "Copy"}
              </button>
            </div>
            <div ref={logAreaRef} className="log-console" aria-live="polite">
              {logLines.map((line, index) => (
                <div
                  key={`${index}-${line.slice(0, 32)}`}
                  className={`log-line${isErrorLogLine(line) ? " log-line-error" : ""}`}
                >
                  {line}
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
