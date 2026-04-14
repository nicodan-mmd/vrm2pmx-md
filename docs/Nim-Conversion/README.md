# Nim Conversion Notes

このディレクトリは、vrm2pmx の変換速度向上 PoC を Nim で検証するための計画・比較記録を管理する。

Rust PoC で発生した課題（頂点数の爆増と変換時間増大）を再発防止しつつ、Python 実装との互換性を維持したまま段階的に検証する。

Rust 経路は現時点の検証結果を踏まえて非推奨扱いとし、継続検証は Nim 経路を優先する。

## 目的

- Nim 経路を実験モードとして追加し、既存 Python 経路は安全なフォールバックとして維持する
- 速度改善だけでなく、出力品質を「要素数メトリクス」で必ず検証する
- フロントエンドに Nim 切替チェックボックスを追加し、明示的に検証可能にする

## ドキュメント構成

- 01-Roadmap.md: フェーズ計画とゲート条件
- 02-Metrics-Plan.md: 出力要素数の比較仕様（骨・モーフ・頂点など）
- 03-Frontend-Toggle.md: Nim チェックボックス導入方針
- Comparisons/README.md: 比較記録の保存ルールと実行履歴
- Comparisons/20260412_175514_timing_comparison.md: 28 体の timing 比較（Python/Nim-exe/Wasm）
- Comparisons/20260412_175624_bitperfect_probe.md: 28 体の bit-perfect probe 結果

## 最新計測

- フロントエンド 3 レーン速度比較 (2026-04-10): [Comparisons/20260410_002518_timing_comparison.md](Comparisons/20260410_002518_timing_comparison.md)
  - JSON: [Comparisons/20260410_002518_timing_comparison.json](Comparisons/20260410_002518_timing_comparison.json)
  - 要約: 26 モデル平均で Python 5727 ms / Nim-exe 458 ms / Wasm 129 ms、Wasm は Python 比 44.3x
- Python 版との差分・bit-perfect 再計測 (2026-04-10): [Comparisons/20260410_0019_bitperfect_probe.md](Comparisons/20260410_0019_bitperfect_probe.md)
  - JSON: [Comparisons/20260410_0019_bitperfect_probe.json](Comparisons/20260410_0019_bitperfect_probe.json)
  - 要約: 26 モデル中 ok=24 / bit-perfect=5 / errors=2、bit-perfect 率は 20.8%
  - 改善点: `左つま先` の bone flag が Python `0x0002` に対して Nim `0x0003` になっていた問題を修正し、AvatarSample_A 系 4 件と プロレスラー_リンリン が bit-perfect に復帰
  - 切り分け結果: Nim-exe と Wasm は同一 PMX を出力しており、フロントエンド化そのものは回帰原因ではない
  - 残差傾向: 非一致 19 件は bone 差分が中心で、一部モデルは vertex 差分も残る

次の目標は、multi-model bit-perfect 率を 80% 超まで引き上げること。

## 参考メモ

- プロジェクト外メモ: D:\Users\maedashingo\Documents_MyDocument\Dev_MyWork\vrm2pmx-md\Material\Note\Nim-Convertion.txt
- 反映済み要点:
  - バイナリ構造体のアライメントずれ防止（packed 指定）
  - リトルエンディアン厳守
  - JS 側メモリを直接参照するゼロコピー志向

## 成功条件（PoC）

- 主要ケースで Python 比の変換時間が短縮される
- 出力 PMX の要素数差分が許容範囲内である
- 頂点数が異常増加した場合は自動で検出し、Nim 経路を失敗扱いでフォールバックできる

## 安全ビルド運用（既存 exe を壊さない）

Nim ソースの修正中は、既存の参照 exe（`src/nim/pmx_lite_main.exe`）を直接置換しない。

1. 候補 exe をビルドする
2. 同一入力モデルで 参照 exe / 候補 exe を両方実行する
3. 出力 PMX の SHA256 が一致した時だけ置換する

実行コマンド:

```powershell
python scripts/nim_safe_rebuild_check.py "D:\Users\maedashingo\Downloads\MMD\VRoid\original\AvatarSample_A.vrm" --report-json tmp/nim/safe_rebuild_report_avatarA.json
```

- 終了コード `0`: 参照出力と一致
- 終了コード `2`: 不一致（置換禁止）
- JSON レポート: `tmp/nim/safe_rebuild_report_*.json`

置換を許可する場合（一致時のみ）:

```powershell
python scripts/nim_safe_rebuild_check.py "<model.vrm>" --replace-reference
```

この運用により「ビルドは通るが挙動が壊れる」ケースで参照 exe が守られる。
