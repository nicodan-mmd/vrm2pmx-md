# Frontend Toggle Plan (Nim Checkbox)

## 目的

- 実験機能として Nim 経路を明示的に ON/OFF できるようにする
- 既存 UX を壊さず、失敗時は自動で Python 経路に戻す

## UI 方針

- 既存のチェックボックス群（Log 付近）に Nim を追加
- ラベル案: "Nim (Experimental)"
- デフォルトは OFF

## 挙動

- OFF: これまでどおり Python 経路
- ON: requestedMode=nim で実行開始
- Nim 実行不可または品質ゲート不合格時:
  - actualMode=python
  - fallbackReason に理由を設定

## ログ・表示

- 実行結果に次を必ず含める
  - requestedMode
  - actualMode
  - fallbackReason (ある場合)
- UI には短い結果メッセージを表示
  - 例: "Nim failed quality gate (vertices_ratio=1.23), fallback to Python"

## 受け入れ条件

- チェックボックス ON/OFF が変換リクエストに反映される
- Nim 失敗時に処理中断せず完走し、Python 経路で出力される
- 出力メトリクス JSON に mode 情報と count diff が残る
