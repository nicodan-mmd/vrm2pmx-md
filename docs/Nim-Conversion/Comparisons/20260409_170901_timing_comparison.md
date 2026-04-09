# Frontend Timing Comparison (2026-04-09 17:09)

## Settings

- Search path: `D:\Users\maedashingo\Downloads\MMD\VRoid`
- Nim exe: `D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\vrm2pmx-md\tmp\nim\pmx_lite_main.exe`
- Wasm: `D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\vrm2pmx-md\frontend\public\nim\vrm2pmx_nim_runtime.wasm`
- Models: 26

## Results

Elapsed times are wall-clock milliseconds for a single conversion run.

| Model | VRM size | Python ms | Python PMX | Nim-exe ms | Nim-exe PMX | Wasm ms | Wasm PMX | Nim-exe speedup | Wasm speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AvatarSample_A | 18.48 MB | 7095 | 4.36 MB | 494 | 4.36 MB | 187 | 4.36 MB | 14.4x | 37.9x |
| AvatarSample_A_1.0 | 18.48 MB | 6959 | 4.36 MB | 501 | 4.36 MB | 174 | 4.36 MB | 13.9x | 40.0x |
| AvatarSample_M | 20.32 MB | 7518 | 4.50 MB | 544 | 4.50 MB | 177 | 4.50 MB | 13.8x | 42.5x |
| NicoDanBoy | 10.64 MB | 5847 | 3.92 MB | 311 | 3.92 MB | 133 | 3.92 MB | 18.8x | 44.0x |
| NicoDanBoy_20260306 | 11.02 MB | 5653 | 3.95 MB | 332 | 3.95 MB | 124 | 3.95 MB | 17.0x | 45.6x |
| 1899578487613238293 | 15.86 MB | 7967 | 4.61 MB | 631 | 4.61 MB | 193 | 4.61 MB | 12.6x | 41.3x |
| 3800391986853067029 | 1.29 MB | - | - | 326 | 871.6 KB | 76 | 871.6 KB | - | - |
| 8211396565083486995 | 370.6 KB | 568 | 169.6 KB | 78 | 169.7 KB | 25 | 169.7 KB | 7.3x | 22.7x |
| 8538742828286332800 | 17.62 MB | 8470 | 4.72 MB | 659 | 4.72 MB | 162 | 4.72 MB | 12.9x | 52.3x |
| 9119730241296603838 | 18.47 MB | 6799 | 3.15 MB | 541 | 3.15 MB | 154 | 3.15 MB | 12.6x | 44.1x |
| 7229542656829083947 | 16.15 MB | 8804 | 4.97 MB | 655 | 4.97 MB | 186 | 4.97 MB | 13.4x | 47.3x |
| 514340979744949531 | 543.6 KB | - | - | 183 | 398.3 KB | 42 | 398.3 KB | - | - |
| 4590875026920364234 | 1.40 MB | - | - | 349 | 1.14 MB | 71 | 1.14 MB | - | - |
| 8954518223473550154 | 18.52 MB | 9191 | 5.04 MB | 668 | 5.04 MB | 198 | 5.04 MB | 13.8x | 46.4x |
| AvatarSample_C | 14.88 MB | 7624 | 4.33 MB | 472 | 4.33 MB | 162 | 4.33 MB | 16.2x | 47.1x |
| mod | 16.09 MB | - | - | 583 | 1.68 MB | 146 | 1.68 MB | - | - |
| NicoDanBoy | 11.02 MB | 5759 | 3.95 MB | 334 | 3.95 MB | 131 | 3.95 MB | 17.2x | 44.0x |
| AvatarSample_A | 18.48 MB | 7863 | 4.36 MB | 543 | 4.36 MB | 191 | 4.36 MB | 14.5x | 41.2x |
| AvatarSample_A | 18.48 MB | 7796 | 4.36 MB | 542 | 4.36 MB | 199 | 4.36 MB | 14.4x | 39.2x |
| mod | 23.51 MB | - | - | 758 | 2.25 MB | 193 | 2.25 MB | - | - |
| AvatarSample_A | 18.48 MB | 7223 | 4.36 MB | 483 | 4.36 MB | 176 | 4.36 MB | 15.0x | 41.0x |
| AvatarSample_A | 18.48 MB | 7153 | 4.36 MB | 506 | 4.36 MB | 183 | 4.36 MB | 14.1x | 39.1x |
| 超かぐや姫！酒寄彩葉「水色の描」 | 21.29 MB | 8898 | 4.97 MB | 652 | 4.97 MB | 213 | 4.97 MB | 13.6x | 41.8x |
| 8831901753414439164 | 8.80 MB | 5634 | 3.31 MB | 412 | 3.30 MB | 143 | 3.30 MB | 13.7x | 39.4x |
| プロレスラー_リンリン | 21.94 MB | 11671 | 6.65 MB | 959 | 6.65 MB | 261 | 6.65 MB | 12.2x | 44.7x |
| 和風リメイクあかおに | 18.65 MB | 7727 | 3.32 MB | 696 | 3.32 MB | 160 | 3.32 MB | 11.1x | 48.3x |

## Summary

- Avg Python: 7249 ms
- Avg Nim-exe: 524 ms
- Avg Nim-exe speedup: **13.8x**
- Avg Wasm: 168 ms
- Avg Wasm speedup: **43.1x**
