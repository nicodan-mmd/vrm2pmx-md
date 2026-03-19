# Frontend with Vite

## 採用理由

- 起動が速く PoC 向き。
- TypeScript と React の構成を最小コストで整えられる。
- 将来的な分割ビルドと環境変数管理がしやすい。

## 初期構成

- ランタイム: Node.js LTS
- ツール: Vite
- UI: React + TypeScript

## 想定ディレクトリ

- frontend/src/components: UploadForm, ResultPanel
- frontend/src/services: api client
- frontend/src/types: API 型定義

## 最小機能

1. VRM ファイル選択
2. POST /api/convert 実行
3. PMX ダウンロード
4. エラー表示
