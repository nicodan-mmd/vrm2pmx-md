@echo off
rem --- 
rem ---  vmdデータのトレースモデルを変換
rem --- 

rem ---  カレントディレクトリを実行先に変更
cd /d %~dp0

cls

if exist ".venv\Scripts\python.exe" (
	.venv\Scripts\python.exe src\executor.py --out_log 1 --verbose 20 --is_saving 1
) else (
	python src\executor.py --out_log 1 --verbose 20 --is_saving 1
)

if errorlevel 1 (
	echo 起動に失敗しました。Python と依存ライブラリの状態を確認してください。
	exit /b 1
)

