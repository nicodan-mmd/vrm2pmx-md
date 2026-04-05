import * as Sentry from "@sentry/react";
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from "@zip.js/zip.js";
import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import { type ChangeEvent, type DragEvent, FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FaCircleInfo } from "react-icons/fa6";
import { FaSkullCrossbones } from "react-icons/fa";
import { IoCopyOutline } from "react-icons/io5";
import { MdOutlineSettings } from "react-icons/md";
import Swal from "sweetalert2";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MMDLoader } from "three-stdlib";
import { useReactPWAInstall } from "react-pwa-install";
import AboutDialog, { type TabId as AboutTabId } from "./components/AboutDialog";
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
import { computePmxLightPreset, applyPmxLightTuning } from "./features/preview/lib/pmxLight";
import {
  detectQualityRiskSignals,
  createConversionReportId,
  reportQualitySignals,
} from "./features/convert/services/qualitySignals";
import {
  detectProfileFromFile,
  type ProfileDetectionResult,
} from "./features/convert/services/profileDetection";
import { useUiSettings, PMX_LIGHT_DEFAULT_INTENSITY_SCALE, PMX_LIGHT_DEFAULT_CONTRAST_FACTOR } from "./features/settings/hooks/useUiSettings";
import { getRuntimeLogLevel, shouldCaptureLog, type ConsoleLogLevel } from "./utils/logging";

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

type AppLocale = "ja" | "en" | "zh";

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
const HEART_SLACK_WEBHOOK_URL = (import.meta.env.VITE_HEART_SLACK_WEBHOOK_URL as string | undefined)?.trim() ?? "";
const HEART_GAS_WEB_APP_URL = (import.meta.env.VITE_HEART_GAS_WEB_APP_URL as string | undefined)?.trim() ?? "";

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
    allResetConfirmMessage: "すべての設定をリセットし、ローカルストレージをクリアしますか？",
    allResetCounterLabel: "変換カウンターもリセットする",
    taPoseZeroConfirm: "T/A Pose が 0 度に設定されています。このまま変換を続けますか？",
    taPoseZeroCanceled: "0 度のポーズ設定により変換をキャンセルしました。",
    installButtonLabel: "Install",
    installUnsupportedHint: "ブラウザの共有メニューから「ホーム画面に追加」を選んでください。",
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
    taPoseZeroConfirm: "T/A Pose Convert is set to 0 degrees. Do you want to continue conversion?",
    taPoseZeroCanceled: "Conversion canceled at 0 degree pose setting.",
    installButtonLabel: "Install",
    installUnsupportedHint: "Use your browser menu and choose \"Add to Home Screen\".",
    installDialogTitle: "Install App",
    installDialogDescription: "Launch quickly from your home screen.",
    restrictedRedistributionModificationConfirm:
      "This model prohibits modification or redistribution. If you proceed with conversion, please do so at your own responsibility.",
    restrictedRedistributionModificationCancel: "Cancel",
    restrictedRedistributionModificationProceed: "Proceed",
    previewShaderErrorTitle: "PMX Preview Error",
    previewShaderErrorMessage:
      "Conversion succeeded, and ZIP download is available, but PMX preview rendering failed.\nSending a report via \"Report quality issue\" helps future improvements.",
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
    qualityReportSubmittedMessage:
      "已发送匿名报告。这有助于未来改善转换质量。",
    qualityReportEnableHint:
      "启用错误报告功能，可匿名报告转换成功但质量有问题的情况。",
    qualityAutoReportConfirm: (signals) =>
      `转换成功，但在日志中检测到可能存在质量问题的信号。\n\n检测信号: ${signals}\n\n是否发送匿名报告？\n发送后，该情况可能在未来版本中得到改善。`,
    allResetConfirmTitle: "重置确认",
    allResetConfirmMessage: "重置所有设置并清除本地存储吗？",
    allResetCounterLabel: "同时重置转换计数器",
    taPoseZeroConfirm: "T/A Pose 已设置为 0 度。确定继续转换吗？",
    taPoseZeroCanceled: "因 0 度姿势设置，已取消转换。",
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
};

