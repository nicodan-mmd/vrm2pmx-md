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

- 2026-04-12 (models=28, timing)
  - モデル探索パス: D:\Users\maedashingo\Downloads\MMD\VRoid
  - 記録(JSON): 20260412_175514_timing_comparison.json
  - 記録(MD): 20260412_175514_timing_comparison.md
  - 結果要約: Avg Python=6572 ms, Avg Nim-exe=1368 ms (4.8x), Avg Wasm=149 ms (44.2x)
  - 補足: Python は 2 モデルで失敗のため平均は 26 モデルベース
- 2026-04-12 (models=28, bit-perfect probe)
  - モデル探索パス: D:\Users\maedashingo\Downloads\MMD\VRoid
  - 記録(JSON): 20260412_175624_bitperfect_probe.json
  - 記録(MD): 20260412_175624_bitperfect_probe.md
  - 結果要約: total=28, ok=26, bit_perfect=0, non_bit_perfect=26, errors=2, ratio=0.0%
  - エラー対象: Release\0.1.0.0\mod.vrm, original\VRM2PMX\mod.vrm
- 2026-04-12 (safe rebuild check)
  - モデル: D:\Users\maedashingo\Downloads\MMD\VRoid\original\AvatarSample_A.vrm
  - 記録(JSON): ..\..\tmp\nim\safe_rebuild_report_avatarA.json
  - 結果要約: outputs_equal=false, replaced_reference=false（不一致検知で参照 exe 保護）
  - 補足: `python scripts/nim_safe_rebuild_check.py "<model.vrm>" [--replace-reference]`
- 2026-04-07 (runs=10)
  - モデル: D:\Users\maedashingo\Downloads\MMD\VRoid\Booth\プロレスラー リンリン\プロレスラー\_リンリン.vrm
  - 記録(JSON): 20260407*180130*プロレスラー\_リンリン\_nim-validation.json
  - 記録(MD): 20260407*180130*プロレスラー\_リンリン\_nim-validation.md
  - 結果要約: counts_stable=true, elapsed_ms[min/max/mean]=21216/22585/21536.6
- 2026-04-07 (runs=3)
  - モデル: D:\Users\maedashingo\Downloads\MMD\VRoid\Booth\プロレスラー リンリン\プロレスラー\_リンリン.vrm
  - 記録(JSON): 20260407*175348*プロレスラー\_リンリン\_nim-validation.json
  - 記録(MD): 20260407*175348*プロレスラー\_リンリン\_nim-validation.md
  - 補足: 20260407_175002 は頂点集計ロジック修正前のため参考扱い
