# Nim Comparison Records

このディレクトリは Nim PoC の比較結果 JSON を保存する。

## ルール

- 1 実行につき 1 JSON
- ファイル名は日時 + 入力名 + mode
- 例: 20260407_221500_avatarA_nim.json

## 最低限含める項目

- input_name
- requested_mode
- actual_mode
- fallback_reason
- elapsed_ms
- counts.py
- counts.nim
- diff.ratio
- diff.delta

## 目的

- 頂点爆増などの異常を後追いで検証できるようにする
- 速度改善と品質維持の両立を履歴で追跡できるようにする

## 実行履歴

- 2026-04-07 (runs=10)
  - モデル: D:\Users\maedashingo\Downloads\MMD\VRoid\Booth\プロレスラー リンリン\プロレスラー_リンリン.vrm
  - 記録(JSON): 20260407_180130_プロレスラー_リンリン_nim-validation.json
  - 記録(MD): 20260407_180130_プロレスラー_リンリン_nim-validation.md
  - 結果要約: counts_stable=true, elapsed_ms[min/max/mean]=21216/22585/21536.6
- 2026-04-07 (runs=3)
  - モデル: D:\Users\maedashingo\Downloads\MMD\VRoid\Booth\プロレスラー リンリン\プロレスラー_リンリン.vrm
  - 記録(JSON): 20260407_175348_プロレスラー_リンリン_nim-validation.json
  - 記録(MD): 20260407_175348_プロレスラー_リンリン_nim-validation.md
  - 補足: 20260407_175002 は頂点集計ロジック修正前のため参考扱い
