# Wasm Migration Notes

このディレクトリは、vrm2pmx をサーバー常設なしで運用するために、変換処理をブラウザ側へ寄せる計画を整理したドキュメントです。

## 方針

- FastAPI 常設運用は前提にしない。
- 短期は Pyodide で Python 変換コアをブラウザ実行する。
- 中長期は必要に応じてコアの純 Wasm 実装（Rust/C++）を比較検討する。
- まずは最小変換経路を成立させ、段階的に tex 同梱、ZIP 化、進捗、キャンセルへ拡張する。
- Wasm 完成までは作業ブランチで進め、main ブランチに破壊的変更を入れない。
- Wasm 化が安定した時点で、バックエンドを必須要件から外す。

## ブランチ運用（提案）

- ブランチA: refactor/io-core-separation
- ブランチB: feature/wasm-pyodide-poc
- ブランチC: feature/wasm-worker-ux

## ドキュメント一覧

- 01-Roadmap.md: フェーズ計画とマイルストーン
- 02-Architecture.md: 目標アーキテクチャと責務分離
- 03-Browser-Contract.md: ブラウザ内実行の入出力契約
- 04-Frontend-Vite.md: Vite/React 側の実装方針
- 05-Test-Strategy.md: テスト戦略と合格条件
- 06-Local-Run.md: ローカル実行手順
- 07_Risks-Diagnostics.md: リスク、観測、ロールバック方針
- 08-Execution-Checklist.md: ローカル実装時の実行チェックリスト
- 09-Phase0-Inventory.md: GUI依存とFS依存の棚卸し結果

## 運用メモ

- このリポジトリでは PR 前提で進めず、ローカルで Wasm 化完了まで進める。
- 完了後に必要ならフォーク先へ push する。
