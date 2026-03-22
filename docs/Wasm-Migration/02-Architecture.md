# Architecture

## 現状

- 変換コアは Python サービス層にある。
- API/GUI の一部で form 層定数に依存が残る。
- I/O は実ファイルと一時ディレクトリを前提としている。

## 目標

- ランタイム: Browser + Pyodide + Web Worker
- UI: Vite + React + TypeScript
- 変換契約: `VRM bytes + options -> PMX bytes (+ assets)`

## 論理構成

1. UI Layer
- ファイル選択、設定入力、進捗表示、ダウンロード

2. Worker Layer
- Pyodide 初期化、Python 呼び出し、メッセージ受け渡し

3. Python Core Layer
- 変換ロジック本体
- GUI 非依存
- `bytes` 入出力 API

4. Packaging Layer
- PMX 単体出力または ZIP 出力

## 分離原則

- form 配下の型や定数を変換コアへ import しない。
- core はパス解決責務を持たない。
- UI は Python 実装詳細を知らず、Worker 契約のみを利用する。

## 将来拡張

- 高速化が必要なら、Python Core を Rust/C++ で段階置換する。
- 置換時も Worker 契約を保ち、UI 変更を最小化する。
