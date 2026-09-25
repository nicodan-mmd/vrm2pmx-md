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

export const SiteGuideSection: React.FC<SiteGuideSectionProps> = ({ locale }) => {
  if (locale === "ja") {
    return (
      <section id="guide" className="site-guide-section" aria-label="ツールのご利用ガイド">
        <div className="site-guide-card">
          <header className="site-guide-header">
            <h2 className="site-guide-title">VRM to MMD Converter (vrm2pmx-md) とは</h2>
            <p className="site-guide-lead">
              VRoid Studio等で作成された <strong>VRM 形式の 3D アバターモデル</strong> を、
              MikuMikuDance（MMD）で利用可能な <strong>PMX 形式へブラウザ上で高速・高品質に変換</strong> できる無料Webツールです。
              サーバーにファイルを一切アップロードせず、お使いのPC・スマートフォンのブラウザ内（クライアントサイド）だけで完全ローカル処理するため、
              <strong>大切なモデルデータが外部に送信・流出する心配がなく、安全・安心にご利用いただけます。</strong>
            </p>
          </header>

          <div className="site-guide-features">
            <h3 className="site-guide-subtitle">✨ 主な特徴</h3>
            <div className="features-grid">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <div className="feature-title">完全ブラウザ完結・安心のセキュリティ</div>
                <div className="feature-desc">
                  モデルデータはサーバーに送信されず、お使いの端末内だけで高速変換。著作権や機密性のあるモデルでも安心です。
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">👁️</div>
                <div className="feature-title">リアルタイム 3D プレビュー＆モーション確認</div>
                <div className="feature-desc">
                  変換前（VRM）と変換後（PMX）をブラウザ上で並べて3D表示。VMD（ダンスモーション）やVPD（ポーズ）の流し込み確認も可能です。
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">📐</div>
                <div className="feature-title">T/A ポーズ自動変換対応</div>
                <div className="feature-desc">
                  VRM特有のTポーズから、MMDモーションに適した自然なAスタンスへ角度を指定して自動調整できます。
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <div className="feature-title">表情モーフ・物理演算・テクスチャ最適化</div>
                <div className="feature-desc">
                  VRMのブレンドシェイプをMMD表情モーフに変換。ボーン階層や剛体・Joint、テクスチャもZIPにまとめて自動生成します。
                </div>
              </div>
            </div>
          </div>

          <div className="site-guide-steps">
            <h3 className="site-guide-subtitle">🚀 使い方・変換手順（簡単4ステップ）</h3>
            <div className="steps-container">
              <div className="step-card">
                <div className="step-badge">Step 1</div>
                <div className="step-card-content">
                  <h4>VRM ファイルを読み込む</h4>
                  <p>
                    左側の「VRM Preview」エリアにお手持ちの <code>.vrm</code> ファイルをドラッグ＆ドロップするか、「Choose file」からファイルを選択します。
                  </p>
                </div>
              </div>
              <div className="step-card">
                <div className="step-badge">Step 2</div>
                <div className="step-card-content">
                  <h4>モデル確認と変換設定</h4>
                  <p>
                    プレビュー画面でモデルの見た目を確認します。「T/A Pose Convert」でお好みの腕の角度を指定できます（標準推奨値が設定されています）。
                  </p>
                </div>
              </div>
              <div className="step-card">
                <div className="step-badge">Step 3</div>
                <div className="step-card-content">
                  <h4>変換を実行する</h4>
                  <p>
                    「Convert」ボタンをクリックします。WebAssembly技術により、ブラウザ内で即座に高速変換が開始されます。
                  </p>
                </div>
              </div>
              <div className="step-card">
                <div className="step-badge">Step 4</div>
                <div className="step-card-content">
                  <h4>プレビュー確認＆ZIPダウンロード</h4>
                  <p>
                    右側の「PMX Preview」で変換結果を確認し、「Download ZIP」をクリックしてPMXモデルとテクスチャが同梱されたZIPファイルを保存します。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="site-guide-faq">
            <h3 className="site-guide-subtitle">❓ よくあるご質問 (FAQ)</h3>
            <div className="faq-grid">
              <div className="faq-item">
                <div className="faq-q">Q. 利用料金はかかりますか？</div>
                <div className="faq-a">
                  A. いいえ、すべての変換機能を<strong>完全無料</strong>でご利用いただけます。
                </div>
              </div>
              <div className="faq-item">
                <div className="faq-q">Q. 変換データがサーバーに保存されることはありますか？</div>
                <div className="faq-a">
                  A. いいえ、一切ありません。本サービスはWebブラウザ（クライアントサイド）内でのみ処理が完結する技術を採用しており、モデルファイルやテクスチャが外部サーバーへ送信・保存されることはありません。
                </div>
              </div>
              <div className="faq-item">
                <div className="faq-q">Q. どのようなブラウザに対応していますか？</div>
                <div className="faq-a">
                  A. Google Chrome, Microsoft Edge, Mozilla Firefox, Apple Safari の最新バージョンに対応しています。
                </div>
              </div>
              <div className="faq-item">
                <div className="faq-q">Q. モデルの著作権や利用規約はどうなりますか？</div>
                <div className="faq-a">
                  A. 変換元のVRMモデルの利用規約（改変可否、再配布可否、商用利用等）を必ずご確認の上ご利用ください。変換後のモデルも元モデルのライセンスに準拠します。
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (locale === "zh") {
    return (
      <section id="guide" className="site-guide-section" aria-label="工具使用指南">
        <div className="site-guide-card">
          <header className="site-guide-header">
            <h2 className="site-guide-title">关于 VRM to MMD Converter (vrm2pmx-md)</h2>
            <p className="site-guide-lead">
              本工具是一款免费的 Web 应用程序，可直接在浏览器中将 VRoid Studio 等制作的 <strong>VRM 3D 模型高速转换为 MMD（MikuMikuDance）可用的 PMX 格式</strong>。
              <strong>完全在本地浏览器端处理，不会上传模型文件至任何服务器</strong>，保护您的模型隐私和数据安全。
            </p>
          </header>

          <div className="site-guide-features">
            <h3 className="site-guide-subtitle">✨ 核心特点</h3>
            <div className="features-grid">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <div className="feature-title">浏览器本地运行・数据安全</div>
                <div className="feature-desc">
                  所有转换均在客户端完成，文件绝不上传至任何服务器，保护创作者版权。
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">👁️</div>
                <div className="feature-title">实时 3D 预览与动作测试</div>
                <div className="feature-desc">
                  支持 VRM 与 PMX 双侧实时 3D 预览，可直接拖入 VMD 动作或 VPD 姿势文件测试效果。
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">📐</div>
                <div className="feature-title">T/A Pose 自动转换</div>
                <div className="feature-desc">
                  支持自定义角度，将 VRM 标准 T 姿态自动调整为适合 MMD 动作的自然 A 姿态。
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <div className="feature-title">表情形态与物理骨骼适配</div>
                <div className="feature-desc">
                  自动将 BlendShape 转换为 MMD 表情变形，打包生成包含贴图的完整 ZIP 文件。
                </div>
              </div>
            </div>
          </div>

          <div className="site-guide-steps">
            <h3 className="site-guide-subtitle">🚀 使用步骤（简单 4 步）</h3>
            <div className="steps-container">
              <div className="step-card">
                <div className="step-badge">步骤 1</div>
                <div className="step-card-content">
                  <h4>导入 VRM 文件</h4>
                  <p>将 <code>.vrm</code> 模型拖入左侧预览区域，或点击「Choose file」选择文件。</p>
                </div>
              </div>
              <div className="step-card">
                <div className="step-badge">步骤 2</div>
                <div className="step-card-content">
                  <h4>确认模型与设置</h4>
                  <p>在预览区域检查模型形态，根据需要调整 T/A 姿态转换角度。</p>
                </div>
              </div>
              <div className="step-card">
                <div className="step-badge">步骤 3</div>
                <div className="step-card-content">
                  <h4>开始转换</h4>
                  <p>点击「Convert」按钮，WebAssembly 引擎将立即在浏览器中高速转换。</p>
                </div>
              </div>
              <div className="step-card">
                <div className="step-badge">步骤 4</div>
                <div className="step-card-content">
                  <h4>预览与下载 ZIP</h4>
                  <p>在右侧预览检查 PMX 效果，点击「Download ZIP」保存包含 PMX 和贴图的压缩包。</p>
                </div>
              </div>
            </div>
          </div>

          <div className="site-guide-faq">
            <h3 className="site-guide-subtitle">❓ 常见问题 (FAQ)</h3>
            <div className="faq-grid">
              <div className="faq-item">
                <div className="faq-q">Q. 转换工具是免费的吗？</div>
                <div className="faq-a">A. 是的，本工具所有核心功能完全免费开放使用。</div>
              </div>
              <div className="faq-item">
                <div className="faq-q">Q. 模型文件会被保存在服务器上吗？</div>
                <div className="faq-a">A. 绝不会。所有数据仅在您的浏览器中计算，不上传任何外部服务器。</div>
              </div>
              <div className="faq-item">
                <div className="faq-q">Q. 支持哪些浏览器？</div>
                <div className="faq-a">A. 支持 Chrome, Edge, Safari, Firefox 等最新现代浏览器。</div>
              </div>
              <div className="faq-item">
                <div className="faq-q">Q. 转换后的模型版权如何处理？</div>
                <div className="faq-a">A. 转换后模型的版权与使用权限完全遵循原 VRM 模型的许可条款。</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // en (default)
  return (
    <section id="guide" className="site-guide-section" aria-label="Tool Guide & Documentation">
      <div className="site-guide-card">
        <header className="site-guide-header">
          <h2 className="site-guide-title">About VRM to MMD Converter (vrm2pmx-md)</h2>
          <p className="site-guide-lead">
            <strong>vrm2pmx-md</strong> is a free, modern web application that converts <strong>VRM 3D avatar models</strong> (such as those created in VRoid Studio) into <strong>PMX format for MikuMikuDance (MMD)</strong> directly in your browser.
            <strong>All processing runs entirely on the client-side (inside your browser)</strong> using WebAssembly. Your 3D models and textures are never uploaded or stored on any remote server, ensuring maximum privacy and copyright security.
          </p>
        </header>

        <div className="site-guide-features">
          <h3 className="site-guide-subtitle">✨ Key Features</h3>
          <div className="features-grid">
            <div className="feature-item">
              <div className="feature-icon">🔒</div>
              <div className="feature-title">100% Client-Side & Private</div>
              <div className="feature-desc">
                Your 3D model files never leave your computer. Everything converts locally in your browser for total peace of mind.
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">👁️</div>
              <div className="feature-title">Real-Time 3D Preview & Motion Testing</div>
              <div className="feature-desc">
                Inspect both VRM and PMX models in interactive 3D viewports. Drop VMD motions or VPD poses to test animations instantly.
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">📐</div>
              <div className="feature-title">Automatic T/A Pose Conversion</div>
              <div className="feature-desc">
                Converts VRM T-pose to natural MMD A-pose with customizable arm angles for optimal motion compatibility.
              </div>
            </div>
            <div className="feature-item">
              <div className="feature-icon">⚡</div>
              <div className="feature-title">Morphs, Physics & Textures Packaged</div>
              <div className="feature-desc">
                Maps blendshapes to MMD facial morphs, configures bones/physics, and bundles everything into a convenient ZIP archive.
              </div>
            </div>
          </div>
        </div>

        <div className="site-guide-steps">
          <h3 className="site-guide-subtitle">🚀 How to Use (4 Easy Steps)</h3>
          <div className="steps-container">
            <div className="step-card">
              <div className="step-badge">Step 1</div>
              <div className="step-card-content">
                <h4>Load Your VRM File</h4>
                <p>Drag and drop your <code>.vrm</code> file into the "VRM Preview" box, or click "Choose file".</p>
              </div>
            </div>
            <div className="step-card">
              <div className="step-badge">Step 2</div>
              <div className="step-card-content">
                <h4>Inspect & Adjust Settings</h4>
                <p>Check the 3D model in the viewport. Adjust T/A Pose Convert angle if needed.</p>
              </div>
            </div>
            <div className="step-card">
              <div className="step-badge">Step 3</div>
              <div className="step-card-content">
                <h4>Click Convert</h4>
                <p>Click "Convert" to process the model locally using our optimized high-speed engine.</p>
              </div>
            </div>
            <div className="step-card">
              <div className="step-badge">Step 4</div>
              <div className="step-card-content">
                <h4>Preview & Download ZIP</h4>
                <p>Inspect the converted PMX in the right viewport, then click "Download ZIP" to save your model.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="site-guide-faq">
          <h3 className="site-guide-subtitle">❓ Frequently Asked Questions (FAQ)</h3>
          <div className="faq-grid">
            <div className="faq-item">
              <div className="faq-q">Q. Is this service free to use?</div>
              <div className="faq-a">A. Yes, all conversion features are completely free to use.</div>
            </div>
            <div className="faq-item">
              <div className="faq-q">Q. Is my model data saved on your servers?</div>
              <div className="faq-a">A. No. Conversion takes place entirely within your browser (client-side). No model data is ever uploaded or retained.</div>
            </div>
            <div className="faq-item">
              <div className="faq-q">Q. What browsers are supported?</div>
              <div className="faq-a">A. Google Chrome, Microsoft Edge, Mozilla Firefox, and Apple Safari (latest versions).</div>
            </div>
            <div className="faq-item">
              <div className="faq-q">Q. What about model licensing and copyrights?</div>
              <div className="faq-a">A. Please ensure you comply with the original model creator's terms of use. Converted models retain original license terms.</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
