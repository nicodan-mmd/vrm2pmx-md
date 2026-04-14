# Scripts

ユーティリティスクリプトと運用タスク用のスクリプト群です。

## 構成

### `dump_pmx_header_bytes.py`

PMX ファイルの先頭バイト列を 16 進ダンプするデバッグ用スクリプトです。

**用途：**

- PMX ヘッダー（シグネチャ、バージョン、ヘッダーブロック）の確認
- Nim 出力と Python ベースラインの差分箇所を目視確認

**使用方法：**

```bash
python scripts/dump_pmx_header_bytes.py <pmx_path> [--bytes 96]
```

**出力例：**

```text
path=tmp/nim/out/avatar_nim.pmx
size=123456
00000000: 50 4d 58 20 ...
```

---

### `python_vrm_counters.py`

Python バックエンドによる VRM 変換の実行・カウント取得ライブラリです。
`multi_model_validation.py` や他スクリプトから共通ユーティリティとして `import` して使います。

**主要関数：**

- `run_python_conversion(vrm_path, num_runs)` → `ValidationRun` (頂点・面・ボーン・モーフ等のカウントを含む)
- `extract_pmx_counts(pmx_bytes)` → `dict` (PMX バイナリから各種カウントを抽出)

**直接実行：**

```bash
python scripts/python_vrm_counters.py <vrm_file> [--runs 3] [--output-dir tmp/]
```

---

### `test_vrm_counter.py`

`VrmCounterService` を直接呼び出し、既知ベースラインと照合するテスト用スクリプトです。

**用途：**

- VRM ファイルの頂点・面・ボーン・モーフ・材質数を素早く確認
- JSON ベースラインファイルと比較して回帰チェック

**使用方法：**

```bash
python scripts/test_vrm_counter.py <vrm_file> [--baseline-json <file>]
```

---

### `multi_model_validation.py`

ディレクトリを再帰的にスキャンして複数 VRM ファイルを一括変換・検証するスクリプトです。
`python_vrm_counters.py` を内部で使用します。

**用途：**

- 複数モデルに対して Python バックエンド変換を一括実行
- 変換時間・モデル統計を JSON レポート（タイムスタンプ付き）として保存

**使用方法：**

```bash
python scripts/multi_model_validation.py <vrm_dir> [--max 10] [--output-dir tmp/multi_model_validation]
```

**出力：**

- `tmp/multi_model_validation/validation_YYYYMMDD_HHMMSS.json`

---

### `nim_bitperfect_validation.py`

Nim 変換器のバイト一致検証用スクリプト。Python を確定的ベースラインとして PMX を生成し、Nim 出力と byte-by-byte で比較します。

**用途：**

- Python ベースライン PMX を生成・保存（SHA256 付き）
- Nim バイナリが出力した PMX との最初の差分オフセットを特定
- 差分オフセットを PMX セクション（ボーン/モーフ/剛体等）に位置付けて報告

**使用方法：**

```bash
# Python ベースラインのみ生成
python scripts/nim_bitperfect_validation.py <vrm_file> --output-dir tmp/nim/out

# Nim 出力と比較
python scripts/nim_bitperfect_validation.py <vrm_file> --nim-exe tmp/nim/pmx_lite_main.exe --output-dir tmp/nim/out
```

**出力：**

- `<output_dir>/<vrm_stem>_py_baseline.pmx`
- コンソールに差分サマリー JSON

---

### `nim_multi_bitperfect_probe.py`

`nim_bitperfect_validation.py` をベースに、ディレクトリ内の複数 VRM ファイルを一括してバイト一致プローブするスクリプトです。

**用途：**

- 複数モデルに対して Python ベースライン生成 → Nim 比較を自動化
- どのセクションで最初の差分が発生するかを全モデル横断で確認

**使用方法：**

```bash
python scripts/nim_multi_bitperfect_probe.py <vrm_dir> --nim-exe tmp/nim/pmx_lite_main.exe [--max 5]
```

**出力：**

- `tmp/nim/probe_YYYYMMDD_HHMMSS.json`

---

### `nim_comparison_runner.py`

Python バックエンドの変換時間・出力カウントを記録するパフォーマンス比較ランナーです。
（Nim 変換器との速度比較のベースライン収集用）

**用途：**

- Python バックエンドの変換を複数回実行して elapsed_ms を計測
- 頂点・面・ボーン・モーフ・材質・テクスチャ・剛体・ジョイント数を収集

**使用方法：**

```bash
python scripts/nim_comparison_runner.py <vrm_file> [--runs 3]
```

---

### `sentry/`

Sentry イベント収集・分析スクリプト。

#### `collect_stats.py`

品質シグナルイベットを集計し、統計レポートを生成します。

**用途：**

- Sentry に送信された品質シグナルイベント（quality_signal）を集計
- signal_code、signal_source、mode 別にグループ化
- signal_code × signal_source のマトリクスを作成
- JSON レポートを生成

**使用方法：**

```bash
python scripts/sentry/collect_stats.py
```

**前提条件：**

- `sentry-cli` がインストール済み
- Sentry 認証情報が設定済み（`~/.sentryclirc` または `SENTRY_AUTH_TOKEN` 環境変数）

**出力：**

- 統計をコンソールに表示
- JSON レポートを `docs/Sentry-Reports/` に保存（タイムスタンプ付きファイル名）

### `rust_compare_backend.py`

Rust移行の比較記録用に、backend基準の変換時間と出力ZIP情報を
`docs/Rust-Conversion/Comparisons/` へ保存します。

**用途：**

- backend `/api/convert` を複数回実行し時間を記録
- 1回分のZIPを artifacts に保存
- SHA256 と ZIP エントリ情報を JSON/Markdown で records に保存

**使用方法：**

```bash
python scripts/rust_compare_backend.py --input "D:/path/to/model.vrm" --sample linlin --warmup 1 --runs 3
```

**出力：**

- `docs/Rust-Conversion/Comparisons/records/<sample>_YYYYMMDD_HHMMSS.json`
- `docs/Rust-Conversion/Comparisons/artifacts/<sample>_YYYYMMDD_HHMMSS.zip`

---

### `compare_pmx_materials.py`

Web 版と既存ローカル版（例: vroid2pmx）の PMX 出力を、材質単位で比較する JSON レポート生成スクリプトです。

**用途：**

- 材質名ごとの差分確認
- 色テクスチャ / sphere / toon 参照の比較
- 両面フラグや影フラグの比較
- 頂点数や色係数の差分確認

**使用方法：**

```bash
python scripts/compare_pmx_materials.py <reference_pmx> <candidate_pmx> [output_json]
```

**出力：**

- コンソールに JSON を表示
- 第3引数を指定した場合は JSON ファイルを保存

**想定例：**

```bash
python scripts/compare_pmx_materials.py baseline_vroid2pmx.pmx web_output.pmx tmp/compare_materials.json
```

**主な比較項目：**

- `texture_path`
- `sphere_texture_path`
- `toon_texture_path`
- `flag` / `flags`
- `diffuse_color`
- `alpha`
- `edge_size`
- `vertex_count`

---

## Notes

- すべての Python スクリプトは Python 3.10+ で実行される想定です。
- 認証トークンは `.gitignore` で保護されたローカル設定使用推奨
- `run_socket_scan.ps1`（PowerShell）: Socket.dev CLI を使ってプロジェクト依存関係のセキュリティスキャンをローカル実行します。`-ApiKey <key>` でAPIキーを渡します（省略時は `SOCKET_API_KEY` 環境変数を参照）。
