import * as Sentry from "@sentry/react";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import { type ChangeEvent, type DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { IoCopyOutline } from "react-icons/io5";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MMDLoader } from "three-stdlib";
import { useReactPWAInstall } from "react-pwa-install";
import AboutDialog from "./components/AboutDialog";
import { APP_VERSION } from "./constants/appInfo";
import {
  type ConvertMode,
  convertWithMode,
  isBackendFallbackEnabled,
  toUserFriendlyConvertError,
} from "./services/convertClient";
import type { WorkerLogResponse, WorkerProgressStage } from "./types/convert";
import { poseUpperArmsInGlb, poseDebug } from "./features/preview/lib/glbPose";
import { computePmxLightPreset, applyPmxLightTuning } from "./features/preview/lib/pmxLight";
import {
  detectQualityRiskSignals,
  createConversionReportId,
  reportQualitySignals,
} from "./features/convert/services/qualitySignals";
import { useUiSettings, PMX_LIGHT_DEFAULT_INTENSITY_SCALE, PMX_LIGHT_DEFAULT_CONTRAST_FACTOR } from "./features/settings/hooks/useUiSettings";
import { useErrorReportingConsent } from "./features/settings/hooks/useErrorReportingConsent";

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

const DEBUG_PMX = false;

type AppLocale = "ja" | "en";

type AppI18n = {
  errorReportingModalTitle: string;
  errorReportingModalDescription1: string;
  errorReportingModalDescription2: string;
  errorReportingEnable: string;
  errorReportingNotNow: string;
  fallbackReportConfirm: (requestedMode: ConvertMode, usedMode: ConvertMode, reason: string) => string;
  fallbackReportSubmittedMessage: string;
  qualityReportButton: string;
  qualityReportConfirm: string;
  qualityReportSubmittedMessage: string;
  qualityReportEnableHint: string;
  qualityAutoReportConfirm: (signals: string) => string;
  taPoseZeroConfirm: string;
  taPoseZeroCanceled: string;
  installButtonLabel: string;
  installUnsupportedHint: string;
  installDialogTitle: string;
  installDialogDescription: string;
};

