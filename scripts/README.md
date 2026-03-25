# Scripts

ユーティリティスクリプトと運用タスク用のスクリプト群です。

## 構成

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

**出力例：**
```
Quality Signal Events: 8

--- By Signal Code ---
  THREE_CLOCK_DEPRECATED: 4
  THREE_TIMER_MIGRATION_WARNING: 4

--- By Signal Source ---
  user_reported: 4
  auto_detected: 4

--- Signal Code x Signal Source Matrix ---
  THREE_CLOCK_DEPRECATED:
    auto_detected: 2
    user_reported: 2
```

**将来の拡張：**
- GitHub Actions での定期実行（日次/週次）
- Sentry Discover との統合
- レポートの可視化（HTML ダッシュボード）

---

## Notes

- すべてのスクリプトは Python 3.10+

で実行される想定です
- 認証トークンは `.gitignore` で保護されたローカル設定使用推奨
