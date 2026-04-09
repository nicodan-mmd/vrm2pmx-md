Gemini さんへの報告・相談（2026-04-08）

【検証結果サマリー】

Case A（方向A：セグメント拡張）の検証:
✓ 実装完了: segment 22→23, 27→28, 56→57 に factor64 直結を追加
✓ ビルド成功
✓ 新モデル（Akiaoni, Kaguyahime, AvatarM, NicoDanBoy）でも Case A Nim 出力を生成成功
❌ 効果なし: Rinrin/Avatar では Case A = 前回（61→62 のみ）と IDENTICAL
🎯 結論: segments 22/27/56 は、少なくとも Rinrin/Avatar/独立テストモデルでは非活性

Direction B（方向B：演算構造深掘り）- 案6 の検証:
✓ 実装完了: Bdef2 weight0 固定 + weight1 残差処理
✓ ビルド成功
❌ 効果なし: Rinrin/Avatar で first_diff 位置が変わらず（233505/262284）
🎯 結論: 残差計算では bit-perfect に達しない

【現在の first_diff 位置】
- Rinrin:  233505 bytes (変化なし)
- Avatar:  262284 bytes (変化なし)

【質問】

1. **first_diff 位置の意味**
   233505 と 262284 という byte offset は PMX バイナリのどこに対応しているのか？
   （頂点頭？骨部？モーフ部？）
   この offset を逆算して、実際に何が異なっているか（骨 index か weight 値か）を特定できれば、次の施策が見つかると推測します。

2. **次の最適化の優先順位**
   a) これ以上セグメント単位の調整は不要？
   b) むしろ Bdef4（複数ウェイト）側の正規化に問題があるか？
   c) 全体の weight merge/trim ロジックを見直すべき？

3. **bit-perfect 到達への見通し**
   - 現在の改善: 元の baseline から +4+ bytes（61→62 のみでもらった分）
   - 残り差分: 数百バイト（233505 の offset まで到達）
   - 最後の 1-4 byte の 1 ULP 差を埋めるには、どのレベルの修正が必要とお考えですか？

【現在のコード状態】
- Nim: Case A（4-segment, factor64）+ Case 6（Bdef2 残差処理）実装済み
- ビルド: ✓ success
- 任意の時点で revert 可能


待ちます。