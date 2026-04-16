import * as Sentry from "@sentry/react";
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import {
  type ChangeEvent,
  type DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FaCircleInfo } from "react-icons/fa6";
import { FaSkullCrossbones } from "react-icons/fa";
import { CiMaximize2 } from "react-icons/ci";
import { IoCopyOutline } from "react-icons/io5";
import { MdOutlineSettings } from "react-icons/md";
import CountUp from "react-countup";
import Swal from "sweetalert2";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  GLTFLoader,
  type GLTFParser,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MMDLoader } from "three-stdlib";
import { useReactPWAInstall } from "react-pwa-install";
import AboutDialog, {
  type TabId as AboutTabId,
} from "./components/AboutDialog";
import Dialog from "./components/Dialog";
import { APP_VERSION } from "./constants/appInfo";
import {
  type ConvertMode,
  convertWithMode,
  isBackendFallbackEnabled,
  toUserFriendlyConvertError,
} from "./services/convertClient";
import type { WorkerLogResponse, WorkerProgressStage } from "./types/convert";
import { poseUpperArmsInGlb, poseDebug } from "./features/preview/lib/glbPose";
import {
  computePmxLightPreset,
  applyPmxLightTuning,
} from "./features/preview/lib/pmxLight";
import {
  detectQualityRiskSignals,
  createConversionReportId,
  reportQualitySignals,
} from "./features/convert/services/qualitySignals";
import {
  detectProfileFromFile,
  type ProfileDetectionResult,
} from "./features/convert/services/profileDetection";
import {
  getWorldCounterFromFirestore,
  incrementWorldCounterOnFirestore,
} from "./services/worldCounter";
import {
  useUiSettings,
  PMX_LIGHT_DEFAULT_INTENSITY_SCALE,
  PMX_LIGHT_DEFAULT_CONTRAST_FACTOR,
} from "./features/settings/hooks/useUiSettings";
import {
  getRuntimeLogLevel,
  shouldCaptureLog,
  type ConsoleLogLevel,
} from "./utils/logging";

type Status = "idle" | "uploading" | "done" | "error" | "canceled";

type UpperArmState = {
  leftBone: THREE.Object3D | null;
  rightBone: THREE.Object3D | null;
  leftBaseQuaternion: THREE.Quaternion | null;
  rightBaseQuaternion: THREE.Quaternion | null;
  armPoseSign: 1 | -1;
};

type ConvertedOutput = {
  blob: Blob;
  fileExtension: "zip" | "pmx";
};

type PmxPreviewDiagnostics = {
  zipEntryCount: number;
  zipFileCount: number;
  zipTextureFileCount: number;
  zipTextureSamples: string[];
  zipPmxEntries: string[];
  selectedPmxPath: string;
  assetKeyCount: number;
  materialCount: number;
  materialSlotCount: number;
  vertexCount: number;
  triangleCount: number;
  boneCount: number;
  morphCount: number;
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

type InfoRow = {
  label: string;
  value: string;
  isLink: boolean;
};

type VrmInfoData = {
  summaryRows: InfoRow[];
  licenseRows: InfoRow[];
};

type PmxInfoData = {
  summaryRows: InfoRow[];
  licenseRows: InfoRow[];
};

type OutputCountMetrics = {
  vertices: number;
  faces: number;
  bones: number;
  morphs: number;
  materials: number;
  textures: number;
};

type OutputCountDiff = {
  delta: OutputCountMetrics;
  ratio: Record<keyof OutputCountMetrics, number | null>;
};

type QualityGateResult = {
  passed: boolean;
  reasons: string[];
};

const DEBUG_PMX = false;
const APP_LOG_LEVEL = getRuntimeLogLevel();
const NON_QUALITY_RUNTIME_SIGNALS = new Set<string>([
  "three-clock-deprecated",
  "three-timer-migration-warning",
]);

function getProfileLabel(profile: ProfileDetectionResult["profile"]): string {
  return profile === "vroid" ? "VRoid" : "Generic";
}

function getProfileFlags(result: ProfileDetectionResult): string[] {
  const flags = [];
  if (result.hasVrm0Extension) {
    flags.push("VRM0");
  }
  if (result.hasVrm1Extension) {
    flags.push("VRM1");
  }
  if (result.hasSpringExtension) {
    flags.push("Spring");
  }
  return flags;
}

type AppLocale = "ja" | "en" | "zh" | "ko";

type AppI18n = {
  errorReportingModalTitle: string;
  errorReportingModalDescription1: string;
  errorReportingModalDescription2: string;
  errorReportingEnable: string;
  errorReportingNotNow: string;
  fallbackReportConfirm: (
    requestedMode: ConvertMode,
    usedMode: ConvertMode,
    reason: string,
  ) => string;
  fallbackReportSubmittedMessage: string;
  qualityReportButton: string;
  qualityReportConfirm: string;
  qualityReportDialogSend: string;
  qualityReportDialogCancel: string;
  qualityReportSubmittedMessage: string;
  qualityReportEnableHint: string;
  qualityAutoReportConfirm: (signals: string) => string;
  allResetConfirmTitle: string;
  allResetConfirmMessage: string;
  allResetCounterLabel: string;
  taPoseZeroConfirm: string;
  taPoseZeroCanceled: string;
  turboLabsLabel: string;
  turboLabsEnableInSettingTooltip: string;
  turboLabsSettingLabel: string;
  installButtonLabel: string;
  installUnsupportedHint: string;
  installDialogTitle: string;
  installDialogDescription: string;
  restrictedRedistributionModificationConfirm: string;
  restrictedRedistributionModificationCancel: string;
  restrictedRedistributionModificationProceed: string;
  previewShaderErrorTitle: string;
  previewShaderErrorMessage: string;
  previewShaderErrorOk: string;
  heartButtonAriaLabel: string;
  heartDialogTitle: string;
  heartDialogPlaceholder: string;
  heartDialogCancel: string;
  heartDialogSubmit: string;
  heartDialogRemaining: (remaining: number) => string;
  heartDialogSent: string;
  heartDialogError: string;
  heartAlreadySent: string;
};

const LAST_LAUNCH_DATE_KEY = "vrm2pmx.last_launch_date";
const LAST_BOOT_VERSION_KEY = "vrm2pmx.last_boot_version";
const HEART_LOCK_UNTIL_KEY = "vrm2pmx.heart_lock_until";
const HEART_FEEDBACK_USER_ID_KEY = "vrm2pmx.feedback_user_id";
const LOCAL_COUNTER_KEY = "vrm2pmx.local_counter";
const COUNTER_DISPLAY_MODE_KEY = "vrm2pmx.counter_display_mode";
const METRICS_BASELINE_KEY_PREFIX = "vrm2pmx.metrics.baseline";
const MAX_USER_CONVERT_LOG_LINES = 240;
const CONVERT_HEARTBEAT_INTERVAL_MS = 2000;
const NIM_VERTEX_RATIO_LIMIT = 1.05;
const NIM_BONE_RATIO_TOLERANCE = 0.01;
const NIM_MORPH_RATIO_TOLERANCE = 0.01;
const HEART_SLACK_WEBHOOK_URL =
  (
    import.meta.env.VITE_HEART_SLACK_WEBHOOK_URL as string | undefined
  )?.trim() ?? "";
const HEART_GAS_WEB_APP_URL =
  (import.meta.env.VITE_HEART_GAS_WEB_APP_URL as string | undefined)?.trim() ??
  "";

function toOutputCountMetrics(
  diagnostics: PmxPreviewDiagnostics,
): OutputCountMetrics {
  return {
    vertices: diagnostics.vertexCount,
    faces: diagnostics.triangleCount,
    bones: diagnostics.boneCount,
    morphs: diagnostics.morphCount,
    materials: diagnostics.materialCount,
    textures: diagnostics.zipTextureFileCount,
  };
}

function buildMetricsBaselineKey(inputName: string): string {
  return `${METRICS_BASELINE_KEY_PREFIX}.${inputName}`;
}

function buildOutputCountDiff(
  current: OutputCountMetrics,
  baseline: OutputCountMetrics,
): OutputCountDiff {
  const delta: OutputCountMetrics = {
    vertices: current.vertices - baseline.vertices,
    faces: current.faces - baseline.faces,
    bones: current.bones - baseline.bones,
    morphs: current.morphs - baseline.morphs,
    materials: current.materials - baseline.materials,
    textures: current.textures - baseline.textures,
  };

  const ratio: OutputCountDiff["ratio"] = {
    vertices:
      baseline.vertices > 0
        ? Number((current.vertices / baseline.vertices).toFixed(6))
        : null,
    faces:
      baseline.faces > 0
        ? Number((current.faces / baseline.faces).toFixed(6))
        : null,
    bones:
      baseline.bones > 0
        ? Number((current.bones / baseline.bones).toFixed(6))
        : null,
    morphs:
      baseline.morphs > 0
        ? Number((current.morphs / baseline.morphs).toFixed(6))
        : null,
    materials:
      baseline.materials > 0
        ? Number((current.materials / baseline.materials).toFixed(6))
        : null,
    textures:
      baseline.textures > 0
        ? Number((current.textures / baseline.textures).toFixed(6))
        : null,
  };

  return { delta, ratio };
}

function evaluateNimQualityGate(diff: OutputCountDiff): QualityGateResult {
  const reasons: string[] = [];

  const vertexRatio = diff.ratio.vertices;
  if (vertexRatio !== null && vertexRatio > NIM_VERTEX_RATIO_LIMIT) {
    reasons.push(
      `vertices_ratio=${vertexRatio.toFixed(6)} > ${NIM_VERTEX_RATIO_LIMIT}`,
    );
  }

  const boneRatio = diff.ratio.bones;
  if (
    boneRatio !== null &&
    Math.abs(boneRatio - 1) > NIM_BONE_RATIO_TOLERANCE
  ) {
    reasons.push(
      `bones_ratio=${boneRatio.toFixed(6)} outside +/-${NIM_BONE_RATIO_TOLERANCE}`,
    );
  }

  const morphRatio = diff.ratio.morphs;
  if (
    morphRatio !== null &&
    Math.abs(morphRatio - 1) > NIM_MORPH_RATIO_TOLERANCE
  ) {
    reasons.push(
      `morphs_ratio=${morphRatio.toFixed(6)} outside +/-${NIM_MORPH_RATIO_TOLERANCE}`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

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
    qualityReportDialogSend: "送信",
    qualityReportDialogCancel: "キャンセル",
    qualityReportSubmittedMessage:
      "匿名レポートを送信しました。将来の変換品質改善につながる可能性があります。",
    qualityReportEnableHint:
      "Error Reporting を有効にすると、成功時の品質崩れケースを匿名で報告できます。",
    qualityAutoReportConfirm: (signals) =>
      `変換は成功しましたが、品質崩れの可能性があるログを検出しました。\n\n検出シグナル: ${signals}\n\n匿名レポートを送信しますか？\n送信すると、将来このケースが改善される可能性があります。`,
    allResetConfirmTitle: "リセット確認",
    allResetConfirmMessage:
      "すべての設定をリセットし、ローカルストレージをクリアしますか？",
    allResetCounterLabel: "変換カウンターもリセットする",
    taPoseZeroConfirm:
      "T/A Pose が 0 度に設定されています。このまま変換を続けますか？",
    taPoseZeroCanceled: "0 度のポーズ設定により変換をキャンセルしました。",
    turboLabsLabel: "Turbo (Labs)",
    turboLabsEnableInSettingTooltip:
      "有効にするにはセッティングを変更してください。",
    turboLabsSettingLabel: "Turbo: 爆速化を有効にする",
    installButtonLabel: "Install",
    installUnsupportedHint:
      "ブラウザの共有メニューから「ホーム画面に追加」を選んでください。",
    installDialogTitle: "アプリをインストール",
    installDialogDescription: "デスクトップやホーム画面からすぐ起動できます。",
    restrictedRedistributionModificationConfirm:
      "このモデルは、改変または、再配布が禁止されています。変換する場合は、個人の責任において実行してください",
    restrictedRedistributionModificationCancel: "キャンセル",
    restrictedRedistributionModificationProceed: "続行",
    previewShaderErrorTitle: "PMXプレビューエラー",
    previewShaderErrorMessage:
      "変換は成功していますが、PMXプレビューの描画でエラーが発生しました。\nZIPはダウンロード可能です。\n「品質崩れを報告」で送信していただければ将来の改善につながります。",
    previewShaderErrorOk: "OK",
    heartButtonAriaLabel: "開発者にハートを送る",
    heartDialogTitle: "開発者にハートを送る",
    heartDialogPlaceholder: "ひとことメッセージ（任意）",
    heartDialogCancel: "Cancel",
    heartDialogSubmit: "Thank You ❤",
    heartDialogRemaining: (remaining) => `残り ${remaining} 文字`,
    heartDialogSent: "ハートを送りました。ありがとうございます。",
    heartDialogError: "送信に失敗しました。時間をおいて再試行してください。",
    heartAlreadySent: "ありがとうございます。ハートは受け取り済みです。",
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
    qualityReportDialogSend: "Send",
    qualityReportDialogCancel: "Cancel",
    qualityReportSubmittedMessage:
      "Anonymous report submitted. This case may be improved in a future release.",
    qualityReportEnableHint:
      "Enable Error Reporting to anonymously report successful conversions with quality issues.",
    qualityAutoReportConfirm: (signals) =>
      `Conversion succeeded, but possible quality-risk signals were detected in logs.\n\nDetected signals: ${signals}\n\nDo you want to send an anonymous report?\nIf sent, this case may be improved in a future release.`,
    allResetConfirmTitle: "Confirm Reset",
    allResetConfirmMessage: "Reset all settings and clear local storage?",
    allResetCounterLabel: "Also reset the conversion counter",
    taPoseZeroConfirm:
      "T/A Pose Convert is set to 0 degrees. Do you want to continue conversion?",
    taPoseZeroCanceled: "Conversion canceled at 0 degree pose setting.",
    turboLabsLabel: "Turbo (Labs)",
    turboLabsEnableInSettingTooltip:
      "To enable this, please change the setting.",
    turboLabsSettingLabel: "Turbo: Enable high-speed mode",
    installButtonLabel: "Install",
    installUnsupportedHint:
      'Use your browser menu and choose "Add to Home Screen".',
    installDialogTitle: "Install App",
    installDialogDescription: "Launch quickly from your home screen.",
    restrictedRedistributionModificationConfirm:
      "This model prohibits modification or redistribution. If you proceed with conversion, please do so at your own responsibility.",
    restrictedRedistributionModificationCancel: "Cancel",
    restrictedRedistributionModificationProceed: "Proceed",
    previewShaderErrorTitle: "PMX Preview Error",
    previewShaderErrorMessage:
      'Conversion succeeded, and ZIP download is available, but PMX preview rendering failed.\nSending a report via "Report quality issue" helps future improvements.',
    previewShaderErrorOk: "OK",
    heartButtonAriaLabel: "Send a heart to the developer",
    heartDialogTitle: "Send a heart to the developer",
    heartDialogPlaceholder: "Leave a short message (optional)",
    heartDialogCancel: "Cancel",
    heartDialogSubmit: "Thank You ❤",
    heartDialogRemaining: (remaining) => `${remaining} characters left`,
    heartDialogSent: "Heart sent. Thank you!",
    heartDialogError: "Failed to send. Please try again later.",
    heartAlreadySent: "Thank you. Your heart has already been received.",
  },
  zh: {
    errorReportingModalTitle: "错误报告发送",
    errorReportingModalDescription1:
      "为改善转换质量，可启用匿名错误报告发送功能。",
    errorReportingModalDescription2:
      "不会上传文件内容本身。您可以随时从页脚更改设置。",
    errorReportingEnable: "启用",
    errorReportingNotNow: "暂不启用",
    fallbackReportConfirm: (requestedMode, usedMode, reason) =>
      `已使用备用方式转换。\n\n请求模式: ${requestedMode}\n使用模式: ${usedMode}\n原因: ${reason}\n\n是否发送匿名报告？\n发送后，该情况可能在未来版本中得到改善。`,
    fallbackReportSubmittedMessage:
      "已发送匿名报告。这有助于未来改善转换质量。",
    qualityReportButton: "报告质量问题",
    qualityReportConfirm:
      "转换完成，但外观存在问题。是否发送匿名报告？\n发送后，该情况可能在未来版本中得到改善。",
    qualityReportDialogSend: "发送",
    qualityReportDialogCancel: "取消",
    qualityReportSubmittedMessage: "已发送匿名报告。这有助于未来改善转换质量。",
    qualityReportEnableHint:
      "启用错误报告功能，可匿名报告转换成功但质量有问题的情况。",
    qualityAutoReportConfirm: (signals) =>
      `转换成功，但在日志中检测到可能存在质量问题的信号。\n\n检测信号: ${signals}\n\n是否发送匿名报告？\n发送后，该情况可能在未来版本中得到改善。`,
    allResetConfirmTitle: "重置确认",
    allResetConfirmMessage: "重置所有设置并清除本地存储吗？",
    allResetCounterLabel: "同时重置转换计数器",
    taPoseZeroConfirm: "T/A Pose 已设置为 0 度。确定继续转换吗？",
    taPoseZeroCanceled: "因 0 度姿势设置，已取消转换。",
    turboLabsLabel: "Turbo (Labs)",
    turboLabsEnableInSettingTooltip: "要启用此功能，请先在设置中更改。",
    turboLabsSettingLabel: "Turbo：启用高速模式",
    installButtonLabel: "Install",
    installUnsupportedHint: "请从浏览器菜单中选择「添加到主屏幕」。",
    installDialogTitle: "安装应用",
    installDialogDescription: "可从桌面或主屏幕快速启动。",
    restrictedRedistributionModificationConfirm:
      "此模型禁止改变或再分发。如需转换，请自行承担责任。",
    restrictedRedistributionModificationCancel: "取消",
    restrictedRedistributionModificationProceed: "继续",
    previewShaderErrorTitle: "PMX预览错误",
    previewShaderErrorMessage:
      "转换成功，ZIP可以下载，但PMX预览渲染失败。\n点击「报告质量问题」提交报告有助于未来改善。",
    previewShaderErrorOk: "OK",
    heartButtonAriaLabel: "向开发者发送爱心",
    heartDialogTitle: "向开发者发送爱心",
    heartDialogPlaceholder: "留言（可选）",
    heartDialogCancel: "Cancel",
    heartDialogSubmit: "Thank You ❤",
    heartDialogRemaining: (remaining) => `还可输入 ${remaining} 个字符`,
    heartDialogSent: "爱心已发送，感谢支持！",
    heartDialogError: "发送失败，请稍后重试。",
    heartAlreadySent: "感谢支持，已收到您的爱心。",
  },
  ko: {
    errorReportingModalTitle: "오류 리포트 전송",
    errorReportingModalDescription1:
      "변환 품질 개선을 위해 익명 오류 리포트 전송을 활성화할 수 있습니다.",
    errorReportingModalDescription2:
      "파일 내용 자체는 전송되지 않습니다. 설정은 푸터에서 언제든 변경할 수 있습니다.",
    errorReportingEnable: "활성화",
    errorReportingNotNow: "나중에",
    fallbackReportConfirm: (requestedMode, usedMode, reason) =>
      `폴백으로 변환되었습니다.\n\n요청 모드: ${requestedMode}\n사용 모드: ${usedMode}\n이유: ${reason}\n\n익명 리포트를 전송하시겠습니까?\n전송하면 향후 이 케이스의 품질 개선에 도움이 됩니다.`,
    fallbackReportSubmittedMessage:
      "익명 리포트를 전송했습니다. 향후 변환 품질 개선에 도움이 됩니다.",
    qualityReportButton: "품질 문제 신고",
    qualityReportConfirm:
      "변환은 완료되었지만 화면 품질이 올바르지 않습니다. 이 케이스를 익명으로 신고하시겠습니까?\n전송하면 향후 개선에 도움이 됩니다.",
    qualityReportDialogSend: "전송",
    qualityReportDialogCancel: "취소",
    qualityReportSubmittedMessage:
      "익명 리포트를 전송했습니다. 향후 변환 품질 개선에 도움이 됩니다.",
    qualityReportEnableHint:
      "Error Reporting을 활성화하면 성공한 변환의 품질 문제를 익명으로 보고할 수 있습니다.",
    qualityAutoReportConfirm: (signals) =>
      `변환은 성공했지만 로그에서 품질 저하 가능 신호가 감지되었습니다.\n\n감지 신호: ${signals}\n\n익명 리포트를 전송하시겠습니까?\n전송하면 향후 개선에 도움이 됩니다.`,
    allResetConfirmTitle: "리셋 확인",
    allResetConfirmMessage:
      "모든 설정을 리셋하고 로컬 스토리지를 초기화하시겠습니까?",
    allResetCounterLabel: "변환 카운터도 함께 리셋",
    taPoseZeroConfirm:
      "T/A Pose가 0도로 설정되어 있습니다. 이 상태로 변환을 계속하시겠습니까?",
    taPoseZeroCanceled: "0도 포즈 설정으로 인해 변환이 취소되었습니다.",
    turboLabsLabel: "Turbo (Labs)",
    turboLabsEnableInSettingTooltip:
      "활성화하려면 설정에서 먼저 변경해 주세요.",
    turboLabsSettingLabel: "Turbo: 고속 모드 활성화",
    installButtonLabel: "Install",
    installUnsupportedHint:
      "브라우저 메뉴에서 \"홈 화면에 추가\"를 선택해 주세요.",
    installDialogTitle: "앱 설치",
    installDialogDescription: "홈 화면이나 데스크톱에서 빠르게 실행할 수 있습니다.",
    restrictedRedistributionModificationConfirm:
      "이 모델은 개변 또는 재배포가 금지되어 있습니다. 변환을 진행하는 경우 개인 책임 하에 실행해 주세요.",
    restrictedRedistributionModificationCancel: "취소",
    restrictedRedistributionModificationProceed: "계속",
    previewShaderErrorTitle: "PMX 미리보기 오류",
    previewShaderErrorMessage:
      "변환은 성공했지만 PMX 미리보기 렌더링 중 오류가 발생했습니다.\nZIP은 다운로드할 수 있습니다.\n\"품질 문제 신고\"를 보내주시면 향후 개선에 도움이 됩니다.",
    previewShaderErrorOk: "OK",
    heartButtonAriaLabel: "개발자에게 하트 보내기",
    heartDialogTitle: "개발자에게 하트 보내기",
    heartDialogPlaceholder: "한 줄 메시지(선택)",
    heartDialogCancel: "취소",
    heartDialogSubmit: "Thank You ❤",
    heartDialogRemaining: (remaining) => `${remaining}자 남음`,
    heartDialogSent: "하트를 보냈습니다. 감사합니다.",
    heartDialogError: "전송에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    heartAlreadySent: "감사합니다. 이미 하트를 전달받았습니다.",
  },
};

function detectAppLocale(language: string | undefined): AppLocale {
  const normalized = (language ?? "").toLowerCase();
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  if (normalized.startsWith("ko")) {
    return "ko";
  }
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  return "en";
}

function localizeAllowDisallow(
  value: string,
  locale: AppLocale,
): { text: string; isNg: boolean } {
  const normalized = value.trim().toLowerCase();
  if (locale === "en") {
    return {
      text: value,
      isNg:
        normalized === "disallow" ||
        normalized === "prohibited" ||
        normalized.endsWith("_prohibited"),
    };
  }

  const jaValueMap: Record<string, { text: string; isNg: boolean }> = {
    allow: { text: "OK", isNg: false },
    disallow: { text: "NG", isNg: true },
    prohibited: { text: "NG", isNg: true },
    true: { text: "OK", isNg: false },
    false: { text: "NG", isNg: true },
    allow_modification: { text: "OK", isNg: false },
    allow_modification_redistribution: { text: "OK", isNg: false },
    allowmodification: { text: "OK", isNg: false },
    allowmodificationredistribution: { text: "OK", isNg: false },
    redistribution_prohibited: { text: "再配布禁止", isNg: true },
    modification_prohibited: { text: "改変禁止", isNg: true },
    onlyauthor: { text: "アバター作者のみ", isNg: false },
    explicitlylicensedperson: { text: "明示的に許可された人のみ", isNg: false },
    everyone: { text: "誰でも", isNg: false },
    personalnonprofit: { text: "個人・非営利", isNg: false },
    personalprofit: { text: "個人・営利", isNg: false },
    corporation: { text: "法人", isNg: false },
    required: { text: "必要", isNg: false },
    unnecessary: { text: "不要", isNg: false },
  };

  const zhValueMap: Record<string, { text: string; isNg: boolean }> = {
    allow: { text: "OK", isNg: false },
    disallow: { text: "NG", isNg: true },
    prohibited: { text: "NG", isNg: true },
    true: { text: "OK", isNg: false },
    false: { text: "NG", isNg: true },
    allow_modification: { text: "OK", isNg: false },
    allow_modification_redistribution: { text: "OK", isNg: false },
    allowmodification: { text: "OK", isNg: false },
    allowmodificationredistribution: { text: "OK", isNg: false },
    redistribution_prohibited: { text: "禁止再分发", isNg: true },
    modification_prohibited: { text: "禁止改变", isNg: true },
    onlyauthor: { text: "仅限模型作者", isNg: false },
    explicitlylicensedperson: { text: "仅限明确授权的人", isNg: false },
    everyone: { text: "任何人", isNg: false },
    personalnonprofit: { text: "个人・非营利", isNg: false },
    personalprofit: { text: "个人・营利", isNg: false },
    corporation: { text: "法人", isNg: false },
    required: { text: "必要", isNg: false },
    unnecessary: { text: "不需要", isNg: false },
  };

  const koValueMap: Record<string, { text: string; isNg: boolean }> = {
    allow: { text: "허용", isNg: false },
    disallow: { text: "금지", isNg: true },
    prohibited: { text: "금지", isNg: true },
    true: { text: "허용", isNg: false },
    false: { text: "금지", isNg: true },
    allow_modification: { text: "허용", isNg: false },
    allow_modification_redistribution: { text: "허용", isNg: false },
    allowmodification: { text: "허용", isNg: false },
    allowmodificationredistribution: { text: "허용", isNg: false },
    redistribution_prohibited: { text: "재배포 금지", isNg: true },
    modification_prohibited: { text: "개변 금지", isNg: true },
    onlyauthor: { text: "아바타 작성자만", isNg: false },
    explicitlylicensedperson: { text: "명시적으로 허가된 사람만", isNg: false },
    everyone: { text: "누구나", isNg: false },
    personalnonprofit: { text: "개인·비영리", isNg: false },
    personalprofit: { text: "개인·영리", isNg: false },
    corporation: { text: "법인", isNg: false },
    required: { text: "필수", isNg: false },
    unnecessary: { text: "불필요", isNg: false },
  };

  const valueMap =
    locale === "zh" ? zhValueMap : locale === "ko" ? koValueMap : jaValueMap;
  const mapped = valueMap[normalized];
  if (mapped) {
    return mapped;
  }

  if (normalized.endsWith("_prohibited")) {
    return { text: "NG", isNg: true };
  }

  return { text: value, isNg: false };
}

function localizeMetadataLabel(label: string, locale: AppLocale): string {
  if (locale === "en") {
    return label;
  }

  if (locale === "ko") {
    if (label.startsWith("Reference URL ")) {
      return label.replace("Reference URL ", "참조 URL ");
    }
    if (label.startsWith("Reference ")) {
      return label.replace("Reference ", "참조 ");
    }
    const koLabelMap: Record<string, string> = {
      Title: "제목",
      Author: "작성자",
      Contact: "연락처",
      Reference: "참조",
      Version: "버전",
      Copyright: "저작권",
      "Avatar Permission": "아바타 인격 부여 허용 범위",
      "Commercial Usage": "상업적 이용 허가",
      "Credit Notation": "크레딧 표기",
      Modification: "개변 허가",
      "Allow Redistribution": "재배포 허가",
      "Allow Violent Usage": "폭력적 표현 허가",
      "Allow Sexual Usage": "성적 표현 허가",
      "Allow Political/Religious": "정치/종교 이용 허가",
      "Allow Antisocial/Hate": "반사회/혐오 이용 허가",
      "License URL": "라이선스 URL",
      "Other License URL": "기타 라이선스 URL",
      "Third Party Licenses": "서드파티 라이선스",
      "Allowed User": "허용 사용자",
      "Violent Usage": "폭력적 표현 허가",
      "Sexual Usage": "성적 표현 허가",
      "License Name": "라이선스 이름",
      "Other Permission URL": "기타 허가 조건 URL",
      "Model Name": "모델명",
      "Model Name EN": "모델명(영문)",
      Comment: "코멘트",
      "Comment EN": "코멘트(영문)",
      Vertices: "정점 수",
      Faces: "면 수",
      Materials: "재질 수",
      Bones: "본 수",
      Morphs: "모프 수",
      "Rigid Bodies": "강체 수",
      Constraints: "조인트 수",
      License: "라이선스",
    };
    return koLabelMap[label] ?? label;
  }

  if (locale === "zh") {
    if (label.startsWith("Reference URL ")) {
      return label.replace("Reference URL ", "参考URL ");
    }
    if (label.startsWith("Reference ")) {
      return label.replace("Reference ", "参考 ");
    }
    const zhLabelMap: Record<string, string> = {
      Title: "标题",
      Author: "作者",
      Contact: "联系方式",
      Reference: "参考",
      Version: "版本",
      Copyright: "版权",
      "Avatar Permission": "赋予模型人格的许可范围",
      "Commercial Usage": "商业用途许可",
      "Credit Notation": "署名要求",
      Modification: "改变许可",
      "Allow Redistribution": "再分发许可",
      "Allow Violent Usage": "暴力表现许可",
      "Allow Sexual Usage": "性表现许可",
      "Allow Political/Religious": "政治・宗教利用许可",
      "Allow Antisocial/Hate": "反社会・仇恨利用许可",
      "License URL": "许可证URL",
      "Other License URL": "其他许可证URL",
      "Third Party Licenses": "第三方许可证",
      "Allowed User": "允许使用者",
      "Violent Usage": "暴力表现许可",
      "Sexual Usage": "性表现许可",
      "License Name": "许可证类型",
      "Other Permission URL": "其他许可条件URL",
      "Model Name": "模型名称",
      "Model Name EN": "模型名称（英文）",
      Comment: "备注",
      "Comment EN": "备注（英文）",
      Vertices: "顶点数",
      Faces: "面数",
      Materials: "材质数",
      Bones: "骨骼数",
      Morphs: "变形数",
      "Rigid Bodies": "刚体数",
      Constraints: "关节数",
      License: "许可证",
    };
    return zhLabelMap[label] ?? label;
  }

  if (label.startsWith("Reference URL ")) {
    return label.replace("Reference URL ", "参照URL ");
  }
  if (label.startsWith("Reference ")) {
    return label.replace("Reference ", "参照 ");
  }

  const jaLabelMap: Record<string, string> = {
    Title: "タイトル",
    Author: "作者",
    Contact: "連絡先",
    Reference: "参照",
    Version: "バージョン",
    Copyright: "コピーライト",
    "Avatar Permission": "アバターに人格を与えることの許諾範囲",
    "Commercial Usage": "商用利用の許可",
    "Credit Notation": "クレジット表記",
    Modification: "改変の許可",
    "Allow Redistribution": "再配布の許可",
    "Allow Violent Usage": "このアバターを用いて暴力表現を演じることの許可",
    "Allow Sexual Usage": "このアバターを用いて性的表現を演じることの許可",
    "Allow Political/Religious": "政治・宗教利用の許可",
    "Allow Antisocial/Hate": "反社会・ヘイト利用の許可",
    "License URL": "ライセンスURL",
    "Other License URL": "その他ライセンスURL",
    "Third Party Licenses": "第三者ライセンス",
    "Allowed User": "アバターに人格を与えることの許諾範囲",
    "Violent Usage": "このアバターを用いて暴力表現を演じることの許可",
    "Sexual Usage": "このアバターを用いて性的表現を演じることの許可",
    "License Name": "ライセンスタイプ",
    "Other Permission URL": "その他許諾条件URL",
    "Model Name": "モデル名",
    "Model Name EN": "モデル名(英語)",
    Comment: "コメント",
    "Comment EN": "コメント(英語)",
    Vertices: "頂点数",
    Faces: "面数",
    Materials: "マテリアル数",
    Bones: "ボーン数",
    Morphs: "モーフ数",
    "Rigid Bodies": "剛体数",
    Constraints: "ジョイント数",
    License: "ライセンス",
  };

  return jaLabelMap[label] ?? label;
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
    'THREE.GLTFLoader: Unknown extension "KHR_materials_pbrSpecularGlossiness"',
    'Unknown extension "KHR_materials_pbrSpecularGlossiness"',
  ];

  return (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : String(args[0] ?? "");
    return noisyPatterns.some((pattern) => first.includes(pattern));
  };
}

async function applySpecGlossinessFallback(gltf: unknown): Promise<void> {
  const parsed = gltf as {
    scene?: THREE.Object3D;
    parser?: {
      associations?: Map<unknown, { materials?: number }>;
      json?: { materials?: Array<Record<string, unknown>> };
      getDependency?: (type: string, index: number) => Promise<unknown>;
    };
  };
  const parser = parsed.parser;
  if (!parsed.scene || !parser || !parser.associations || !parser.json) {
    return;
  }

  const associations = parser.associations;
  const materialDefs = parser.json.materials ?? [];
  const textureTasks: Promise<void>[] = [];
  const visited = new Set<THREE.Material>();

  parsed.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) {
      return;
    }

    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (!material || visited.has(material)) {
        continue;
      }
      visited.add(material);

      const relation = associations.get(material);
      const materialIndex = relation?.materials;
      if (typeof materialIndex !== "number") {
        continue;
      }

      const materialDef = materialDefs[materialIndex] ?? null;
      const extensions = (materialDef?.extensions ?? {}) as Record<
        string,
        unknown
      >;
      const specGloss = (extensions.KHR_materials_pbrSpecularGlossiness ??
        null) as Record<string, unknown> | null;
      if (!specGloss) {
        continue;
      }

      const standardMaterial = material as THREE.MeshStandardMaterial;
      const diffuseFactor = Array.isArray(specGloss.diffuseFactor)
        ? (specGloss.diffuseFactor as number[])
        : [1, 1, 1, 1];

      if (standardMaterial.color) {
        standardMaterial.color.setRGB(
          Number(diffuseFactor[0] ?? 1),
          Number(diffuseFactor[1] ?? 1),
          Number(diffuseFactor[2] ?? 1),
        );
      }

      const alpha = Number(diffuseFactor[3] ?? 1);
      if (Number.isFinite(alpha)) {
        standardMaterial.opacity = alpha;
        standardMaterial.transparent = alpha < 1;
      }

      const diffuseTexture = specGloss.diffuseTexture as
        | { index?: number }
        | undefined;
      if (
        diffuseTexture &&
        typeof diffuseTexture.index === "number" &&
        typeof parser.getDependency === "function"
      ) {
        textureTasks.push(
          parser
            .getDependency("texture", diffuseTexture.index)
            .then((texture) => {
              const map = texture as THREE.Texture;
              standardMaterial.map = map;
              map.colorSpace = THREE.SRGBColorSpace;
              map.needsUpdate = true;
              standardMaterial.needsUpdate = true;
            })
            .catch(() => {
              // Keep fallback color when texture cannot be loaded.
            }),
        );
      } else {
        standardMaterial.needsUpdate = true;
      }
    }
  });

  if (textureTasks.length > 0) {
    await Promise.all(textureTasks);
  }
}

