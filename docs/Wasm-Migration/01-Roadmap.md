# Roadmap

## Goal

- サーバー常設なしで、VRM から PMX 変換をブラウザ上で完結させる。
- GitHub Pages に静的配信しても機能する構成を成立させる。
- 移行中は main ブランチを壊さない。

## Phase 0: 設計固定（1-2日）

1. GUI 依存の棚卸しを実施する。
2. ファイルパス依存 I/O と bytes I/O の境界を定義する。
3. 変換結果の最小成果物を `result.pmx` 単体に固定する。

### Deliverables

- 依存一覧（GUI/FS/外部ライブラリ）
- `bytes -> bytes` 変換の設計メモ

## Phase 1: コア分離（3-5日）

1. 変換コアから form 層依存を除去する。
2. 設定値を GUI から独立した設定モジュールへ移す。
3. `path` ベース API を `bytes` ベース API と併存させる。

### Deliverables

- ローカル Python で `bytes -> bytes` が動作
- 既存 GUI の回帰確認（最小）

## Phase 2: Pyodide PoC（3-5日）

1. frontend で Pyodide のロードを実装する。
2. Python モジュールをブラウザ側にロードし変換を実行する。
3. 変換結果を Blob ダウンロードできるようにする。

### Deliverables

- ブラウザ上で `result.pmx` ダウンロード成功
- FastAPI なしでローカル動作

## Phase 3: 実用化（4-7日）

1. tex 出力の同梱方式を決定する（Python 側 ZIP か JS 側 ZIP）。
2. Web Worker 化して UI フリーズを回避する。
3. 進捗表示、キャンセル、エラー表示を整備する。

### Deliverables

- `result.pmx + tex/` を ZIP で取得可能
- 長時間処理でも UI が応答する

## Phase 4: 公開運用（2-3日）

1. GitHub Pages 用の build/deploy を確立する。
2. 初回ロード時間を計測し、許容目標を設定する。
3. 運用ドキュメントを整備する。
4. バックエンドを必須経路から外し、必要時のみ補助経路として扱う。

### Deliverables

- GitHub Pages で再現可能
- docs の手順のみで開発環境を再現可能

## マイルストーン判定

- M1: Python ローカルで `bytes -> bytes` 成立
- M2: ブラウザで PMX 単体出力成立
- M3: ZIP 同梱と Worker 化成立
- M4: GitHub Pages 運用成立
