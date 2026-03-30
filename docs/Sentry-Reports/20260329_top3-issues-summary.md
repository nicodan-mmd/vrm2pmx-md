<!-- markdownlint-disable MD024 MD034 MD060 -->

# Sentry Top 3 Issues Summary (2026-03-29)

対象プロジェクト: `nicodan/vrm_to_pmx_converterr`
抽出条件: `is:unresolved`, `sort=freq`
取得日時: 2026-03-29

## 結論（先に対応すべき順）

1. **VRM_TO_PMX_CONVERTERR-A (54件)**
   `convert.quality_signal.user_reported.PMX_MISSING_COLOR_TEXTURES`
2. **VRM_TO_PMX_CONVERTERR-H (45件)**
   `Error: PythonError: Traceback (most recent call last):`
3. **VRM_TO_PMX_CONVERTERR-B (15件)**
   `convert.quality_signal.user_reported.PARTIAL_CONVERSION_HINT`

上位3件で合計 **114件**。未解決の総報告の大半を占めるため、ここを優先すると効果が高い。

## 上位3件の意味（何の問題か）

## 1) VRM_TO_PMX_CONVERTERR-A

- 件数: 54
- レベル: info
- URL: [Issue 7363547311](https://nicodan.sentry.io/issues/7363547311/)
- 何が起きているか:
  ユーザー報告ベースで「PMX の色テクスチャが欠落して見える」ことを示す品質シグナル。
- 実害:
  変換処理自体は完走していても、出力の見た目品質が低下する。ユーザー体感の不具合として認識されやすい。
- 切り分け観点:
  テクスチャ参照解決、マテリアル生成、ZIP 出力時の相対パス/ファイル名の整合性を優先確認。

## 2) VRM_TO_PMX_CONVERTERR-H

- 件数: 45
- レベル: error
- URL: [Issue 7370376415](https://nicodan.sentry.io/issues/7370376415/)
- 何が起きているか:
  Python 側で例外トレースバックが発生し、変換処理そのものが失敗しているエラー。
- 実害:
  変換完了前に中断する可能性があり、ユーザーが成果物を得られない。
- 切り分け観点:
  例外の先頭スタック（最初に発火したフレーム）を確認し、入力モデル条件・依存ライブラリ・I/O 周りのどこで落ちるかを特定する。

## 3) VRM_TO_PMX_CONVERTERR-B

- 件数: 15
- レベル: info
- URL: [Issue 7363547439](https://nicodan.sentry.io/issues/7363547439/)
- 何が起きているか:
  ユーザー報告ベースで「部分変換になっている可能性」を示す品質シグナル。
- 実害:
  一部のメッシュ/材質/ボーンなどが欠ける、または期待どおりに変換されない可能性がある。
- 切り分け観点:
  失われる要素の傾向（特定モデル・特定マテリアル・特定機能）を集約し、再現モデルを固定して比較検証する。

## 参考: 取得した生データ（上位3件）

1. VRM_TO_PMX_CONVERTERR-A
   title: convert.quality_signal.user_reported.PMX_MISSING_COLOR_TEXTURES
   count: 54
   level: info
   first_seen: 2026-03-25T17:33:23.382Z
   last_seen: 2026-03-29T11:12:44.342Z
2. VRM_TO_PMX_CONVERTERR-H
   title: Error: PythonError: Traceback (most recent call last):
   count: 45
   level: error
   first_seen: 2026-03-28T07:43:33.378Z
   last_seen: 2026-03-29T11:47:56.49Z
3. VRM_TO_PMX_CONVERTERR-B
   title: convert.quality_signal.user_reported.PARTIAL_CONVERSION_HINT
   count: 15
   level: info
   first_seen: 2026-03-25T17:33:23.379Z
   last_seen: 2026-03-29T10:33:48.694Z

## 次アクション案

1. H の最新イベント詳細から、共通スタックパターンを 1 つに絞って修正着手。
2. A/B は「品質シグナル」として同一再現モデル群でまとめて検証し、再現率の高い条件を先に潰す。
3. 修正後に同クエリ (`is:unresolved sort:freq`) で件数推移を日次確認する。

## 着手前合意（2026-03-29）

既存モデルを壊さない方針を最優先に、以下の順で対応する。

1. A/B は非破壊・後方互換優先で修正する。
2. H は「最低限 PMX として成立する要素が揃うなら続行」を目標に、停止条件を厳格化する。
3. 送信データのファイル名は、ユーザー明示同意（チェックボックス）でのみ送信する。

## A 対応方針（PMX_MISSING_COLOR_TEXTURES）

### Aの目的

- VRM から PMX への色テクスチャ参照が欠落しないようにする。

### 重点確認ポイント

1. VRM 側のテクスチャ参照解決ロジックが仕様どおりか。
2. マテリアル変換時に、色テクスチャ参照が途中で欠落していないか。
3. ZIP 出力時のファイル名・相対パス・大文字小文字差異で参照切れが起きていないか。

### 非破壊条件

1. 既存で正常表示されるモデルの出力を変えない。
2. 既存のマテリアル設定を上書きせず、補完は「不足時のみ」に限定する。

### 再現基準ケース（2026-03-29 確定）

1. Issue: [7363547311](https://nicodan.sentry.io/issues/7363547311/)
2. 症状: PMX 側でスカートが欠ける（色テクスチャ欠落の見え方）
3. 直近イベント例: `704b0793747845e1a9c057a8820e4d62`
4. このケースを A 修正の回帰確認基準（Before/After 比較）として固定する。

### 2026-03-30 追加判明事項

1. 最新イベントでは ZIP 内に 48 個のテクスチャが存在し、blob fetch も成功していた。
2. それでも `pmx_preview_diagnostics.colorTextureCount=0` だったため、A は少なくとも一部が誤判定だった。
3. 原因は、MMDLoader が材質を返した直後は色テクスチャ読込が未完了で、従来の `hasTextureImageData()` 判定では 0 件に見えていたこと。
4. 修正として、PMX 診断を「参照あり / 読込済み / 読込保留中」に分離し、短時間の読込待機後に評価するよう変更した。
5. あわせて `map` / `emissiveMap` / `matcap` には画像の読込完了を待たず `SRGBColorSpace` を設定するよう修正した。
6. これで A が再発する場合は、誤判定ではなく実際の表示崩れとして次段の調査対象に切り分ける。

### 2026-03-30 実崩れ調査の計測追加

1. `pmx_preview_diagnostics` に材質レンダリング情報を追加した。
2. 追加項目: `side`, `transparent`, `alphaTest`, `depthWrite`, `depthTest`, `opacity`, `meshRenderOrder`, `hasMap`, `hasAlphaMap`。
3. 収集対象は先頭 64 材質までで、次回イベントから Sentry 側で「片面化 / 透過順 / 深度書き込み」起因の崩れを切り分け可能。

### 2026-03-30 透明反映補正の結果（issue 7363608280）

1. 最新イベント: `e52aceccdbce43d386ab6805b7dd5cdf`。
2. `materialRenderSamples` の再集計で `sampleCount=19`, `transparent=15`, `mapTransparent=15`。
3. `CLOTH` 材質は 8 件あり、8 件すべて `tr=1` へ変化（補正前は `tr=0`）。
4. 見た目が「少し変わった」ことと一致しており、エプロン欠けに対して透明反映補正が有効に作用している。
5. なお完全一致まで未達の場合は、次段で `depthWrite` と描画順 (`renderOrder`) の調整に進む。

## B 対応方針（PARTIAL_CONVERSION_HINT）

### Bの目的

- 部分変換の原因を減らしつつ、回避不能な差分（VRM と PMX の仕様差）を可視化する。

### 修正方針

1. 変換失敗で欠落した要素を分類して、フォールバック可能なものは救済する。
2. 救済不能な要素は警告として明示し、出力は継続する。

### 傾向分析（追加する観測軸）

1. 欠落カテゴリ: mesh / material / bone / morph / physics / constraint
2. 原因カテゴリ: 参照解決失敗 / 未対応仕様 / 入力破損 / 実行時例外
3. モデル傾向: 同一モデル再発率、同系統モデルの再現率

### 方針上の前提

- VRM と PMX の仕様差で表現不能な要素はゼロにはできない。
- その場合は「何が欠けたか」を明示して、最低限成立する PMX を返す。

## H 対応方針（PythonError）

### Hの目的

- 例外で即中断せず、PMX として成立可能な最低要素がある場合は変換を続行する。

### 最低成立条件（暫定）

1. モデル頂点/面が最低限出力可能
2. 主要ボーン（センター系など）が最低限構築可能
3. PMX ファイルとして構造破綻しない

### 実装方針

1. 致命エラーと非致命エラーを分離する。
2. 非致命エラーは記録して継続、致命エラーのみ停止する。
3. 継続時は warning を明示して、何をスキップしたかを出力に残す。

## 送信フォーム変更方針（ファイル名送信）

### UI 変更

1. 報告フォームに「ファイル名を送信する」チェックボックスを追加する。
2. デフォルトは **未チェック** とする。
3. 説明文を追加する:
   「公開モデルの場合、検証可能性が上がります。」

### 送信ルール

1. チェックありの場合のみ、ファイル名（basename のみ）を送信する。
2. チェックなしの場合は、従来どおりファイル名を送信しない。
3. フルパスは送信しない。

## 実装順（合意）

1. A: 参照ロジック確認と補完（非破壊優先）
2. B: 修正 + 傾向データの観測軸追加
3. H: 非致命エラー継続化（最低成立条件を満たす範囲）
4. フォーム: ファイル名送信チェックボックス追加（デフォルト未チェック）