type FolderZipEntry = {
  file: File;
  relativePath: string;
};

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = entry.createReader();

    const all: FileSystemEntry[] = [];
    const loop = () => {
      reader.readEntries(
        (batch) => {
          if (!batch || batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          loop();
        },
        (error) => reject(error),
      );
    };
    loop();
  });
}

async function collectFolderEntriesRecursively(
  entry: FileSystemEntry,
  prefix: string,
): Promise<FolderZipEntry[]> {
  const pathPart = entry.name || "";
  const relativePath = prefix ? `${prefix}/${pathPart}` : pathPart;

  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry);
    return [{ file, relativePath }];
  }

  if (!entry.isDirectory) {
    return [];
  }

  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry);
  const nestedResults = await Promise.all(
    children.map((child) => collectFolderEntriesRecursively(child, relativePath)),
  );
  return nestedResults.flat();
}

function normalizeAssetPath(path: string): string {
  let noQuery = path.split("?")[0].split("#")[0] || "";

  if (/^(blob:|https?:)/i.test(noQuery)) {
    try {
      const unwrap = noQuery.startsWith("blob:") ? noQuery.slice(5) : noQuery;
      noQuery = new URL(unwrap).pathname || noQuery;
    } catch {
      // Keep original string when URL parsing fails.
    }
  }

  const decoded = decodeURIComponent(noQuery);
  return decoded.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function buildAssetLookupCandidates(path: string): string[] {
  const normalized = normalizeAssetPath(path);
  const segments = normalized
    .split("/")
    .filter((segment) => segment.length > 0);
  const candidates = new Set<string>();

  if (normalized) {
    candidates.add(normalized);
    candidates.add(normalized.toLowerCase());
  }

  const fileName = segments[segments.length - 1] ?? normalized;
  if (fileName) {
    candidates.add(fileName);
    candidates.add(fileName.toLowerCase());
  }

  for (let i = 1; i < segments.length - 1; i += 1) {
    const suffix = segments.slice(i).join("/");
    if (!suffix) {
      continue;
    }
    candidates.add(suffix);
    candidates.add(suffix.toLowerCase());
  }

  return [...candidates];
}

function getFileExtensionLower(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) {
    return "";
  }
  return fileName.slice(index).toLowerCase();
}

function isConvertSupportedInputFile(fileName: string): boolean {
  const ext = getFileExtensionLower(fileName);
  return ext === ".vrm" || ext === ".glb";
}

function isPreviewSupportedInputFile(fileName: string): boolean {
  const ext = getFileExtensionLower(fileName);
  return ext === ".vrm" || ext === ".glb" || ext === ".gltf" || ext === ".zip";
}

function isPmxPreviewSupportedInputFile(fileName: string): boolean {
  const ext = getFileExtensionLower(fileName);
  return ext === ".pmx" || ext === ".zip";
}

type ResolvedPreviewInput =
  | {
      kind: "binary";
      fileName: string;
      buffer: ArrayBuffer;
      cleanup: () => void;
    }
  | {
      kind: "gltf-json";
      fileName: string;
      gltfText: string;
      baseDir: string;
      assetUrlMap: Map<string, string>;
      cleanup: () => void;
    };

