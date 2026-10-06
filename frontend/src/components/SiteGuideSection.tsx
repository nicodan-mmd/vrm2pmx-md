import React from "react";

type GuideLocale =
  | "ja"
  | "en"
  | "zh"
  | "zh-TW"
  | "ko"
  | "id"
  | "es"
  | "pt-BR"
  | string;

interface SiteGuideSectionProps {
  locale: GuideLocale;
}

interface FeatureItem {
  icon: string;
  title: string;
  desc: string;
}

interface StepItem {
  number: string;
  title: string;
  desc: string;
}

interface FaqItem {
  q: string;
  a: string;
}

interface GuideContent {
  sectionTitle: string;
  lead: string;
  securityTitle: string;
  securityText: string;
  featuresTitle: string;
  features: FeatureItem[];
  stepsTitle: string;
  steps: StepItem[];
  faqTitle: string;
  faqs: FaqItem[];
  guideLinkText: string;
  guideLinkLabel: string;
}

const JA_CONTENT: GuideContent = {
  sectionTitle: "VRM to MMD Converter (vrm2pmx-md) について",
  lead: "VRoid Studio や各種モデリングツールで作成された VRM 形式の 3D アバターモデルを、MikuMikuDance（MMD）や互換ソフトウェアで利用可能な PMX 形式へブラウザ上で高速・高品質に変換できる無料のWebツールです。",
  securityTitle: "安心・安全の完全ローカル処理（クライアントサイド完結）",
  securityText: "本ツールの変換処理は、WebAssembly（Wasm）などの最新ブラウザ技術を活用し、すべてお使いのPC・スマートフォン端末内（ブラウザ上）で完結して実行されます。3Dモデルファイルやテクスチャ画像が外部サーバーへ送信・保存されることは一切ありません。大切なオリジナルモデルや商用規約のあるアバターも安心・安全にご利用いただけます。",
  featuresTitle: "主な機能と特徴",
  features: [
    {
      icon: "🛡️",
      title: "完全ローカル・プライバシー保証",
      desc: "データはすべてお使いのブラウザ内部で変換処理。サーバーへアップロードされないため、著作権保護や機密保持の観点からも安心して扱えます。",
    },
    {
      icon: "👁️",
      title: "リアルタイム 3D プレビュー",
      desc: "変換前のVRMと変換後のPMXをブラウザ上で並べて3D表示。回転・拡大縮小・ライティング調整を行いながら仕上がりをその場で確認できます。",
    },
    {
      icon: "💃",
      title: "VMD / VPD モーション・ポーズ再生",
      desc: "変換後のPMXビューエリアにVMD（モーション）やVPD（ポーズ）ファイルをドラッグ＆ドロップして、ボーンの動きや破綻を即座にチェック可能です。",
    },
    {
      icon: "📐",
      title: "T/A ポーズ自動調整機能",
      desc: "VRM特有のTスタンスから、MMDモーションの流し込みに最適な自然なAスタンスへ腕の角度を自動調整してPMX化できます。",
    },
    {
      icon: "🎭",
      title: "モーフ・ボーン・物理演算の最適化",
      desc: "VRMの表情ブレンドシェイプをMMDモーフ（眉・目・口など）へ自動変換。ボーン階層構造、剛体、JointもMMDの仕様に合わせて構築されます。",
    },
    {
      icon: "📦",
      title: "ZIP 一括パッケージ出力",
      desc: "PMXファイル本体と必要なテクスチャ画像（PNG/JPG/スフィアマップ）を1つのZIPファイルにまとめて即座にダウンロードできます。",
    },
  ],
  stepsTitle: "簡単4ステップの使い方（変換手順）",
  steps: [
    {
      number: "Step 1",
      title: "VRM ファイルを読み込む",
      desc: "上部の「VRM Preview」エリアにお手持ちの .vrm ファイルをドラッグ＆ドロップするか、「ファイルを選択」ボタンから読み込みます。",
    },
    {
      number: "Step 2",
      title: "プレビュー確認と変換設定",
      desc: "プレビュー画面でモデルの形状を確認し、必要に応じて「T/A Pose Convert」で腕の角度調整や各変換オプションを指定します。",
    },
    {
      number: "Step 3",
      title: "変換を実行する",
      desc: "「Convert」ボタンをクリックすると、ブラウザ内の高速変換エンジンが起動し、自動的にPMXモデルへの変換処理が行われます。",
    },
    {
      number: "Step 4",
      title: "プレビュー確認＆ZIPダウンロード",
      desc: "右側の「PMX Preview」画面で仕上がりを確認したら、「Download ZIP」をクリックしてPMXモデルとテクスチャが同梱されたZIPを保存します。",
    },
  ],
  faqTitle: "よくあるご質問 (FAQ)",
  faqs: [
    {
      q: "Q. 利用料金やアカウント登録は必要ですか？",
      a: "A. いいえ、会員登録やログインは不要で、すべての機能を完全無料でご利用いただけます。",
    },
    {
      q: "Q. アップロードした3Dモデルが外部に漏洩・保存される心配はありませんか？",
      a: "A. 一切ありません。本サービスはサーバーとの通信を必要とせず、すべてお使いのブラウザ内部（ローカル環境）で処理を完結させています。",
    },
    {
      q: "Q. MMDでモデルを読み込んだ際にテクスチャが白くなる（表示されない）場合は？",
      a: "A. ダウンロードしたZIPファイルを必ず「すべて展開（解凍）」してから、解凍後のフォルダ内にあるPMXファイルをMMDに読み込んでください。ZIPファイルを開いたまま直接ドラッグ＆ドロップするとテクスチャが読み込まれません。",
    },
    {
      q: "Q. 変換したPMXモデルの著作権や利用条件はどうなりますか？",
      a: "A. 変換元のVRMモデルの利用規約（作者様が定めた商用利用、改変、再配布等の許諾範囲）に準拠します。規約をご確認の上、ルールを守ってご利用ください。",
    },
    {
      q: "Q. スマートフォンやタブレットでも利用できますか？",
      a: "A. 最新のGoogle ChromeやSafari等のブラウザを搭載したスマートフォン・タブレットでも閲覧・変換が可能です（※大容量モデルの場合はPC推奨です）。",
    },
  ],
  guideLinkText: "詳しい操作方法や各設定パラメータの仕様については、",
  guideLinkLabel: "使い方・機能紹介ページ",
};

