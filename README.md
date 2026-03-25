# vrm2pmx-md (Modernized)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![three.js](https://img.shields.io/badge/three.js-0.183-black?logo=threedotjs&logoColor=white)](https://threejs.org)
[![three-stdlib](https://img.shields.io/badge/three--stdlib-2.36-black)](https://github.com/pmndrs/three-stdlib)
[![@pixiv/three-vrm](https://img.shields.io/badge/@pixiv%2Fthree--vrm-3.5-ff69b4)](https://github.com/pixiv/three-vrm)
[![Pyodide](https://img.shields.io/badge/Pyodide-0.29-3572A5)](https://pyodide.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-deployed-brightgreen?logo=github)](https://pages.github.com)

[English](./README_en.md) | 日本語

## About

[miu200521358](https://github.com/miu200521358) さんの [vrm2pmx](https://github.com/miu200521358/vrm2pmx) をモダナイズしたVRM→PMX変換ツールです。

- **T/A ポーズ変換機能**
- **ブラウザ上でのプレビュー機能**
- **VRM 0.0 対応** (VRM 1.0は現在表示のみ)

## GitHubPages URL

[VRM to PMX Converter](https://nicodan-mmd.github.io/vrm2pmx-md/)

## VRM と PMX について

3Dモデルのファイル形式（フォーマット）」です。
VRMとPMXは、それぞれの拡張子です。

VRM: [VRoid Studio](https://vroid.com/studio)
VRoid Studio などで出力される、プラットフォーム非依存の3Dアバター向けフォーマット。

PMX: [MikuMikuDance](https://sites.google.com/view/vpvp/)
MikuMikuDance (MMD) で利用されるモデルデータフォーマット。

## 技術スタック

- 言語
  - [Python](https://www.python.org/)
  - [TypeScript](https://www.typescriptlang.org/)

- Webアプリ化
  - [Vite](https://vitejs.dev/) — ビルドツール
  - [React](https://react.dev/) — UI フレームワーク

- Java Script Library
  - [three.js](https://threejs.org/) — 3D レンダリング
  - [three-stdlib](https://github.com/pmndrs/three-stdlib) — MMDLoader
  - [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) — VRM モデル読み込み

- Wasm (Web Assembly)
  - [Pyodide](https://pyodide.org/) — ブラウザ上での Python 実行

## History

1.0 - VRM 0.0 表示・変換、VRM 1.0 表示のみ対応
1.1 - 細かい不具合、動作調整、レポート機能実装

## 謝辞

有用なリポジトリを公開していただいた [miu200521358](https://github.com/miu200521358)さん、世界中のツール、ライブラリ開発者に感謝いたします。

## オリジナルのREADME

vrm(glb) を pmx（準標準ボーンまで）に変換するツール