const APP_I18N: Record<AppLocale, AppI18n> = {
  ja: {
    errorReportingModalTitle: "エラーレポート送信",
    errorReportingModalDescription1:
      "変換品質の改善のため、匿名のエラーレポート送信を有効化できます。",
    errorReportingModalDescription2:
      "ファイル内容そのものは送信しません。設定はフッターからいつでも変更できます。",
    errorReportingEnable: "有効にする",
    errorReportingNotNow: "今はしない",
    fallbackReportConfirm: (requestedMode, usedMode, reason) =>
      `フォールバックで変換されました。\n\n要求モード: ${requestedMode}\n使用モード: ${usedMode}\n理由: ${reason}\n\n匿名レポートを送信しますか？\n送信すると、将来このケースが改善される可能性があります。`,
    fallbackReportSubmittedMessage:
      "匿名レポートを送信しました。将来の変換品質改善につながる可能性があります。",
    qualityReportButton: "品質崩れを報告",
    qualityReportConfirm:
      "変換は完了しましたが見た目が崩れているケースとして、匿名レポートを送信しますか？\n送信すると、将来このケースが改善される可能性があります。",
    qualityReportSubmittedMessage:
      "匿名レポートを送信しました。将来の変換品質改善につながる可能性があります。",
    qualityReportEnableHint:
      "Error Reporting を有効にすると、成功時の品質崩れケースを匿名で報告できます。",
    qualityAutoReportConfirm: (signals) =>
      `変換は成功しましたが、品質崩れの可能性があるログを検出しました。\n\n検出シグナル: ${signals}\n\n匿名レポートを送信しますか？\n送信すると、将来このケースが改善される可能性があります。`,
    taPoseZeroConfirm: "T/A Pose が 0 度に設定されています。このまま変換を続けますか？",
    taPoseZeroCanceled: "0 度のポーズ設定により変換をキャンセルしました。",
    installButtonLabel: "Install",
    installUnsupportedHint: "ブラウザの共有メニューから「ホーム画面に追加」を選んでください。",
    installDialogTitle: "アプリをインストール",
    installDialogDescription: "デスクトップやホーム画面からすぐ起動できます。",
  },
  en: {
    errorReportingModalTitle: "Error Reporting",
    errorReportingModalDescription1:
      "Enable anonymous error reporting to help improve conversion quality.",
    errorReportingModalDescription2:
      "File content is not uploaded. You can change this option later from the footer.",
    errorReportingEnable: "Enable",
    errorReportingNotNow: "Not now",
    fallbackReportConfirm: (requestedMode, usedMode, reason) =>
      `Converted with fallback.\n\nRequested mode: ${requestedMode}\nUsed mode: ${usedMode}\nReason: ${reason}\n\nDo you want to send an anonymous report?\nIf sent, this case may be improved in a future release.`,
    fallbackReportSubmittedMessage:
      "Anonymous report submitted. This case may be improved in a future release.",
    qualityReportButton: "Report quality issue",
    qualityReportConfirm:
      "Conversion completed, but visual quality looks wrong. Send an anonymous report for this case?\nIf sent, this case may be improved in a future release.",
    qualityReportSubmittedMessage:
      "Anonymous report submitted. This case may be improved in a future release.",
    qualityReportEnableHint:
      "Enable Error Reporting to anonymously report successful conversions with quality issues.",
    qualityAutoReportConfirm: (signals) =>
      `Conversion succeeded, but possible quality-risk signals were detected in logs.\n\nDetected signals: ${signals}\n\nDo you want to send an anonymous report?\nIf sent, this case may be improved in a future release.`,
    taPoseZeroConfirm: "T/A Pose Convert is set to 0 degrees. Do you want to continue conversion?",
    taPoseZeroCanceled: "Conversion canceled at 0 degree pose setting.",
    installButtonLabel: "Install",
    installUnsupportedHint: "Use your browser menu and choose \"Add to Home Screen\".",
    installDialogTitle: "Install App",
    installDialogDescription: "Launch quickly from your home screen.",
  },
};

function detectAppLocale(language: string | undefined): AppLocale {
  const normalized = (language ?? "").toLowerCase();
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  return "en";
}

function getStageProgressPercent(stage: WorkerProgressStage): number {
  switch (stage) {
    case "init":
      return 8;
    case "pyodide-loading":
      return 26;
    case "py-src-sync":
      return 45;
    case "converting":
      return 80;
    case "finalizing":
      return 96;
    default:
      return 0;
  }
}


function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function hasTextureImageData(texture: THREE.Texture | null | undefined): boolean {
  if (!texture) {
    return false;
  }
  const tex = texture as THREE.Texture & {
    source?: { data?: unknown };
    image?: unknown;
  };
  return Boolean(tex.image || tex.source?.data);
}

