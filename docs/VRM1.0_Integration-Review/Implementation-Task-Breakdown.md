# VRM1.0 Integration Task Breakdown

更新日: 2026-03-24

## 目的

- `vrm2pmx` に対して、将来的に `vroid2pmx` の知見を安全に統合できる形へ段階移行する。
- 既存の VRM0.x 変換の安定性を崩さず、VRM1.0 対応の足場を作る。

## 完了条件（Definition of Done）

- 変換モード `generic` / `vroid` の実行分離ができる。
- 既存 VRM0.x サンプルは回帰しない。
- 最低1つ以上の VRM1.0 サンプルで変換成功（暫定品質で可）。
- API と UI にモード選択が反映される。
- README に対象範囲と制約が明記される。

## 実装フェーズ

### Phase 0: 設計固定（短期）

- 目的: 手戻りを防ぐため、インターフェースを先に決める。
- タスク:

  1. 変換モード仕様を決める（`generic` / `vroid` / 将来 `auto`）
  2. API 入出力契約を決める（mode 追加時の後方互換）
  3. 失敗時エラーコード・メッセージ規約を決める

- 成果物:

  - `docs/VRM1.0_Integration-Review/API-Mode-Contract.md`
  - `docs/VRM1.0_Integration-Review/Error-Handling-Policy.md`

### Phase 1: 共通基盤抽出（中期）

- 目的: `vrm2pmx` と `vroid2pmx` の重複ロジックを共通化する。
- タスク:

  1. glTF/VRM バイナリ読み出しユーティリティを抽出
  2. 画像展開（`images`, `bufferViews`）を共通化
  3. accessor 読み取り（POSITION/NORMAL/UV/JOINTS/WEIGHTS）を共通化
  4. テクスチャ出力パス生成とファイル配置を共通化

- 候補配置:

  - `src/service/convert/common/` 配下に `glb_io.py`, `accessor_reader.py`, `texture_extractor.py`

- 成果物:

  - 共通ユーティリティ一式
  - 既存ロジック差し替え PR

### Phase 2: プロファイル分離（中期）

- 目的: ドメイン固有処理を分離し、保守性を確保する。
- タスク:

  1. 変換エントリを `ConverterProfile` インターフェース化
  2. `GenericProfile`（現行 `vrm2pmx` ロジック）実装
  3. `VroidProfile`（`vroid2pmx` 由来）実装
  4. API で mode に応じてプロファイルを選択

- 目安インターフェース:

  - `prepare_model()`
  - `convert_bones()`
  - `convert_mesh()`
  - `convert_morphs()`
  - `post_process()`

- 成果物:

  - `src/service/convert/profiles/` 配下の実装
  - `backend/app/main.py` mode 受け取り対応

### Phase 3: VRM1.0 データ読み分け（中〜長期）

- 目的: VRM0.x 依存から脱却し、1.0 を正式に扱う。
- タスク:

  1. extension 判定の共通化（`VRM` / `VRMC_vrm` / `VRMC_springBone`）
  2. humanoid 参照の統一 API 化
  3. morph / expression の読み分け対応
  4. 物理情報（springBone 相当）の取り扱い方針決定

- 成果物:

  - バージョン判定ユーティリティ
  - 0.x/1.0 互換マッパ

### Phase 4: テスト・回帰保証（継続）

- 目的: 統合後の品質を担保する。
- タスク:

  1. スモークテストセット作成（VRM0.x, VRM1.0, VRoid1.x）
  2. 変換成功判定（PMX 出力有無、メッシュ数、ボーン数）
  3. API レベルの回帰テスト（mode別）
  4. 既知失敗ケースのゴールデンログ化

- 成果物:

  - `backend/tests/` へのケース追加
  - テスト実行手順書

## 優先度付きバックログ

### P0（先にやる）

1. mode 仕様の固定
2. API 契約定義
3. 共通 GLB I/O の抽出

### P1（次にやる）

1. Profile インターフェース導入
2. GenericProfile へ既存処理移設
3. VroidProfile の最小移植

### P2（後追い）

1. VRM1.0 expression/springBone 深掘り
2. 自動判定 `auto` 導入
3. UI で mode 選択 UX 改善

## リスクと緩和策

- リスク: 同名モジュール衝突（`mmd`, `module`, `utils`）

  - 緩和: `service/convert/` 配下へ新規名前空間を作成し、直接混在を避ける。

- リスク: VRoid 固有処理が generic 側に漏れる

  - 緩和: Profile 境界で禁止し、共通層はデータ取得だけに限定。

- リスク: 既存 Web API 互換破壊

  - 緩和: `mode` は省略時 `generic` をデフォルトにする。

## 初回着手の具体アクション（着手時チェックリスト）

1. `backend/app/main.py` に mode パラメータの受け口だけ先に追加（実装は generic 固定）。
2. `src/service/convert/common/` を作成し、GLB JSON と BIN 取り出し処理を移動。
3. 既存 `VrmReader` から共通関数を呼ぶように置換。
4. ここまでで一度回帰テスト。

## メモ

- 現時点では「すぐ統合」ではなく「統合可能性を担保する設計先行」が最適。
- まずは Phase 0〜1 を終えてから、Phase 2 で vroid2pmx ロジックの取り込み判断を再評価する。
