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
