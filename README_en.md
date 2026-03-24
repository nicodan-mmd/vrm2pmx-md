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

[Japanese](./README.md) | English

## About

A modernized VRM→PMX conversion tool based on [vrm2pmx](https://github.com/miu200521358/vrm2pmx) by [miu200521358](https://github.com/miu200521358).

- **T-Pose/A-Pose Conversion**
- **In-browser Preview**
- **VRM 0.0 Support** (VRM 1.0 display only at this time)

## GitHub Pages

[VRM to PMX Converter](https://nicodan-mmd.github.io/vrm2pmx-md/)

## About VRM and PMX

File formats for 3D models.

**VRM**: [VRoid Studio](https://vroid.com/studio)
A platform-independent 3D avatar file format output by VRoid Studio.

**PMX**: [MikuMikuDance](https://sites.google.com/view/vpvp/)
A model data format used in MikuMikuDance (MMD).

## Tech Stack

- Languages
  - [Python](https://www.python.org/)
  - [TypeScript](https://www.typescriptlang.org/)

- Web Application
  - [Vite](https://vitejs.dev/) — Build tool
  - [React](https://react.dev/) — UI framework

- JavaScript Libraries
  - [three.js](https://threejs.org/) — 3D rendering
  - [three-stdlib](https://github.com/pmndrs/three-stdlib) — MMDLoader
  - [@pixiv/three-vrm](https://github.com/pixiv/three-vrm) — VRM model loading

- WebAssembly (Wasm)
  - [Pyodide](https://pyodide.org/) — Python execution in the browser

## History

1.0 - VRM 0.0 display & conversion, VRM 1.0 display only

## Credits

We would like to thank [miu200521358](https://github.com/miu200521358) for sharing the useful repository and all the tool and library developers around the world.

## Original README

Tool to convert vrm(glb) to pmx (up to standard bones)