async function resolvePreviewInput(targetFile: File): Promise<ResolvedPreviewInput> {
  const ext = getFileExtensionLower(targetFile.name);
  if (ext === ".vrm" || ext === ".glb") {
    return {
      kind: "binary",
      fileName: targetFile.name,
      buffer: await targetFile.arrayBuffer(),
      cleanup: () => undefined,
    };
  }

  if (ext === ".gltf") {
    return {
      kind: "gltf-json",
      fileName: targetFile.name,
      gltfText: await targetFile.text(),
      baseDir: "",
      assetUrlMap: new Map<string, string>(),
      cleanup: () => undefined,
    };
  }

  if (ext !== ".zip") {
    throw new Error("Unsupported preview input. Please use .vrm/.glb/.gltf/.zip");
  }

  const zipReader = new ZipReader(new BlobReader(targetFile));
  const objectUrls: string[] = [];
  try {
    const entries = await zipReader.getEntries();
    const fileEntries = entries.filter((entry) => {
      const current = entry as unknown as {
        directory?: boolean;
        filename?: string;
      };
      return !current.directory && Boolean(current.filename);
    });

    const gltfEntry = fileEntries.find((entry) => {
      const current = entry as unknown as { filename?: string };
      return current.filename?.toLowerCase().endsWith(".gltf");
    });
    const glbEntry = fileEntries.find((entry) => {
      const current = entry as unknown as { filename?: string };
      return current.filename?.toLowerCase().endsWith(".glb");
    });

    const mainEntry = gltfEntry ?? glbEntry;
    if (!mainEntry) {
      throw new Error("ZIP must contain a .gltf or .glb file.");
    }

    const mainCurrent = mainEntry as unknown as {
      filename?: string;
      getData?: (writer: BlobWriter) => Promise<Blob>;
    };
    if (!mainCurrent.filename || !mainCurrent.getData) {
      throw new Error("Failed to read main model entry from ZIP.");
    }

    const assetUrlMap = new Map<string, string>();
    let mainBlob: Blob | null = null;
    let mainName = "";

    for (const entry of fileEntries) {
      const current = entry as unknown as {
        filename?: string;
        getData?: (writer: BlobWriter) => Promise<Blob>;
      };
      if (!current.filename || !current.getData) {
        continue;
      }

      const blob = await current.getData(new BlobWriter());
      const url = URL.createObjectURL(blob);
      objectUrls.push(url);

      const candidates = buildAssetLookupCandidates(current.filename);
      for (const candidate of candidates) {
        if (!assetUrlMap.has(candidate)) {
          assetUrlMap.set(candidate, url);
        }
      }

      if (current.filename === mainCurrent.filename) {
        mainBlob = blob;
        mainName = current.filename;
      }
    }

    if (!mainBlob) {
      throw new Error("Failed to load main model data from ZIP.");
    }

    const cleanup = () => {
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };

    if (mainName.toLowerCase().endsWith(".glb")) {
      return {
        kind: "binary",
        fileName: mainName,
        buffer: await mainBlob.arrayBuffer(),
        cleanup,
      };
    }

    const normalizedMainPath = normalizeAssetPath(mainName);
    const slashIndex = normalizedMainPath.lastIndexOf("/");
    const baseDir = slashIndex >= 0 ? normalizedMainPath.slice(0, slashIndex + 1) : "";

    return {
      kind: "gltf-json",
      fileName: mainName,
      gltfText: await mainBlob.text(),
      baseDir,
      assetUrlMap,
      cleanup,
    };
  } finally {
    await zipReader.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value.trim());
}

function createInfoRow(label: string, value: string): InfoRow {
  return {
    label,
    value,
    isLink: isLikelyUrl(value),
  };
}

function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s)"'<>]+/giu);
  if (!matches) {
    return [];
  }
  return [...new Set(matches)];
}

function getUrlParamLikeValue(url: string, key: string): string {
  if (!url || !key) {
    return "";
  }
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[?&#\/&])${escapedKey}=([^&#]+)`, "i");
  const match = url.match(pattern);
  if (!match || !match[1]) {
    return "";
  }
  try {
    return decodeURIComponent(match[1]).trim();
  } catch {
    return match[1].trim();
  }
}

function pushInfoRow(rows: InfoRow[], label: string, value: unknown) {
  const text = asString(value);
  if (!text) {
    return;
  }
  rows.push(createInfoRow(label, text));
}

function extractVrmInfoData(gltf: unknown): VrmInfoData {
  const parserJson = asRecord(
    (gltf as { parser?: { json?: unknown } })?.parser?.json,
  );
  const extensions = asRecord(parserJson.extensions);
  const asset = asRecord(parserJson.asset);
  const vrm1 = asRecord(extensions.VRMC_vrm);
  const vrm0Meta = asRecord(asRecord(extensions.VRM).meta);
  const vrm1Meta = asRecord(vrm1.meta);

  const summaryRows: InfoRow[] = [];
  const licenseRows: InfoRow[] = [];

  if (Object.keys(vrm1Meta).length > 0) {
    pushInfoRow(summaryRows, "Title", vrm1Meta.name);

    const authors = asStringArray(vrm1Meta.authors);
    if (authors.length > 0) {
      summaryRows.push(createInfoRow("Author", authors.join(", ")));
    }

    pushInfoRow(
      summaryRows,
      "Version",
      vrm1Meta.version || vrm1.specVersion || asset.version,
    );

    pushInfoRow(summaryRows, "Contact", vrm1Meta.contactInformation);
    pushInfoRow(summaryRows, "Copyright", vrm1Meta.copyrightInformation);

    const references = asStringArray(vrm1Meta.references);
    references.forEach((reference, index) => {
      summaryRows.push(createInfoRow(`Reference ${index + 1}`, reference));
    });

    pushInfoRow(licenseRows, "Avatar Permission", vrm1Meta.avatarPermission);
    pushInfoRow(licenseRows, "Commercial Usage", vrm1Meta.commercialUsage);
    pushInfoRow(licenseRows, "Credit Notation", vrm1Meta.creditNotation);
    pushInfoRow(licenseRows, "Modification", vrm1Meta.modification);
    pushInfoRow(
      licenseRows,
      "Allow Redistribution",
      vrm1Meta.allowRedistribution,
    );
    pushInfoRow(
      licenseRows,
      "Allow Violent Usage",
      vrm1Meta.allowExcessivelyViolentUsage,
    );
    pushInfoRow(
      licenseRows,
      "Allow Sexual Usage",
      vrm1Meta.allowExcessivelySexualUsage,
    );
    pushInfoRow(
      licenseRows,
      "Allow Political/Religious",
      vrm1Meta.allowPoliticalOrReligiousUsage,
    );
    pushInfoRow(
      licenseRows,
      "Allow Antisocial/Hate",
      vrm1Meta.allowAntisocialOrHateUsage,
    );
    pushInfoRow(licenseRows, "License URL", vrm1Meta.licenseUrl);
    pushInfoRow(licenseRows, "Other License URL", vrm1Meta.otherLicenseUrl);
    pushInfoRow(
      licenseRows,
      "Third Party Licenses",
      vrm1Meta.thirdPartyLicenses,
    );

    return { summaryRows, licenseRows };
  }

  pushInfoRow(summaryRows, "Title", vrm0Meta.title);
  pushInfoRow(summaryRows, "Author", vrm0Meta.author);
  pushInfoRow(summaryRows, "Contact", vrm0Meta.contactInformation);
  pushInfoRow(summaryRows, "Reference", vrm0Meta.reference);
  pushInfoRow(summaryRows, "Version", vrm0Meta.version);

  pushInfoRow(licenseRows, "Allowed User", vrm0Meta.allowedUserName);
  pushInfoRow(licenseRows, "Violent Usage", vrm0Meta.violentUssageName);
  pushInfoRow(licenseRows, "Sexual Usage", vrm0Meta.sexualUssageName);
  pushInfoRow(licenseRows, "Commercial Usage", vrm0Meta.commercialUssageName);

  const otherPermissionUrl = asString(vrm0Meta.otherPermissionUrl);
  const otherLicenseUrl = asString(vrm0Meta.otherLicenseUrl);
  const permissionSourceUrl = otherPermissionUrl || otherLicenseUrl;
  const redistributionFromUrl =
    getUrlParamLikeValue(permissionSourceUrl, "redistribution") ||
    getUrlParamLikeValue(permissionSourceUrl, "allowRedistribution");
  const modificationFromUrl =
    getUrlParamLikeValue(permissionSourceUrl, "modification") ||
    getUrlParamLikeValue(permissionSourceUrl, "allowModification");

  pushInfoRow(licenseRows, "Allow Redistribution", redistributionFromUrl);
  pushInfoRow(licenseRows, "Modification", modificationFromUrl);

  const licenseNameText = asString(vrm0Meta.licenseName);
  const licenseNameNormalized = licenseNameText.toLowerCase();
  if (
    !redistributionFromUrl &&
    licenseNameNormalized.includes("redistribution_prohibited")
  ) {
    pushInfoRow(
      licenseRows,
      "Allow Redistribution",
      "redistribution_prohibited",
    );
  }
  if (
    !modificationFromUrl &&
    licenseNameNormalized.includes("modification_prohibited")
  ) {
    pushInfoRow(licenseRows, "Modification", "modification_prohibited");
  }

  pushInfoRow(licenseRows, "License Name", vrm0Meta.licenseName);
  pushInfoRow(licenseRows, "Other Permission URL", vrm0Meta.otherPermissionUrl);
  pushInfoRow(licenseRows, "Other License URL", vrm0Meta.otherLicenseUrl);

  return { summaryRows, licenseRows };
}

function generateLicenseText(infoData: VrmInfoData, locale: AppLocale): string {
  const lines: string[] = [];

  if (infoData.summaryRows.length > 0) {
    lines.push(
      locale === "ja"
        ? "=== 基本情報 ==="
        : locale === "ko"
          ? "=== 기본 정보 ==="
        : locale === "zh"
          ? "=== 基本信息 ==="
          : "=== Basic Information ===",
    );
    infoData.summaryRows.forEach((row) => {
      const localizedLabel = localizeMetadataLabel(row.label, locale);
      lines.push(`${localizedLabel}: ${row.value}`);
    });
    lines.push("");
  }

  if (infoData.licenseRows.length > 0) {
    lines.push(
      locale === "ja"
        ? "=== ライセンス情報 ==="
        : locale === "ko"
          ? "=== 라이선스 정보 ==="
        : locale === "zh"
          ? "=== 许可证信息 ==="
          : "=== License Information ===",
    );
    infoData.licenseRows.forEach((row) => {
      const localizedLabel = localizeMetadataLabel(row.label, locale);
      const localizedValue = localizeAllowDisallow(row.value, locale).text;
      lines.push(`${localizedLabel}: ${localizedValue}`);
    });
  }

  return lines.join("\n");
}

async function addLicenseToZip(
  zipBlob: Blob,
  licenseText: string,
): Promise<Blob> {
  const zipReader = new ZipReader(new BlobReader(zipBlob));
  const entries = await zipReader.getEntries();

  const zipWriter = new BlobWriter("application/zip");
  const writer = new ZipWriter(zipWriter);

  for (const entry of entries) {
    const current = entry as unknown as {
      filename?: string;
      directory?: boolean;
      getData?: (writer: BlobWriter) => Promise<Blob>;
      lastModDate?: Date;
      comment?: string;
    };
    if (
      current.directory ||
      !current.filename ||
      current.filename === "license.txt" ||
      !current.getData
    ) {
      continue;
    }

    const data = await current.getData(new BlobWriter());
    await writer.add(current.filename, new BlobReader(data), {
      lastModDate: current.lastModDate,
      comment: current.comment,
    });
  }

  await writer.add(
    "license.txt",
    new BlobReader(new Blob([licenseText], { type: "text/plain" })),
  );
  await zipReader.close();
  const newZipBlob = await writer.close();
  return newZipBlob;
}

type ExtractedTextureAsset = {
  fileName: string;
  blob: Blob;
};

function inferTextureExtension(mimeType: string | null | undefined): string {
  if (!mimeType) {
    return "png";
  }
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("bmp")) return "bmp";
  if (normalized.includes("webp")) return "webp";
  return "bin";
}

function decodeDataUri(
  uri: string,
): { bytes: Uint8Array; mimeType: string | null } | null {
  const m = uri.match(/^data:([^;,]*)(;base64)?,(.*)$/i);
  if (!m) {
    return null;
  }

  const mimeType = m[1] || null;
  const isBase64 = Boolean(m[2]);
  const dataPart = m[3] ?? "";

  if (isBase64) {
    const binary = atob(dataPart);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return { bytes: out, mimeType };
  }

  const decoded = decodeURIComponent(dataPart);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    out[i] = decoded.charCodeAt(i);
  }
  return { bytes: out, mimeType };
}

function normalizeTextureBaseName(raw: string, fallback: string): string {
  const base = raw
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .trim();
  return base || fallback;
}

async function buildPmxZipFromVrm(
  sourceVrmFile: File,
  pmxBlob: Blob,
): Promise<{ zipBlob: Blob; textureCount: number }> {
  const GLB_MAGIC = 0x46546c67;
  const GLB_JSON_CHUNK = 0x4e4f534a;
  const GLB_BIN_CHUNK = 0x004e4942;

  const sourceBuffer = await sourceVrmFile.arrayBuffer();
  const view = new DataView(sourceBuffer);
  if (sourceBuffer.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(
      "RUST_PMX_ZIP_FAILED: Input file is not a valid GLB container.",
    );
  }

  let jsonChunkBytes: Uint8Array | null = null;
  let binChunkBytes: Uint8Array | null = null;
  let offset = 12;
  while (offset + 8 <= sourceBuffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > sourceBuffer.byteLength) {
      break;
    }

    if (chunkType === GLB_JSON_CHUNK && !jsonChunkBytes) {
      jsonChunkBytes = new Uint8Array(sourceBuffer.slice(chunkStart, chunkEnd));
    } else if (chunkType === GLB_BIN_CHUNK && !binChunkBytes) {
      binChunkBytes = new Uint8Array(sourceBuffer.slice(chunkStart, chunkEnd));
    }
    offset = chunkEnd;
  }

  const extractedTextures: ExtractedTextureAsset[] = [];
  if (jsonChunkBytes) {
    const jsonText = new TextDecoder()
      .decode(jsonChunkBytes)
      .replace(/\u0000+$/g, "")
      .trimEnd();
    const gltfJson = JSON.parse(jsonText) as {
      images?: Array<{
        name?: string;
        mimeType?: string;
        bufferView?: number;
        uri?: string;
      }>;
      bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
    };

    const images = Array.isArray(gltfJson.images) ? gltfJson.images : [];
    const bufferViews = Array.isArray(gltfJson.bufferViews)
      ? gltfJson.bufferViews
      : [];
    const usedNames = new Set<string>();

    for (let i = 0; i < images.length; i++) {
      const image = images[i] || {};
      let bytes: Uint8Array | null = null;
      let mimeType: string | null =
        typeof image.mimeType === "string" ? image.mimeType : null;

      if (
        typeof image.bufferView === "number" &&
        image.bufferView >= 0 &&
        image.bufferView < bufferViews.length &&
        binChunkBytes
      ) {
        const bv = bufferViews[image.bufferView] || {};
        const start = bv.byteOffset || 0;
        const length = bv.byteLength || 0;
        const end = start + length;
        if (length > 0 && end <= binChunkBytes.byteLength) {
          bytes = binChunkBytes.slice(start, end);
        }
      } else if (
        typeof image.uri === "string" &&
        image.uri.startsWith("data:")
      ) {
        const decoded = decodeDataUri(image.uri);
        if (decoded) {
          bytes = decoded.bytes;
          if (!mimeType) {
            mimeType = decoded.mimeType;
          }
        }
      }

      if (!bytes || bytes.byteLength === 0) {
        continue;
      }

      const extension = inferTextureExtension(mimeType);
      const baseName = normalizeTextureBaseName(
        typeof image.name === "string"
          ? image.name
          : typeof image.uri === "string"
            ? image.uri
            : "",
        `texture_${i}`,
      );

      let candidate = `textures/${baseName}.${extension}`;
      let serial = 1;
      while (usedNames.has(candidate.toLowerCase())) {
        candidate = `textures/${baseName}_${serial}.${extension}`;
        serial += 1;
      }
      usedNames.add(candidate.toLowerCase());

      const blobBytes = new Uint8Array(bytes.byteLength);
      blobBytes.set(bytes);

      extractedTextures.push({
        fileName: candidate,
        blob: new Blob([blobBytes.buffer], {
          type: mimeType || "application/octet-stream",
        }),
      });
    }
  }

  const baseName = sourceVrmFile.name.replace(/\.[^.]+$/, "") || "converted";
  const zipBlobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(zipBlobWriter);
  await zipWriter.add(`${baseName}.pmx`, new BlobReader(pmxBlob));
  for (const texture of extractedTextures) {
    await zipWriter.add(texture.fileName, new BlobReader(texture.blob));
  }
  await zipWriter.close();

  return {
    zipBlob: await zipBlobWriter.getData(),
    textureCount: extractedTextures.length,
  };
}

function extractPmxInfoData(mesh: THREE.SkinnedMesh): PmxInfoData {
  const geometry = mesh.geometry as THREE.BufferGeometry & {
    userData?: unknown;
  };
  const mmd = asRecord(asRecord(geometry.userData).MMD);
  const metadata = asRecord(mmd.metadata);

  const summaryRows: InfoRow[] = [];
  const licenseRows: InfoRow[] = [];

  pushInfoRow(
    summaryRows,
    "Model Name",
    metadata.modelName || metadata.name || mesh.name,
  );
  pushInfoRow(summaryRows, "Model Name EN", metadata.englishModelName);
  pushInfoRow(summaryRows, "Comment", metadata.comment);
  pushInfoRow(summaryRows, "Comment EN", metadata.englishComment);
  pushInfoRow(summaryRows, "Vertices", metadata.vertexCount);
  pushInfoRow(summaryRows, "Faces", metadata.faceCount);
  pushInfoRow(summaryRows, "Materials", metadata.materialCount);
  pushInfoRow(summaryRows, "Bones", metadata.boneCount);
  pushInfoRow(summaryRows, "Morphs", metadata.morphCount);
  pushInfoRow(summaryRows, "Rigid Bodies", metadata.rigidBodyCount);
  pushInfoRow(summaryRows, "Constraints", metadata.constraintCount);

  pushInfoRow(licenseRows, "License", metadata.licenseName);
  pushInfoRow(licenseRows, "Copyright", metadata.copyright);

  const commentUrls = [
    asString(metadata.comment),
    asString(metadata.englishComment),
  ].flatMap((comment) => extractUrls(comment));
  commentUrls.forEach((url, index) => {
    licenseRows.push(createInfoRow(`Reference URL ${index + 1}`, url));
  });

  return { summaryRows, licenseRows };
}

function isRedistributionOrModificationNG(infoData: VrmInfoData): boolean {
  for (const row of infoData.licenseRows) {
    const label = row.label.toLowerCase();
    const value = row.value.toLowerCase();
    if (
      (label.includes("redistribution") ||
        label.includes("allow redistribution")) &&
      (value === "ng" ||
        value === "disallow" ||
        value === "prohibited" ||
        value === "=再配布禁止=" ||
        value.includes("prohibited"))
    ) {
      return true;
    }
    if (
      (label.includes("modification") || label === "改変の許可") &&
      (value === "ng" ||
        value === "disallow" ||
        value === "prohibited" ||
        value === "改変禁止" ||
        value.includes("prohibited"))
    ) {
      return true;
    }
  }
  return false;
}

function hasTextureImageData(
  texture: THREE.Texture | null | undefined,
): boolean {
  if (!texture) {
    return false;
  }
  const tex = texture as THREE.Texture & {
    source?: { data?: unknown };
    image?: unknown;
  };
  return Boolean(tex.image || tex.source?.data);
}

