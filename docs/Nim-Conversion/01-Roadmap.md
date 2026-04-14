# Nim Conversion Roadmap

<!-- markdownlint-disable MD024 -->

## Phase 0: 計測基盤の固定

- Python 現行経路で比較用メトリクスを出力できる状態を作る
- 比較対象の最小セットを決める
  - 頂点数
  - 面数
  - ボーン数
  - モーフ数
  - 材質数
  - テクスチャ数
- 変換時間計測の開始点/終了点を固定する

### Gate

- 同一入力で 3 回実行してメトリクス取得が安定する

## Phase 1: フロントの Nim 切替導入

- UI に Nim チェックボックスを追加する（既存 Log チェックボックス近傍）
- 変換リクエストに requestedMode=nim を含める
- 実行ログに requestedMode / actualMode / fallbackReason を残す

### Gate

- Nim ON/OFF が UI とログで一致して確認できる

## Phase 2: Nim PoC 最小実装

- 一番重い頂点処理の一部を Nim 化して呼び出す
- バイナリ境界のルールを固定する
  - packed
  - little-endian
  - pointer/zero-copy 優先
- 失敗時は Python 経路へフォールバックする

### Gate

- 代表モデルで Python 経路と同等に変換完了する

## Phase 3: 品質ゲート（頂点爆増の再発防止）

- Python 基準値との比率チェックを追加する
- 頂点数の急増をハードエラーとして検出する
- 乖離が閾値超過した場合に Nim 経路を無効化してフォールバックする

### 初期閾値（PoC）

- vertices_ratio = nim_vertices / py_vertices
- vertices_ratio > 1.05 で失敗（要見直し）
- bones_ratio, morphs_ratio は 1.00 を理想、暫定許容は ±1%

### Gate

- 頂点爆増ケースを意図的に再現し、検出・フォールバックが機能する

## Phase 4: 速度評価と継続判断

- 代表ケースで処理時間短縮率を測る
- 品質ゲートを満たした上での短縮率で採用可否を決める

### 採用判断の目安

- 品質ゲート全通過
- 主要ケース中央値で 20% 以上短縮（目安）