const EN_CONTENT: GuideContent = {
  sectionTitle: "About VRM to MMD Converter (vrm2pmx-md)",
  lead: "VRM to MMD Converter is a free, web-based tool that enables high-speed, high-quality conversion of VRM 3D avatar models (created in VRoid Studio and other modeling tools) into PMX format for MikuMikuDance (MMD) and compatible software directly inside your browser.",
  securityTitle: "100% Client-Side Processing & Privacy Guaranteed",
  securityText: "All conversion processes run entirely within your local web browser using modern WebAssembly (Wasm) technology. Your 3D models and textures are never uploaded or stored on any external servers. You can safely convert proprietary, confidential, or commercial avatar models with complete peace of mind.",
  featuresTitle: "Key Features & Capabilities",
  features: [
    {
      icon: "🛡️",
      title: "Client-Side Privacy",
      desc: "All processing happens in your local browser environment. No model files leave your device, ensuring maximum confidentiality and IP protection.",
    },
    {
      icon: "👁️",
      title: "Real-Time 3D Previews",
      desc: "Inspect both the source VRM and output PMX models side by side with full interactive 3D rotation, zoom, and lighting controls.",
    },
    {
      icon: "💃",
      title: "VMD & VPD Motion/Pose Playback",
      desc: "Drag and drop MMD motion (.vmd) or pose (.vpd) files into the PMX preview pane to verify animations, rigging, and bone weights immediately.",
    },
    {
      icon: "📐",
      title: "T/A-Pose Automatic Adjustment",
      desc: "Automatically adjust arm angles from VRM's default T-pose into the natural A-pose preferred for MMD motion compatibility.",
    },
    {
      icon: "🎭",
      title: "Morph, Bone & Physics Mapping",
      desc: "Seamlessly converts blend shapes into MMD facial morphs (eyebrows, eyes, mouth) and structures bones, rigid bodies, and joints according to MMD standards.",
    },
    {
      icon: "📦",
      title: "One-Click ZIP Packaging",
      desc: "Export your finished model as a tidy ZIP package containing the PMX file and all associated texture images (PNG, JPG, sphere maps).",
    },
  ],
  stepsTitle: "How to Use: 4 Simple Steps",
  steps: [
    {
      number: "Step 1",
      title: "Load Your VRM File",
      desc: "Drag and drop your .vrm file into the 'VRM Preview' box at the top, or click the file select button to choose one from your computer.",
    },
    {
      number: "Step 2",
      title: "Inspect & Configure Settings",
      desc: "Review your model in the 3D viewport. Adjust the T/A pose arm angles and conversion options according to your requirements.",
    },
    {
      number: "Step 3",
      title: "Run the Conversion",
      desc: "Click 'Convert' to execute the in-browser WebAssembly conversion pipeline, generating the PMX model within seconds.",
    },
    {
      number: "Step 4",
      title: "Preview & Download ZIP",
      desc: "Check the resulting model in the 'PMX Preview' canvas, then click 'Download ZIP' to save the complete package.",
    },
  ],
  faqTitle: "Frequently Asked Questions (FAQ)",
  faqs: [
    {
      q: "Q. Is this tool completely free to use?",
      a: "A. Yes, all conversion and preview features are 100% free with no registration or subscription required.",
    },
    {
      q: "Q. Are my uploaded 3D models saved on any server?",
      a: "A. Absolutely not. The application executes entirely inside your browser's local sandbox; zero model data is transmitted to external servers.",
    },
    {
      q: "Q. Why are textures missing (white model) in MMD?",
      a: "A. Please make sure to extract (unzip) the downloaded ZIP archive completely before opening the PMX model in MMD. Opening directly from inside the archive prevents MMD from reading relative texture paths.",
    },
    {
      q: "Q. What are the copyright and usage terms for converted models?",
      a: "A. The rights and permissions remain governed by the original VRM model's license terms. Please respect the original creator's commercial and modification policies.",
    },
    {
      q: "Q. Which web browsers are supported?",
      a: "A. Modern evergreen browsers including Google Chrome, Microsoft Edge, Mozilla Firefox, and Apple Safari are fully supported.",
    },
  ],
  guideLinkText: "For detailed specifications, release notes, and troubleshooting, visit the ",
  guideLinkLabel: "Detailed User Guide",
};

