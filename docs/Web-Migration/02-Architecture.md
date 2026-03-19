# Architecture

## 現状
- GUI中心の実行フロー。
- 変換コアは Python サービス層にあるが、一部で form 層依存が残る。

## 目標
- バックエンド: FastAPI
- フロントエンド: Vite + React + TypeScript
- 通信: multipart/form-data で VRM をアップロードし、PMX バイナリを返却

## 分離原則
- 変換コアは GUI に依存しない。
- API 層は I/O とエラーハンドリングのみを担当する。
- フロントは API 契約にのみ依存し、変換ロジックを持たない。
