# Web Migration Notes

このディレクトリは、vrm2pmx を PoC として Web 化するための作業ドキュメントです。

## 方針

- まずはエラー整理と依存整理を優先する。
- その後、FastAPI バックエンドと分離フロントエンドを実装する。
- フロントエンドは Vite + React + TypeScript を標準とする。
- 変換APIは同期方式で開始し、必要なら非同期ジョブ方式へ拡張する。

## ブランチ運用

- ブランチA: refactor/errors-fix
- ブランチB: feature/web-modernization

## ドキュメント一覧

- 01-Roadmap.md: 実施順序とマイルストーン
- 02-Architecture.md: 現状構造と目標構造
- 03-Backend-API.md: FastAPI の最小API仕様
- 04-Frontend-Vite.md: Vite 構成と実装方針
- 05-Test-Strategy.md: テスト方針と追加項目
- 06-Local-Run.md: ローカル起動手順（Backend/Frontend）
