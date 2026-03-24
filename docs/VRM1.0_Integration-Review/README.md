# VRM1.0 Integration Review

更新日: 2026-03-24

関連ドキュメント:
- [Implementation Task Breakdown](Implementation-Task-Breakdown.md)

## 目的
- 現在の `vrm2pmx`（VRM0.x中心）に対して、`vroid2pmx` の知見を将来的に統合できるかを事前調査する。

## 調査対象
- 現行リポジトリ: `vrm2pmx`
- 参照リポジトリ: `~/_MyDocument/Dev/GitHub/vroid2pmx/vroid2pmx`

## 結論（要約）
- 統合は可能。
- ただし「そのままマージ」ではなく、共通基盤化 + プロファイル分離（generic / vroid）で段階的に進めるのが安全。
- 理由: 両リポジトリとも `extensions["VRM"]` 前提コードが多く、VRM1.0 (`VRMC_vrm`) を直接扱う統一実装にはなっていないため。

## 事実ベースの確認結果

### 1. `vrm2pmx` は変換コアで VRM0.x 構造を参照
- `src/mmd/VrmReader.py:546`
  - `extensions["VRM"]["materialProperties"]` を参照
- `src/mmd/VrmReader.py:850`
  - `extensions["VRM"]["blendShapeMaster"]` を参照
- `src/mmd/VrmReader.py:854`
  - `blendShapeGroups` を走査
- `src/service/Vrm2PmxExportService.py:46`
  - `VrmReader.convert_glTF(...)` を中核として実行

### 2. フロント表示（プレビュー）は VRM0/1 を両方見る分岐あり
- `frontend/src/App.tsx:245`
  - VRM0 (`extensions.VRM.humanoid.humanBones`) 分岐
- `frontend/src/App.tsx:262`
  - VRM1 (`extensions.VRMC_vrm.humanoid.humanBones`) 分岐
- ただしこれは表示補助ロジックであり、変換本体の 1.0 完全対応を意味しない。

### 3. `vroid2pmx` も中核は `extensions["VRM"]` 前提
- `src/service/VroidExportService.py:2982` `create_model`
  - `extensions["VRM"]["exporterVersion"]` を参照
- `src/service/VroidExportService.py:3040`
  - `is_vroid1 = True`（VRoid Studio 1.x 判定フラグ）
- `src/service/VroidExportService.py:1048`
  - `extensions["VRM"]["blendShapeMaster"]` を参照
- `src/service/VroidExportService.py:176`
  - `extensions["VRM"]["secondaryAnimation"]` を参照
- つまり `vroid2pmx` は「VRoid向け最適化された実装」であり、`VRMC_vrm` ベースの汎用 VRM1.0 変換器ではない。

## 統合観点の評価

### 良い点（統合しやすい）
- クラス構成が近い（Reader / ExportService / PmxModel 系）。
- glTF バッファ読み取り、アクセサ展開、材質・モーフ構築などの責務分割が類似。
- 既存 `vrm2pmx` Web API に mode 追加で機能切替しやすい。

### 注意点（統合時リスク）
- 同名パッケージ（`mmd`, `module`, `utils`）の衝突。
- VRoid固有処理（髪・衣装・物理の命名前提）が generic 変換に混ざると保守性低下。
- 既存 API 契約のシンプルさを維持するには、変換モードの明示分離が必要。

## 推奨アーキテクチャ（段階統合）

### Phase 0: 方針固定
- 変換モードを明示化: `generic` / `vroid`
- 現行挙動を `generic` として固定（非破壊）

### Phase 1: 共通基盤抽出
- glTF 読み出し、画像抽出、アクセサ読み取りを共通ユーティリティへ分離
- 既存 `VrmReader` と `VroidExportService` の重複を縮約

### Phase 2: プロファイル分離
- `GenericProfile`（現行）
- `VroidProfile`（vroid2pmx由来ロジック）
- API は `mode` で選択

### Phase 3: VRM1.0 本対応
- `VRMC_vrm` / `VRMC_springBone` を明示的に読み分け
- 0.x/1.0 を extension ベースで自動判定

## 最終コメント
- 「統合可能か？」への回答は Yes。
- ただし現時点の両実装は共に `extensions["VRM"]` 依存が強く、まずは共通化とモード分離を先に行うのが最小リスク。
- すぐに着手しない前提なら、次回は Phase 0/1 の設計メモ（インターフェース定義）から始めるのが効率的。