function detectAppLocale(language: string | undefined): AppLocale {
  const normalized = (language ?? "").toLowerCase();
  if (normalized.startsWith("ja")) {
    return "ja";
  }
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  return "en";
}

function localizeAllowDisallow(value: string, locale: AppLocale): { text: string; isNg: boolean } {
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

  const valueMap = locale === "zh" ? zhValueMap : jaValueMap;
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
  ];

  return (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : String(args[0] ?? "");
    return noisyPatterns.some((pattern) => first.includes(pattern));
  };
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
  return decoded
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function buildAssetLookupCandidates(path: string): string[] {
  const normalized = normalizeAssetPath(path);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
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
  const parserJson = asRecord((gltf as { parser?: { json?: unknown } })?.parser?.json);
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

    pushInfoRow(summaryRows, "Version", vrm1Meta.version || vrm1.specVersion || asset.version);

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
    pushInfoRow(licenseRows, "Allow Redistribution", vrm1Meta.allowRedistribution);
    pushInfoRow(licenseRows, "Allow Violent Usage", vrm1Meta.allowExcessivelyViolentUsage);
    pushInfoRow(licenseRows, "Allow Sexual Usage", vrm1Meta.allowExcessivelySexualUsage);
    pushInfoRow(licenseRows, "Allow Political/Religious", vrm1Meta.allowPoliticalOrReligiousUsage);
    pushInfoRow(licenseRows, "Allow Antisocial/Hate", vrm1Meta.allowAntisocialOrHateUsage);
    pushInfoRow(licenseRows, "License URL", vrm1Meta.licenseUrl);
    pushInfoRow(licenseRows, "Other License URL", vrm1Meta.otherLicenseUrl);
    pushInfoRow(licenseRows, "Third Party Licenses", vrm1Meta.thirdPartyLicenses);

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
  if (!redistributionFromUrl && licenseNameNormalized.includes("redistribution_prohibited")) {
    pushInfoRow(licenseRows, "Allow Redistribution", "redistribution_prohibited");
  }
  if (!modificationFromUrl && licenseNameNormalized.includes("modification_prohibited")) {
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
    lines.push(locale === "ja" ? "=== 基本情報 ===" : locale === "zh" ? "=== 基本信息 ===" : "=== Basic Information ===");
    infoData.summaryRows.forEach((row) => {
      const localizedLabel = localizeMetadataLabel(row.label, locale);
      lines.push(`${localizedLabel}: ${row.value}`);
    });
    lines.push("");
  }

  if (infoData.licenseRows.length > 0) {
    lines.push(locale === "ja" ? "=== ライセンス情報 ===" : locale === "zh" ? "=== 许可证信息 ===" : "=== License Information ===");
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
    if (current.directory || !current.filename || current.filename === "license.txt" || !current.getData) {
      continue;
    }

    const data = await current.getData(new BlobWriter());
    await writer.add(current.filename, new BlobReader(data), {
      lastModDate: current.lastModDate,
      comment: current.comment,
    });
  }

  await writer.add("license.txt", new BlobReader(new Blob([licenseText], { type: "text/plain" })));
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

async function buildRustPmxZipFromVrm(
  sourceVrmFile: File,
  pmxBlob: Blob,
): Promise<{ zipBlob: Blob; textureCount: number }> {
  const GLB_MAGIC = 0x46546c67;
  const GLB_JSON_CHUNK = 0x4e4f534a;
  const GLB_BIN_CHUNK = 0x004e4942;

  const sourceBuffer = await sourceVrmFile.arrayBuffer();
  const view = new DataView(sourceBuffer);
  if (sourceBuffer.byteLength < 12 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("RUST_PMX_ZIP_FAILED: Input file is not a valid GLB container.");
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
    const jsonText = new TextDecoder().decode(jsonChunkBytes).replace(/\u0000+$/g, "").trimEnd();
    const gltfJson = JSON.parse(jsonText) as {
      images?: Array<{ name?: string; mimeType?: string; bufferView?: number; uri?: string }>;
      bufferViews?: Array<{ byteOffset?: number; byteLength?: number }>;
    };

    const images = Array.isArray(gltfJson.images) ? gltfJson.images : [];
    const bufferViews = Array.isArray(gltfJson.bufferViews) ? gltfJson.bufferViews : [];
    const usedNames = new Set<string>();

    for (let i = 0; i < images.length; i++) {
      const image = images[i] || {};
      let bytes: Uint8Array | null = null;
      let mimeType: string | null = typeof image.mimeType === "string" ? image.mimeType : null;

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
      } else if (typeof image.uri === "string" && image.uri.startsWith("data:")) {
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
        typeof image.name === "string" ? image.name : typeof image.uri === "string" ? image.uri : "",
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
        blob: new Blob([blobBytes.buffer], { type: mimeType || "application/octet-stream" }),
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
  const geometry = mesh.geometry as THREE.BufferGeometry & { userData?: unknown };
  const mmd = asRecord(asRecord(geometry.userData).MMD);
  const metadata = asRecord(mmd.metadata);

  const summaryRows: InfoRow[] = [];
  const licenseRows: InfoRow[] = [];

  pushInfoRow(summaryRows, "Model Name", metadata.modelName || metadata.name || mesh.name);
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

  const commentUrls = [asString(metadata.comment), asString(metadata.englishComment)]
    .flatMap((comment) => extractUrls(comment));
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
      (label.includes("redistribution") || label.includes("allow redistribution")) &&
      (value === "ng" || value === "disallow" || value === "prohibited" || value === "=再配布禁止=" || value.includes("prohibited"))
    ) {
      return true;
    }
    if (
      (label.includes("modification") || label === "改変の許可") &&
      (value === "ng" || value === "disallow" || value === "prohibited" || value === "改変禁止" || value.includes("prohibited"))
    ) {
      return true;
    }
  }
  return false;
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

function hasPendingTextureCallback(texture: THREE.Texture | null | undefined): boolean {
  if (!texture) {
    return false;
  }
  const tex = texture as THREE.Texture & {
    readyCallbacks?: Array<(texture: THREE.Texture) => void>;
  };
  return Array.isArray(tex.readyCallbacks);
}

function getMaterialColorTexture(material: THREE.Material | null | undefined): THREE.Texture | null {
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

async function waitForTextureReady(texture: THREE.Texture, timeoutMs: number): Promise<void> {
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

async function waitForMeshColorTextures(root: THREE.Object3D, timeoutMs: number): Promise<void> {
  const uniqueTextures = new Set<THREE.Texture>();
  for (const material of collectMeshMaterials(root)) {
    const texture = getMaterialColorTexture(material);
    if (texture) {
      uniqueTextures.add(texture);
    }
  }

  await Promise.all([...uniqueTextures].map((texture) => waitForTextureReady(texture, timeoutMs)));
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
      <section className="heart-modal" role="dialog" aria-modal="true" aria-labelledby="heart-title">
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
          <p className="heart-remaining">{i18n.heartDialogRemaining(remaining)}</p>
        </div>
        <footer className="heart-modal-actions">
          <button type="button" className="footer-action-button" onClick={onClose} disabled={isSubmitting}>
            {i18n.heartDialogCancel}
          </button>
          <button type="button" className="footer-action-button heart-submit-button" onClick={onSubmit} disabled={isSubmitting}>
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

function formatLocalCounter(count: number): string {
  const s = count.toString();
  const padded = s.padStart(6, "0");
  const chunks: string[] = [];
  let remaining = padded;
  while (remaining.length > 3) {
    chunks.unshift(remaining.slice(-3));
    remaining = remaining.slice(0, -3);
  }
  chunks.unshift(remaining);
  return `LOCAL: ${chunks.join(",")}`;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const {
    mode, setMode,
    taPoseAngle, setTaPoseAngle,
    orbitSyncEnabled, setOrbitSyncEnabled, orbitSyncEnabledRef,
    logEnabled, setLogEnabled, logEnabledRef,
    rustEnabled, setRustEnabled,
    gridEnabled, setGridEnabled, gridEnabledRef,
    pmxBrightnessScale, setPmxBrightnessScale,
    pmxContrastFactor, setPmxContrastFactor,
    isUiSettingsHydrated,
    resetToDefaults,
  } = useUiSettings();
  const vrmGridRef = useRef<THREE.GridHelper | null>(null);
  const pmxGridRef = useRef<THREE.GridHelper | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logLinesRef = useRef<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "done" | "failed">("idle");
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
      return raw ? (parseInt(raw, 10) || 0) : 0;
    } catch {
      return 0;
    }
  });
  const resetCounterCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [isVrmMetadataOpen, setIsVrmMetadataOpen] = useState(false);
  const [isPmxMetadataOpen, setIsPmxMetadataOpen] = useState(false);
  const [pmxBonesVisible, setPmxBonesVisible] = useState(false);
  const [hasPmxSkeleton, setHasPmxSkeleton] = useState(false);
  const [vrmInfoData, setVrmInfoData] = useState<VrmInfoData>({ summaryRows: [], licenseRows: [] });
  const [pmxInfoData, setPmxInfoData] = useState<PmxInfoData>({ summaryRows: [], licenseRows: [] });
  const [isVrmRedistributionOrModificationNG, setIsVrmRedistributionOrModificationNG] = useState(false);
  const logAreaRef = useRef<HTMLDivElement | null>(null);
  const [isVrmReady, setIsVrmReady] = useState(false);
  const [message, setMessage] = useState("VRM file is not selected yet.");
  const [errorDetail, setErrorDetail] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isVrmDropActive, setIsVrmDropActive] = useState(false);
  const [convertProgressPercent, setConvertProgressPercent] = useState(0);
  const [convertProgressStage, setConvertProgressStage] = useState<WorkerProgressStage | "done" | null>(null);
  const [convertedOutput, setConvertedOutput] = useState<ConvertedOutput | null>(null);
  const [detectedProfileResult, setDetectedProfileResult] = useState<ProfileDetectionResult | null>(null);
  const [detectedQualityRiskSignals, setDetectedQualityRiskSignals] = useState<string[]>([]);
  const runtimeQualitySignalsRef = useRef<Set<string>>(new Set());
  const profileDetectionRequestIdRef = useRef(0);
  const [lastRequestedMode, setLastRequestedMode] = useState<ConvertMode | null>(null);
  const [lastUsedMode, setLastUsedMode] = useState<ConvertMode | null>(null);
  const [lastFallbackReason, setLastFallbackReason] = useState<string | null>(null);
  const [lastConversionReportId, setLastConversionReportId] = useState<string | null>(null);
  const pmxPreviewDiagnosticsRef = useRef<PmxPreviewDiagnostics | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const vrmInputRef = useRef<HTMLInputElement | null>(null);
  const vrmCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pmxCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const vrmIdleManagerRef = useRef<ReturnType<typeof createIdleRotationManager> | null>(null);
  const pmxIdleManagerRef = useRef<ReturnType<typeof createIdleRotationManager> | null>(null);
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
    vrmState: { isRotating: false, rotationDirection: 1, inactivityTimeoutId: null },
    pmxState: { isRotating: false, rotationDirection: 1, inactivityTimeoutId: null },
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
    () => detectAppLocale(typeof navigator !== "undefined" ? navigator.language : "en"),
    [],
  );
  const i18n = APP_I18N[appLocale];
  const isHeartLocked = heartLockUntil !== null && heartLockUntil - 5000 > Date.now();

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
      window.localStorage.setItem(LAST_LAUNCH_DATE_KEY, new Date().toISOString());
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
        const existing = window.localStorage.getItem(HEART_FEEDBACK_USER_ID_KEY)?.trim();
        if (existing) {
          return existing;
        }
        const nextId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `fallback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        window.localStorage.setItem(HEART_FEEDBACK_USER_ID_KEY, nextId);
        return nextId;
      } catch {
        return `ephemeral-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      }
    })();

    const lines = ["❤ A user sent a heart from VRM to MMD Converter.", `feedbackUserId: ${feedbackUserId}`];
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

    const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      iosStandalone ||
      document.referrer.startsWith("android-app://");

    return isStandalone ? "Local" : "Web";
  }, [isInstalledState]);

  const canConvert = useMemo(
    () => !!file && status !== "uploading" && !isPreviewing && isVrmReady,
    [file, isPreviewing, isVrmReady, status],
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
    () => !!convertedOutput && status !== "uploading",
    [convertedOutput, status],
  );
  const pmxSummaryRowsForDisplay = useMemo(
    () => (pmxInfoData.summaryRows.length > 0 ? pmxInfoData.summaryRows : vrmInfoData.summaryRows),
    [pmxInfoData.summaryRows, vrmInfoData.summaryRows],
  );
  const pmxLicenseRowsForDisplay = useMemo(
    () => (pmxInfoData.licenseRows.length > 0 ? pmxInfoData.licenseRows : vrmInfoData.licenseRows),
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

  function appendConsoleLine(args: unknown[], level: ConsoleLogLevel = "info") {
    if (!shouldCaptureLog(level, APP_LOG_LEVEL)) {
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
    appendConsoleLine(log.args, log.level);
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
    for (const helper of pmxSkeletonHelpersRef.current) {
      helper.visible = pmxBonesVisible;
    }
  }, [pmxBonesVisible]);


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
        const shouldResetCounter = resetCounterCheckboxRef.current?.checked ?? false;
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
        const rotationSpeed = 0.01875 * (state.rotationDirection === 1 ? 1 : -1);
        const angle = THREE.MathUtils.degToRad(rotationSpeed * deltaTime);
        const targetToCamera = view.camera.position.clone().sub(view.controls.target);
        targetToCamera.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        view.camera.position.copy(view.controls.target).add(targetToCamera);
      },
    };
  }

  async function previewPmxFromZip(zipBlob: Blob, syncOrbitFromVrm = false): Promise<void> {
    if (!pmxCanvasRef.current) {
      return;
    }

    cleanupPmxPreview();
    setPmxInfoData({ summaryRows: [], licenseRows: [] });

    const canvas = pmxCanvasRef.current;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
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

        const toStandard = (material: THREE.Material | null | undefined): THREE.Material | null => {
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
            color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
            map: source.map ?? null,
            emissive: source.emissive ? source.emissive.clone() : new THREE.Color(0x000000),
            emissiveMap: source.emissiveMap ?? null,
            alphaMap: source.alphaMap ?? null,
            transparent: source.transparent ?? false,
            opacity: typeof source.opacity === "number" ? source.opacity : 1,
            side: source.side ?? THREE.FrontSide,
            alphaTest: typeof source.alphaTest === "number" ? source.alphaTest : 0,
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
            maybeMesh.material = nextMaterials.filter((mat): mat is THREE.Material => mat !== null);
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
      appendConsoleLine([
        `[WARN] PMX preview fallback material enabled (${reason}), replaced materials: ${replacedMaterialCount}`,
      ], "warn");
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

    let pmxIdleManager: ReturnType<typeof createIdleRotationManager> | null = null;
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
          appendConsoleLine(["[ERROR] PMX preview shader compile failed."], "error");
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
          const current = entry as unknown as { filename?: string; directory?: boolean };
          if (current.directory || !current.filename) {
            return null;
          }
          return normalizeAssetPath(current.filename);
        })
        .filter((name): name is string => Boolean(name));
      const textureEntryNames = entryFileNames.filter((name) => /\.(png|jpe?g|bmp|tga|dds|webp)$/i.test(name));
      const pmxEntryCandidates = entryFileNames.filter((name) => /\.pmx$/i.test(name));
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
          if (m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.needsUpdate = true;
          }
          if (m.emissiveMap) {
            m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            m.emissiveMap.needsUpdate = true;
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
          };
          const materialLabel = `${maybeMesh.name || ""} ${m.name || ""}`.toLowerCase();
          const mapTransparent = Boolean(m.map && m.map.transparent);
          const likelySkinMaterial = /(skin|body|face|head|hair|肌|素体|顔|頭|髪)/.test(materialLabel);
          if (!mapTransparent || likelySkinMaterial) {
            continue;
          }

          // Prefer cutout-style rendering for alpha-textured cloth layers.
          // This avoids transparent-sort artifacts where a large skirt plane
          // gets rendered in front of apron/chest details.
          m.transparent = false;
          m.alphaTest = Math.max(m.alphaTest ?? 0, 0.06);
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
        directionalIntensity: Number(tunedLight.directionalIntensity.toFixed(3)),
      });

      scene.add(mesh);

      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      const materialNames: string[] = [];
      const materialRenderDiagnostics: PmxPreviewDiagnostics["materialRenderDiagnostics"] = [];
      let materialSlotCount = 0;
      let colorTextureCount = 0;
      let loadedColorTextureCount = 0;
      let pendingColorTextureCount = 0;
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
                withRenderProps.map
                && (withRenderProps.map as THREE.Texture & { transparent?: boolean }).transparent,
              ),
              hasAlphaMap: Boolean(withRenderProps.alphaMap),
            });
          }
        }
      });

      const textureCoverage = materialSlotCount > 0
        ? colorTextureCount / materialSlotCount
        : 0;
      const loadedTextureCoverage = materialSlotCount > 0
        ? loadedColorTextureCount / materialSlotCount
        : 0;

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
      const materialRenderSamples = materialRenderDiagnostics.slice(0, 32).map((item) =>
        `${item.name} | mesh=${item.meshName} | side=${item.side} | tr=${item.transparent ? 1 : 0} | aT=${item.alphaTest} | dW=${item.depthWrite ? 1 : 0} | dT=${item.depthTest ? 1 : 0} | op=${item.opacity} | map=${item.hasMap ? 1 : 0} | mapTr=${item.mapTransparent ? 1 : 0} | aMap=${item.hasAlphaMap ? 1 : 0}`,
      );
      if (
        materialSlotCount >= 6
        && colorTextureCount === 0
        && loadedColorTextureCount === 0
        && pendingColorTextureCount === 0
      ) {
        runtimeQualitySignalsRef.current.add("pmx-missing-color-textures");
      }

      for (const skinned of skinnedMeshes) {
        if (!skinned.skeleton || skinned.skeleton.bones.length <= 0) {
          continue;
        }
        const helper = new THREE.SkeletonHelper(skinned);
        helper.visible = pmxBonesVisible;
        helper.setColors(new THREE.Color("#63f5ff"), new THREE.Color("#ff9f4a"));
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
      pmxIdleManager = createIdleRotationManager(pmxViewRef, "pmxState");
      pmxIdleManagerRef.current = pmxIdleManager;
      controls.addEventListener("change", onPmxOrbitChanged);
      controls.addEventListener("start", () => pmxIdleManager!.stopRotation());
      controls.addEventListener("end", () => pmxIdleManager!.resetInactivityTimer());
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
          appendConsoleLine(["[ERROR] PMX preview render failed:", formatLogArg(error)], "error");
          const recovered = applyPmxPreviewMaterialFallback("render-error");
          if (!recovered) {
            window.cancelAnimationFrame(frameId);
            showPreviewShaderErrorDialog();
          }
        }
      };
      renderLoop();
    } catch (error) {
      disposePreview();
      pmxPreviewCleanupRef.current = null;
      pmxIdleManager?.stopRotation();
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
        setMessage("Conversion cancelled due to redistribution/modification restrictions.");
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
    setMessage(
      requestedMode === "rust"
        ? "Rust experimental mode requested. This build will fall back to Wasm while the Rust converter is under development."
        : mode === "backend"
          ? "Converting with backend... this can take a while for large files."
          : backendEnabled
            ? "Trying Wasm first. If it fails, backend fallback will run."
            : "Converting with Wasm mode...",
    );
    appendConsoleLine([`[INFO] Convert requested: preparing input (${file.name})`], "info");
    appendConsoleLine([`[INFO] Requested convert mode: ${requestedMode}`], "info");

    try {
      const convertLogStartIndex = logLinesRef.current.length;
      const convertInput = await buildConvertInputFile(file);
      poseDebug("convert start", {
        requestedMode,
        fileName: file.name,
        convertInputBytes: convertInput.size,
      });
      const result = await convertWithMode(convertInput, requestedMode, {
        onProgress: (progress) => {
          setMessage(progress.message);
          const nextPercent = getStageProgressPercent(progress.stage);
          setConvertProgressStage(progress.stage);
          setConvertProgressPercent((prev) => Math.max(prev, nextPercent));
        },
        onLog: appendWorkerLog,
        signal: abortControllerRef.current.signal,
      });

      let outputBlob = result.blob;
      let outputExtension: ConvertedOutput["fileExtension"] = result.fileExtension;
      const licenseText = generateLicenseText(vrmInfoData, appLocale);
      if (result.fileExtension === "zip") {
        outputBlob = await addLicenseToZip(result.blob, licenseText);
      } else if (result.fileExtension === "pmx") {
        const wrapped = await buildRustPmxZipFromVrm(file, result.blob);
        outputBlob = await addLicenseToZip(wrapped.zipBlob, licenseText);
        outputExtension = "zip";
        appendConsoleLine(
          [
            `[INFO] Rust PMX packaged as ZIP with ${wrapped.textureCount} texture file(s) from source VRM.`,
          ],
          "info",
        );
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
        appendConsoleLine(
          result.fallbackReason
            ? [`[WARN] Rust experimental mode did not run yet. Using ${result.usedMode}. ${result.fallbackReason}`]
            : [`[INFO] Rust experimental mode completed via ${result.usedMode}.`],
          result.fallbackReason ? "warn" : "info",
        );
      }

      if (outputExtension === "zip") {
        await previewPmxFromZip(outputBlob, orbitSyncEnabled);
      } else {
        throw new Error("Current preview supports ZIP output with PMX resources.");
      }

      setConvertProgressPercent(100);
      setConvertProgressStage("done");
      setStatus("done");
      setLocalCounter((prev) => {
        const next = prev + 1;
        try {
          window.localStorage.setItem(LOCAL_COUNTER_KEY, String(next));
        } catch { /* ignore */ }
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
        const rawDetail = error instanceof Error ? error.message : String(error);
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
        appendConsoleLine(["[ERROR] Convert failed:"], "error");
        rawDetail.split("\n").forEach((line) => appendConsoleLine([line], "error"));
        showDialog({
          title: "Error",
          message: "Convert error. Please see Log View.",
          type: "error",
        });
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  async function onConvert() {
    if (!file) {
      return;
    }
    const requestedMode: ConvertMode = rustEnabled ? "rust" : mode;

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
      if (shouldCaptureLog("log", APP_LOG_LEVEL)) {
        originalLog(...args);
      }
      appendConsoleLine(args, "log");
    };
    console.info = (...args: unknown[]) => {
      if (shouldCaptureLog("info", APP_LOG_LEVEL)) {
        originalInfo(...args);
      }
      appendConsoleLine(args, "info");
    };
    console.warn = (...args: unknown[]) => {
      if (shouldCaptureLog("warn", APP_LOG_LEVEL)) {
        originalWarn(...args);
      }
      appendConsoleLine(args, "warn");
    };
    console.error = (...args: unknown[]) => {
      if (shouldCaptureLog("error", APP_LOG_LEVEL)) {
        originalError(...args);
      }
      appendConsoleLine(args, "error");
    };
    console.debug = (...args: unknown[]) => {
      if (shouldCaptureLog("debug", APP_LOG_LEVEL)) {
        originalDebug(...args);
      }
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

      if (target.closest(".preview-metadata-popup") || target.closest(".metadata-info-button")) {
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

    const profileForPreview = (await detectProfileFromFile(targetFile)) ?? detectedProfileResult;
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
      const infoData = extractVrmInfoData(gltf);
      setVrmInfoData(infoData);
      setIsVrmRedistributionOrModificationNG(isRedistributionOrModificationNG(infoData));
      vrm = (gltf.userData.vrm as VRM | undefined) ?? null;

      if (!vrm) {
        throw new Error("Selected file does not contain VRM data.");
      }

      scene.add(vrm.scene);
      vrm.scene.rotation.y = previewRootYaw;

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
        armPoseSign,
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
      const vrmIdleManager = createIdleRotationManager(vrmViewRef, "vrmState");
      vrmIdleManagerRef.current = vrmIdleManager;
      controls.addEventListener("change", onVrmOrbitChanged);
      controls.addEventListener("start", () => vrmIdleManager.stopRotation());
      controls.addEventListener("end", () => vrmIdleManager.resetInactivityTimer());
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
        <h1 className="app-title">
          VRM to MMD Converter
          <span className="app-subtitle">A web-based modernization of vrm2pmx and vroid2pmx mix</span>
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
              <a href="https://vroid.com/studio" target="_blank" rel="noopener noreferrer" className="preview-link">
                VRoid Studio
              </a>
            </figcaption>
            <div className="preview-canvas-wrap" onPointerDown={() => {
              vrmIdleManagerRef.current?.stopRotation();
            }}>
              <canvas
                ref={vrmCanvasRef}
                className="preview-canvas"
                aria-label="VRM preview canvas"
              />
              {isVrmMetadataOpen && (
                <section className="preview-metadata-popup" aria-label="VRM metadata popup">
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
                          <div key={`basic-${row.label}-${row.value}`} className="preview-info-row">
                            <span className="preview-info-label">{localizeMetadataLabel(row.label, appLocale)}</span>
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
                                {localizeAllowDisallow(row.value, appLocale).text}
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
                          <div key={`license-${row.label}-${row.value}`} className="preview-info-row">
                            <span className="preview-info-label">{localizeMetadataLabel(row.label, appLocale)}</span>
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
                                {localizeAllowDisallow(row.value, appLocale).text}
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
                className={`metadata-info-button${isVrmRedistributionOrModificationNG ? " metadata-info-button-alert" : ""}`}
                aria-label="Show VRM metadata"
                onClick={() => onOpenMetadata("vrm")}
                disabled={!canOpenVrmMetadata}
              >
                <FaCircleInfo />
              </button>
            </div>
          </figure>
          <figure className="preview-panel">
            <figcaption className="preview-caption">
              <span>PMX Preview</span>
              <a href="https://sites.google.com/view/vpvp/" target="_blank" rel="noopener noreferrer" className="preview-link">
                MikuMikuDance
              </a>
            </figcaption>
            <div className="preview-canvas-wrap" onPointerDown={() => {
              pmxIdleManagerRef.current?.stopRotation();
            }}>
              <canvas
                ref={pmxCanvasRef}
                className="preview-canvas"
                aria-label="PMX preview canvas"
              />
              {isPmxMetadataOpen && (
                <section className="preview-metadata-popup" aria-label="PMX metadata popup">
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
                          <div key={`pmx-basic-${row.label}-${row.value}`} className="preview-info-row">
                            <span className="preview-info-label">{localizeMetadataLabel(row.label, appLocale)}</span>
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
                                {localizeAllowDisallow(row.value, appLocale).text}
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
                          <div key={`pmx-license-${row.label}-${row.value}`} className="preview-info-row">
                            <span className="preview-info-label">{localizeMetadataLabel(row.label, appLocale)}</span>
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
                                {localizeAllowDisallow(row.value, appLocale).text}
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
                className={`metadata-info-button pmx-bones-button${pmxBonesVisible ? " pmx-bones-button-active" : ""}`}
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

          {file && detectedProfileResult && (
            <section className="profile-detection-card" aria-label="Auto detection result">
              <div className="profile-detection-header">
                <span className={`profile-badge profile-${detectedProfileResult.profile}`}>
                  Auto: {getProfileLabel(detectedProfileResult.profile)}
                </span>
                <span className="profile-detection-reason">{detectedProfileResult.reason}</span>
              </div>
              <div className="profile-detection-meta">
                {getProfileFlags(detectedProfileResult).length > 0 && (
                  <span>{getProfileFlags(detectedProfileResult).join(" / ")}</span>
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
            <button
              type="button"
              className="app-version app-version-link"
              title="Open version history"
              onClick={() => {
                setAboutDefaultTab("history");
                setIsAboutOpen(true);
              }}
            >
              Version {APP_VERSION}
            </button>
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

        <div className="local-counter" aria-label="Local counter">{formatLocalCounter(localCounter)}</div>
      </section>

      <AboutDialog
        open={isAboutOpen}
        version={APP_VERSION}
        locale={appLocale}
        defaultTab={aboutDefaultTab}
        installControl={<PwaInstallControl i18n={i18n} />}
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
