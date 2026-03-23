# Execution Checklist

このチェックリストは、Wasm 化の実装作業をローカルで安全に進めるための実行用メモです。

## 0. 事前確認

- [ ] 現在ブランチが `docs/wasm-migration-plan` である
- [ ] `git status --short` が意図した変更のみである
- [ ] main ブランチへ直接変更を入れていない

## 1. Phase 0: 設計固定

- [x] GUI 依存 import 一覧を洗い出した
- [x] FS 依存箇所（temp dir, path 前提）を洗い出した
- [x] `bytes -> bytes` API の最小仕様を文書化した

## 2. Phase 1: コア分離

- [x] form 依存を core から切り離した
- [x] 設定値を GUI 非依存モジュールへ移した
- [x] `path` API と `bytes` API を併存させた
- [x] 既存 GUI の最低限回帰を確認した

## 3. Phase 2: Pyodide PoC

- [x] frontend で Pyodide の初期化経路を実装した
- [x] `auto` モードで wasm 失敗時の backend フォールバックを実装した
- [x] Worker から Python 呼び出し経路を実装した（変換本体まで実装済み）
- [x] PMX 単体をダウンロードできる
- [ ] FastAPI なしでローカル動作する

## 4. Phase 3: 実用化

- [ ] ZIP 同梱方式（Python 側 or JS 側）を決めた
- [x] Worker で進捗通知が出る
- [x] キャンセル動作を定義した
- [x] エラー表示をユーザー向けに整えた

## 5. Phase 4: 公開運用

- [ ] GitHub Pages で動作確認できた
- [ ] 初回ロード時間を計測した
- [ ] 主要サンプルで変換劣化がないことを確認した
- [ ] 運用手順を docs に反映した
- [x] 公開時設定が Wasm 既定（backend fallback 無効）である

## 6. ローカル運用ルール

- [ ] 破壊的変更の前に必ずコミットする
- [ ] 懸念や不確定要素が出たら作業を止めて確認する
- [ ] Wasm 安定化後に backend 必須要件を外す判断をする

## 7. 完了条件

- [ ] main を壊さずに Wasm 経路を成立させた
- [ ] backend なしで変換が成立することを確認した
- [ ] フォーク先へ push する準備が整った
