# Sentry 品質シグナル集計整理メモ

作成日: 2026-03-25

## 背景

本アプリでは、変換が正常終了していても見た目に問題がありそうなケースを検知し、Sentry に送信する運用を行っている。

この品質系イベントを後から集計しやすくするため、Sentry のイベント設計を整理した。

## 今回の目的

以下を満たすことを目的として実装を見直した。

- 正常終了時の品質リスクイベントを Sentry 上で集計しやすくする
- エラー監視用イベントと品質シグナルイベントを論理的に分離する
- ブラウザ内完結の方針を維持しつつ、送信時にユーザー確認ダイアログを出す
- 将来、release 単位で改善傾向を比較できるようにする

## release とは何か

Sentry における release は、「どの版のアプリで発生したイベントか」を示す識別子である。

例:

- vrm2pmx-web@1.0
- vrm2pmx-web@1.1

これを付けることで、以下の比較がしやすくなる。

- 特定の品質シグナルがどの版で増減したか
- フォールバック件数が改修後に減ったか
- 自動検知シグナルの傾向が版ごとにどう変わったか

## 実装前の課題

従来は品質系イベントの event_type が用途ごとに分散していた。

- dict_candidate
- quality_auto_detection
- quality_feedback

この状態では、Sentry 側で「品質イベント全体」をまとめて扱いづらく、集計軸が安定しなかった。

また、複数シグナルを 1 イベントの context にまとめているだけだと、signal 単位の件数比較がしづらかった。

## 今回の整理方針

品質系イベントの event_type を quality_signal に統一した。

その上で、集計用タグを以下に固定した。

- event_type=quality_signal
- signal_source=fallback | auto_detected | user_reported
- signal_code=品質シグナルの識別子
- mode=ユーザー要求モード
- used_mode=実際に使われた変換モード
- backend_enabled=true | false
- file_extension=zip | pmx
- result=送信理由の補助分類

さらに、1 回の変換で複数シグナルがある場合は、signal_code ごとに個別イベントを送るようにした。

これにより、Sentry 側で以下のような集計がしやすくなった。

- signal_code ごとの件数
- signal_source ごとの傾向
- release ごとの比較
- mode ごとの偏り

## 実装内容

### 1. release の共通化

フロントエンドのアプリ版と Sentry release を共通定数として切り出した。

対象:

- frontend/src/constants/appInfo.ts

内容:

- APP_VERSION を共通化
- VITE_SENTRY_RELEASE があればそれを優先
- 未設定時は vrm2pmx-web@{APP_VERSION} を既定値に使用

### 2. Sentry 初期化への release 追加

対象:

- frontend/src/main.tsx

内容:

- Sentry.init に release を追加

### 3. 品質シグナル送信 helper の追加

対象:

- frontend/src/App.tsx

内容:

- quality signal 用の共通 helper を追加
- signal_code の正規化処理を追加
- 変換単位の識別子 conversionReportId を追加

signal_code は以下のように正規化する。

- 英数字以外を _ に変換
- 先頭末尾の _ を除去
- 大文字化

例:

- deprecated-runtime-message -> DEPRECATED_RUNTIME_MESSAGE
- three-clock-deprecated -> THREE_CLOCK_DEPRECATED

### 4. fallback イベントの整理

対象:

- frontend/src/App.tsx

内容:

- 従来の dict_candidate を廃止
- event_type=quality_signal に統一
- signal_source=fallback を付与
- fallbackReason を signal_code 化して送信
- 送信後の report dialog は維持

### 5. 自動検知イベントの整理

対象:

- frontend/src/App.tsx

内容:

- 従来の quality_auto_detection を廃止
- event_type=quality_signal に統一
- signal_source=auto_detected を付与
- 検知された signal ごとに個別イベント送信
- 送信後の report dialog は維持

### 6. 手動報告イベントの整理

対象:

- frontend/src/App.tsx

内容:

- 従来の quality_feedback を廃止
- event_type=quality_signal に統一
- signal_source=user_reported を付与
- 自動検知 signal があればそれを使い、なければ fallbackReason または user-reported-visual-issue を使う
- 送信後の report dialog は維持

### 7. 設定例の追記

対象:

- frontend/.env.example

内容:

- VITE_SENTRY_RELEASE の例を追加

## 変更したファイル

- frontend/src/constants/appInfo.ts
- frontend/src/main.tsx
- frontend/src/App.tsx
- frontend/.env.example
- docs/Sentry-Operation/README.md

## 動作確認結果

実施内容:

- TypeScript エラーチェック
- frontend ビルド

結果:

- 型エラーなし
- npm run build 成功

補足:

- Pyodide 由来の Vite 警告は表示されたが、今回の変更起因ではなく build 自体は成功した

## 運用上の注意

### 1. fallbackReason は現状まだ自由文に近い

今回は signal_code 化して集計しやすくしたが、安定運用するなら最終的には backend/worker 側で理由コードを返す形が望ましい。

理想例:

- WASM_RUNTIME_ERROR
- MORPH_BINDS_EMPTY_SKIP
- RIGIDBODY_OTHERS_FALLBACK

### 2. 高カーディナリティ値は送らない

以下は送らない方針を維持する。

- ファイル名
- ファイルパス
- モデル名
- ユーザー名
- 元データ本文

### 3. 品質イベントとエラーイベントは分けて見る

アラート対象は error 系を中心にし、quality_signal はダッシュボード集計用途として扱うのがよい。

## 今後の改善候補

- fallbackReason の完全な理由コード化
- Sentry Discover 用の保存クエリ作成
- release ごとの signal_code 比較ダッシュボード作成
- signal_source と used_mode を軸にした週次集計の整備
