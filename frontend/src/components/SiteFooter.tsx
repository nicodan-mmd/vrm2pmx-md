import React from "react";
import { SiAfdian } from "react-icons/si";

type FooterLocale =
  | "ja"
  | "en"
  | "zh"
  | "zh-TW"
  | "ko"
  | "id"
  | "es"
  | "pt-BR"
  | string;

interface SiteFooterProps {
  locale: FooterLocale;
}

export const SiteFooter: React.FC<SiteFooterProps> = ({ locale }) => {
  const isJa = locale === "ja";
  const baseUrl = import.meta.env.BASE_URL;

  const guideUrl = `${baseUrl}${isJa ? "guide_ja.html" : "guide.html"}`;
  const privacyUrl = `${baseUrl}${isJa ? "privacy_ja.html" : "privacy.html"}`;
  const tokushohoUrl = `${baseUrl}${isJa ? "tokushoho_ja.html" : "tokushoho.html"}`;
  const contactUrl = `${baseUrl}${isJa ? "contact_ja.html" : "contact.html"}`;

  const labels = {
    guide: isJa ? "使い方・機能紹介" : locale === "zh" ? "使用指南" : "Tool Guide",
    privacy: isJa ? "プライバシーポリシー" : locale === "zh" ? "隐私政策" : "Privacy Policy",
    tokushoho: isJa ? "特定商取引法に基づく表記" : locale === "zh" ? "商业信息披露" : "Commercial Disclosure",
    contact: isJa ? "お問い合わせ" : locale === "zh" ? "联系我们" : "Contact Us",
  };

  return (
    <footer className="site-outer-footer" aria-label="Site footer">
      <div className="site-outer-footer-content">
        <nav className="site-outer-footer-links" aria-label="Legal and information links">
          <a
            href={guideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="site-outer-footer-link"
          >
            {labels.guide}
          </a>
          <span className="site-outer-footer-separator" aria-hidden="true">|</span>
          <a
            href={privacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="site-outer-footer-link"
          >
            {labels.privacy}
          </a>
          <span className="site-outer-footer-separator" aria-hidden="true">|</span>
          <a
            href={tokushohoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="site-outer-footer-link"
          >
            {labels.tokushoho}
          </a>
          <span className="site-outer-footer-separator" aria-hidden="true">|</span>
          <a
            href={contactUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="site-outer-footer-link"
          >
            {labels.contact}
          </a>
        </nav>

        <div className="site-outer-footer-social">
          <a
            href="https://x.com/nicodan_mmd"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Official X"
            title="Official X (@nicodan_mmd)"
            className="site-outer-social-link"
          >
            <img
              src={`${baseUrl}assets/social/x-logo-black.png`}
              alt="X"
              className="site-outer-social-icon"
            />
          </a>
          <a
            href="https://www.nicovideo.jp/watch/sm46100394"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="ニコニコ動画"
            title="ニコニコ動画"
            className="site-outer-social-link"
          >
            <img
              src={`${baseUrl}assets/social/nico2tv.png`}
              alt="ニコニコ動画"
              className="site-outer-social-icon"
            />
          </a>
          <a
            href="https://afdian.com/a/vrmtommdconverter"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Sponsor on Afdian"
            title="Sponsor on Afdian"
            className="site-outer-social-link"
          >
            <SiAfdian className="site-outer-social-icon-afdian" aria-hidden="true" />
          </a>
        </div>

        <p className="site-outer-footer-copy">
          &copy; 2026 nicodan_mmd. All rights reserved.
        </p>
      </div>
    </footer>
  );
};
