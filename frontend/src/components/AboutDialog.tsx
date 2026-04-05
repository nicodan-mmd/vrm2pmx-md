import { type ReactNode, useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";

type HistoryLocale = "ja" | "en" | "zh";

type AboutDialogProps = {
  open: boolean;
  version: string;
  locale: HistoryLocale;
  defaultTab?: TabId;
  installControl?: ReactNode;
  onAllReset: () => void;
  onClose: () => void;
};

export type TabId = "about" | "history" | "setting";

const HISTORY: Array<{
  version: string;
  date: string;
  items: Record<HistoryLocale, string>[];
}> = [
  {
    version: "v1.5.1",
    date: "2026-03-30",
    items: [
      {
        ja: "ユーザーレポートによる表示崩れ改善",
        en: "UI display issues fixed based on user reports",
        zh: "基于用户反馈改善了显示问题",
      },
      {
        ja: "エラーとなっていた処理を続行可能な場合には継続",
        en: "Processing continues when non-critical errors occur",
        zh: "可继续的处理不再中断",
      },
    ],
  },
  {
    version: "v1.5.0",
    date: "2026-03-26",
    items: [
      {
        ja: "操作無しでモデルをゆっくり回転",
        en: "Model auto-rotates when idle",
        zh: "无操作时模型自动缓慢旋转",
      },
      {
        ja: "英語、中国語対応",
        en: "English and Chinese language support added",
        zh: "新增英语和中文支持",
      },
      {
        ja: "ボーン表示ボタン追加",
        en: "Bone display toggle button added",
        zh: "添加骨骼显示切换按钮",
      },
      {
        ja: "表示崩れ報告機能追加",
        en: "Display quality report feature added",
        zh: "添加显示异常报告功能",
      },
    ],
  },
  {
    version: "v1.4",
    date: "N/A",
    items: [
      {
        ja: "メタデータボタン追加",
        en: "Metadata button added",
        zh: "添加元数据按钮",
      },
      {
        ja: "ライセンス確認とVRMのlicense.txtをZIPに含めるようにした",
        en: "Added license confirmation and included VRM license.txt in ZIP output",
        zh: "增加许可证确认，并将 VRM 的 license.txt 包含到 ZIP 输出中",
      },
    ],
  },
  {
    version: "v1.3",
    date: "N/A",
    items: [
      {
        ja: "VRM1.0対応",
        en: "Added VRM 1.0 support",
        zh: "支持 VRM 1.0",
      },
    ],
  },
  {
    version: "v1.2",
    date: "N/A",
    items: [
      {
        ja: "PWA化(ローカル起動)",
        en: "Added PWA support (local launch)",
        zh: "已实现 PWA（本地启动）",
      },
    ],
  },
  {
    version: "v1.1",
    date: "N/A",
    items: [
      {
        ja: "レポート用にSentry導入",
        en: "Introduced Sentry for reporting",
        zh: "为报告功能引入 Sentry",
      },
      {
        ja: "揺れもの、シェーダー、モーフの変換処理追加",
        en: "Added conversion support for spring bones, shaders, and morphs",
        zh: "新增揺れ物、着色器和形变的转换处理",
      },
    ],
  },
  {
    version: "v1.0",
    date: "N/A",
    items: [
      {
        ja: "vrm2pmx,vroid2pmxの統合",
        en: "Integrated vrm2pmx and vroid2pmx",
        zh: "整合 vrm2pmx 与 vroid2pmx",
      },
      {
        ja: "Web化、UI調整",
        en: "Migrated to web and adjusted UI",
        zh: "Web 化并进行了 UI 调整",
      },
    ],
  },
];

export default function AboutDialog({
  open,
  version,
  locale,
  defaultTab,
  installControl,
  onAllReset,
  onClose,
}: AboutDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>("about");
  const privacyPolicyTitle: Record<HistoryLocale, string> = {
    ja: "Privacy Policy",
    en: "Privacy Policy",
    zh: "隐私政策",
  };
  const privacyPolicyText: Record<HistoryLocale, string> = {
    ja: "Thank You ❤ を送ると、匿名ID付きで記録されます。",
    en: "When you send Thank You ❤, it is recorded with an anonymous ID.",
    zh: "发送 Thank You ❤ 时，会以匿名 ID 进行记录。",
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveTab(defaultTab ?? "about");

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, defaultTab, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="about-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section className="about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <header className="about-modal-header">
          <h2 id="about-title">About</h2>
          <button type="button" className="about-close-button" onClick={onClose} aria-label="Close about dialog">
            Close
          </button>
        </header>
        <div className="about-tabs">
          <button
            type="button"
            className={`about-tab${activeTab === "about" ? " about-tab-active" : ""}`}
            onClick={() => setActiveTab("about")}
          >About</button>
          <button
            type="button"
            className={`about-tab${activeTab === "history" ? " about-tab-active" : ""}`}
            onClick={() => setActiveTab("history")}
          >Version</button>
          <button
            type="button"
            className={`about-tab${activeTab === "setting" ? " about-tab-active" : ""}`}
            onClick={() => setActiveTab("setting")}
          >Setting</button>
        </div>
        {activeTab === "history" ? (
          <div className="about-modal-body about-history-body">
            {HISTORY.map((entry) => (
              <div key={entry.version} className="history-entry">
                <p className="history-version">{entry.version} <span className="history-date">{entry.date}</span></p>
                <ul className="history-list">
                  {entry.items.map((item, i) => (
                    <li key={i}>{item[locale]}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : activeTab === "setting" ? (
          <div className="about-modal-body about-settings-body">
            <p><strong>Setting</strong></p>
            <div className="about-settings-actions">
              {installControl}
              <button
                type="button"
                className="footer-action-button footer-action-button-reset"
                onClick={onAllReset}
              >
                All Reset
              </button>
            </div>
          </div>
        ) : (
        <div className="about-modal-body">
          <p><strong>VRM to MMD Converter</strong></p>
          <p>This tool converts VRM models to PMX format in browser using Wasm/Pyodide runtime.</p>

          <hr className="about-divider" />

          <p>
            <a
              href="https://github.com/nicodan-mmd/vrm2pmx-md"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              <FaGithub className="about-link-icon" />
              vrm2pmx-md
            </a>
          </p>

          <hr className="about-divider" />

          <p><strong>Special thanks:</strong></p>
          <p>
            <a
              href="https://github.com/miu200521358"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              miu200521358
            </a>
          </p>
          <p>
            Forked from{" "}
            <a
              href="https://github.com/miu200521358/vrm2pmx"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
              vrm2pmx
            </a>
          </p>

          <hr className="about-divider" />

          <p><strong>Libraries:</strong>{" "}
            <a href="https://threejs.org/" target="_blank" rel="noopener noreferrer" className="about-link">three.js</a>{" · "}
            <a href="https://github.com/pmndrs/three-stdlib" target="_blank" rel="noopener noreferrer" className="about-link">three-stdlib</a>{" · "}
            <a href="https://github.com/pixiv/three-vrm" target="_blank" rel="noopener noreferrer" className="about-link">@pixiv/three-vrm</a>{" · "}
            <a href="https://pyodide.org/" target="_blank" rel="noopener noreferrer" className="about-link">Pyodide</a>{" · "}
            <a href="https://react.dev/" target="_blank" rel="noopener noreferrer" className="about-link">React</a>{" · "}
            <a href="https://gildas-lormeau.github.io/zip.js/" target="_blank" rel="noopener noreferrer" className="about-link">zip.js</a>{" · "}
            <a href="https://react-icons.github.io/react-icons/" target="_blank" rel="noopener noreferrer" className="about-link">react-icons</a>
          </p>

          <hr className="about-divider" />
          <p><strong>{privacyPolicyTitle[locale]}:</strong></p>
          <p>{privacyPolicyText[locale]}</p>

          <hr className="about-divider" />
          <p>Powered by GitHub Copilot</p>

        </div>
        )}
      </section>
    </div>
  );
}
