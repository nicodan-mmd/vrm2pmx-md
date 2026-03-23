# Phase 0 Inventory

この文書は、Wasm 移行 Phase 0 の実測結果を固定化するための棚卸しメモです。

## 実施日

- 2026-03-23

## 1. GUI依存 import の確認結果

### 直接的な阻害点

1. backend が form 層の定数へ依存
- `backend/app/main.py`
- `from form.panel.BonePanel import BONE_PAIRS, RIGIDBODY_PAIRS`

2. 変換コアが form 層の定数へ依存
- `src/mmd/VrmReader.py`
- `from form.panel.BonePanel import MORPH_PAIRS`

### 補足

- `src/form/**` 配下の相互 import は GUI 層内依存なので、Wasm コア分離の主対象は上記 2 点。

## 2. FS依存（path/temp/zip）確認結果

### backend 側

- `backend/app/main.py`
  - `tempfile.mkdtemp` による一時ディレクトリ作成
  - `input_path.open("wb")` で実ファイル保存
  - `zipfile.ZipFile` で ZIP 作成
  - `FileResponse` でファイル返却

### 変換コア側

- `src/service/Vrm2PmxExportService.py`
  - `self.options.vrm_model.path` と `self.options.output_path` の path 前提
  - `PmxWriter().write(..., output_path)` のファイル出力前提

- `src/mmd/VrmReader.py`
  - `self.file_path` 読み込み前提
  - `output_pmx_path` を基準に `tex` / `glTF` ディレクトリを作成
  - 画像展開や JSON 出力で複数のファイル書き込み

## 3. 最小 bytes API 仕様（Phase 0 固定）

## 3.1 目的

- 既存 path ベース API を保持したまま、Wasm 実行向けに bytes ベース API を追加する。

## 3.2 提案インターフェース

```text
convert_vrm_bytes(
  vrm_bytes: bytes,
  bone_config: dict[str, Any] | None = None,
  physics_config: dict[str, Any] | None = None,
  morph_config: dict[str, Any] | None = None,
  package_mode: Literal["pmx", "zip"] = "pmx",
) -> ConvertResult

ConvertResult:
  pmx_bytes: bytes
  assets: list[AssetFile]  # package_mode == "zip" のとき使用
  logs: list[LogEvent]
```

```text
AssetFile:
  path: str         # 例: tex/foo.png
  data: bytes
  mime_type: str | None
```

## 3.3 段階導入

1. Step A
- `package_mode="pmx"` のみ実装し、`pmx_bytes` を返す。

2. Step B
- `assets` を返せるようにして `zip` 生成責務を分離する。
- ZIP 生成は Python 側と JS 側のどちらでも成立する設計にする。

## 4. 懸念事項（要確認で停止条件）

1. `src/mmd/VrmReader.py` は画像展開や中間ファイル出力を前提としており、bytes 化の影響範囲が広い。
2. `MORPH_PAIRS` を form から参照しているため、先に共通設定モジュール化が必要。
3. tex 同梱まで一気に進めると差分が大きくなるため、まず PMX 単体出力で分割実装する。

## 5. Phase 1 着手タスク

1. 設定定数の移設
- `BONE_PAIRS`, `RIGIDBODY_PAIRS`, `MORPH_PAIRS` を GUI 非依存モジュールへ移動

2. backend import 切替
- `backend/app/main.py` の form 依存を除去

3. core import 切替
- `src/mmd/VrmReader.py` の form 依存を除去

4. 変換 entrypoint 追加
- `bytes -> bytes` API の最小実装（PMX 単体）

## 6. Phase 1 進捗（2026-03-23）

- 完了: 設定定数の移設
  - `src/config/default_pairs.py` を追加
  - `backend/app/main.py` の定数参照を config へ切替
  - `src/mmd/VrmReader.py` の定数参照を config へ切替

- 完了: `bytes -> bytes` の最小エントリポイント追加
  - `src/service/Vrm2PmxBytesService.py` を追加
  - `convert_vrm_bytes(...) -> bytes` を実装（PMX 単体）

- 完了: 最低限テスト
  - `backend/tests/test_bytes_service.py` を追加
  - `backend/tests` の全テスト通過を確認

- 完了: 既存 GUI の最低限回帰確認
  - `python -c` で `form.panel.BonePanel` import と定数参照を確認

## 7. Phase 2 着手（2026-03-23）

- 完了: frontend に Wasm 実行モードの分岐を追加
  - `frontend/src/services/convertClient.ts`
  - backend / wasm の切替実行経路を追加

- 完了: ハイブリッド自動フォールバックを追加
  - 実行モード `auto` を追加（wasm 優先、失敗時 backend フォールバック）
  - フォールバック理由をメッセージと JSON ログに出力

- 完了: Worker 経由の Wasm 実行土台を追加
  - `frontend/src/workers/convertWorker.ts` を追加
  - `frontend/src/wasm/workerClient.ts` を追加
  - `frontend/src/services/convertClient.ts` の Wasm 経路を Worker 呼び出しへ切替

- 完了: Wasm 実変換ブリッジの初版を追加
  - `frontend/scripts/sync_py_src.mjs` で Python コアソースを `frontend/public/py_src` に同期
  - Worker 内で `convert_vrm_bytes(...)` を呼び出す経路を実装
  - `src/utils/MLogger.py` の `cython` 依存を任意化

- 完了: Pyodide 初期化経路を追加
  - `frontend/src/wasm/pyodideRuntime.ts`
  - `App.tsx` から Wasm モード時に初期化を呼び出す構成へ変更

- 既知懸念（継続監視）
  - `npm run build` は成功するが、`pyodide.mjs` 起因で Node built-in externalize 警告が出る
  - 次段で Worker 化する際に CDN import 方式との比較が必要

## 8. 実ファイルベンチ（2026-03-23）

### 実行環境

- ローカル Python (`convert_vrm_bytes`, `.venv`)
- 計時: `time.perf_counter`
- メモリ計測: `tracemalloc`（tracemalloc使用時は計測オーバーヘッドで処理時間が大幅増加するため、時間とメモリは別計測）

### ファイル①: 和風リメイクあかおに.vrm

| 項目 | 値 |
|---|---|
| input_bytes | 18,650,692 (17.7 MB) |
| output_bytes | 3,318,594 (3.2 MB) |
| elapsed_sec | **6.447** |
| 結果 | 成功 |

### ファイル②: プロレスラー_リンリン.vrm

| 項目 | 値 |
|---|---|
| input_bytes | 21,938,004 (20.9 MB) |
| output_bytes | 6,652,871 (6.3 MB) |
| elapsed_sec | **9.038** |
| peak_memory_mb | **182.6 MB** (tracemalloc 計測) |
| 結果 | 成功 |

### スケーリング観測

- サイズ比 20.9 / 17.7 ≒ 1.18 倍 → 処理時間 9.0 / 6.4 ≒ 1.41 倍（ほぼリニア）
- メモリピーク ~183 MB（20.9 MB ファイル時）
  - ファイルサイズの約 8.7 倍がピーク使用量の目安
  - 50 MB ファイルは概算で ~430 MB ピーク、処理時間 ~22秒 と推定
  - tracemalloc オーバーヘッドにより実時間はこの値より短い可能性あり

### 追加対応

- `src/service/Vrm2PmxExportService.py` の `logging.basicConfig` 形式を `%(message)s` に変更
- 目的: 実測時に `module_name` 欠落で大量に出る logging error ノイズを抑制
