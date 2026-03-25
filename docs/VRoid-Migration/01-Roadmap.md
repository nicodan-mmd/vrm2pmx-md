# Roadmap

## Goal

- 既存VRM変換の互換性を保ったまま、VRoid由来の変換ロジックを段階導入する。
- VRM0.x / VRM1.0 / VRoid を単一の自動判定フローで安定変換する。

## Phase 0: 仕様固定（1-2日）

1. 自動判定仕様（判定順序・フォールバック・ログ）を確定する。
2. 受け入れ条件を「非VRoid回帰ゼロ」を含めて固定する。
3. テスト対象サンプルセット（非VRoid/VRM1.0/VRoid）を固定する。

### Deliverables

- 自動判定仕様
- 受け入れ判定表
- サンプル一覧

## Phase 1: 判定レイヤー整理（2-3日）

1. メタデータ参照点を一覧化する。
2. 判定API（例: detect_profile）を設計する。
3. 変換本体から判定ロジックを分離する。

### Deliverables

- 判定API仕様
- 判定シーケンス図

## Phase 2: 共通化抽出（3-5日）

1. glTF/VRMバイナリ読込を共通化する。
2. 画像展開・accessor読取・テクスチャ出力処理を共通化する。
3. 既存generic経路を共通層に置換する。

### Deliverables

- 共通ユーティリティ一式
- generic回帰結果

## Phase 3: Profile境界導入（3-4日）

1. GenericProfile を明示化し責務を固定する。
2. Profile境界のI/Fを定義する。
3. 共通層との境界テストを追加する。

### Deliverables

- Profile I/F
- GenericProfile整理

## Phase 4: VRoid変換統合（4-7日）

1. ボーン・メッシュ・モーフ・剛体・姿勢補正を機能単位で移植する。
2. マッピング定義を config 側へ集約する。
3. VRM1.0/VRoid 特有分岐を profile 内に閉じる。

### Deliverables

- VRoidProfile最小実装
- 変換完走ログ

## Phase 5: frontend統合（2-3日）

1. UI変更最小で自動判定結果を表示する。
2. 判定不能時の案内を整備する。
3. 失敗時の再試行導線を確認する。

### Deliverables

- 自動判定結果表示
- 失敗案内UI

## Phase 6: 統合回帰と確定（2-3日）

1. 非VRoid既存成功ケースを最優先で回帰確認する。
2. VRM1.0/VRoidを含む統合回帰を完了する。
3. 本ドキュメント群を最終更新する。

### Deliverables

- 回帰結果レポート
- 最終チェック完了

## 依存関係

- Phase 1 depends on Phase 0
- Phase 2 depends on Phase 1
- Phase 3 depends on Phase 2
- Phase 4 depends on Phase 3
- Phase 5 depends on Phase 4
- Phase 6 depends on Phase 5

## マイルストーン判定

- M1: 判定仕様が固定され、判定不能時の扱いが決定済み
- M2: generic経路が共通層経由で回帰維持
- M3: VRoidProfile経路で変換完走
- M4: 非VRoid回帰と統合回帰がともに合格
