# Metrics Plan (Output Counts + Time)

## 1. 何を数えるか

変換結果 PMX から以下を抽出し、Python/Nim の両方で保存する。

- vertices: 頂点数
- faces: 面インデックス数（または三角面数）
- bones: ボーン数
- morphs: モーフ数
- materials: 材質数
- textures: テクスチャ数
- rigidbodies: 剛体数
- joints: ジョイント数

加えて以下を計測する。

- elapsed_ms: 変換全体の処理時間
- stage_ms: 可能なら主要ステージ別時間

## 2. 比較ルール

- 同じ入力ファイルを Python と Nim で実行し、JSON で保存する
- 差分は ratio と delta の両方を記録する
- 頂点数は最重要監視項目とする

### 比率定義

- ratio = nim_value / py_value
- delta = nim_value - py_value

## 3. 失敗条件（PoC 初期）

- py_vertices > 0 かつ nim_vertices / py_vertices > 1.05
- py_bones > 0 かつ abs(nim_bones - py_bones) / py_bones > 0.01
- py_morphs > 0 かつ abs(nim_morphs - py_morphs) / py_morphs > 0.01

上記いずれかで Nim 経路を失敗扱いにし、Python へフォールバックする。

## 4. 記録フォーマット

1 ファイル 1 実行で JSON 保存する。CSV は使わない。

推奨キー:

- input_name
- requested_mode
- actual_mode
- fallback_reason
- elapsed_ms
- counts.py
- counts.nim
- diff.ratio
- diff.delta
- timestamp

## 5. 実装メモ

- 比較ロジックは UI ではなく変換パイプライン側に置く
- UI には結果サマリのみ表示し、詳細は JSON に残す
- 異常検出時はユーザーに「Nim を停止して Python で継続した」旨を明示する