function PwaInstallControl({ i18n }: { i18n: AppI18n }) {
  const { pwaInstall, supported, isInstalled } = useReactPWAInstall();

  if (isInstalled()) {
    return null;
  }

  if (!supported()) {
    return <span className="install-hint">{i18n.installUnsupportedHint}</span>;
  }

  const onInstallClick = () => {
    void pwaInstall({
      title: i18n.installDialogTitle,
      description: i18n.installDialogDescription,
    }).catch(() => {
      // User canceled native install prompt.
    });
  };

  return (
    <button type="button" className="footer-action-button footer-install-button" onClick={onInstallClick}>
      {i18n.installButtonLabel}
    </button>
  );
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const {
    mode, setMode,
    taPoseAngle, setTaPoseAngle,
    orbitSyncEnabled, setOrbitSyncEnabled, orbitSyncEnabledRef,
    logEnabled, setLogEnabled, logEnabledRef,
    gridEnabled, setGridEnabled, gridEnabledRef,
    pmxBrightnessScale, setPmxBrightnessScale,
    pmxContrastFactor, setPmxContrastFactor,
    isUiSettingsHydrated,
    resetToDefaults,
  } = useUiSettings();
  const {
    isErrorReportingEnabled,
    isErrorReportingPromptOpen,
    setIsErrorReportingPromptOpen,
    persistErrorReportingConsent,
    resetConsent,
  } = useErrorReportingConsent();
  const vrmGridRef = useRef<THREE.GridHelper | null>(null);
  const pmxGridRef = useRef<THREE.GridHelper | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logLinesRef = useRef<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "failed">("idle");
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const logAreaRef = useRef<HTMLDivElement | null>(null);
  const [isVrmReady, setIsVrmReady] = useState(false);
  const [message, setMessage] = useState("VRM file is not selected yet.");
  const [errorDetail, setErrorDetail] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isVrmDropActive, setIsVrmDropActive] = useState(false);
  const [convertProgressPercent, setConvertProgressPercent] = useState(0);
  const [convertProgressStage, setConvertProgressStage] = useState<WorkerProgressStage | "done" | null>(null);
  const [convertedOutput, setConvertedOutput] = useState<ConvertedOutput | null>(null);
  const [detectedQualityRiskSignals, setDetectedQualityRiskSignals] = useState<string[]>([]);
  const runtimeQualitySignalsRef = useRef<Set<string>>(new Set());
  const [lastUsedMode, setLastUsedMode] = useState<"backend" | "wasm" | null>(null);
  const [lastFallbackReason, setLastFallbackReason] = useState<string | null>(null);
  const [lastConversionReportId, setLastConversionReportId] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const vrmInputRef = useRef<HTMLInputElement | null>(null);
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
  const pmxLightRuntimeRef = useRef<{
    ambientLight: THREE.AmbientLight;
    keyLight: THREE.DirectionalLight;
    baseAmbient: number;
    baseDirectional: number;
    avgLuminance: number;
    brightMaterialRatio: number;
  } | null>(null);
  const orbitSyncLockRef = useRef(false);
  const upperArmStateRef = useRef<UpperArmState>({
    leftBone: null,
    rightBone: null,
    leftBaseQuaternion: null,
    rightBaseQuaternion: null,
  });
  const backendEnabled = isBackendFallbackEnabled();
  const appLocale = useMemo(
    () => detectAppLocale(typeof navigator !== "undefined" ? navigator.language : "en"),
    [],
  );
  const i18n = APP_I18N[appLocale];

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
      logLinesRef.current = next;
      return next;
    });
  }

  function appendWorkerLog(log: WorkerLogResponse) {
    appendConsoleLine(log.args);
  }

  useEffect(() => {
    const runtime = pmxLightRuntimeRef.current;
    if (!runtime) {
      return;
    }

    const tuned = applyPmxLightTuning(
      runtime.baseAmbient,
      runtime.baseDirectional,
      pmxBrightnessScale,
      pmxContrastFactor,
    );
    runtime.ambientLight.intensity = tuned.ambientIntensity;
    runtime.keyLight.intensity = tuned.directionalIntensity;
  }, [pmxBrightnessScale, pmxContrastFactor]);


  useEffect(() => {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const line = args.map((arg) => formatLogArg(arg)).join(" ").toLowerCase();
      if (line.includes("three.three.clock") && line.includes("deprecated")) {
        runtimeQualitySignalsRef.current.add("three-clock-deprecated");
      }
      if (line.includes("please use three.timer instead")) {
        runtimeQualitySignalsRef.current.add("three-timer-migration-warning");
      }
      originalWarn(...args);
    };

    return () => {
      console.warn = originalWarn;
    };
  }, []);


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

  function onAllReset() {
    const confirmed = window.confirm("Reset all settings and clear local storage?");
    if (!confirmed) {
      return;
    }

    cleanupPreview();
    cleanupPmxPreview();
    setConvertedOutput(null);
    setDetectedQualityRiskSignals([]);
    setLastUsedMode(null);
    setLastFallbackReason(null);
    setLastConversionReportId(null);
    setLogLines([]);
    logLinesRef.current = [];
    setCopyStatus("idle");
    setErrorDetail("");
    setStatus("idle");
    setConvertProgressPercent(0);
    setConvertProgressStage(null);
    setFile(null);
    setIsVrmReady(false);
    setMessage("VRM file is not selected yet.");
    setIsVrmDropActive(false);

    resetToDefaults();
    resetConsent();

    if (vrmInputRef.current) {
      vrmInputRef.current.value = "";
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
    pmxLightRuntimeRef.current = null;

    const canvas = pmxCanvasRef.current;
    if (!canvas) {
      return;
    }

    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (gl) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }

    const context2d = canvas.getContext("2d");
    context2d?.clearRect(0, 0, canvas.width, canvas.height);
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
        if (pmxGridRef.current) {
          scene.remove(pmxGridRef.current);
          pmxGridRef.current = null;
        }
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      renderer.dispose();
      loadingManager.setURLModifier((url) => url);
    };

    pmxPreviewCleanupRef.current = disposePreview;

    try {
      scene.background = new THREE.Color("#dde8f5");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // NoToneMapping: output colors without compression — best for MeshToonMaterial
      // so sRGB textures appear at full saturation, closer to VRM MToon vibrancy.
      renderer.toneMapping = THREE.NoToneMapping;
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
      scene.add(ambientLight);
      const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
      keyLight.position.set(2.8, 2.2, 1.2);
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

      // MMDLoader does not tag color textures as sRGB, causing double-gamma and
      // washed-out colors in Three.js r152+ (SRGBColorSpace output default).
      // Fix: mark diffuse/emissive/sphere textures as SRGBColorSpace.
      mesh.traverse((obj) => {
        const maybeMesh = obj as THREE.Mesh;
        if (!maybeMesh.isMesh) return;
        const mats = Array.isArray(maybeMesh.material)
          ? maybeMesh.material
          : [maybeMesh.material];
        for (const mat of mats) {
          if (!mat) continue;
          const m = mat as THREE.MeshToonMaterial & {
            emissiveMap?: THREE.Texture | null;
            matcap?: THREE.Texture | null;
          };
          if (m.color) {
            m.color.convertSRGBToLinear();
          }
          if (m.emissive) {
            m.emissive.convertSRGBToLinear();
          }
          if (m.map) {
            if (hasTextureImageData(m.map)) {
              m.map.colorSpace = THREE.SRGBColorSpace;
              m.map.needsUpdate = true;
            }
          }
          if (m.emissiveMap) {
            if (hasTextureImageData(m.emissiveMap)) {
              m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
              m.emissiveMap.needsUpdate = true;
            }
          }
          if (m.matcap) {
            if (hasTextureImageData(m.matcap)) {
              m.matcap.colorSpace = THREE.SRGBColorSpace;
              m.matcap.needsUpdate = true;
            }
          }
          m.needsUpdate = true;
        }
      });

      const lightPreset = computePmxLightPreset(mesh);
      pmxLightRuntimeRef.current = {
        ambientLight,
        keyLight,
        baseAmbient: lightPreset.ambientIntensity,
        baseDirectional: lightPreset.directionalIntensity,
        avgLuminance: lightPreset.avgLuminance,
        brightMaterialRatio: lightPreset.brightMaterialRatio,
      };

      const tunedLight = applyPmxLightTuning(
        lightPreset.ambientIntensity,
        lightPreset.directionalIntensity,
        pmxBrightnessScale,
        pmxContrastFactor,
      );
      ambientLight.intensity = tunedLight.ambientIntensity;
      keyLight.intensity = tunedLight.directionalIntensity;
      pmxDebug("light auto adjusted", {
        avgLuminance: Number(lightPreset.avgLuminance.toFixed(3)),
        brightMaterialRatio: Number(lightPreset.brightMaterialRatio.toFixed(3)),
        brightness: Number(pmxBrightnessScale.toFixed(2)),
        contrast: Number(pmxContrastFactor.toFixed(2)),
        ambientIntensity: Number(tunedLight.ambientIntensity.toFixed(3)),
        directionalIntensity: Number(tunedLight.directionalIntensity.toFixed(3)),
      });

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
      const distance = Math.max(fitHeightDistance, fitWidthDistance, size.z) * 1.25;
      const targetY = size.y * 0.1;

      camera.position.set(0, targetY, Math.max(distance, 1.2));
      controls.target.set(0, targetY, 0);
      controls.update();
      controls.saveState();

      // TODO: Grid visualization (debug feature)
      // Grid helper size calculation needs refinement to match camera view proportions
      // Currently disabled pending further tuning of grid dimensions relative to viewport
      // const gridSize = Math.max(size.x, size.z) * 1.5;
      // const gridSubdivisions = Math.ceil(gridSize / 2);
      // const grid = new THREE.GridHelper(gridSize, gridSubdivisions);
      // grid.visible = gridEnabledRef.current;
      // scene.add(grid);
      // pmxGridRef.current = grid;

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
      const shouldContinue = window.confirm(i18n.taPoseZeroConfirm);
      if (!shouldContinue) {
        setErrorDetail("");
        setMessage(i18n.taPoseZeroCanceled);
        return;
      }
    }

    setStatus("uploading");
    setErrorDetail("");
    setConvertedOutput(null);
    setDetectedQualityRiskSignals([]);
    setConvertProgressPercent(2);
    setConvertProgressStage("init");
    abortControllerRef.current = new AbortController();
    setMessage(
      mode === "backend"
        ? "Converting with backend... this can take a while for large files."
        : backendEnabled
          ? "Trying Wasm first. If it fails, backend fallback will run."
          : "Converting with Wasm mode...",
    );

    try {
      const convertLogStartIndex = logLinesRef.current.length;
      const convertInput = await buildConvertInputFile(file);
      poseDebug("convert start", {
        requestedMode: mode,
        fileName: file.name,
        convertInputBytes: convertInput.size,
      });
      const result = await convertWithMode(convertInput, mode, {
        onProgress: (progress) => {
          setMessage(progress.message);
          const nextPercent = getStageProgressPercent(progress.stage);
          setConvertProgressStage(progress.stage);
          setConvertProgressPercent((prev) => Math.max(prev, nextPercent));
        },
        onLog: appendWorkerLog,
        signal: abortControllerRef.current.signal,
      });

      const nextOutput: ConvertedOutput = {
        blob: result.blob,
        fileExtension: result.fileExtension,
      };
      const conversionReportId = createConversionReportId();
      setConvertedOutput(nextOutput);
      setLastUsedMode(result.usedMode);
      setLastFallbackReason(result.fallbackReason ?? null);
      setLastConversionReportId(conversionReportId);

      if (result.fileExtension === "zip") {
        await previewPmxFromZip(result.blob, orbitSyncEnabled);
      } else {
        throw new Error("Current preview supports ZIP output with PMX resources.");
      }

      setConvertProgressPercent(100);
      setConvertProgressStage("done");
      setStatus("done");
      if (result.fallbackReason) {
        setDetectedQualityRiskSignals([]);
        setMessage(
          `Converted and previewed with fallback. Requested: ${mode}, used: ${result.usedMode}. Reason: ${result.fallbackReason} / Press Download ZIP to save file. If preview quality looks wrong, use ${i18n.qualityReportButton}.`,
        );
      } else {
        const convertLogLines = logLinesRef.current.slice(convertLogStartIndex);
        const qualityRiskSignals = [
          ...new Set([
            ...detectQualityRiskSignals(convertLogLines),
            ...Array.from(runtimeQualitySignalsRef.current),
          ]),
        ];
        setDetectedQualityRiskSignals(qualityRiskSignals);

        setMessage(
          qualityRiskSignals.length > 0
            ? `Converted and previewed via ${result.usedMode}. Press Download ZIP to save file. If preview quality looks wrong, use ${i18n.qualityReportButton}.`
            : `Converted and previewed via ${result.usedMode}. Press Download ZIP to save file.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatus("canceled");
        setConvertProgressPercent(0);
        setConvertProgressStage(null);
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
        if (isErrorReportingEnabled) {
          const shouldSend = window.confirm(
            "An error occurred. Do you want to open the error report form and send an anonymous report?",
          );
          if (shouldSend) {
            let eventId: string | undefined;
            Sentry.withScope((scope) => {
              scope.setTag("mode", mode);
              scope.setTag("event_type", "error");
              scope.setContext("convert", {
                status: "failed",
                backendEnabled,
              });
              eventId = Sentry.captureException(
                error instanceof Error ? error : new Error(rawDetail),
              );
            });
            if (eventId) {
              Sentry.showReportDialog({ eventId });
            }
          }
        }

        setStatus("error");
        setConvertProgressPercent(0);
        setConvertProgressStage(null);
        setErrorDetail(rawDetail);
        setMessage(
          toUserFriendlyConvertError(error, {
            mode,
            backendEnabled,
          }),
        );
        // エラー時はLog Viewを自動展開してトレースバックを表示
        setLogEnabled(true);
        appendConsoleLine(["[ERROR] Convert failed:"]);
        rawDetail.split("\n").forEach((line) => appendConsoleLine([line]));
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

  function onReportQualityIssue() {
    if (status !== "done" || !convertedOutput) {
      return;
    }

    if (!isErrorReportingEnabled) {
      setMessage(i18n.qualityReportEnableHint);
      return;
    }

    const shouldSend = window.confirm(i18n.qualityReportConfirm);
    if (!shouldSend) {
      return;
    }

    reportQualitySignals({
      source: "user_reported",
      signals:
        detectedQualityRiskSignals.length > 0
          ? detectedQualityRiskSignals
          : [lastFallbackReason ?? "user-reported-visual-issue"],
      level: "info",
      requestedMode: mode,
      usedMode: lastUsedMode,
      backendEnabled,
      fileExtension: convertedOutput.fileExtension,
      dialogEnabled: false,
      status: "success_but_quality_issue",
      result: "success_user_reported_issue",
      conversionReportId: lastConversionReportId ?? createConversionReportId(),
    });

    setMessage(i18n.qualityReportSubmittedMessage);
    setDetectedQualityRiskSignals([]);
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
    const timer = new THREE.Timer();
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
        if (vrmGridRef.current) {
          scene.remove(vrmGridRef.current);
          vrmGridRef.current = null;
        }
      renderer.dispose();
    };

    previewCleanupRef.current = disposePreview;

    try {
      scene.background = new THREE.Color("#eaf1fb");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
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

      // Resync spring-bone runtime state after scene transforms to avoid
      // temporary hair jitter right after model load.
      vrm.springBoneManager?.reset();

      // TODO: Grid visualization (debug feature)
      // Grid helper size calculation needs refinement to match camera view proportions
      // Currently disabled pending further tuning of grid dimensions relative to viewport
      // const gridSize = Math.max(size.x, size.z) * 1.5;
      // const gridSubdivisions = Math.ceil(gridSize / 2);
      // const grid = new THREE.GridHelper(gridSize, gridSubdivisions);
      // grid.visible = gridEnabledRef.current;
      // scene.add(grid);
      // vrmGridRef.current = grid;

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
        timer.update();
        const delta = Math.min(timer.getDelta(), 1 / 30);
        vrm?.update(delta);
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
    cleanupPmxPreview();
    setConvertedOutput(null);
    setLogLines([]);
    setCopyStatus("idle");
    setErrorDetail("");
    setStatus("idle");
    await previewVrmFile(file);
  }

  function applySelectedVrmFile(selected: File | null) {
    cleanupPmxPreview();
    setConvertedOutput(null);
    setLogLines([]);
    setCopyStatus("idle");
    setErrorDetail("");

    setFile(selected);
    setIsVrmReady(false);
    setStatus("idle");

    if (!selected) {
      cleanupPreview();
      setMessage("VRM file is not selected yet.");
      return;
    }

    void previewVrmFile(selected);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    applySelectedVrmFile(selected);
  }

  function onVrmDropAreaDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    if (!isVrmDropActive) {
      setIsVrmDropActive(true);
    }
  }

  function onVrmDropAreaDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsVrmDropActive(false);
  }

  function onVrmDropAreaDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsVrmDropActive(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    if (!droppedFile) {
      return;
    }

    const lowerName = droppedFile.name.toLowerCase();
    if (!(lowerName.endsWith(".vrm") || lowerName.endsWith(".glb"))) {
      setMessage("Dropped file is not supported. Please drop a .vrm or .glb file.");
      return;
    }

    if (vrmInputRef.current) {
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(droppedFile);
        vrmInputRef.current.files = dataTransfer.files;
      } catch {
        // Some environments may block programmatic file list updates.
      }
    }

    applySelectedVrmFile(droppedFile);
  }

  return (
    <main className="page">
      <div className="halo" />
      <section className="card">
        <h2>VRM to PMX Converter</h2>
        <section className="preview-grid" aria-label="Model previews">
          <figure
            className={`preview-panel${isVrmDropActive ? " preview-panel-dropping" : ""}`}
            onDragOver={onVrmDropAreaDragOver}
            onDragLeave={onVrmDropAreaDragLeave}
            onDrop={onVrmDropAreaDrop}
          >
            <figcaption className="preview-caption">
              <span>VRM Preview</span>
              <a href="https://vroid.com/studio" target="_blank" rel="noopener noreferrer" className="preview-link">
                VRoid Studio
              </a>
            </figcaption>
            <div className="preview-canvas-wrap">
              <canvas
                ref={vrmCanvasRef}
                className="preview-canvas"
                aria-label="VRM preview canvas"
              />
              {!isVrmReady && !isPreviewing && (
                <div className="vrm-drop-placeholder" aria-hidden="true">
                  <div>Drop VRM file here</div>
                  <div className="vrm-drop-hint">(Only VRM 0.0 can be converted)</div>
                </div>
              )}
            </div>
          </figure>
          <figure className="preview-panel">
            <figcaption className="preview-caption">
              <span>PMX Preview</span>
              <a href="https://sites.google.com/view/vpvp/" target="_blank" rel="noopener noreferrer" className="preview-link">
                MikuMikuDance
              </a>
            </figcaption>
            <canvas
              ref={pmxCanvasRef}
              className="preview-canvas"
              aria-label="PMX preview canvas"
            />
            {/* 明るさデバッグ用（必要時にコメント解除）
            <div className="pmx-preview-adjustments" aria-label="PMX preview tuning">
              <div className="pmx-preview-adjustment-row">
                <label htmlFor="pmx-brightness" className="pmx-preview-adjustment-label">
                  Brightness
                </label>
                <span className="pmx-preview-adjustment-value">
                  {pmxBrightnessScale.toFixed(2)}
                </span>
              </div>
              <input
                id="pmx-brightness"
                type="range"
                min={0.6}
                max={1.2}
                step={0.01}
                value={pmxBrightnessScale}
                onChange={(event) => setPmxBrightnessScale(Number(event.target.value))}
              />
              <div className="pmx-preview-adjustment-row">
                <label htmlFor="pmx-contrast" className="pmx-preview-adjustment-label">
                  Contrast
                </label>
                <span className="pmx-preview-adjustment-value">
                  {pmxContrastFactor.toFixed(2)}
                </span>
              </div>
              <input
                id="pmx-contrast"
                type="range"
                min={0.8}
                max={1.4}
                step={0.01}
                value={pmxContrastFactor}
                onChange={(event) => setPmxContrastFactor(Number(event.target.value))}
              />
            </div>
            */}
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
              <div className="ta-pose-slider-wrapper">
                <input
                  id="ta-pose-angle"
                  type="range"
                  min={0}
                  max={90}
                  step={5}
                  value={taPoseAngle}
                  onChange={(event) => setTaPoseAngle(Number(event.target.value))}
                  disabled={!file || isPreviewing || !isVrmReady || status === "done" || status === "uploading"}
                />
              </div>
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
              {/*
                TODO: Grid toggle UI (debug feature)
                Grid rendering is intentionally disabled while viewport fit tuning is in progress.
              <label className="pmx-tool-checkbox">
                <input
                  type="checkbox"
                  name="grid"
                  checked={gridEnabled}
                  onChange={(event) => setGridEnabled(event.target.checked)}
                />
                <span>Grid</span>
              </label>
              */}
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

          <div className="file-label-row">
            <label htmlFor="vrm-input" className="input-label file-input-label">
              Choose VRM file
            </label>
            {status === "done" && convertedOutput && detectedQualityRiskSignals.length > 0 && (
              <button
                type="button"
                className="download-button quality-report-button"
                onClick={onReportQualityIssue}
                disabled={false}
              >
                {i18n.qualityReportButton}
              </button>
            )}
          </div>
          <div className="file-picker-row">
            <input
              ref={vrmInputRef}
              id="vrm-input"
              type="file"
              accept=".vrm,.glb"
              onClick={(event) => {
                event.currentTarget.value = "";
              }}
              onChange={onFileChange}
            />
            <button
              type="button"
              className="preview-button"
              onClick={onPreviewVrm}
              disabled={!file || status === "uploading" || isPreviewing}
            >
              {isPreviewing ? "Reloading..." : "Reload VRM"}
            </button>
          </div>

          <div className="convert-actions">
            <button
              type="submit"
              className={`convert-button${status === "uploading" ? ` is-uploading progress-${convertProgressStage ?? "init"}` : ""}`}
              disabled={!canConvert}
            >
              {status === "uploading" ? `Converting... ${Math.round(convertProgressPercent)}%` : "Convert"}
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
                title="copy"
                onClick={() => {
                  void onCopyLog();
                }}
              >
                <IoCopyOutline />
                {copyStatus === "done" && <span className="copy-status">Copied</span>}
                {copyStatus === "failed" && <span className="copy-status">Failed</span>}
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

        <footer className="app-footer" aria-label="Application footer actions">
          <div className="app-footer-meta">
            <p className="app-version">Version {APP_VERSION}</p>
            <PwaInstallControl i18n={i18n} />
          </div>
          <div className="app-footer-actions">
            <label className="footer-consent-checkbox" title="Anonymous error reporting">
              <input
                type="checkbox"
                name="error-reporting"
                checked={isErrorReportingEnabled}
                onChange={(event) => persistErrorReportingConsent(event.target.checked)}
              />
              <span>Error Reporting</span>
            </label>
            <button
              type="button"
              className="footer-action-button"
              onClick={() => setIsAboutOpen(true)}
            >
              About
            </button>
            <button
              type="button"
              className="footer-action-button footer-action-button-reset"
              onClick={onAllReset}
            >
              All Reset
            </button>
          </div>
        </footer>
      </section>

      <AboutDialog
        open={isAboutOpen}
        version={APP_VERSION}
        onClose={() => setIsAboutOpen(false)}
      />

      {isErrorReportingPromptOpen && (
        <div className="about-modal-backdrop" role="presentation">
          <section
            className="about-modal error-reporting-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="error-reporting-title"
          >
            <header className="about-modal-header">
              <h2 id="error-reporting-title">{i18n.errorReportingModalTitle}</h2>
            </header>
            <div className="about-modal-body">
              <p>{i18n.errorReportingModalDescription1}</p>
              <p>{i18n.errorReportingModalDescription2}</p>
              <div className="error-reporting-actions">
                <button
                  type="button"
                  className="footer-action-button"
                  onClick={() => {
                    persistErrorReportingConsent(true);
                    setIsErrorReportingPromptOpen(false);
                  }}
                >
                  {i18n.errorReportingEnable}
                </button>
                <button
                  type="button"
                  className="footer-action-button footer-action-button-reset"
                  onClick={() => {
                    persistErrorReportingConsent(false);
                    setIsErrorReportingPromptOpen(false);
                  }}
                >
                  {i18n.errorReportingNotNow}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
