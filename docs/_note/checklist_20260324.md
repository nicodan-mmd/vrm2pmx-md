# checklist_20260324

## 1. UI調整

- [x] About ダイアログに以下を追加
  - [x] GitHub リポジトリリンク (vrm2pmx-md)
  - [x] Special thanks
  - [x] Forked from vrm2pmx 表記
  - [x] 使用ライブラリリンクの横並び表示
- [x] タイトル (VRM to MMD Converter) の中央寄せ
- [x] Log View ヘッダーの上下余白を縮小
- [x] VRM Preview のプレースホルダーに補足文追加
  - (Only VRM 0.0 can be converted)
- [x] Convert ボタンに進捗表現を追加
  - [x] ステージベースの疑似%表示
  - [x] 左から塗り進む見た目

## 2. デザイン調整

- [x] Convert を Download ZIP と同系色に統一
- [x] ボタン全体をパステル寄りに調整
- [x] ボタン文字色を白からダークグレーへ変更
- [x] About ボタンをオレンジ系に変更

## 3. README/ドキュメント

- [x] [README.md](../../README.md) 更新
  - [x] 使用ライブラリ記載
  - [x] shields.io バッジ修正
  - [x] TypeScript / Python 追記
- [x] [README_en.md](../../README_en.md) 作成

## 4. favicon / SEO / SNS / Analytics

- [x] favicon を [frontend/public/assets/favicon](../../frontend/public/assets/favicon) に配置
- [x] [frontend/index.html](../../frontend/index.html) に favicon リンク追加
- [x] description (英日) 追加
- [x] Google Analytics gtag 追加
- [x] OGP/Twitter/canonical 追加
- [x] OGP画像を [frontend/public/assets/og/ogp.png](../../frontend/public/assets/og/ogp.png) に差し替え

## 5. Git運用

- [x] feature/ui-enhancements を push
- [x] ローカルで main へ fast-forward マージ
- [x] main を origin/main に push

## 6. 公開前の最終チェック (推奨)

- [ ] Chrome/Edge で変換フロー確認
- [ ] 代表モデル 5〜10件で変換・MMD読み込み確認
- [ ] 失敗ケース確認 (.vrm/.glb 以外、キャンセル、壊れデータ)
- [ ] OGP表示確認
  - [ ] X 投稿作成画面でURLプレビュー確認
  - [ ] Facebook Sharing Debugger で Scrape Again
- [ ] GA リアルタイムでイベント受信確認

## 7. 今後タスク候補

- [ ] VRM 1.0 変換対応
- [ ] Vrm展開ホットスポットの計測
- [ ] 必要に応じて部分Rust化を検討
- [ ] App.tsx の段階的分割 (Preview / Convert / Log / Footer)
- [ ] 最小E2Eテスト導入 (正常系・失敗系・キャンセル)
