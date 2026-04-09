# Nim Conversion Notes

このディレクトリは、vrm2pmx の変換速度向上 PoC を Nim で検証するための計画・比較記録を管理する。

Rust PoC で発生した課題（頂点数の爆増と変換時間増大）を再発防止しつつ、Python 実装との互換性を維持したまま段階的に検証する。

## 目的

- Nim 経路を実験モードとして追加し、既存 Python 経路は安全なフォールバックとして維持する
- 速度改善だけでなく、出力品質を「要素数メトリクス」で必ず検証する
- フロントエンドに Nim 切替チェックボックスを追加し、明示的に検証可能にする

## ドキュメント構成

- 01-Roadmap.md: フェーズ計画とゲート条件
- 02-Metrics-Plan.md: 出力要素数の比較仕様（骨・モーフ・頂点など）
- 03-Frontend-Toggle.md: Nim チェックボックス導入方針
- Comparisons/README.md: 比較記録の保存ルール

## 最新計測

- フロントエンド 3 レーン速度比較 (2026-04-09): [Comparisons/20260409_170901_timing_comparison.md](Comparisons/20260409_170901_timing_comparison.md)
  - JSON: [Comparisons/20260409_170901_timing_comparison.json](Comparisons/20260409_170901_timing_comparison.json)
  - 要約: 26 モデル平均で Python 7249 ms / Nim-exe 524 ms / Wasm 168 ms、Wasm は Python 比 43.1x
- Python 版との差分・bit-perfect 再計測 (2026-04-09): [Comparisons/20260409_1716_bitperfect_probe.md](Comparisons/20260409_1716_bitperfect_probe.md)
  - JSON: [Comparisons/20260409_1716_bitperfect_probe.json](Comparisons/20260409_1716_bitperfect_probe.json)
  - 要約: 26 モデル中 ok=21 / bit-perfect=0 / errors=5、現状 bit-perfect 率は 0.0%
  - 傾向: first diff は after_vertex 側が多く、vertex 差分も一部残る

次の目標は、multi-model bit-perfect 率を 80% 超まで引き上げること。

## 参考メモ

- プロジェクト外メモ: D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\Material\Note\Nim-Convertion.txt
- 反映済み要点:
  - バイナリ構造体のアライメントずれ防止（packed 指定）
  - リトルエンディアン厳守
  - JS 側メモリを直接参照するゼロコピー志向

## 成功条件（PoC）

- 主要ケースで Python 比の変換時間が短縮される
- 出力 PMX の要素数差分が許容範囲内である
- 頂点数が異常増加した場合は自動で検出し、Nim 経路を失敗扱いでフォールバックできる