export const SiteGuideSection: React.FC<SiteGuideSectionProps> = ({ locale }) => {
  const isJa = locale === "ja";
  const content = isJa ? JA_CONTENT : EN_CONTENT;

  const baseUrl = import.meta.env.BASE_URL;
  const guideUrl = `${baseUrl}${isJa ? "guide_ja.html" : "guide.html"}`;

  return (
    <section className="site-guide-section card" aria-labelledby="site-guide-heading">
      <header className="site-guide-header">
        <h2 id="site-guide-heading" className="site-guide-title">
          {content.sectionTitle}
        </h2>
        <p className="site-guide-lead">{content.lead}</p>
      </header>

      {/* セキュリティ・完全クライアント完結のハイライト */}
      <div className="site-guide-banner" role="region" aria-label="Privacy guarantee">
        <div className="site-guide-banner-icon" aria-hidden="true">🔒</div>
        <div className="site-guide-banner-body">
          <h3 className="site-guide-banner-title">{content.securityTitle}</h3>
          <p className="site-guide-banner-text">{content.securityText}</p>
        </div>
      </div>

      {/* 主な機能グリッド */}
      <div className="site-guide-block">
        <h3 className="site-guide-subtitle">{content.featuresTitle}</h3>
        <div className="site-guide-features-grid">
          {content.features.map((feature, idx) => (
            <div key={idx} className="site-guide-feature-box">
              <span className="site-guide-feature-icon" aria-hidden="true">
                {feature.icon}
              </span>
              <h4 className="site-guide-feature-title">{feature.title}</h4>
              <p className="site-guide-feature-desc">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 簡単4ステップの使い方 */}
      <div className="site-guide-block">
        <h3 className="site-guide-subtitle">{content.stepsTitle}</h3>
        <div className="site-guide-steps-list">
          {content.steps.map((step, idx) => (
            <div key={idx} className="site-guide-step-item">
              <span className="site-guide-step-badge">{step.number}</span>
              <div className="site-guide-step-body">
                <h4 className="site-guide-step-title">{step.title}</h4>
                <p className="site-guide-step-desc">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* よくある質問 (FAQ) */}
      <div className="site-guide-block">
        <h3 className="site-guide-subtitle">{content.faqTitle}</h3>
        <div className="site-guide-faq-list">
          {content.faqs.map((faq, idx) => (
            <details key={idx} className="site-guide-faq-card" open={idx === 0}>
              <summary className="site-guide-faq-question">{faq.q}</summary>
              <p className="site-guide-faq-answer">{faq.a}</p>
            </details>
          ))}
        </div>
      </div>

      {/* 詳細ガイドへの導線 */}
      <footer className="site-guide-footer-note">
        <p>
          {content.guideLinkText}
          <a
            href={guideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="site-guide-more-link"
          >
            {content.guideLinkLabel} →
          </a>
        </p>
      </footer>
    </section>
  );
};