function hasPendingTextureCallback(
  texture: THREE.Texture | null | undefined,
): boolean {
  if (!texture) {
    return false;
  }
  const tex = texture as THREE.Texture & {
    readyCallbacks?: Array<(texture: THREE.Texture) => void>;
  };
  return Array.isArray(tex.readyCallbacks);
}

function getMaterialColorTexture(
  material: THREE.Material | null | undefined,
): THREE.Texture | null {
  if (!material) {
    return null;
  }
  const withMap = material as THREE.Material & {
    map?: THREE.Texture | null;
  };
  return withMap.map ?? null;
}

function getMaterialSideLabel(side: THREE.Side | undefined): string {
  if (side === THREE.DoubleSide) {
    return "DoubleSide";
  }
  if (side === THREE.BackSide) {
    return "BackSide";
  }
  return "FrontSide";
}

function collectMeshMaterials(root: THREE.Object3D): THREE.Material[] {
  const materials: THREE.Material[] = [];
  root.traverse((object) => {
    const maybeMesh = object as THREE.Mesh;
    if (!maybeMesh.isMesh) {
      return;
    }

    const entries = Array.isArray(maybeMesh.material)
      ? maybeMesh.material
      : [maybeMesh.material];
    for (const material of entries) {
      if (material) {
        materials.push(material);
      }
    }
  });
  return materials;
}

async function waitForTextureReady(
  texture: THREE.Texture,
  timeoutMs: number,
): Promise<void> {
  if (hasTextureImageData(texture) || !hasPendingTextureCallback(texture)) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const tex = texture as THREE.Texture & {
      readyCallbacks?: Array<(texture: THREE.Texture) => void>;
    };
    tex.readyCallbacks?.push(() => finish());
    window.setTimeout(finish, timeoutMs);
  });
}

async function waitForMeshColorTextures(
  root: THREE.Object3D,
  timeoutMs: number,
): Promise<void> {
  const uniqueTextures = new Set<THREE.Texture>();
  for (const material of collectMeshMaterials(root)) {
    const texture = getMaterialColorTexture(material);
    if (texture) {
      uniqueTextures.add(texture);
    }
  }

  await Promise.all(
    [...uniqueTextures].map((texture) =>
      waitForTextureReady(texture, timeoutMs),
    ),
  );
}

async function captureCanvasSnapshotDataUrl(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
): Promise<string | null> {
  if (!canvas) {
    return null;
  }

  const sourceWidth = canvas.width || canvas.clientWidth;
  const sourceHeight = canvas.height || canvas.clientHeight;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const tmp = document.createElement("canvas");
  tmp.width = width;
  tmp.height = height;
  const ctx = tmp.getContext("2d");
  if (!ctx) {
    return null;
  }

  // Wait for rendering to settle so WebGL canvas pixels are present.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const capture = () => {
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(canvas, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  };

  let imageData = capture();

  // If the sampled frame is effectively black/empty, retry once after a short delay.
  let sum = 0;
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    sum += data[i] + data[i + 1] + data[i + 2];
  }
  const avg = sum / (width * height * 3);
  if (avg < 2) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    imageData = capture();
    void imageData;
  }

  return tmp.toDataURL("image/jpeg", 0.72);
}

function PwaInstallControl({ i18n }: { i18n: AppI18n }) {
  const { pwaInstall, supported, isInstalled } = useReactPWAInstall();

  if (isInstalled()) {
    return null;
  }

  const onInstallClick = () => {
    if (!supported()) {
      window.alert(
        `${i18n.installDialogTitle}\n\n${i18n.installUnsupportedHint}`,
      );
      return;
    }

    void pwaInstall({
      title: i18n.installDialogTitle,
      description: i18n.installDialogDescription,
    }).catch(() => {
      // User canceled native install prompt.
    });
  };

  return (
    <button
      type="button"
      className="footer-action-button footer-install-button"
      onClick={onInstallClick}
    >
      {i18n.installButtonLabel}
    </button>
  );
}

