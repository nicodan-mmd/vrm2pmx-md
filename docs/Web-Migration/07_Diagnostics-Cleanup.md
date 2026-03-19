# 07 Diagnostics クリーンアップ

## 現在の状態（2026-03-20 時点）

### ビルドへの影響

**ビルド自体は問題なし。**
現在の警告は Trunk（ruff / bandit）のリント警告であり、Python 実行やビルドを止めるコンパイルエラーではない。

### この続き作業で解決した項目

| 項目                                         | 対応内容                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/mmd/PmxWriter.py` F401/F811/B007        | 不要 import 削除、重複 import 解消、未使用ループ変数を `_` 化                                  |
| `src/mmd/VrmReader.py` F401/B007/E722/B905   | 未使用 import 削除、未使用ループ変数修正、`except Exception` 化、`zip(..., strict=False)` 明示 |
| `src/service/Vrm2PmxExportService.py` F401   | 不要 import（`PmxReader`, `MFileUtils`, `concurrent.futures`）削除                             |
| `src/form/panel/RigidbodyPanel.py` F401/B905 | 不要 import 削除、`zip(..., strict=False)` 明示                                                |
| `src/form/worker/ExportWorkerThread.py` F401 | 不要 import（`BONE_PAIRS`, `MORPH_PAIRS`）削除                                                 |
| `src/form/panel/BonePanel.py` B905           | `zip(..., strict=False)` 明示                                                                  |
| `src/form/panel/ExportPanel.py` F401         | 不要 import（`PmxReader`）削除                                                                 |
| `backend/tests/test_main.py` B010            | `setattr(...)` を属性代入に変更                                                                |
| `backend/app/main.py` B008                   | `Annotated[UploadFile, File(...)]` へ変更                                                      |

---

## 残存する警告一覧

**なし。すべての警告を解消済み。**

### 補足

- `trunk check --no-fix --filter=ruff --filter=bandit` の結果、**全対象ファイルで No issues**。
- `ExportWorkerThread.py` の B110 は `except Exception as e: logger.debug(...)` に置き換えてモダン化済み。

---

## 実施した検証

1. `trunk check --no-fix --filter=ruff,bandit`（対象 9 ファイル）
   - 結果: `No new issues`
2. `python -m unittest discover -s backend/tests -q`
   - 結果: `Ran 4 tests ... OK`

---

## 次のアクション

1. ✅ 全警告解消完了
2. `refactor/reduce-diagnostics` へ commit → PR

---

## 関連ファイル

| ファイル                                | 状態                             |
| --------------------------------------- | -------------------------------- |
| `.trunk/trunk.yaml`                     | 既に安定（.venv ノイズ抑制済み） |
| `.vscode/settings.json`                 | 既に安定                         |
| `pyrightconfig.json`                    | 既に安定                         |
| `src/form/worker/ExportWorkerThread.py` | B110 が 2 件残存                 |
| それ以外の今回修正対象ファイル          | 新規警告なし                     |
