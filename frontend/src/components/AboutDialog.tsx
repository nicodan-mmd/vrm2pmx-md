import { type ReactNode, useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";

type HistoryLocale =
  | "ja"
  | "en"
  | "zh"
  | "zh-TW"
  | "ko"
  | "id"
  | "es"
  | "pt-BR";

type AboutDialogProps = {
  open: boolean;
  version: string;
  locale: HistoryLocale;
  userLocaleSetting?: string;
  onUserLocaleSettingChange?: (setting: string) => void;
  languageSettingLabel?: string;
  languageAutoLabel?: string;
  worldCounterSettingLabel?: string;
  defaultTab?: TabId;
  installControl?: ReactNode;
  worldCounterParticipationEnabled: boolean;
  onWorldCounterParticipationChange: (enabled: boolean) => void;
  turboLabsEnabled: boolean;
  onTurboLabsEnabledChange: (enabled: boolean) => void;
  turboLabsSettingLabel: string;
  onAllReset: () => void;
  onClose: () => void;
};

export type TabId = "about" | "history" | "setting";

const HISTORY: Array<{
  version: string;
  date: string;
  items: Partial<Record<HistoryLocale, string>>[];
}> = [
  {
    version: "v1.6.4",
    date: "2026/08/02",
    items: [
      {
        ja: "ニコダンリンク追加",
        en: "Added NicoDan Chrome extension link",
        zh: "新增 NicoDan 链接",
        "zh-TW": "新增 NicoDan 連結",
        ko: "NicoDan 링크 추가",
        id: "Penambahan tautan NicoDan",
        es: "Añadido enlace a NicoDan",
        "pt-BR": "Adicionado link para o NicoDan",
      },
    ],
  },
  {
    version: "v1.6.3",
    date: "2026/07/21",
    items: [
      {
        ja: "多言語対応の強化・言語設定UIの追加",
        en: "Enhanced multilingual support & added language setting UI",
        zh: "增强多语言支持并新增语言设置界面",
        "zh-TW": "增強多語言支援並新增語言設定介面",
        ko: "다국어 지원 강화 및 언어 설정 UI 추가",
        id: "Peningkatan dukungan multibahasa & penambahan UI pengaturan bahasa",
        es: "Soporte multilingüe mejorado y menú de configuración de idioma añadido",
        "pt-BR": "Suporte multilíngue aprimorado e adicionada interface de configuração de idioma",
      },
    ],
  },
  {
    version: "v1.6.2",
    date: "2026/07/16",
    items: [
      {
        ja: "開発サポートリンク",
        en: "Development support links",
        zh: "开发支持链接",
        "zh-TW": "開發支持連結", // 「連結」に変更してより台湾・香港向けに自然に
        ko: "개발 지원 링크",
        id: "Tautan dukungan pengembangan",
        es: "Enlaces de apoyo al desarrollo",
        "pt-BR": "Links de apoio ao desenvolvimento",
      },
      {
        ja: "多言語対応追加（繁体字中国語・インドネシア語・スペイン語・ポルトガル語）",
        en: "Added multilingual support (Traditional Chinese · Indonesian · Spanish · Portuguese)",
        zh: "新增多语言支持（繁体中文·印尼语·西班牙语·葡萄牙语）",
        "zh-TW": "新增多語言支援（繁體中文·印尼語·西班牙語·葡萄牙語）",
        ko: "다국어 지원 추가(번체 중국어·인도네시아어·스페인어·포르투갈어)",
        id: "Dukungan multibahasa ditambahkan (Tionghoa Tradisional · Indonesia · Spanyol · Portugis)",
        es: "Soporte multilingüe añadido (chino tradicional · indonesio · español · portugués)", // より簡潔に
        "pt-BR":
          "Suporte multilíngue adicionado (chinês tradicional · indonésio · espanhol · português)",
      },
    ],
  },
  {
    version: "v1.6.1",
    date: "2026/05/27",
    items: [
      {
        ja: "セキュリティ(サプライチェーン)リスクチェック",
        en: "Security (supply chain) risk check",
        zh: "安全（供应链）风险检查",
        ko: "보안(공급망) 리스크 체크",
      },
    ],
  },
  {
    version: "v1.6.0",
    date: "2026/04/17",
    items: [
      {
        ja: "爆速変換モード追加 (実験的, 一次検証済)",
        en: "Added high-speed conversion mode (experimental, first-stage validated)",
        zh: "新增极速转换模式（实验性，已完成第一阶段验证）",
        "zh-TW": "新增高速轉換模式（實驗性，已完成第一階段驗證）",
        id: "Menambahkan mode konversi berkecepatan tinggi (eksperimental, lolos validasi tahap awal)",
        es: "Modo de conversión de alta velocidad añadido (experimental, validado en primera etapa)", // より簡潔に
        "pt-BR":
          "Adicionado modo de conversão de alta velocidade (experimental, validado na primeira etapa)",
        ko: "초고속 변환 모드 추가 (실험적, 1차 검증 완료)",
      },
      {
        ja: "オートコンバート機能追加",
        en: "Added auto convert feature",
        zh: "新增自动转换功能",
        "zh-TW": "新增自動轉換功能",
        id: "Menambahkan fitur konversi otomatis",
        es: "Función de conversión automática añadida", // より簡潔に
        "pt-BR": "Adicionada a função de conversão automática",
        ko: "자동 변환 기능 추가",
      },
      {
        ja: "Pmx Preview にPMX,VMD,VPD 読込対応",
        en: "PMX Preview now supports PMX/VMD/VPD loading",
        zh: "PMX 预览支持 PMX/VMD/VPD 读取",
        "zh-TW": "PMX 預覽支援 PMX/VMD/VPD 讀取",
        id: "PMX Preview kini mendukung pemuatan PMX/VMD/VPD",
        es: "PMX Preview ahora admite la carga de PMX/VMD/VPD",
        "pt-BR": "O PMX Preview agora suporta carregamento de PMX/VMD/VPD",
        ko: "PMX 미리보기에서 PMX/VMD/VPD 로딩 지원",
      },
      {
        ja: "VRM Preview にGLB 読込対応 (変換未検証)",
        en: "VRM Preview now supports GLB loading (conversion not verified)",
        zh: "VRM 预览支持 GLB 读取（转换尚未验证）",
        "zh-TW": "VRM 預覽支援 GLB 讀取（轉換尚未驗證）",
        id: "VRM Preview kini mendukung pemuatan GLB (konversi belum diverifikasi)",
        es: "VRM Preview ahora admite la carga de GLB (conversión no verificada)",
        "pt-BR":
          "O VRM Preview agora suporta carregamento de GLB (conversão não verificada)",
        ko: "VRM 미리보기에서 GLB 로딩 지원 (변환 미검증)",
      },
      {
        ja: "※ ファイル読込時に自動切替",
        en: "Auto switching on file load",
        zh: "文件读取时自动切换",
        "zh-TW": "檔案讀取時自動切換",
        id: "Peralihan otomatis saat file dimuat",
        es: "Cambio automático al cargar archivos",
        "pt-BR": "Alternância automática ao carregar o arquivo",
        ko: "파일 로드 시 자동 전환",
      },
    ],
  },
  {
    version: "v1.5.4",
    date: "2026/04/12",
    items: [
      {
        ja: "韓国語対応",
        en: "Added Korean language support",
        zh: "新增韩语支持",
        "zh-TW": "新增韓語支援",
        id: "Menambahkan dukungan bahasa Korea",
        es: "Se añadió compatibilidad con coreano",
        "pt-BR": "Adicionado suporte ao idioma coreano",
        ko: "한국어 지원 추가",
      },
      {
        ja: "UI調整",
        en: "UI adjustments",
        zh: "UI 调整",
        "zh-TW": "UI 調整",
        id: "Penyesuaian UI",
        es: "Ajustes de la interfaz",
        "pt-BR": "Ajustes de UI",
        ko: "UI 조정",
      },
      {
        ja: "ログ出力調整",
        en: "Adjusted log output",
        zh: "日志输出调整",
        "zh-TW": "日誌輸出調整",
        id: "Penyesuaian output log",
        es: "Ajuste de la salida de registros",
        "pt-BR": "Ajuste da saída de log",
        ko: "로그 출력 조정",
      },
      {
        ja: "外部サービスについてAboutに追記",
        en: "Added external services section to About",
        zh: "在 About 中补充外部服务说明",
        "zh-TW": "在 About 中補充外部服務說明",
        id: "Menambahkan bagian layanan eksternal ke About",
        es: "Se añadió la sección de servicios externos en About",
        "pt-BR": "Adicionada a seção de serviços externos em About",
        ko: "About에 외부 서비스 항목 추가",
      },
    ],
  },
  {
    version: "v1.5.3",
    date: "2026-04-07",
    items: [
      {
        ja: "プレビュー最大化機能追加、右上アイコンまたはプレビュー内ダブルクリック",
        en: "Added preview maximize feature via top-right icon or double-click inside preview",
        zh: "新增预览最大化功能，可通过右上角图标或在预览区域内双击触发",
        "zh-TW": "新增預覽最大化功能，可透過右上角圖示或在預覽內雙擊觸發",
        id: "Menambahkan fitur perbesaran pratinjau melalui ikon kanan atas atau klik dua kali di pratinjau",
        es: "Se añadió la función de maximizar la vista previa mediante el icono superior derecho o doble clic dentro de la vista previa",
        "pt-BR":
          "Adicionada a função de maximizar a pré-visualização pelo ícone no canto superior direito ou duplo clique dentro da pré-visualização",
      },
      {
        ja: "VRMボーン表示ボタン追加",
        en: "Added VRM bone display toggle button",
        zh: "新增 VRM 骨骼显示切换按钮",
        "zh-TW": "新增 VRM 骨骼顯示切換按鈕",
        id: "Menambahkan tombol toggle tampilan bone VRM",
        es: "Se añadió el botón para alternar la visualización de huesos VRM",
        "pt-BR": "Adicionado botão para alternar a exibição dos ossos do VRM",
      },
      {
        ja: "X、ニコ動リンク追加",
        en: "Added links to X and NicoNico",
        zh: "新增 X 与 Niconico 链接",
        "zh-TW": "新增 X 與 Niconico 連結",
        id: "Menambahkan tautan ke X dan NicoNico",
        es: "Se añadieron enlaces a X y NicoNico",
        "pt-BR": "Adicionados links para X e NicoNico",
      },
      {
        ja: "PMX プレビューの白飛び改善",
        en: "Improved PMX preview overexposure (white clipping)",
        zh: "改善 PMX 预览过曝（发白）问题",
        "zh-TW": "改善 PMX 預覽過曝（發白）問題",
        id: "Memperbaiki overexposure (white clipping) pada pratinjau PMX",
        es: "Se mejoró la sobreexposición (blanqueo) de la vista previa PMX",
        "pt-BR":
          "Melhoria na superexposição (estouro de branco) da pré-visualização PMX",
      },
    ],
  },
  {
    version: "v1.5.2",
    date: "2026-04-06",
    items: [
      {
        ja: "開発サポートリンク",
        en: "Development support links",
        zh: "开发支持链接",
        "zh-TW": "開發支持鏈接",
        ko: "개발 지원 링크",
        id: "Tautan dukungan pengembangan",
        es: "Enlaces de apoyo al desarrollo",
        "pt-BR": "Links de apoio ao desenvolvimento",
      },
      {
        ja: "多言語対応追加（繁体字中国語・インドネシア語・スペイン語・ポルトガル語）",
        en: "Added multilingual support (Traditional Chinese · Indonesian · Spanish · Portuguese)",
        zh: "新增多语言支持（繁体中文·印尼语·西班牙语·葡萄牙语）",
        "zh-TW": "新增多語言支援（繁體中文·印尼語·西班牙語·葡萄牙語）",
        ko: "다국어 지원 추가(번체 중국어·인도네시아어·스페인어·포르투갈어)",
        id: "Dukungan multibahasa ditambahkan (Tionghoa Tradisional · Indonesia · Spanyol · Portugis)",
        es: "Compatibilidad multilingüe añadida (chino tradicional · indonesio · español · portugués)",
        "pt-BR":
          "Suporte multilíngue adicionado (chinês tradicional · indonésio · espanhol · português)",
      },
      {
        ja: "ZIP内のPMXのファイル名をVRMのファイル名に合わせた",
        en: "PMX filename in ZIP now matches the VRM filename",
        zh: "ZIP内PMX文件名与VRM文件名保持一致",
      },
    ],
  },
  {
    version: "v1.5.1",
    date: "2026-03-30",
    items: [
      {
        ja: "ユーザーレポートによる表示崩れ改善",
        en: "UI display issues fixed based on user reports",
        zh: "基于用户反馈改善了显示问题",
        "zh-TW": "根據使用者回報改善了顯示問題",
        id: "Masalah tampilan diperbaiki berdasarkan laporan pengguna",
        es: "Se corrigieron problemas de visualización según reportes de usuarios",
        "pt-BR":
          "Problemas de exibição corrigidos com base em relatos de usuários",
      },
      {
        ja: "エラーとなっていた処理を続行可能な場合には継続",
        en: "Processing continues when non-critical errors occur",
        zh: "可继续的处理不再中断",
        "zh-TW": "可繼續的處理不再中斷",
        id: "Proses tetap dilanjutkan saat terjadi error non-kritis",
        es: "El proceso continúa cuando ocurren errores no críticos",
        "pt-BR": "O processamento continua quando ocorrem erros não críticos",
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
        "zh-TW": "無操作時模型自動緩慢旋轉",
        id: "Model berputar perlahan secara otomatis saat idle",
        es: "El modelo gira lentamente de forma automática cuando está inactivo",
        "pt-BR": "O modelo gira lentamente automaticamente quando está inativo",
      },
      {
        ja: "英語、中国語対応",
        en: "English and Chinese language support added",
        zh: "新增英语和中文支持",
        "zh-TW": "新增英語和中文支援",
        id: "Menambahkan dukungan bahasa Inggris dan Mandarin",
        es: "Se añadió compatibilidad con inglés y chino",
        "pt-BR": "Adicionado suporte para inglês e chinês",
      },
      {
        ja: "ボーン表示ボタン追加",
        en: "Bone display toggle button added",
        zh: "添加骨骼显示切换按钮",
        "zh-TW": "新增骨骼顯示切換按鈕",
        id: "Menambahkan tombol toggle tampilan bone",
        es: "Se añadió el botón de alternar visualización de huesos",
        "pt-BR": "Adicionado botão de alternância de exibição dos ossos",
      },
      {
        ja: "表示崩れ報告機能追加",
        en: "Display quality report feature added",
        zh: "添加显示异常报告功能",
        "zh-TW": "新增顯示異常回報功能",
        id: "Menambahkan fitur laporan masalah tampilan",
        es: "Se añadió la función de reporte de problemas de visualización",
        "pt-BR": "Adicionada a função de relatório de problemas de exibição",
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
        "zh-TW": "新增中繼資料按鈕",
        id: "Menambahkan tombol metadata",
        es: "Se añadió el botón de metadatos",
        "pt-BR": "Adicionado botão de metadados",
      },
      {
        ja: "ライセンス確認とVRMのlicense.txtをZIPに含めるようにした",
        en: "Added license confirmation and included VRM license.txt in ZIP output",
        zh: "增加许可证确认，并将 VRM 的 license.txt 包含到 ZIP 输出中",
        "zh-TW": "增加授權確認，並將 VRM 的 license.txt 包含到 ZIP 輸出中",
        id: "Menambahkan konfirmasi lisensi dan menyertakan license.txt VRM di output ZIP",
        es: "Se añadió la confirmación de licencia y se incluyó license.txt del VRM en la salida ZIP",
        "pt-BR":
          "Adicionada a confirmação de licença e incluído o license.txt do VRM na saída ZIP",
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
        "zh-TW": "支援 VRM 1.0",
        id: "Menambahkan dukungan VRM 1.0",
        es: "Se añadió compatibilidad con VRM 1.0",
        "pt-BR": "Adicionado suporte ao VRM 1.0",
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
        "zh-TW": "已實現 PWA（本地啟動）",
        id: "Menambahkan dukungan PWA (peluncuran lokal)",
        es: "Se añadió compatibilidad con PWA (inicio local)",
        "pt-BR": "Adicionado suporte a PWA (execução local)",
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
        "zh-TW": "為回報功能導入 Sentry",
        id: "Memperkenalkan Sentry untuk pelaporan",
        es: "Se introdujo Sentry para los informes",
        "pt-BR": "Sentry introduzido para relatórios",
      },
      {
        ja: "揺れもの、シェーダー、モーフの変換処理追加",
        en: "Added conversion support for spring bones, shaders, and morphs",
        zh: "新增揺れ物、着色器和形变的转换处理",
        "zh-TW": "新增揺れ物、著色器和形變的轉換處理",
        id: "Menambahkan dukungan konversi untuk spring bone, shader, dan morph",
        es: "Se añadió compatibilidad de conversión para spring bones, shaders y morphs",
        "pt-BR":
          "Adicionado suporte de conversão para spring bones, shaders e morphs",
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
        "zh-TW": "整合 vrm2pmx 與 vroid2pmx",
        id: "Mengintegrasikan vrm2pmx dan vroid2pmx",
        es: "Se integraron vrm2pmx y vroid2pmx",
        "pt-BR": "Integrados vrm2pmx e vroid2pmx",
      },
      {
        ja: "Web化、UI調整",
        en: "Migrated to web and adjusted UI",
        zh: "Web 化并进行了 UI 调整",
        "zh-TW": "Web 化並進行了 UI 調整",
        id: "Dimigrasikan ke web dan UI disesuaikan",
        es: "Se migró a la web y se ajustó la interfaz",
        "pt-BR": "Migrado para a web e UI ajustada",
      },
    ],
  },
];

export default function AboutDialog({
  open,
  version,
  locale,
  userLocaleSetting = "auto",
  onUserLocaleSettingChange,
  languageSettingLabel = "Display Language",
  languageAutoLabel = "Auto (Browser language)",
  worldCounterSettingLabel = "WORLD CONVERT COUNTER に参加する (外すと表示のみになります)",
  defaultTab,
  installControl,
  worldCounterParticipationEnabled,
  onWorldCounterParticipationChange,
  turboLabsEnabled,
  onTurboLabsEnabledChange,
  turboLabsSettingLabel,
  onAllReset,
  onClose,
}: AboutDialogProps) {
  const [activeTab, setActiveTab] = useState<TabId>("about");
  const privacyPolicyTitle: Record<HistoryLocale, string> = {
    ja: "Privacy Policy",
    en: "Privacy Policy",
    zh: "隐私政策",
    "zh-TW": "隱私權政策",
    ko: "개인정보 처리방침",
    id: "Kebijakan Privasi",
    es: "Política de privacidad",
    "pt-BR": "Política de Privacidade",
  };
  const privacyPolicyText: Record<HistoryLocale, string> = {
    ja: "Thank You ❤ を送ると、匿名ID付きで記録されます。",
    en: "When you send Thank You ❤, it is recorded with an anonymous ID.",
    zh: "发送 Thank You ❤ 时，会以匿名 ID 进行记录。",
    "zh-TW": "送出 Thank You ❤ 時，會以匿名 ID 記錄。",
    ko: "Thank You ❤를 보내면 익명 ID와 함께 기록됩니다.",
    id: "Saat Anda mengirim Thank You ❤, itu dicatat dengan ID anonim.",
    es: "Al enviar Thank You ❤, se registra con un ID anónimo.",
    "pt-BR": "Ao enviar Thank You ❤, isso é registrado com um ID anônimo.",
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
      <section
        className="about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
      >
        <header className="about-modal-header">
          <h2 id="about-title">About</h2>
          <button
            type="button"
            className="about-close-button"
            onClick={onClose}
            aria-label="Close about dialog"
          >
            Close
          </button>
        </header>
        <div className="about-tabs">
          <button
            type="button"
            className={`about-tab${activeTab === "about" ? " about-tab-active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
          <button
            type="button"
            className={`about-tab${activeTab === "history" ? " about-tab-active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            Version
          </button>
          <button
            type="button"
            className={`about-tab${activeTab === "setting" ? " about-tab-active" : ""}`}
            onClick={() => setActiveTab("setting")}
          >
            Setting
          </button>
        </div>
        {activeTab === "history" ? (
          <div className="about-modal-body about-history-body">
            {HISTORY.map((entry) => (
              <div key={entry.version} className="history-entry">
                <p className="history-version">
                  {entry.version}{" "}
                  <span className="history-date">{entry.date}</span>
                </p>
                <ul className="history-list">
                  {entry.items.map((item, i) => (
                    <li key={i}>{item[locale] ?? item.en ?? item.ja ?? ""}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : activeTab === "setting" ? (
          <div className="about-modal-body about-settings-body">
            <p>
              <strong>Setting</strong>
            </p>
            <div className="about-settings-row" style={{ marginBottom: "1rem" }}>
              <label htmlFor="language-setting" className="about-settings-label" style={{ display: "block", marginBottom: "0.25rem" }}>
                <strong>{languageSettingLabel}:</strong>
              </label>
              <select
                id="language-setting"
                className="about-settings-select"
                style={{
                  padding: "0.4rem 0.6rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color, #ccc)",
                  background: "var(--bg-color, #fff)",
                  color: "var(--text-color, inherit)",
                  fontSize: "0.9rem",
                  width: "100%",
                  maxWidth: "300px",
                }}
                value={userLocaleSetting}
                onChange={(event) => onUserLocaleSettingChange?.(event.target.value)}
              >
                <option value="auto">{languageAutoLabel}</option>
                <option value="ja">日本語 (Japanese)</option>
                <option value="en">English</option>
                <option value="zh">简体中文 (Simplified Chinese)</option>
                <option value="zh-TW">繁體中文 (Traditional Chinese)</option>
                <option value="ko">한국어 (Korean)</option>
                <option value="id">Bahasa Indonesia</option>
                <option value="es">Español</option>
                <option value="pt-BR">Português (Brasil)</option>
              </select>
            </div>
            <label className="about-settings-toggle">
              <input
                type="checkbox"
                checked={worldCounterParticipationEnabled}
                onChange={(event) =>
                  onWorldCounterParticipationChange(event.target.checked)
                }
              />
              <span>
                {worldCounterSettingLabel}
              </span>
            </label>

            {/* Ver 1.6.0 release */}

            <label className="about-settings-toggle">
              <input
                type="checkbox"
                checked={turboLabsEnabled}
                onChange={(event) =>
                  onTurboLabsEnabledChange(event.target.checked)
                }
              />
              <span>{turboLabsSettingLabel}</span>
            </label>

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
            <p>
              <strong>VRM to MMD Converter</strong>
            </p>
            <p>
              This tool converts VRM models to PMX format in browser using
              Wasm/Pyodide runtime.
            </p>

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

            <p>
              <strong>Special thanks:</strong>
            </p>
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

            <p>
              <strong>Libraries:</strong>{" "}
              <a
                href="https://threejs.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                three.js
              </a>
              {" · "}
              <a
                href="https://github.com/pmndrs/three-stdlib"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                three-stdlib
              </a>
              {" · "}
              <a
                href="https://github.com/pixiv/three-vrm"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                @pixiv/three-vrm
              </a>
              {" · "}
              <a
                href="https://pyodide.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                Pyodide
              </a>
              {" · "}
              <a
                href="https://nim-lang.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                Nim
              </a>
              {" · "}
              <a
                href="https://react.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                React
              </a>
              {" · "}
              <a
                href="https://gildas-lormeau.github.io/zip.js/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                zip.js
              </a>
              {" · "}
              <a
                href="https://react-icons.github.io/react-icons/"
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                react-icons
              </a>
            </p>

            <hr className="about-divider" />

            <p>
              <strong>External Services:</strong>
            </p>
            <ul>
              <li>
                <a
                  href="https://sentry.io/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-link"
                >
                  Sentry
                </a>{" "}
                - Error Tracking.
              </li>
              <li>
                <a
                  href="https://slack.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-link"
                >
                  Slack
                </a>{" "}
                - Notifications
              </li>
              <li>
                <a
                  href="https://analytics.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-link"
                >
                  Google Analytics
                </a>{" "}
                - Usage analysis
              </li>
              <li>
                <a
                  href="https://script.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-link"
                >
                  Google Apps Script
                </a>{" "}
                - API security
              </li>
              <li>
                <a
                  href="https://firebase.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="about-link"
                >
                  Firebase
                </a>{" "}
                - Convert Counter
              </li>
            </ul>

            <hr className="about-divider" />
            <p>
              <strong>{privacyPolicyTitle[locale]}:</strong>
            </p>
            <p>{privacyPolicyText[locale]}</p>

            <p>
              <a
                href={`${import.meta.env.BASE_URL}${locale === "ja" ? "tokushoho_ja.html" : "tokushoho.html"}`}
                target="_blank"
                rel="noopener noreferrer"
                className="about-link"
              >
                {locale === "ja"
                  ? "特定商取引法に基づく表記"
                  : "Commercial Disclosure"}
              </a>
            </p>

            <hr className="about-divider" />
            <p>Powered by GitHub Copilot</p>
          </div>
        )}
      </section>
    </div>
  );
}