function HeartThanksDialog({
  open,
  i18n,
  message,
  onMessageChange,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  open: boolean;
  i18n: AppI18n;
  message: string;
  onMessageChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const remaining = 200 - message.length;
  const heartSubmitText = i18n.heartDialogSubmit.replace("❤", "").trim();

  return (
    <div
      className="heart-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        className="heart-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="heart-title"
      >
        <header className="heart-modal-header">
          <h2 id="heart-title">{i18n.heartDialogTitle}</h2>
        </header>
        <div className="heart-modal-body">
          <textarea
            className="heart-message-input"
            rows={3}
            maxLength={200}
            value={message}
            placeholder={i18n.heartDialogPlaceholder}
            onChange={(event) => onMessageChange(event.target.value)}
          />
          <p className="heart-remaining">
            {i18n.heartDialogRemaining(remaining)}
          </p>
        </div>
        <footer className="heart-modal-actions">
          <button
            type="button"
            className="footer-action-button"
            onClick={onClose}
            disabled={isSubmitting}
          >
            {i18n.heartDialogCancel}
          </button>
          <button
            type="button"
            className="footer-action-button heart-submit-button"
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            {heartSubmitText.length > 0 ? `${heartSubmitText} ` : ""}
            <span className="heart-submit-icon" aria-hidden="true">
              ❤
            </span>
          </button>
        </footer>
      </section>
    </div>
  );
}

function formatCounterValue(count: number, minDigits: number): string {
  const s = count.toString();
  const padded = s.padStart(minDigits, "0");
  const chunks: string[] = [];
  let remaining = padded;
  while (remaining.length > 3) {
    chunks.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  chunks.unshift(remaining);
  return chunks.join(",");
}

export default function App() {
  const [maximizedPreview, setMaximizedPreview] = useState<
    "vrm" | "pmx" | null
  >(null);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const {
    mode,
    setMode,
    taPoseAngle,
    setTaPoseAngle,
    orbitSyncEnabled,
    setOrbitSyncEnabled,
    orbitSyncEnabledRef,
    logEnabled,
    setLogEnabled,
    logEnabledRef,
    rustEnabled,
    setRustEnabled,
    turboLabsEnabled,
    setTurboLabsEnabled,
    nimEnabled,
    setNimEnabled,
    worldCounterParticipationEnabled,
    setWorldCounterParticipationEnabled,
    gridEnabled,
    setGridEnabled,
    gridEnabledRef,
    pmxBrightnessScale,
    setPmxBrightnessScale,
    pmxContrastFactor,
    setPmxContrastFactor,
    isUiSettingsHydrated,
    resetToDefaults,
  } = useUiSettings();
  const vrmGridRef = useRef<THREE.GridHelper | null>(null);
  const pmxGridRef = useRef<THREE.GridHelper | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logLinesRef = useRef<string[]>([]);
  const convertUiLogCountRef = useRef(0);
  const convertUiLogSeenRef = useRef<Set<string>>(new Set());
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "failed">(
    "idle",
  );
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [aboutDefaultTab, setAboutDefaultTab] = useState<AboutTabId>("about");
  const [isHeartDialogOpen, setIsHeartDialogOpen] = useState(false);
  const [heartMessage, setHeartMessage] = useState("");
  const [heartLockUntil, setHeartLockUntil] = useState<number | null>(null);
  const [isHeartSentVisual, setIsHeartSentVisual] = useState(false);
  const [isHeartSubmitting, setIsHeartSubmitting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogConfig, setDialogConfig] = useState<{
    title: string;
    message: string;
    type?: "alert" | "confirm" | "warning" | "error" | "success";
    okLabel?: string;
    cancelLabel?: string;
    onOk?: () => void | Promise<void>;
    onCancel?: () => void;
    content?: ReactNode;
  }>({ title: "", message: "" });
  const [localCounter, setLocalCounter] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(LOCAL_COUNTER_KEY);
      return raw ? parseInt(raw, 10) || 0 : 0;
    } catch {
      return 0;
    }
  });
  const [worldCounter, setWorldCounter] = useState(0);
  const [counterDisplayMode, setCounterDisplayMode] = useState<
    "local" | "world"
  >(() => {
    try {
      const raw = window.localStorage.getItem(COUNTER_DISPLAY_MODE_KEY);
      return raw === "world" ? "world" : "local";
    } catch {
      return "local";
    }
  });
  const [counterFlipToken, setCounterFlipToken] = useState(0);
  const resetCounterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [isVrmMetadataOpen, setIsVrmMetadataOpen] = useState(false);
  const [isPmxMetadataOpen, setIsPmxMetadataOpen] = useState(false);
  const [vrmBonesVisible, setVrmBonesVisible] = useState(false);
  const [hasVrmSkeleton, setHasVrmSkeleton] = useState(false);
  const [pmxBonesVisible, setPmxBonesVisible] = useState(false);
  const [hasPmxSkeleton, setHasPmxSkeleton] = useState(false);
  const [vrmInfoData, setVrmInfoData] = useState<VrmInfoData>({
    summaryRows: [],
    licenseRows: [],
  });
  const [pmxInfoData, setPmxInfoData] = useState<PmxInfoData>({
    summaryRows: [],
    licenseRows: [],
  });
  const [
    isVrmRedistributionOrModificationNG,
    setIsVrmRedistributionOrModificationNG,
  ] = useState(false);
  const logAreaRef = useRef<HTMLDivElement | null>(null);
  const [isVrmReady, setIsVrmReady] = useState(false);
  const [message, setMessage] = useState("VRM file is not selected yet.");
  const [errorDetail, setErrorDetail] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isPmxPreviewing, setIsPmxPreviewing] = useState(false);
  const [isPmxReady, setIsPmxReady] = useState(false);
  const [pmxPreviewFileName, setPmxPreviewFileName] = useState<string | null>(null);
  const [isVrmDropActive, setIsVrmDropActive] = useState(false);
  const [isPmxDropActive, setIsPmxDropActive] = useState(false);
  const [convertProgressPercent, setConvertProgressPercent] = useState(0);
  const [convertProgressStage, setConvertProgressStage] = useState<
    WorkerProgressStage | "done" | null
  >(null);
  const [convertedOutput, setConvertedOutput] =
    useState<ConvertedOutput | null>(null);
  const [detectedProfileResult, setDetectedProfileResult] =
    useState<ProfileDetectionResult | null>(null);
  const [detectedQualityRiskSignals, setDetectedQualityRiskSignals] = useState<
    string[]
  >([]);
  const runtimeQualitySignalsRef = useRef<Set<string>>(new Set());
  const profileDetectionRequestIdRef = useRef(0);
  const [lastRequestedMode, setLastRequestedMode] =
    useState<ConvertMode | null>(null);
  const [lastUsedMode, setLastUsedMode] = useState<ConvertMode | null>(null);
  const [lastFallbackReason, setLastFallbackReason] = useState<string | null>(
    null,
  );
  const [lastConversionReportId, setLastConversionReportId] = useState<
    string | null
  >(null);
  const pmxPreviewDiagnosticsRef = useRef<PmxPreviewDiagnostics | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const convertHeartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const convertHeartbeatStartedAtRef = useRef(0);
  const vrmInputRef = useRef<HTMLInputElement | null>(null);
  const vrmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pmxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const vrmSkeletonHelpersRef = useRef<THREE.SkeletonHelper[]>([]);
  const pmxSkeletonHelpersRef = useRef<THREE.SkeletonHelper[]>([]);
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
  const vrmIdleManagerRef = useRef<ReturnType<
    typeof createIdleRotationManager
  > | null>(null);
  const pmxIdleManagerRef = useRef<ReturnType<
    typeof createIdleRotationManager
  > | null>(null);
  const pmxLightRuntimeRef = useRef<{
    ambientLight: THREE.AmbientLight;
    keyLight: THREE.DirectionalLight;
    baseAmbient: number;
    baseDirectional: number;
    avgLuminance: number;
    brightMaterialRatio: number;
  } | null>(null);
  const orbitSyncLockRef = useRef(false);
  const idleAnimationRef = useRef<{
    vrmState: {
      isRotating: boolean;
      rotationDirection: 1 | -1;
      inactivityTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    pmxState: {
      isRotating: boolean;
      rotationDirection: 1 | -1;
      inactivityTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    isConverting: boolean;
  }>({
    vrmState: {
      isRotating: false,
      rotationDirection: 1,
      inactivityTimeoutId: null,
    },
    pmxState: {
      isRotating: false,
      rotationDirection: 1,
      inactivityTimeoutId: null,
    },
    isConverting: false,
  });
  const upperArmStateRef = useRef<UpperArmState>({
    leftBone: null,
    rightBone: null,
    leftBaseQuaternion: null,
    rightBaseQuaternion: null,
    armPoseSign: 1,
  });
  const [isInstalledState, setIsInstalledState] = useState(false);
  const backendEnabled = isBackendFallbackEnabled();
  const appLocale = useMemo(
    () =>
      detectAppLocale(
        typeof navigator !== "undefined" ? navigator.language : "en",
      ),
    [],
  );
  const i18n = APP_I18N[appLocale];
  const isHeartLocked =
    heartLockUntil !== null && heartLockUntil - 5000 > Date.now();
  const isWorldCounterDisplayed = counterDisplayMode === "world";
  const formatWorldCountUpValue = useCallback((value: number) => {
    return formatCounterValue(Math.floor(value), 9);
  }, []);

  const reportWorldCounterError = useCallback(
    (
      action: "fetch" | "increment",
      error: unknown,
      context: Record<string, string>,
    ) => {
      Sentry.withScope((scope) => {
        scope.setLevel("warning");
        scope.setTag("feature", "world_counter");
        scope.setTag("action", action);
        Object.entries(context).forEach(([key, value]) => {
          scope.setContext(key, { value });
        });
        Sentry.captureException(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    },
    [],
  );

  function refreshWorldCounter(reason: string) {
    void getWorldCounterFromFirestore()
      .then((latest) => {
        if (typeof latest === "number") {
          setWorldCounter(latest);
        }
      })
      .catch((error) => {
        console.warn("world_counter.fetch_failed", { reason, error });
        reportWorldCounterError("fetch", error, { reason });
      });
  }

  useEffect(() => {
    refreshWorldCounter("startup");
    const intervalId = window.setInterval(
      () => {
        refreshWorldCounter("interval_5min");
      },
      5 * 60 * 1000,
    );
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COUNTER_DISPLAY_MODE_KEY, counterDisplayMode);
    } catch {
      // localStorage unavailable — ignore
    }
  }, [counterDisplayMode]);

  function onCounterToggle() {
    setCounterFlipToken((prev) => prev + 1);
    setCounterDisplayMode((prev) => {
      const next = prev === "local" ? "world" : "local";
      if (next === "world") {
        refreshWorldCounter("toggle_to_world");
      }
      return next;
    });
  }

  const showDialog = (config: {
    title: string;
    message: string;
    type?: "alert" | "confirm" | "warning" | "error" | "success";
    okLabel?: string;
    cancelLabel?: string;
    onOk?: () => void | Promise<void>;
    onCancel?: () => void;
    content?: ReactNode;
  }) => {
    setDialogConfig(config);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
  };

  const onHeartButtonClick = () => {
    if (isHeartLocked) {
      void Swal.fire({
        icon: "info",
        title: i18n.heartAlreadySent,
        timer: 1400,
        showConfirmButton: false,
      });
      return;
    }
    setIsHeartDialogOpen(true);
  };

  // Record last_launch_date and open About/History on version change
  useEffect(() => {
    try {
      window.localStorage.setItem(
        LAST_LAUNCH_DATE_KEY,
        new Date().toISOString(),
      );
      const savedVersion = window.localStorage.getItem(LAST_BOOT_VERSION_KEY);
      if (savedVersion !== APP_VERSION) {
        window.localStorage.setItem(LAST_BOOT_VERSION_KEY, APP_VERSION);
        setAboutDefaultTab("history");
        setIsAboutOpen(true);
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(HEART_LOCK_UNTIL_KEY);
      if (!raw) {
        return;
      }
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed - 5000 > Date.now()) {
        setHeartLockUntil(parsed);
        setIsHeartSentVisual(true);
      }
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  const onSubmitHeart = async () => {
    if (isHeartSubmitting || isHeartLocked) {
      return;
    }

    const trimmed = heartMessage.trim();
    const feedbackUserId = (() => {
      try {
        const existing = window.localStorage
          .getItem(HEART_FEEDBACK_USER_ID_KEY)
          ?.trim();
        if (existing) {
          return existing;
        }
        const nextId =
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        window.localStorage.setItem(HEART_FEEDBACK_USER_ID_KEY, nextId);
        return nextId;
      } catch {
        return `ephemeral-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
    })();

    const lines = [
      "❤ A user sent a heart from VRM to MMD Converter.",
      `feedbackUserId: ${feedbackUserId}`,
    ];
    if (trimmed.length > 0) {
      lines.push("Message:");
      lines.push(trimmed);
    }

    setIsHeartSubmitting(true);
    try {
      const sentAtIso = new Date().toISOString();
      const requests: Array<Promise<unknown>> = [];

      if (HEART_SLACK_WEBHOOK_URL.length > 0) {
        requests.push(
          fetch(HEART_SLACK_WEBHOOK_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: lines.join("\n") }),
          }),
        );
      }

      if (HEART_GAS_WEB_APP_URL.length > 0) {
        requests.push(
          fetch(HEART_GAS_WEB_APP_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
              // no-cors で送るため text/plain を使う
              "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify({
              source: "vrm2pmx-web-heart",
              feedbackUserId,
              locale: appLocale,
              appVersion: APP_VERSION,
              sentAt: sentAtIso,
              message: trimmed,
            }),
          }),
        );
      }

      if (requests.length === 0) {
        throw new Error("No feedback endpoint configured");
      }

      await Promise.all(requests);

      setIsHeartSentVisual(true);
      const lockUntil = Date.now() + 24 * 60 * 60 * 1000;
      setHeartLockUntil(lockUntil);
      try {
        window.localStorage.setItem(HEART_LOCK_UNTIL_KEY, String(lockUntil));
      } catch {
        // localStorage unavailable — ignore
      }

      setIsHeartDialogOpen(false);
      setHeartMessage("");
      void Swal.fire({
        icon: "success",
        title: i18n.heartDialogSent,
        timer: 1400,
        showConfirmButton: false,
      });
    } catch {
      void Swal.fire({
        icon: "error",
        title: i18n.heartDialogError,
      });
    } finally {
      setIsHeartSubmitting(false);
    }
  };

  // Monitor PWA installation event to immediately show "Local"
  useEffect(() => {
    const handleAppInstalled = () => {
      setIsInstalledState(true);
    };
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const launchStateLabel = useMemo(() => {
    if (typeof window === "undefined") {
      return "Web";
    }

    // If just installed, immediately show "Local"
    if (isInstalledState) {
      return "Local";
    }

    const iosStandalone = Boolean(
      (navigator as Navigator & { standalone?: boolean }).standalone,
    );
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      iosStandalone ||
      document.referrer.startsWith("android-app://");

    return isStandalone ? "Local" : "Web";
  }, [isInstalledState]);

  const isConvertSupportedInput = useMemo(
    () => (file ? isConvertSupportedInputFile(file.name) : false),
    [file],
  );

  const canConvert = useMemo(
    () =>
      !!file &&
      isConvertSupportedInput &&
      status !== "uploading" &&
      !isPreviewing &&
      isVrmReady,
    [file, isConvertSupportedInput, isPreviewing, isVrmReady, status],
  );
  const canDownload = useMemo(
    () => !!convertedOutput && status !== "uploading",
    [convertedOutput, status],
  );
  const canOpenVrmMetadata = useMemo(
    () => isVrmReady && !isPreviewing,
    [isPreviewing, isVrmReady],
  );
  const canOpenPmxMetadata = useMemo(
    () => isPmxReady && !isPmxPreviewing,
    [isPmxPreviewing, isPmxReady],
  );
  const pmxSummaryRowsForDisplay = useMemo(
    () =>
      pmxInfoData.summaryRows.length > 0
        ? pmxInfoData.summaryRows
        : vrmInfoData.summaryRows,
    [pmxInfoData.summaryRows, vrmInfoData.summaryRows],
  );
  const pmxLicenseRowsForDisplay = useMemo(
    () =>
      pmxInfoData.licenseRows.length > 0
        ? pmxInfoData.licenseRows
        : vrmInfoData.licenseRows,
    [pmxInfoData.licenseRows, vrmInfoData.licenseRows],
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

  function appendConsoleLine(
    args: unknown[],
    level: ConsoleLogLevel = "info",
    options?: { force?: boolean },
  ) {
    if (!options?.force && !shouldCaptureLog(level, APP_LOG_LEVEL)) {
      return;
    }

    const line = args.map((value) => formatLogArg(value)).join(" ");
    setLogLines((prev) => {
      if (prev.length > 0 && prev[prev.length - 1] === line) {
        return prev;
      }

      const next = [...prev, line];
      if (next.length > 1000) {
        next.splice(0, next.length - 1000);
      }
      logLinesRef.current = next;
      return next;
    });
  }

  function appendWorkerLog(log: WorkerLogResponse) {
    const joined = log.args.map((value) => formatLogArg(value)).join(" ");

    if (log.level === "error") {
      console.error(`[worker] ${joined}`);
    } else if (log.level === "warn") {
      console.warn(`[worker] ${joined}`);
    } else if (log.level === "debug") {
      console.debug(`[worker] ${joined}`);
    } else if (log.level === "log") {
      console.log(`[worker] ${joined}`);
    } else {
      console.info(`[worker] ${joined}`);
    }

    const normalized = joined.toLowerCase();
    if (log.level === "error") {
      appendUserConvertLog(
        "[ERROR] 変換中にエラーが発生しました。詳細はコンソールを確認してください。",
        "error",
      );
      return;
    }
    if (log.level === "warn") {
      appendUserConvertLog(
        "[WARN] 変換中に注意メッセージがありました。",
        "warn",
      );
    }

    if (normalized.includes("bone")) {
      appendUserConvertLog("[INFO] ボーン変換中...");
    } else if (
      normalized.includes("morph") ||
      normalized.includes("expression")
    ) {
      appendUserConvertLog("[INFO] モーフ変換中...");
    } else if (
      normalized.includes("material") ||
      normalized.includes("texture")
    ) {
      appendUserConvertLog("[INFO] 材質・テクスチャ変換中...");
    } else if (
      normalized.includes("rigid") ||
      normalized.includes("joint") ||
      normalized.includes("physics")
    ) {
      appendUserConvertLog("[INFO] 物理情報変換中...");
    } else if (
      normalized.includes("parse") ||
      normalized.includes("glb") ||
      normalized.includes("json")
    ) {
      appendUserConvertLog("[INFO] モデル解析中...");
    }
  }

  function beginUserConvertLogSession() {
    convertUiLogCountRef.current = 0;
    convertUiLogSeenRef.current = new Set();
  }

  function appendUserConvertLog(line: string, level: ConsoleLogLevel = "info") {
    const key = `${level}:${line}`;
    if (convertUiLogSeenRef.current.has(key)) {
      return;
    }
    if (convertUiLogCountRef.current >= MAX_USER_CONVERT_LOG_LINES) {
      return;
    }

    convertUiLogSeenRef.current.add(key);
    convertUiLogCountRef.current += 1;
    appendConsoleLine([line], level, { force: true });
  }

  function appendUserConvertStageLog(
    stage: WorkerProgressStage,
    mode: ConvertMode,
  ) {
    if (stage === "init") {
      appendUserConvertLog("[INFO] 変換準備中...");
      return;
    }
    if (stage === "pyodide-loading") {
      appendUserConvertLog("[INFO] ランタイム初期化中...");
      return;
    }
    if (stage === "py-src-sync") {
      appendUserConvertLog("[INFO] 変換エンジン同期中...");
      return;
    }
    if (stage === "converting") {
      appendUserConvertLog(
        mode === "nim"
          ? "[INFO] Nim変換中（ボーン・モーフ・材質）..."
          : mode === "rust"
            ? "[INFO] Rust変換中（ボーン・モーフ・材質）..."
            : "[INFO] 変換中（ボーン・モーフ・材質）...",
      );
      return;
    }
    if (stage === "finalizing") {
      appendUserConvertLog("[INFO] 出力を最終化中...");
    }
  }

  function stopConvertHeartbeat() {
    if (convertHeartbeatTimerRef.current) {
      clearInterval(convertHeartbeatTimerRef.current);
      convertHeartbeatTimerRef.current = null;
    }
  }

  function startConvertHeartbeat() {
    stopConvertHeartbeat();
    convertHeartbeatStartedAtRef.current = Date.now();

    convertHeartbeatTimerRef.current = setInterval(() => {
      if (!idleAnimationRef.current.isConverting) {
        return;
      }

      const elapsedSec = Math.max(
        1,
        Math.floor((Date.now() - convertHeartbeatStartedAtRef.current) / 1000),
      );
      appendUserConvertLog(`[INFO] 変換処理中... ${elapsedSec}s 経過`);

      if (elapsedSec % 30 === 0) {
        appendUserConvertLog(
          "[INFO] 大きめのモデルのため時間がかかっています。処理は継続中です。",
        );
      }
    }, CONVERT_HEARTBEAT_INTERVAL_MS);
  }

  useEffect(() => {
    return () => {
      stopConvertHeartbeat();
    };
  }, []);

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
    for (const helper of vrmSkeletonHelpersRef.current) {
      helper.visible = vrmBonesVisible;
    }
  }, [vrmBonesVisible]);

  useEffect(() => {
    for (const helper of pmxSkeletonHelpersRef.current) {
      helper.visible = pmxBonesVisible;
    }
  }, [pmxBonesVisible]);

  useEffect(() => {
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const line = args
        .map((arg) => formatLogArg(arg))
        .join(" ")
        .toLowerCase();
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
    return /(error|failed|exception|traceback|aborterror|convert\.failed)/i.test(
      line,
    );
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
    showDialog({
      title: i18n.allResetConfirmTitle,
      message: i18n.allResetConfirmMessage,
      type: "confirm",
      okLabel: "Reset",
      cancelLabel: "Cancel",
      content: (
        <label className="dialog-extra-label">
          <input
            type="checkbox"
            ref={resetCounterCheckboxRef}
            defaultChecked={false}
          />
          {i18n.allResetCounterLabel}
        </label>
      ),
      onOk: () => {
        const shouldResetCounter =
          resetCounterCheckboxRef.current?.checked ?? false;
        cleanupPreview();
        cleanupPmxPreview();
        setConvertedOutput(null);
        setDetectedProfileResult(null);
        setDetectedQualityRiskSignals([]);
        setLastRequestedMode(null);
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
        setMessage("VRM file is not selected yet.");
        setErrorDetail("");
        setIsVrmReady(false);
        setVrmInfoData({ summaryRows: [], licenseRows: [] });
        setPmxInfoData({ summaryRows: [], licenseRows: [] });
        setIsVrmRedistributionOrModificationNG(false);
        setIsVrmMetadataOpen(false);
        setIsPmxMetadataOpen(false);
        setIsVrmDropActive(false);
        resetToDefaults();

        if (vrmInputRef.current) {
          vrmInputRef.current.value = "";
        }

        setHeartMessage("");
        setIsHeartDialogOpen(false);
        setIsHeartSubmitting(false);
        setIsHeartSentVisual(false);
        setHeartLockUntil(null);

        try {
          window.localStorage.removeItem(HEART_LOCK_UNTIL_KEY);
          window.localStorage.removeItem(HEART_FEEDBACK_USER_ID_KEY);
        } catch {
          // localStorage unavailable — ignore
        }
        if (shouldResetCounter) {
          setLocalCounter(0);
          try {
            window.localStorage.removeItem(LOCAL_COUNTER_KEY);
          } catch {
            // localStorage unavailable — ignore
          }
        }
      },
    });
  }

  async function buildConvertInputFile(sourceFile: File): Promise<File> {
    const sourceBuffer = await sourceFile.arrayBuffer();
    let posedBuffer = sourceBuffer;
    try {
      posedBuffer = poseUpperArmsInGlb(sourceBuffer, taPoseAngle);
    } catch (error) {
      // Non-VRM GLB may not have humanoid arm bones. Continue conversion with original input.
      console.warn(
        "pose_upper_arms.skipped",
        sourceFile.name,
        error instanceof Error ? error.message : String(error),
      );
    }
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
    setIsPmxReady(false);
    setPmxPreviewFileName(null);
    pmxSkeletonHelpersRef.current = [];
    setHasPmxSkeleton(false);
    pmxViewRef.current = null;
    pmxLightRuntimeRef.current = null;
    idleAnimationRef.current.pmxState.isRotating = false;
    if (idleAnimationRef.current.pmxState.inactivityTimeoutId) {
      clearTimeout(idleAnimationRef.current.pmxState.inactivityTimeoutId);
      idleAnimationRef.current.pmxState.inactivityTimeoutId = null;
    }

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

    const source =
      sourceView === "vrm" ? vrmViewRef.current : pmxViewRef.current;
    const target =
      sourceView === "vrm" ? pmxViewRef.current : vrmViewRef.current;
    if (!source || !target || orbitSyncLockRef.current) {
      return;
    }

    const sourceOffset = source.camera.position
      .clone()
      .sub(source.controls.target);
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
    const sourcePanDelta = source.controls.target
      .clone()
      .sub(source.anchorTarget);
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

  function resetOrbitView(
    view: {
      controls: OrbitControls;
    } | null,
  ) {
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

  function createIdleRotationManager(
    viewRef: React.MutableRefObject<{
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      baseDistance: number;
      anchorTarget: THREE.Vector3;
    } | null>,
    stateKey: "vrmState" | "pmxState",
  ) {
    return {
      resetInactivityTimer: () => {
        const state = idleAnimationRef.current[stateKey];
        if (state.inactivityTimeoutId) {
          clearTimeout(state.inactivityTimeoutId);
        }
        state.inactivityTimeoutId = setTimeout(() => {
          if (viewRef.current) {
            state.isRotating = true;
            state.rotationDirection = Math.random() < 0.5 ? 1 : -1;
          }
        }, 20000);
      },
      stopRotation: () => {
        const state = idleAnimationRef.current[stateKey];
        if (state.inactivityTimeoutId) {
          clearTimeout(state.inactivityTimeoutId);
          state.inactivityTimeoutId = null;
        }
        state.isRotating = false;
      },
      updateRotation: (deltaTime: number) => {
        const state = idleAnimationRef.current[stateKey];
        // Don't rotate if system is busy (status is not idle)
        if (!state.isRotating || !viewRef.current) {
          return;
        }
        // Check status at time of update to prevent rotation during conversion
        if (idleAnimationRef.current.isConverting) {
          return;
        }
        const view = viewRef.current;
        const rotationSpeed =
          0.01875 * (state.rotationDirection === 1 ? 1 : -1);
        const angle = THREE.MathUtils.degToRad(rotationSpeed * deltaTime);
        const targetToCamera = view.camera.position
          .clone()
          .sub(view.controls.target);
        targetToCamera.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        view.camera.position.copy(view.controls.target).add(targetToCamera);
      },
    };
  }

  async function previewPmxFromZip(
    zipBlob: Blob,
    syncOrbitFromVrm = false,
  ): Promise<void> {
    if (!pmxCanvasRef.current) {
      return;
    }

    cleanupPmxPreview();
    setIsPmxReady(false);
    setPmxInfoData({ summaryRows: [], licenseRows: [] });

    const canvas = pmxCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      // Needed so report snapshots can capture the currently rendered frame reliably.
      preserveDrawingBuffer: true,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const loadingManager = new THREE.LoadingManager();
    let onPmxOrbitChanged: (() => void) | null = null;
    let frameId = 0;
    let loadedMesh: THREE.Object3D | null = null;
    let hasShownShaderErrorDialog = false;
    let hasAppliedMaterialFallback = false;
    const skeletonHelpers: THREE.SkeletonHelper[] = [];
    const objectUrls: string[] = [];
    const assetMap = new Map<string, string>();

    const showPreviewShaderErrorDialog = () => {
      if (hasShownShaderErrorDialog) {
        return;
      }
      hasShownShaderErrorDialog = true;
      setLogEnabled(true);
      setMessage(
        appLocale === "ja"
          ? "変換は成功しているので、ZIPはダウンロード可能です。PMXプレビュー描画ではエラーが発生しました。"
          : appLocale === "ko"
            ? "변환은 성공했으므로 ZIP 다운로드가 가능합니다. PMX 미리보기 렌더링에서 오류가 발생했습니다."
          : "Conversion succeeded, so ZIP download is available. PMX preview rendering failed.",
      );
      void Swal.fire({
        title: i18n.previewShaderErrorTitle,
        html: i18n.previewShaderErrorMessage.replace(/\n/g, "<br>"),
        icon: "error",
        confirmButtonText: i18n.previewShaderErrorOk,
      });
    };

    const applyPmxPreviewMaterialFallback = (reason: string): boolean => {
      if (hasAppliedMaterialFallback || !loadedMesh) {
        return false;
      }

      let replacedMaterialCount = 0;
      loadedMesh.traverse((object) => {
        const maybeMesh = object as THREE.Mesh;
        if (!maybeMesh.isMesh) {
          return;
        }

        const toStandard = (
          material: THREE.Material | null | undefined,
        ): THREE.Material | null => {
          if (!material) {
            return null;
          }
          const source = material as THREE.Material & {
            color?: THREE.Color;
            map?: THREE.Texture | null;
            emissive?: THREE.Color;
            emissiveMap?: THREE.Texture | null;
            alphaMap?: THREE.Texture | null;
            transparent?: boolean;
            opacity?: number;
            side?: THREE.Side;
            alphaTest?: number;
            name?: string;
          };

          const fallback = new THREE.MeshStandardMaterial({
            color: source.color
              ? source.color.clone()
              : new THREE.Color(0xffffff),
            map: source.map ?? null,
            emissive: source.emissive
              ? source.emissive.clone()
              : new THREE.Color(0x000000),
            emissiveMap: source.emissiveMap ?? null,
            alphaMap: source.alphaMap ?? null,
            transparent: source.transparent ?? false,
            opacity: typeof source.opacity === "number" ? source.opacity : 1,
            side: source.side ?? THREE.FrontSide,
            alphaTest:
              typeof source.alphaTest === "number" ? source.alphaTest : 0,
            roughness: 1,
            metalness: 0,
          });
          fallback.name = source.name ?? "";
          fallback.needsUpdate = true;
          return fallback;
        };

        if (Array.isArray(maybeMesh.material)) {
          const nextMaterials = maybeMesh.material.map((material) => {
            const fallback = toStandard(material);
            if (fallback) {
              replacedMaterialCount += 1;
            }
            return fallback;
          });
          if (nextMaterials.some((mat) => mat !== null)) {
            maybeMesh.material = nextMaterials.filter(
              (mat): mat is THREE.Material => mat !== null,
            );
          }
          return;
        }

        const fallback = toStandard(maybeMesh.material);
        if (fallback) {
          maybeMesh.material = fallback;
          replacedMaterialCount += 1;
        }
      });

      if (replacedMaterialCount <= 0) {
        return false;
      }

      hasAppliedMaterialFallback = true;
      runtimeQualitySignalsRef.current.add("pmx-preview-material-fallback");
      appendConsoleLine(
        [
          `[WARN] PMX preview fallback material enabled (${reason}), replaced materials: ${replacedMaterialCount}`,
        ],
        "warn",
      );
      return true;
    };

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
      for (const helper of skeletonHelpers) {
        scene.remove(helper);
        helper.dispose();
      }
      skeletonHelpers.length = 0;
      pmxSkeletonHelpersRef.current = [];
      setHasPmxSkeleton(false);
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

    let pmxIdleManager: ReturnType<typeof createIdleRotationManager> | null =
      null;
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
      const rendererWithShaderDebug = renderer as THREE.WebGLRenderer & {
        debug?: {
          onShaderError?: (...args: unknown[]) => void;
        };
      };
      if (rendererWithShaderDebug.debug) {
        rendererWithShaderDebug.debug.onShaderError = () => {
          runtimeQualitySignalsRef.current.add("pmx-shader-compile-failed");
          appendConsoleLine(
            ["[ERROR] PMX preview shader compile failed."],
            "error",
          );
          const recovered = applyPmxPreviewMaterialFallback("shader-compile");
          if (!recovered) {
            showPreviewShaderErrorDialog();
          }
        };
      }

      fitRendererSize();
      window.addEventListener("resize", fitRendererSize);

      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 1;
      controls.maxDistance = 300;

      const zipReader = new ZipReader(new BlobReader(zipBlob));
      const entries = await zipReader.getEntries();
      const entryFileNames = entries
        .map((entry) => {
          const current = entry as unknown as {
            filename?: string;
            directory?: boolean;
          };
          if (current.directory || !current.filename) {
            return null;
          }
          return normalizeAssetPath(current.filename);
        })
        .filter((name): name is string => Boolean(name));
      const textureEntryNames = entryFileNames.filter((name) =>
        /\.(png|jpe?g|bmp|tga|dds|webp)$/i.test(name),
      );
      const pmxEntryCandidates = entryFileNames.filter((name) =>
        /\.pmx$/i.test(name),
      );
      pmxDebug("zip entries", {
        count: entries.length,
        files: entries
          .map((entry) => {
            const current = entry as unknown as {
              filename?: string;
              directory?: boolean;
            };
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

      const pmxEntryName = [...assetMap.keys()].find((key) =>
        /\.pmx$/i.test(key),
      );
      if (!pmxEntryName) {
        throw new Error("PMX file was not found in converted ZIP.");
      }

      const pmxPath = normalizeAssetPath(pmxEntryName);
      pmxDebug("pmx path selected", { pmxPath });
      loadingManager.setURLModifier((url) => {
        for (const candidate of buildAssetLookupCandidates(url)) {
          const resolved = assetMap.get(candidate);
          if (resolved) {
            return resolved;
          }
        }
        return url;
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
      setPmxInfoData(extractPmxInfoData(mesh));

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
          // PMXEditor寄りに、材質の色乗算と発光寄与をリセットして
          // テクスチャ本来の発色を優先する。
          m.color.setRGB(1, 1, 1);
          m.emissive.setRGB(0, 0, 0);
          m.blending = THREE.NormalBlending;
          m.toneMapped = false;
          if (m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
          if (m.emissiveMap) {
            // PMXプレビューではemissive寄与が白かぶりに見えやすいため無効化。
            m.emissiveMap = null;
          }
          if (m.matcap) {
            m.matcap.colorSpace = THREE.SRGBColorSpace;
            m.matcap.needsUpdate = true;
          }
          m.needsUpdate = true;
        }
      });

      await waitForMeshColorTextures(mesh, 1200);

      // MMDLoader may mark texture-side transparency (map.transparent) but leave
      // material.transparent as false. Syncing them prevents masked cloth parts
      // (e.g. aprons) from being rendered as fully opaque/discarded artifacts.
      mesh.traverse((obj) => {
        const maybeMesh = obj as THREE.Mesh;
        if (!maybeMesh.isMesh) {
          return;
        }
        const mats = Array.isArray(maybeMesh.material)
          ? maybeMesh.material
          : [maybeMesh.material];
        for (const mat of mats) {
          if (!mat) {
            continue;
          }
          const m = mat as THREE.MeshToonMaterial & {
            map?: (THREE.Texture & { transparent?: boolean }) | null;
            alphaMap?: THREE.Texture | null;
            premultipliedAlpha?: boolean;
          };

          const materialLabel =
            `${maybeMesh.name || ""} ${m.name || ""}`.toLowerCase();
          const mapTransparent = Boolean(m.map && m.map.transparent);
          const hasAlphaMap = Boolean(m.alphaMap);
          const needsCutout = mapTransparent || hasAlphaMap;
          const likelySkinMaterial =
            /(skin|body|face|head|hair|肌|素体|顔|頭|髪)/.test(materialLabel);

          // PMXエディタ寄りに、半透明ブレンドは原則使わずカットアウト方式へ統一する。
          // これにより全体が白く霞む(フィルターがかかったように見える)現象を抑える。
          m.transparent = false;
          m.opacity = 1;
          m.premultipliedAlpha = false;
          m.alphaTest = needsCutout
            ? Math.max(m.alphaTest ?? 0, likelySkinMaterial ? 0.02 : 0.06)
            : 0;
          m.depthWrite = true;
          m.depthTest = true;
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
        directionalIntensity: Number(
          tunedLight.directionalIntensity.toFixed(3),
        ),
      });

      scene.add(mesh);

      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      const uniqueBoneNames = new Set<string>();
      const materialNames: string[] = [];
      const materialRenderDiagnostics: PmxPreviewDiagnostics["materialRenderDiagnostics"] =
        [];
      let materialSlotCount = 0;
      let vertexCount = 0;
      let triangleCount = 0;
      let morphCount = 0;
      let colorTextureCount = 0;
      let loadedColorTextureCount = 0;
      let pendingColorTextureCount = 0;
      mesh.traverse((object) => {
        const maybeSkinnedMesh = object as THREE.SkinnedMesh;
        if (maybeSkinnedMesh.isSkinnedMesh) {
          skinnedMeshes.push(maybeSkinnedMesh);
          if (maybeSkinnedMesh.skeleton?.bones) {
            for (const bone of maybeSkinnedMesh.skeleton.bones) {
              if (bone?.name) {
                uniqueBoneNames.add(bone.name);
              }
            }
          }
        }

        const maybeMesh = object as THREE.Mesh;
        if (!maybeMesh.isMesh) {
          return;
        }

        const geometry = maybeMesh.geometry;
        const position = geometry?.getAttribute?.("position");
        if (position && typeof position.count === "number") {
          vertexCount += position.count;
          if (geometry.index && typeof geometry.index.count === "number") {
            triangleCount += Math.floor(geometry.index.count / 3);
          } else {
            triangleCount += Math.floor(position.count / 3);
          }
        }

        if (maybeMesh.morphTargetDictionary) {
          morphCount += Object.keys(maybeMesh.morphTargetDictionary).length;
        }

        const materials = Array.isArray(maybeMesh.material)
          ? maybeMesh.material
          : [maybeMesh.material];
        for (const material of materials) {
          materialSlotCount += 1;
          if (material && typeof material.name === "string" && material.name) {
            materialNames.push(material.name);
          }

          const colorTexture = getMaterialColorTexture(material);
          if (colorTexture) {
            colorTextureCount += 1;
            if (hasTextureImageData(colorTexture)) {
              loadedColorTextureCount += 1;
            } else if (hasPendingTextureCallback(colorTexture)) {
              pendingColorTextureCount += 1;
            }
          }

          if (materialRenderDiagnostics.length < 64 && material) {
            const withRenderProps = material as THREE.Material & {
              map?: THREE.Texture | null;
              alphaMap?: THREE.Texture | null;
            };
            materialRenderDiagnostics.push({
              name: material.name || "(no-name)",
              meshName: maybeMesh.name || "(no-mesh-name)",
              meshRenderOrder: maybeMesh.renderOrder,
              side: getMaterialSideLabel(material.side),
              transparent: Boolean(material.transparent),
              alphaTest: Number((material.alphaTest ?? 0).toFixed(4)),
              depthWrite: Boolean(material.depthWrite),
              depthTest: Boolean(material.depthTest),
              opacity: Number((material.opacity ?? 1).toFixed(4)),
              hasMap: Boolean(withRenderProps.map),
              mapTransparent: Boolean(
                withRenderProps.map &&
                (
                  withRenderProps.map as THREE.Texture & {
                    transparent?: boolean;
                  }
                ).transparent,
              ),
              hasAlphaMap: Boolean(withRenderProps.alphaMap),
            });
          }
        }
      });

      const textureCoverage =
        materialSlotCount > 0 ? colorTextureCount / materialSlotCount : 0;
      const loadedTextureCoverage =
        materialSlotCount > 0 ? loadedColorTextureCount / materialSlotCount : 0;

      const materialRenderStats = materialRenderDiagnostics.reduce(
        (acc, item) => {
          if (item.side === "FrontSide") {
            acc.frontSideCount += 1;
          } else if (item.side === "DoubleSide") {
            acc.doubleSideCount += 1;
          } else if (item.side === "BackSide") {
            acc.backSideCount += 1;
          }
          if (item.transparent) {
            acc.transparentCount += 1;
          }
          if (item.alphaTest > 0) {
            acc.alphaTestMaterialCount += 1;
          }
          if (item.hasAlphaMap) {
            acc.hasAlphaMapCount += 1;
          }
          if (item.mapTransparent) {
            acc.mapTransparentCount += 1;
          }
          if (!item.depthWrite) {
            acc.depthWriteOffCount += 1;
          }
          if (!item.depthTest) {
            acc.depthTestOffCount += 1;
          }
          return acc;
        },
        {
          frontSideCount: 0,
          doubleSideCount: 0,
          backSideCount: 0,
          transparentCount: 0,
          alphaTestMaterialCount: 0,
          hasAlphaMapCount: 0,
          mapTransparentCount: 0,
          depthWriteOffCount: 0,
          depthTestOffCount: 0,
        },
      );
      const materialRenderSamples = materialRenderDiagnostics
        .slice(0, 32)
        .map(
          (item) =>
            `${item.name} | mesh=${item.meshName} | side=${item.side} | tr=${item.transparent ? 1 : 0} | aT=${item.alphaTest} | dW=${item.depthWrite ? 1 : 0} | dT=${item.depthTest ? 1 : 0} | op=${item.opacity} | map=${item.hasMap ? 1 : 0} | mapTr=${item.mapTransparent ? 1 : 0} | aMap=${item.hasAlphaMap ? 1 : 0}`,
        );
      if (
        materialSlotCount >= 6 &&
        colorTextureCount === 0 &&
        loadedColorTextureCount === 0 &&
        pendingColorTextureCount === 0
      ) {
        runtimeQualitySignalsRef.current.add("pmx-missing-color-textures");
      }

      for (const skinned of skinnedMeshes) {
        if (!skinned.skeleton || skinned.skeleton.bones.length <= 0) {
          continue;
        }
        const helper = new THREE.SkeletonHelper(skinned);
        helper.visible = pmxBonesVisible;
        helper.setColors(
          new THREE.Color("#63f5ff"),
          new THREE.Color("#ff9f4a"),
        );
        (helper.material as THREE.LineBasicMaterial).depthTest = false;
        (helper.material as THREE.LineBasicMaterial).transparent = true;
        (helper.material as THREE.LineBasicMaterial).opacity = 0.95;
        scene.add(helper);
        skeletonHelpers.push(helper);
      }
      pmxSkeletonHelpersRef.current = skeletonHelpers;
      setHasPmxSkeleton(skeletonHelpers.length > 0);

      pmxPreviewDiagnosticsRef.current = {
        zipEntryCount: entries.length,
        zipFileCount: entryFileNames.length,
        zipTextureFileCount: textureEntryNames.length,
        zipTextureSamples: textureEntryNames.slice(0, 20),
        zipPmxEntries: pmxEntryCandidates.slice(0, 5),
        selectedPmxPath: pmxPath,
        assetKeyCount: assetMap.size,
        materialCount: new Set(materialNames).size,
        materialSlotCount,
        vertexCount,
        triangleCount,
        boneCount: uniqueBoneNames.size,
        morphCount,
        colorTextureCount,
        loadedColorTextureCount,
        pendingColorTextureCount,
        textureCoverage: Number(textureCoverage.toFixed(3)),
        loadedTextureCoverage: Number(loadedTextureCoverage.toFixed(3)),
        materialRenderStats,
        materialRenderSamples,
        materialRenderDiagnostics,
      };

      pmxDebug("mesh summary", {
        type: mesh.type,
        childCount: mesh.children.length,
        skinnedMeshCount: skinnedMeshes.length,
        materialCount: new Set(materialNames).size,
        materialSlotCount,
        colorTextureCount,
        loadedColorTextureCount,
        pendingColorTextureCount,
        textureCoverage: Number(textureCoverage.toFixed(3)),
        loadedTextureCoverage: Number(loadedTextureCoverage.toFixed(3)),
        materialRenderStats,
        materialRenderSamples,
        materialRenderDiagnostics,
        sampleMaterials: [...new Set(materialNames)].slice(0, 40),
      });

      const armBonePattern =
        /(腕|ひじ|手首|手捩|UpperArm|LowerArm|Hand|Elbow|Wrist)/i;
      const armBoneSnapshots: Array<{
        name: string;
        local: [number, number, number];
        world: [number, number, number];
      }> = [];
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
      const fitWidthDistance =
        (size.x * 0.5) / (Math.tan(halfFov) * camera.aspect);
      const distance =
        Math.max(fitHeightDistance, fitWidthDistance, size.z) * 1.25;
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
      pmxIdleManager = createIdleRotationManager(pmxViewRef, "pmxState");
      pmxIdleManagerRef.current = pmxIdleManager;
      controls.addEventListener("change", onPmxOrbitChanged);
      controls.addEventListener("start", () => pmxIdleManager!.stopRotation());
      controls.addEventListener("end", () =>
        pmxIdleManager!.resetInactivityTimer(),
      );
      pmxIdleManager.resetInactivityTimer();

      if (syncOrbitFromVrm) {
        syncOrbitBetweenViews("vrm", true);
      }

      let lastFrameTime = performance.now();
      const renderLoop = () => {
        frameId = window.requestAnimationFrame(renderLoop);
        const now = performance.now();
        const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.1);
        lastFrameTime = now;

        controls.update();
        pmxIdleManager!.updateRotation(deltaTime * 1000);
        try {
          renderer.render(scene, camera);
        } catch (error) {
          appendConsoleLine(
            ["[ERROR] PMX preview render failed:", formatLogArg(error)],
            "error",
          );
          const recovered = applyPmxPreviewMaterialFallback("render-error");
          if (!recovered) {
            window.cancelAnimationFrame(frameId);
            showPreviewShaderErrorDialog();
          }
        }
      };
      renderLoop();
      setIsPmxReady(true);
    } catch (error) {
      disposePreview();
      pmxPreviewCleanupRef.current = null;
      pmxIdleManager?.stopRotation();
      setIsPmxReady(false);
      throw error;
    }
  }

  async function performConvertWithMode(requestedMode: ConvertMode) {
    if (!file) {
      return;
    }

    if (isVrmRedistributionOrModificationNG) {
      const result = await Swal.fire({
        title: "Confirm",
        html: i18n.restrictedRedistributionModificationConfirm,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: i18n.restrictedRedistributionModificationProceed,
        cancelButtonText: i18n.restrictedRedistributionModificationCancel,
        reverseButtons: true,
      });

      if (!result.isConfirmed) {
        setErrorDetail("");
        setMessage(
          "Conversion cancelled due to redistribution/modification restrictions.",
        );
        return;
      }
    }

    setStatus("uploading");
    idleAnimationRef.current.isConverting = true;
    setErrorDetail("");
    setConvertedOutput(null);
    setDetectedQualityRiskSignals([]);
    setLastRequestedMode(requestedMode);
    runtimeQualitySignalsRef.current.clear();
    pmxPreviewDiagnosticsRef.current = null;
    setConvertProgressPercent(2);
    setConvertProgressStage("init");
    abortControllerRef.current = new AbortController();
    beginUserConvertLogSession();
    setMessage(
      requestedMode === "rust"
        ? "Rust mode is deprecated and not recommended. Please use Turbo (Labs)/Nim mode."
        : requestedMode === "nim"
          ? "Nim experimental mode requested. Running Nim Wasm converter in this browser."
          : mode === "backend"
            ? "Converting with backend... this can take a while for large files."
            : backendEnabled
              ? "Trying Wasm first. If it fails, backend fallback will run."
              : "Converting with Wasm mode...",
    );
    appendUserConvertLog(`[INFO] 変換を開始します: ${file.name}`);
    appendUserConvertLog(`[INFO] 変換モード: ${requestedMode}`);
    startConvertHeartbeat();

    try {
      const convertLogStartIndex = logLinesRef.current.length;
      const convertInput = await buildConvertInputFile(file);
      poseDebug("convert start", {
        requestedMode,
        fileName: file.name,
        convertInputBytes: convertInput.size,
      });
      const convertStartedAt = performance.now();
      const result = await convertWithMode(convertInput, requestedMode, {
        onProgress: (progress) => {
          setMessage(progress.message);
          const nextPercent = getStageProgressPercent(progress.stage);
          setConvertProgressStage(progress.stage);
          setConvertProgressPercent((prev) => Math.max(prev, nextPercent));
          appendUserConvertStageLog(progress.stage, requestedMode);
        },
        onLog: appendWorkerLog,
        signal: abortControllerRef.current.signal,
      });
      const convertElapsedMs = Math.round(performance.now() - convertStartedAt);

      let outputBlob = result.blob;
      let outputExtension: ConvertedOutput["fileExtension"] =
        result.fileExtension;
      const licenseText = generateLicenseText(vrmInfoData, appLocale);
      if (result.fileExtension === "zip") {
        outputBlob = await addLicenseToZip(result.blob, licenseText);
      } else if (result.fileExtension === "pmx") {
        const wrapped = await buildPmxZipFromVrm(file, result.blob);
        outputBlob = await addLicenseToZip(wrapped.zipBlob, licenseText);
        outputExtension = "zip";
        console.info(
          `[INFO] PMX packaged as ZIP with ${wrapped.textureCount} texture file(s) from source VRM.`,
        );
        appendUserConvertLog("[INFO] PMXとテクスチャをZIP化しました。");
      }

      const nextOutput: ConvertedOutput = {
        blob: outputBlob,
        fileExtension: outputExtension,
      };
      const conversionReportId = createConversionReportId();
      setConvertedOutput(nextOutput);
      setLastUsedMode(result.usedMode);
      setLastFallbackReason(result.fallbackReason ?? null);
      setLastConversionReportId(conversionReportId);

      if (requestedMode === "rust") {
        appendUserConvertLog(
          result.fallbackReason
            ? `[WARN] Rust mode is deprecated. Using ${result.usedMode}. ${result.fallbackReason}`
            : `[WARN] Rust mode is deprecated and not recommended. Completed via ${result.usedMode}.`,
          "warn",
        );
      }

      if (requestedMode === "nim") {
        appendUserConvertLog(
          result.fallbackReason
            ? `[WARN] Nim experimental mode did not run yet. Using ${result.usedMode}. ${result.fallbackReason}`
            : `[INFO] Nim experimental mode completed via ${result.usedMode}.`,
          result.fallbackReason ? "warn" : "info",
        );
      }

      appendUserConvertLog(`[INFO] 変換時間: ${convertElapsedMs} ms`);

      if (outputExtension === "zip") {
        await previewPmxFromZip(outputBlob, orbitSyncEnabled);
        setPmxPreviewFileName(file.name.replace(/\.[^.]+$/, "") + ".pmx");
      } else {
        throw new Error(
          "Current preview supports ZIP output with PMX resources.",
        );
      }

      setConvertProgressPercent(100);
      setConvertProgressStage("done");
      setStatus("done");
      if (worldCounterParticipationEnabled) {
        void incrementWorldCounterOnFirestore()
          .catch((error) => {
            console.warn("world_counter.increment_failed", error);
            reportWorldCounterError("increment", error, {
              reason: "convert_complete",
            });
          })
          .finally(() => {
            refreshWorldCounter("convert_complete");
          });
      } else {
        refreshWorldCounter("convert_complete_no_participation");
      }
      setLocalCounter((prev) => {
        const next = prev + 1;
        try {
          window.localStorage.setItem(LOCAL_COUNTER_KEY, String(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      idleAnimationRef.current.isConverting = false;
      const convertLogLines = logLinesRef.current.slice(convertLogStartIndex);
      const qualityRiskSignals = [
        ...new Set([
          ...detectQualityRiskSignals(convertLogLines),
          ...Array.from(runtimeQualitySignalsRef.current),
        ]),
      ].filter((signal) => !NON_QUALITY_RUNTIME_SIGNALS.has(signal));
      setDetectedQualityRiskSignals(qualityRiskSignals);

      const diagnostics = pmxPreviewDiagnosticsRef.current;
      if (diagnostics) {
        const counts = toOutputCountMetrics(diagnostics);
        const metricsRecord = {
          event: "convert.output.counts",
          inputName: file.name,
          requestedMode,
          actualMode: result.usedMode,
          fallbackReason: result.fallbackReason ?? null,
          counts,
          timestamp: new Date().toISOString(),
        };
        console.info(`[METRICS] ${JSON.stringify(metricsRecord)}`);

        const baselineKey = buildMetricsBaselineKey(file.name);
        const baselineRaw = (() => {
          try {
            return window.localStorage.getItem(baselineKey);
          } catch {
            return null;
          }
        })();

        if (baselineRaw) {
          try {
            const baseline = JSON.parse(baselineRaw) as {
              sourceMode?: string;
              counts?: OutputCountMetrics;
              timestamp?: string;
            };
            if (baseline.counts) {
              const diff = buildOutputCountDiff(counts, baseline.counts);
              console.info(
                `[METRICS_DIFF] ${JSON.stringify({
                  event: "convert.output.counts.diff",
                  inputName: file.name,
                  requestedMode,
                  actualMode: result.usedMode,
                  baselineMode: baseline.sourceMode ?? "unknown",
                  baselineTimestamp: baseline.timestamp ?? null,
                  diff,
                  timestamp: metricsRecord.timestamp,
                })}`,
              );

              if (requestedMode === "nim") {
                const gate = evaluateNimQualityGate(diff);
                const gatePayload = `[QUALITY_GATE] ${JSON.stringify({
                  event: "convert.nim.quality-gate",
                  inputName: file.name,
                  requestedMode,
                  actualMode: result.usedMode,
                  passed: gate.passed,
                  reasons: gate.reasons,
                  threshold: {
                    verticesRatioMax: NIM_VERTEX_RATIO_LIMIT,
                    bonesRatioTolerance: NIM_BONE_RATIO_TOLERANCE,
                    morphsRatioTolerance: NIM_MORPH_RATIO_TOLERANCE,
                  },
                  timestamp: metricsRecord.timestamp,
                })}`;
                if (gate.passed) {
                  console.info(gatePayload);
                } else {
                  console.warn(gatePayload);
                }

                if (!gate.passed) {
                  runtimeQualitySignalsRef.current.add(
                    "nim-quality-gate-failed",
                  );
                }
              }
            }
          } catch {
            console.warn("[WARN] Failed to parse metrics baseline JSON.");
          }
        }

        // Use Python-compatible routes (Wasm/Backend) as baseline for future Nim comparisons.
        if (
          requestedMode !== "nim" &&
          (result.usedMode === "wasm" || result.usedMode === "backend")
        ) {
          try {
            window.localStorage.setItem(
              buildMetricsBaselineKey(file.name),
              JSON.stringify({
                sourceMode: result.usedMode,
                counts,
                timestamp: metricsRecord.timestamp,
              }),
            );
          } catch {
            // localStorage unavailable — ignore baseline persistence.
          }
        }
      }

      if (result.fallbackReason) {
        setMessage(
          qualityRiskSignals.length > 0
            ? `Converted and previewed with fallback. Requested: ${requestedMode}, used: ${result.usedMode}. Reason: ${result.fallbackReason} / Press Download ZIP to save file. If preview quality looks wrong, use ${i18n.qualityReportButton}.`
            : `Converted and previewed with fallback. Requested: ${requestedMode}, used: ${result.usedMode}. Reason: ${result.fallbackReason} / Press Download ZIP to save file.`,
        );
      } else {
        setMessage(
          qualityRiskSignals.length > 0
            ? `Converted and previewed via ${result.usedMode}. Press Download ZIP to save file. If preview quality looks wrong, use ${i18n.qualityReportButton}.`
            : `Converted and previewed via ${result.usedMode}. Press Download ZIP to save file.`,
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setStatus("canceled");
        idleAnimationRef.current.isConverting = false;
        setConvertProgressPercent(0);
        setConvertProgressStage(null);
        setMessage("Conversion canceled.");
      } else {
        const rawDetail =
          error instanceof Error ? error.message : String(error);
        console.error("convert.failed", {
          mode: requestedMode,
          backendEnabled,
          fileName: file?.name,
          detail: rawDetail,
          error,
        });
        Sentry.withScope((scope) => {
          scope.setTag("mode", requestedMode);
          scope.setTag("event_type", "error");
          scope.setContext("convert", {
            status: "failed",
            backendEnabled,
          });
          Sentry.captureException(
            error instanceof Error ? error : new Error(rawDetail),
          );
        });

        setStatus("error");
        idleAnimationRef.current.isConverting = false;
        setConvertProgressPercent(0);
        setConvertProgressStage(null);
        setErrorDetail(rawDetail);
        setMessage(
          toUserFriendlyConvertError(error, {
            mode: requestedMode,
            backendEnabled,
          }),
        );
        setLogEnabled(true);
        console.error("[ERROR] Convert failed:");
        console.error(rawDetail);
        appendUserConvertLog(
          "[ERROR] 変換に失敗しました。詳細はブラウザのコンソールを確認してください。",
          "error",
        );
        showDialog({
          title: "Error",
          message: "Convert error. Please see Log View.",
          type: "error",
        });
      }
    } finally {
      stopConvertHeartbeat();
      abortControllerRef.current = null;
    }
  }

  async function onConvert() {
    if (!file) {
      return;
    }
    const requestedMode: ConvertMode =
      turboLabsEnabled && nimEnabled ? "nim" : rustEnabled ? "rust" : mode;

    if (taPoseAngle === 0) {
      showDialog({
        title: "Confirm",
        message: i18n.taPoseZeroConfirm,
        type: "confirm",
        okLabel: "Continue",
        cancelLabel: "Cancel",
        onOk: async () => {
          closeDialog();
          await performConvertWithMode(requestedMode);
        },
        onCancel: () => {
          setErrorDetail("");
          setMessage(i18n.taPoseZeroCanceled);
        },
      });
      return;
    }

    await performConvertWithMode(requestedMode);
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

  async function onReportQualityIssue() {
    if (status !== "done" || !convertedOutput) {
      return;
    }

    const result = await Swal.fire({
      title: i18n.qualityReportButton,
      html: i18n.qualityReportConfirm.replace(/\n/g, "<br>"),
      icon: "question",
      showCancelButton: true,
      confirmButtonText: i18n.qualityReportDialogSend,
      cancelButtonText: i18n.qualityReportDialogCancel,
      reverseButtons: true,
    });
    if (!result.isConfirmed) {
      return;
    }

    const snapshotWidth = 320;
    const snapshotHeight = 320;
    const vrmDataUrl = await captureCanvasSnapshotDataUrl(
      vrmCanvasRef.current,
      snapshotWidth,
      snapshotHeight,
    );
    const pmxDataUrl = await captureCanvasSnapshotDataUrl(
      pmxCanvasRef.current,
      snapshotWidth,
      snapshotHeight,
    );

    reportQualitySignals({
      source: "user_reported",
      signals:
        detectedQualityRiskSignals.length > 0
          ? detectedQualityRiskSignals
          : [lastFallbackReason ?? "user-reported-visual-issue"],
      level: "info",
      requestedMode: lastRequestedMode ?? mode,
      usedMode: lastUsedMode,
      backendEnabled,
      fileExtension: convertedOutput.fileExtension,
      dialogEnabled: false,
      status: "success_but_quality_issue",
      result: "success_user_reported_issue",
      conversionReportId: lastConversionReportId ?? createConversionReportId(),
      previewSnapshots: {
        vrmDataUrl: vrmDataUrl ?? undefined,
        pmxDataUrl: pmxDataUrl ?? undefined,
        width: snapshotWidth,
        height: snapshotHeight,
      },
      pmxPreviewDiagnostics: pmxPreviewDiagnosticsRef.current ?? undefined,
    });

    setMessage(i18n.qualityReportSubmittedMessage);
    setDetectedQualityRiskSignals([]);
  }

  function onOpenMetadata(target: "vrm" | "pmx") {
    if (target === "vrm") {
      setIsVrmMetadataOpen((prev) => !prev);
      return;
    }

    setIsPmxMetadataOpen((prev) => !prev);
  }

  function onCancel() {
    abortControllerRef.current?.abort();
  }

  function cleanupPreview() {
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
    vrmSkeletonHelpersRef.current = [];
    setHasVrmSkeleton(false);
    vrmViewRef.current = null;
    idleAnimationRef.current.vrmState.isRotating = false;
    if (idleAnimationRef.current.vrmState.inactivityTimeoutId) {
      clearTimeout(idleAnimationRef.current.vrmState.inactivityTimeoutId);
      idleAnimationRef.current.vrmState.inactivityTimeoutId = null;
    }
    upperArmStateRef.current = {
      leftBone: null,
      rightBone: null,
      leftBaseQuaternion: null,
      rightBaseQuaternion: null,
      armPoseSign: 1,
    };
  }

  function applyUpperArmAngle(angleDeg: number) {
    const angleRad = THREE.MathUtils.degToRad(angleDeg);
    const state = upperArmStateRef.current;
    const signedAngle = angleRad * state.armPoseSign;

    if (state.leftBone && state.leftBaseQuaternion) {
      state.leftBone.quaternion.copy(state.leftBaseQuaternion);
      state.leftBone.rotateZ(signedAngle);
    }

    if (state.rightBone && state.rightBaseQuaternion) {
      state.rightBone.quaternion.copy(state.rightBaseQuaternion);
      state.rightBone.rotateZ(-signedAngle);
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
      appendConsoleLine(args, "log");
    };
    console.info = (...args: unknown[]) => {
      originalInfo(...args);
      appendConsoleLine(args, "info");
    };
    console.warn = (...args: unknown[]) => {
      originalWarn(...args);
      appendConsoleLine(args, "warn");
    };
    console.error = (...args: unknown[]) => {
      originalError(...args);
      appendConsoleLine(args, "error");
    };
    console.debug = (...args: unknown[]) => {
      originalDebug(...args);
      appendConsoleLine(args, "debug");
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
    if (!isVrmMetadataOpen && !isPmxMetadataOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (
        target.closest(".preview-metadata-popup") ||
        target.closest(".metadata-info-button")
      ) {
        return;
      }

      setIsVrmMetadataOpen(false);
      setIsPmxMetadataOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isPmxMetadataOpen, isVrmMetadataOpen]);

  useEffect(() => {
    if (!maximizedPreview) {
      document.body.classList.remove("preview-maximized-open");
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMaximizedPreview(null);
      }
    };

    document.body.classList.add("preview-maximized-open");
    window.dispatchEvent(new Event("resize"));
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.classList.remove("preview-maximized-open");
      window.dispatchEvent(new Event("resize"));
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [maximizedPreview]);

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
    setVrmInfoData({ summaryRows: [], licenseRows: [] });
    setIsVrmRedistributionOrModificationNG(false);
    setErrorDetail("");
    setMessage("Loading VRM preview...");
    cleanupPreview();

    const profileForPreview =
      (await detectProfileFromFile(targetFile)) ?? detectedProfileResult;
    const isVrm1Preview = Boolean(profileForPreview?.hasVrm1Extension);
    const previewRootYaw = isVrm1Preview ? 0 : Math.PI;
    const armPoseSign: 1 | -1 = isVrm1Preview ? -1 : 1;

    const canvas = vrmCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      // Needed so report snapshots can capture the currently rendered frame reliably.
      preserveDrawingBuffer: true,
    });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    let onVrmOrbitChanged: (() => void) | null = null;
    const timer = new THREE.Timer();
    let frameId = 0;
    let vrm: VRM | null = null;
    let previewRoot: THREE.Object3D | null = null;
    let cleanupResolvedInput: (() => void) | null = null;
    const skeletonHelpers: THREE.SkeletonHelper[] = [];

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
      for (const helper of skeletonHelpers) {
        scene.remove(helper);
        helper.dispose();
      }
      skeletonHelpers.length = 0;
      vrmSkeletonHelpersRef.current = [];
      setHasVrmSkeleton(false);
      if (vrm) {
        scene.remove(vrm.scene);
      }
      if (previewRoot && previewRoot !== vrm?.scene) {
        scene.remove(previewRoot);
      }
      if (vrmGridRef.current) {
        scene.remove(vrmGridRef.current);
        vrmGridRef.current = null;
      }
      cleanupResolvedInput?.();
      cleanupResolvedInput = null;
      renderer.dispose();
    };

    previewCleanupRef.current = disposePreview;

    try {
      scene.background = new THREE.Color("#eaf1fb");
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambientLight);
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

      const loadingManager = new THREE.LoadingManager();
      const loader = new GLTFLoader(loadingManager);
      loader.register((parser: GLTFParser) => new VRMLoaderPlugin(parser));
      const resolvedInput = await resolvePreviewInput(targetFile);
      cleanupResolvedInput = resolvedInput.cleanup;
      let gltf;
      const originalConsoleWarn = console.warn;
      const shouldSuppressWarn = createThreeWarnFilter();
      try {
        console.warn = (...args: unknown[]) => {
          if (shouldSuppressWarn(...args)) {
            return;
          }
          originalConsoleWarn(...args);
        };

        if (resolvedInput.kind === "binary") {
          gltf = await loader.parseAsync(resolvedInput.buffer, "");
        } else {
          const assetMap = resolvedInput.assetUrlMap;
          const baseDir = resolvedInput.baseDir;
          loadingManager.setURLModifier((rawUrl) => {
            const normalized = normalizeAssetPath(rawUrl);
            const withBase = baseDir
              ? normalizeAssetPath(`${baseDir}${normalized}`)
              : normalized;

            const candidates = [
              ...buildAssetLookupCandidates(withBase),
              ...buildAssetLookupCandidates(normalized),
            ];

            for (const candidate of candidates) {
              const hit = assetMap.get(candidate);
              if (hit) {
                return hit;
              }
            }

            return rawUrl;
          });
          gltf = await loader.parseAsync(resolvedInput.gltfText, "");
        }
      } finally {
        console.warn = originalConsoleWarn;
      }

      await applySpecGlossinessFallback(gltf);
      const infoData = extractVrmInfoData(gltf);
      setVrmInfoData(infoData);
      setIsVrmRedistributionOrModificationNG(
        isRedistributionOrModificationNG(infoData),
      );
      vrm = (gltf.userData.vrm as VRM | undefined) ?? null;
      const isGenericModelPreview = !vrm;

      if (isGenericModelPreview) {
        // Generic GLB/GLTF from DCC tools (e.g. Sketchfab) tends to look dim
        // compared to VRM defaults, so lift key/ambient only for this path.
        ambientLight.intensity = 1.25;
        keyLight.intensity = 1.75;
      }

      previewRoot = vrm?.scene ?? gltf.scene;
      scene.add(previewRoot);
      if (vrm) {
        vrm.scene.rotation.y = previewRootYaw;
      }

      const vrmRootHelper = new THREE.SkeletonHelper(previewRoot);
      vrmRootHelper.visible = vrmBonesVisible;
      vrmRootHelper.setColors(
        new THREE.Color("#63f5ff"),
        new THREE.Color("#ff9f4a"),
      );
      (vrmRootHelper.material as THREE.LineBasicMaterial).depthTest = false;
      (vrmRootHelper.material as THREE.LineBasicMaterial).transparent = true;
      (vrmRootHelper.material as THREE.LineBasicMaterial).opacity = 0.95;
      scene.add(vrmRootHelper);
      skeletonHelpers.push(vrmRootHelper);
      vrmSkeletonHelpersRef.current = skeletonHelpers;
      setHasVrmSkeleton(true);

      const humanoid = vrm?.humanoid;
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
        leftBaseQuaternion: leftUpperArm
          ? leftUpperArm.quaternion.clone()
          : null,
        rightBaseQuaternion: rightUpperArm
          ? rightUpperArm.quaternion.clone()
          : null,
        armPoseSign,
      };
      applyUpperArmAngle(taPoseAngle);

      const bounds = new THREE.Box3().setFromObject(previewRoot);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      previewRoot.position.sub(center);

      const halfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
      const fitHeightDistance = (size.y * 0.5) / Math.tan(halfFov);
      const fitWidthDistance =
        (size.x * 0.5) / (Math.tan(halfFov) * camera.aspect);
      const distance =
        Math.max(fitHeightDistance, fitWidthDistance, size.z) * 1.25;
      const targetY = size.y * 0.1;

      camera.position.set(0, targetY, Math.max(distance, 1.2));
      controls.target.set(0, targetY, 0);
      controls.update();
      controls.saveState();

      // Resync spring-bone runtime state after scene transforms to avoid
      // temporary hair jitter right after model load.
      vrm?.springBoneManager?.reset();

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
      const vrmIdleManager = createIdleRotationManager(vrmViewRef, "vrmState");
      vrmIdleManagerRef.current = vrmIdleManager;
      controls.addEventListener("change", onVrmOrbitChanged);
      controls.addEventListener("start", () => vrmIdleManager.stopRotation());
      controls.addEventListener("end", () =>
        vrmIdleManager.resetInactivityTimer(),
      );
      vrmIdleManager.resetInactivityTimer();

      const renderLoop = () => {
        frameId = window.requestAnimationFrame(renderLoop);
        timer.update();
        const delta = Math.min(timer.getDelta(), 1 / 30);
        vrm?.update(delta);
        controls.update();
        vrmIdleManager.updateRotation(delta * 1000);
        renderer.render(scene, camera);
      };

      renderLoop();
      setIsVrmReady(true);
      setMessage(
        vrm
          ? `Preview loaded: ${targetFile.name}. Drag to rotate, wheel to zoom.`
          : `Preview loaded (GLB/GLTF): ${targetFile.name}. Drag to rotate, wheel to zoom.`,
      );
    } catch (error) {
      const rawDetail = error instanceof Error ? error.message : String(error);
      setErrorDetail(rawDetail);
      setMessage("Failed to load VRM/GLB/GLTF preview.");
      appendConsoleLine(["[ERROR] preview.load_failed", rawDetail], "error", {
        force: true,
      });
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
    setPmxInfoData({ summaryRows: [], licenseRows: [] });
    setIsPmxMetadataOpen(false);
    setLogLines([]);
    setCopyStatus("idle");
    setErrorDetail("");
    setStatus("idle");
    await previewVrmFile(file);
  }

  async function updateDetectedProfile(selected: File | null): Promise<void> {
    const requestId = profileDetectionRequestIdRef.current + 1;
    profileDetectionRequestIdRef.current = requestId;

    if (!selected) {
      setDetectedProfileResult(null);
      return;
    }

    const detection = await detectProfileFromFile(selected);
    if (profileDetectionRequestIdRef.current !== requestId) {
      return;
    }

    setDetectedProfileResult(detection);
  }

  function applySelectedVrmFile(selected: File | null) {
    cleanupPmxPreview();
    setConvertedOutput(null);
    setPmxInfoData({ summaryRows: [], licenseRows: [] });
    setIsPmxMetadataOpen(false);
    setDetectedProfileResult(null);
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

    void updateDetectedProfile(selected);
    void previewVrmFile(selected);
  }

  async function buildZipFromFolderEntries(entries: FolderZipEntry[]): Promise<File> {
    if (entries.length === 0) {
      throw new Error("No files found in selected folder.");
    }

    const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
    const firstRelativePath = entries[0]?.relativePath || entries[0]?.file.name;
    const rootDir = normalizeAssetPath(firstRelativePath).split("/")[0] || "model";

    for (const entry of entries) {
      const normalized = normalizeAssetPath(entry.relativePath || entry.file.name);
      const entryPath = normalized.startsWith(`${rootDir}/`)
        ? normalized.slice(rootDir.length + 1)
        : normalized;
      if (!entryPath) {
        continue;
      }
      await zipWriter.add(entryPath, new BlobReader(entry.file));
    }

    const zipBlob = await zipWriter.close();
    return new File([zipBlob], `${rootDir}.zip`, { type: "application/zip" });
  }

  async function buildZipFromSinglePmxFile(file: File): Promise<File> {
    const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
    await zipWriter.add(normalizeAssetPath(file.name), new BlobReader(file));
    const zipBlob = await zipWriter.close();
    const baseName = file.name.replace(/\.pmx$/i, "");
    return new File([zipBlob], `${baseName || "model"}.zip`, {
      type: "application/zip",
    });
  }

  async function previewPmxSourceFile(selected: File): Promise<void> {
    setIsPmxPreviewing(true);
    setErrorDetail("");
    setMessage("Loading PMX preview...");

    try {
      const ext = getFileExtensionLower(selected.name);
      const zipSource =
        ext === ".pmx" ? await buildZipFromSinglePmxFile(selected) : selected;

      await previewPmxFromZip(zipSource, orbitSyncEnabled);
      setPmxPreviewFileName(selected.name);
      if (ext === ".pmx") {
        setMessage(
          `PMX preview loaded: ${selected.name}. If textures are missing, load ZIP or folder with texture files.`,
        );
      } else {
        setMessage(`PMX preview loaded: ${selected.name}.`);
      }
    } catch (error) {
      setErrorDetail(error instanceof Error ? error.message : String(error));
      setMessage("Failed to load PMX preview input.");
    } finally {
      setIsPmxPreviewing(false);
    }
  }

  function applySelectedPmxFile(selected: File | null) {
    setIsPmxMetadataOpen(false);
    setErrorDetail("");

    if (!selected) {
      cleanupPmxPreview();
      setPmxInfoData({ summaryRows: [], licenseRows: [] });
      setMessage("PMX preview source is not selected yet.");
      return;
    }

    void previewPmxSourceFile(selected);
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

  async function onVrmDropAreaDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsVrmDropActive(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    if (droppedFile) {
      const lowerName = droppedFile.name.toLowerCase();
      if (isPreviewSupportedInputFile(lowerName)) {
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
        return;
      }
    }

    const items = Array.from(event.dataTransfer.items ?? []);
    const entryCandidates = items
      .map((item) =>
        (item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntry | null;
        }).webkitGetAsEntry?.(),
      )
      .filter((entry): entry is FileSystemEntry => entry !== null);

    const directoryEntries = entryCandidates.filter(
      (entry): entry is FileSystemDirectoryEntry => entry.isDirectory,
    );
    if (directoryEntries.length > 0) {
      try {
        const allEntries = await Promise.all(
          directoryEntries.map((entry) => collectFolderEntriesRecursively(entry, "")),
        );
        const zipped = await buildZipFromFolderEntries(allEntries.flat());
        applySelectedVrmFile(zipped);
        setMessage(`Dropped folder loaded as ZIP source: ${zipped.name}`);
        return;
      } catch (error) {
        setMessage("Failed to read dropped folder.");
        setErrorDetail(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    setMessage(
      "Dropped file is not supported. Please drop a .vrm/.glb/.gltf/.zip file.",
    );
  }

  function onPmxDropAreaDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    if (!isPmxDropActive) {
      setIsPmxDropActive(true);
    }
  }

  function onPmxDropAreaDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsPmxDropActive(false);
  }

  async function onPmxDropAreaDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsPmxDropActive(false);
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    if (droppedFile && isPmxPreviewSupportedInputFile(droppedFile.name)) {
      applySelectedPmxFile(droppedFile);
      return;
    }

    const items = Array.from(event.dataTransfer.items ?? []);
    const entryCandidates = items
      .map((item) =>
        (item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntry | null;
        }).webkitGetAsEntry?.(),
      )
      .filter((entry): entry is FileSystemEntry => entry !== null);

    const directoryEntries = entryCandidates.filter(
      (entry): entry is FileSystemDirectoryEntry => entry.isDirectory,
    );
    if (directoryEntries.length > 0) {
      try {
        const allEntries = await Promise.all(
          directoryEntries.map((entry) => collectFolderEntriesRecursively(entry, "")),
        );
        const zipped = await buildZipFromFolderEntries(allEntries.flat());
        applySelectedPmxFile(zipped);
        setMessage(`Dropped PMX folder loaded as ZIP source: ${zipped.name}`);
        return;
      } catch (error) {
        setMessage("Failed to read dropped PMX folder.");
        setErrorDetail(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    setMessage(
      "Dropped input is not supported for PMX preview. Please drop a .pmx/.zip file or folder.",
    );
  }

  return (
    <main className="page">
      <div className="halo" />
      <section className="card">
        <h1 className="app-title">
          VRM to MMD Converter
          <span className="app-subtitle">
            A web-based modernization of vrm2pmx and vroid2pmx mix
          </span>
        </h1>
        <section className="preview-grid" aria-label="Model previews">
          <figure
            className={`preview-panel${isVrmDropActive ? " preview-panel-dropping" : ""}`}
            onDragOver={onVrmDropAreaDragOver}
            onDragLeave={onVrmDropAreaDragLeave}
            onDrop={onVrmDropAreaDrop}
          >
            <figcaption className="preview-caption">
              <span>VRM Preview</span>
              <a
                href="https://vroid.com/studio"
                target="_blank"
                rel="noopener noreferrer"
                className="preview-link"
              >
                VRoid Studio
              </a>
            </figcaption>
            <div
              className={`preview-canvas-wrap${maximizedPreview === "vrm" ? " preview-canvas-wrap-maximized" : ""}`}
              onPointerDown={() => {
                vrmIdleManagerRef.current?.stopRotation();
              }}
            >
              {file && (
                <div className="preview-model-name" title={file.name}>
                  {file.name}
                </div>
              )}
              <canvas
                ref={vrmCanvasRef}
                className="preview-canvas"
                aria-label="VRM preview canvas"
                onDoubleClick={() => {
                  if (!isVrmReady || isPreviewing) {
                    return;
                  }
                  setMaximizedPreview((prev) =>
                    prev === "vrm" ? null : "vrm",
                  );
                }}
              />
              <button
                type="button"
                className="metadata-info-button preview-maximize-button"
                aria-label={
                  maximizedPreview === "vrm"
                    ? "Restore VRM preview size"
                    : "Maximize VRM preview"
                }
                title={maximizedPreview === "vrm" ? "Restore" : "Maximize"}
                onClick={() =>
                  setMaximizedPreview((prev) => (prev === "vrm" ? null : "vrm"))
                }
                disabled={!isVrmReady || isPreviewing}
              >
                <CiMaximize2 />
              </button>
              {isVrmMetadataOpen && (
                <section
                  className="preview-metadata-popup"
                  aria-label="VRM metadata popup"
                >
                  <header className="preview-metadata-popup-header">
                    <strong>VRM Info</strong>
                    <button
                      type="button"
                      className="preview-metadata-close"
                      aria-label="Close VRM metadata popup"
                      onClick={() => setIsVrmMetadataOpen(false)}
                    >
                      x
                    </button>
                  </header>
                  <div className="preview-metadata-popup-body">
                    <div className="preview-info-section-title">Basic</div>
                    {vrmInfoData.summaryRows.length > 0 ? (
                      <div className="preview-info-list">
                        {vrmInfoData.summaryRows.map((row) => (
                          <div
                            key={`basic-${row.label}-${row.value}`}
                            className="preview-info-row"
                          >
                            <span className="preview-info-label">
                              {localizeMetadataLabel(row.label, appLocale)}
                            </span>
                            {row.isLink ? (
                              <a
                                href={row.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="preview-info-link"
                              >
                                {row.value}
                              </a>
                            ) : (
                              <span
                                className={`preview-info-value${localizeAllowDisallow(row.value, appLocale).isNg ? " preview-info-value-negative" : ""}`}
                              >
                                {
                                  localizeAllowDisallow(row.value, appLocale)
                                    .text
                                }
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>Info is not available.</p>
                    )}
                    <div className="preview-info-section-title">License</div>
                    {vrmInfoData.licenseRows.length > 0 ? (
                      <div className="preview-info-list">
                        {vrmInfoData.licenseRows.map((row) => (
                          <div
                            key={`license-${row.label}-${row.value}`}
                            className="preview-info-row"
                          >
                            <span className="preview-info-label">
                              {localizeMetadataLabel(row.label, appLocale)}
                            </span>
                            {row.isLink ? (
                              <a
                                href={row.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="preview-info-link"
                              >
                                {row.value}
                              </a>
                            ) : (
                              <span
                                className={`preview-info-value${localizeAllowDisallow(row.value, appLocale).isNg ? " preview-info-value-negative" : ""}`}
                              >
                                {
                                  localizeAllowDisallow(row.value, appLocale)
                                    .text
                                }
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>License info is not available.</p>
                    )}
                  </div>
                </section>
              )}
              {!isVrmReady && !isPreviewing && (
                <div className="vrm-drop-placeholder" aria-hidden="true">
                  <div>Drop VRM file here</div>
                </div>
              )}
              <button
                type="button"
                className={`metadata-info-button preview-bones-button${vrmBonesVisible ? " preview-bones-button-active" : ""}`}
                aria-label="Toggle VRM bones"
                title={vrmBonesVisible ? "Hide Bones" : "Show Bones"}
                onClick={() => setVrmBonesVisible((prev) => !prev)}
                disabled={!hasVrmSkeleton}
              >
                <FaSkullCrossbones />
              </button>
              <button
                type="button"
                className={`metadata-info-button${isVrmRedistributionOrModificationNG ? " metadata-info-button-alert" : ""}`}
                aria-label="Show VRM metadata"
                onClick={() => onOpenMetadata("vrm")}
                disabled={!canOpenVrmMetadata}
              >
                <FaCircleInfo />
              </button>
            </div>
          </figure>
          <figure
            className={`preview-panel${isPmxDropActive ? " preview-panel-dropping" : ""}`}
            onDragOver={onPmxDropAreaDragOver}
            onDragLeave={onPmxDropAreaDragLeave}
            onDrop={onPmxDropAreaDrop}
          >
            <figcaption className="preview-caption">
              <span>PMX Preview</span>
              <a
                href="https://sites.google.com/view/vpvp/"
                target="_blank"
                rel="noopener noreferrer"
                className="preview-link"
              >
                MikuMikuDance
              </a>
            </figcaption>
            <div
              className={`preview-canvas-wrap${maximizedPreview === "pmx" ? " preview-canvas-wrap-maximized" : ""}`}
              onPointerDown={() => {
                pmxIdleManagerRef.current?.stopRotation();
              }}
            >
              {pmxPreviewFileName && (
                <div className="preview-model-name" title={pmxPreviewFileName}>
                  {pmxPreviewFileName}
                </div>
              )}
              <canvas
                ref={pmxCanvasRef}
                className="preview-canvas"
                aria-label="PMX preview canvas"
                onDoubleClick={() => {
                  if (!canOpenPmxMetadata) {
                    return;
                  }
                  setMaximizedPreview((prev) =>
                    prev === "pmx" ? null : "pmx",
                  );
                }}
              />
              <button
                type="button"
                className="metadata-info-button preview-maximize-button"
                aria-label={
                  maximizedPreview === "pmx"
                    ? "Restore PMX preview size"
                    : "Maximize PMX preview"
                }
                title={maximizedPreview === "pmx" ? "Restore" : "Maximize"}
                onClick={() =>
                  setMaximizedPreview((prev) => (prev === "pmx" ? null : "pmx"))
                }
                disabled={!canOpenPmxMetadata}
              >
                <CiMaximize2 />
              </button>
              {isPmxMetadataOpen && (
                <section
                  className="preview-metadata-popup"
                  aria-label="PMX metadata popup"
                >
                  <header className="preview-metadata-popup-header">
                    <strong>PMX Info</strong>
                    <button
                      type="button"
                      className="preview-metadata-close"
                      aria-label="Close PMX metadata popup"
                      onClick={() => setIsPmxMetadataOpen(false)}
                    >
                      x
                    </button>
                  </header>
                  <div className="preview-metadata-popup-body">
                    <div className="preview-info-section-title">Basic</div>
                    {pmxSummaryRowsForDisplay.length > 0 ? (
                      <div className="preview-info-list">
                        {pmxSummaryRowsForDisplay.map((row) => (
                          <div
                            key={`pmx-basic-${row.label}-${row.value}`}
                            className="preview-info-row"
                          >
                            <span className="preview-info-label">
                              {localizeMetadataLabel(row.label, appLocale)}
                            </span>
                            {row.isLink ? (
                              <a
                                href={row.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="preview-info-link"
                              >
                                {row.value}
                              </a>
                            ) : (
                              <span
                                className={`preview-info-value${localizeAllowDisallow(row.value, appLocale).isNg ? " preview-info-value-negative" : ""}`}
                              >
                                {
                                  localizeAllowDisallow(row.value, appLocale)
                                    .text
                                }
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>Info is not available.</p>
                    )}
                    <div className="preview-info-section-title">License</div>
                    {pmxLicenseRowsForDisplay.length > 0 ? (
                      <div className="preview-info-list">
                        {pmxLicenseRowsForDisplay.map((row) => (
                          <div
                            key={`pmx-license-${row.label}-${row.value}`}
                            className="preview-info-row"
                          >
                            <span className="preview-info-label">
                              {localizeMetadataLabel(row.label, appLocale)}
                            </span>
                            {row.isLink ? (
                              <a
                                href={row.value}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="preview-info-link"
                              >
                                {row.value}
                              </a>
                            ) : (
                              <span
                                className={`preview-info-value${localizeAllowDisallow(row.value, appLocale).isNg ? " preview-info-value-negative" : ""}`}
                              >
                                {
                                  localizeAllowDisallow(row.value, appLocale)
                                    .text
                                }
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p>License info is not available.</p>
                    )}
                  </div>
                </section>
              )}
              <button
                type="button"
                className={`metadata-info-button preview-bones-button${pmxBonesVisible ? " preview-bones-button-active" : ""}`}
                aria-label="Toggle PMX bones"
                title={pmxBonesVisible ? "Hide Bones" : "Show Bones"}
                onClick={() => setPmxBonesVisible((prev) => !prev)}
                disabled={!hasPmxSkeleton}
              >
                <FaSkullCrossbones />
              </button>
              <button
                type="button"
                className="metadata-info-button"
                aria-label="Show PMX metadata"
                onClick={() => onOpenMetadata("pmx")}
                disabled={!canOpenPmxMetadata}
              >
                <FaCircleInfo />
              </button>
              {!canOpenPmxMetadata && !isPmxPreviewing && (
                <div className="vrm-drop-placeholder" aria-hidden="true">
                  <div>Drop PMX/ZIP here</div>
                </div>
              )}
            </div>
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

          <div
            className="pose-and-pmx-tools-row"
            aria-label="Pose and PMX options"
          >
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
                  onChange={(event) =>
                    setTaPoseAngle(Number(event.target.value))
                  }
                  disabled={
                    !file ||
                    !isConvertSupportedInput ||
                    isPreviewing ||
                    !isVrmReady ||
                    status === "done" ||
                    status === "uploading"
                  }
                />
              </div>
            </div>
            <div className="pmx-tools">
              <div className="pmx-tools-main">
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
                    onChange={(event) =>
                      setOrbitSyncEnabled(event.target.checked)
                    }
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
                {/* Rust mode toggle — hidden until Rust converter is production-ready
                <label className="pmx-tool-checkbox">
                  <input
                    type="checkbox"
                    name="rust-mode"
                    checked={rustEnabled}
                    onChange={(event) => setRustEnabled(event.target.checked)}
                    disabled={status === "uploading"}
                  />
                  <span>Rust</span>
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

              <div className="pmx-tools-secondary">
                {/* Ver 1.6.0 release */}
                <label
                  className="pmx-tool-checkbox"
                  title={!turboLabsEnabled ? i18n.turboLabsEnableInSettingTooltip : undefined}
                >
                  <input
                    type="checkbox"
                    name="nim-mode"
                    checked={nimEnabled}
                    onChange={(event) => setNimEnabled(event.target.checked)}
                    disabled={status === "uploading" || !turboLabsEnabled}
                    title={!turboLabsEnabled ? i18n.turboLabsEnableInSettingTooltip : undefined}
                  />
                  <span>{i18n.turboLabsLabel}</span>
                </label>
              </div>
            </div>
          </div>

          <div className="file-label-row">
            <label htmlFor="vrm-input" className="input-label file-input-label">
              Choose VRM file
            </label>
            {status === "done" && convertedOutput && (
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
              accept=".vrm,.glb,.gltf,.zip"
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

          {file && detectedProfileResult && (
            <section
              className="profile-detection-card"
              aria-label="Auto detection result"
            >
              <div className="profile-detection-header">
                <span
                  className={`profile-badge profile-${detectedProfileResult.profile}`}
                >
                  Auto: {getProfileLabel(detectedProfileResult.profile)}
                </span>
                <span className="profile-detection-reason">
                  {detectedProfileResult.reason}
                </span>
              </div>
              <div className="profile-detection-meta">
                {getProfileFlags(detectedProfileResult).length > 0 && (
                  <span>
                    {getProfileFlags(detectedProfileResult).join(" / ")}
                  </span>
                )}
                {detectedProfileResult.generator && (
                  <span>Generator: {detectedProfileResult.generator}</span>
                )}
              </div>
            </section>
          )}

          <div className="convert-actions">
            <button
              type="submit"
              className={`convert-button${status === "uploading" ? ` is-uploading progress-${convertProgressStage ?? "init"}` : ""}`}
              disabled={!canConvert}
            >
              {status === "uploading"
                ? `Converting... ${Math.round(convertProgressPercent)}%`
                : "Convert"}
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
                {copyStatus === "done" && (
                  <span className="copy-status">Copied</span>
                )}
                {copyStatus === "failed" && (
                  <span className="copy-status">Failed</span>
                )}
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
            <button
              type="button"
              className="app-version app-version-link"
              title="Open version history"
              onClick={() => {
                setAboutDefaultTab("history");
                setIsAboutOpen(true);
              }}
            ></button>
            <p className="app-launch-state">{launchStateLabel}</p>
            <button
              type="button"
              className={`footer-heart-button${isHeartSentVisual ? " is-locked" : ""}`}
              aria-label={i18n.heartButtonAriaLabel}
              title={i18n.heartButtonAriaLabel}
              onClick={onHeartButtonClick}
            >
              ❤
            </button>
            <div className="footer-social-links" aria-label="Social links">
              <a
                className="footer-social-link footer-social-link-x"
                href="https://x.com/nicodan_mmd"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
                title="X"
              >
                <img
                  className="footer-social-icon"
                  src={`${import.meta.env.BASE_URL}assets/social/x-logo-black.png`}
                  alt="X"
                />
              </a>
              <a
                className="footer-social-link footer-social-link-nico"
                href="https://www.nicovideo.jp/watch/sm46100394"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="ニコニコ動画"
                title="ニコニコ動画"
              >
                <img
                  className="footer-social-icon footer-social-icon-nico"
                  src={`${import.meta.env.BASE_URL}assets/social/nico2tv.png`}
                  alt="ニコニコ動画"
                />
              </a>
            </div>
          </div>
          <div className="app-footer-actions">
            <button
              type="button"
              className="footer-settings-button"
              aria-label="Settings"
              title="Settings"
              onClick={() => {
                setAboutDefaultTab("setting");
                setIsAboutOpen(true);
              }}
            >
              <MdOutlineSettings aria-hidden="true" />
            </button>
            {/* <button
              type="button"
              className="footer-action-button"
              onClick={() => {
                setAboutDefaultTab("about");
                setIsAboutOpen(true);
              }}
            >
              About
            </button> */}
          </div>
        </footer>

        <div
          className={`local-counter${isWorldCounterDisplayed ? " is-world" : ""}`}
          aria-label={
            isWorldCounterDisplayed ? "World counter" : "Local counter"
          }
          onClick={onCounterToggle}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onCounterToggle();
            }
          }}
        >
          <span key={counterFlipToken} className="counter-face">
            <span className="counter-label">
              {isWorldCounterDisplayed ? "WORLD" : "LOCAL"}:
            </span>
            <span className="counter-value">
              {isWorldCounterDisplayed ? (
                <CountUp
                  end={worldCounter}
                  duration={1.2}
                  preserveValue
                  useEasing
                  redraw={false}
                  separator=","
                  formattingFn={formatWorldCountUpValue}
                />
              ) : (
                formatCounterValue(localCounter, 6)
              )}
            </span>
          </span>
        </div>
      </section>

      <AboutDialog
        open={isAboutOpen}
        version={APP_VERSION}
        locale={appLocale}
        defaultTab={aboutDefaultTab}
        installControl={<PwaInstallControl i18n={i18n} />}
        worldCounterParticipationEnabled={worldCounterParticipationEnabled}
        onWorldCounterParticipationChange={setWorldCounterParticipationEnabled}
        turboLabsEnabled={turboLabsEnabled}
        onTurboLabsEnabledChange={setTurboLabsEnabled}
        turboLabsSettingLabel={i18n.turboLabsSettingLabel}
        onAllReset={onAllReset}
        onClose={() => setIsAboutOpen(false)}
      />
      <HeartThanksDialog
        open={isHeartDialogOpen}
        i18n={i18n}
        message={heartMessage}
        onMessageChange={setHeartMessage}
        onClose={() => setIsHeartDialogOpen(false)}
        onSubmit={() => {
          void onSubmitHeart();
        }}
        isSubmitting={isHeartSubmitting}
      />
      <Dialog
        open={dialogOpen}
        title={dialogConfig.title}
        message={dialogConfig.message}
        type={dialogConfig.type}
        okLabel={dialogConfig.okLabel}
        cancelLabel={dialogConfig.cancelLabel}
        onOk={dialogConfig.onOk}
        onCancel={dialogConfig.onCancel}
        onClose={closeDialog}
        content={dialogConfig.content}
      />
    </main>
  );
}
