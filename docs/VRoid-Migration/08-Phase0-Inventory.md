# Phase 0 Inventory

## 目的

- 実装前に事実ベースで判定条件・対象範囲・回帰基準を固定する。

## 1. 前提確認

- VRM1.0 読み込みは成立済み
- 主対象は変換ロジック
- UIモード切替ボタンは追加しない
- 非VRoid既存変換は必須互換対象

## 2. 判定キー棚卸し（現時点）

- [x] extensions.VRM
	- 根拠: src/mmd/VrmReader.py で extensions["VRM"] を参照
- [x] extensions.VRMC_vrm
	- 根拠: frontend/src/features/preview/lib/glbPose.ts で VRMC_vrm を参照
- [ ] extensions.VRMC_springBone
	- 現時点では参照点未確認（要追加調査）
- [x] humanoid関連配置
	- 判定候補として採用（詳細キーは判定API設計時に固定）
- [x] expression/blendShape関連配置
	- 根拠: src/mmd/VrmReader.py で blendShapeMaster / blendShapeGroups を参照
- [ ] 補助メタデータ（ベンダー/生成ツール等）
	- 補助キーとして利用可否を要検討

## 3. サンプルセット棚卸し（記入用）

- 現状: リポジトリ内に .vrm サンプルファイルは未配置（2026-03-25時点の探索結果）
- 方針: 回帰対象サンプルは外部保管場所を指定して管理する
- 次アクション: 非VRoid/VRM1.0/VRoid それぞれ最低2件の入力パスを確定する
- 補足: D:/Users/maedashingo/Downloads/MMD/VRoid 配下の .vrm は 25件を確認
- 補足: D:/Users/maedashingo/Downloads/MMD 全体では .vrm 30件、うちパス上で非VRoid候補 5件を確認
- 管理ファイル: docs/VRoid-Migration/sample-set-20260325.json

### 非VRoid VRM（既存成功ケース）
- [x] sample-nv-01: D:/Users/maedashingo/Downloads/MMD/opensourceavatars.com/CosmicPerson.vrm
- [x] sample-nv-02: D:/Users/maedashingo/Downloads/MMD/Model_/ユニティちゃん/UnityChan/UnityChan.vrm
- [x] sample-nv-03: D:/Users/maedashingo/Downloads/MMD/Model/ずんだもん/ずんだもん2025モデルセット_ver.A1/ずんだもん2025モデルセット ver.A1/VRM/Zundamon_2025_VRM09A.vrm

### VRM1.0
- [x] sample-10-01: D:/Users/maedashingo/Downloads/MMD/VRoid/original/v1.0/AvatarSample_A.vrm
- [x] sample-10-02: D:/Users/maedashingo/Downloads/MMD/Model/ずんだもん/ずんだもん2025モデルセット_ver.A1/ずんだもん2025モデルセット ver.A1/VRM/Zundamon_2025_VRM10A.vrm
- [x] 予備: D:/Users/maedashingo/Downloads/MMD/VRoid/original/AvatarSample_A_1.0.vrm

### VRoid
- [x] sample-vr-01: D:/Users/maedashingo/Downloads/MMD/VRoid/Booth/プロレスラー リンリン/プロレスラー_リンリン.vrm
- [x] sample-vr-02: D:/Users/maedashingo/Downloads/MMD/VRoid/VRoid Hub/仮面ライダーブルーアイズ/4590875026920364234.vrm

### パス補正メモ

- 入力文字列中で重複していた `4590875026920364234.vrm...` は実在パスへ補正済み

## 4. 回帰基準値（初期案）

- PMX出力: pass/fail
- ボーン数: baseline からの乖離は Soft Warn。表示成立を優先する
- メッシュ数: baseline から乖離なし（原則）
- 主要モーフ数: baseline から乖離なし（原則）
- 備考: 許容差の導入が必要な場合は、対象サンプルごとに理由付きで明示する
- 備考: ボーン欠損単体では停止しない。モデル破綻または表示不能の場合のみ停止対象

## 5. 判定不能時ポリシー（要確定）

- 候補A: generic固定で継続
- 候補B: 明示エラーで停止
- 決定: 候補A（generic固定で継続）
- 理由: エラーレポート基盤があるため、表示成立を優先して前進し、異常はレポートで追跡する

## 5.1 実装中の停止・確認ルール

- 非VRoid既存成功ケースで「PMX生成不能」「表示不能」「モデル破綻」が出たら実装を停止して確認する。
- 判定ロジック変更で影響範囲が拡大した場合は実装を停止して確認する。
- フォールバック方針を変更する場合は、変更前に確認する。

## 6. Phase 0 完了条件

- [x] 判定仕様確定
- [x] サンプルセット確定（暫定）
- [x] 回帰基準確定
- [x] ロールバック条件確定
