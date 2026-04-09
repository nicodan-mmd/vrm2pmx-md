# Frontend Timing Comparison (2026-04-10 00:25)

## Settings

- Search path: `D:\Users\maedashingo\Downloads\MMD\VRoid`
- Nim exe: `D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\vrm2pmx-md\tmp\nim\pmx_lite_main.exe`
- Wasm: `D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\vrm2pmx-md\frontend\public\nim\vrm2pmx_nim_runtime.wasm`
- Models: 26

## Results

Elapsed times are wall-clock milliseconds for a single conversion run.

| Model | VRM size | Python ms | Python PMX | Nim-exe ms | Nim-exe PMX | Wasm ms | Wasm PMX | Nim-exe speedup | Wasm speedup |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AvatarSample_A | 18.48 MB | 6202 | 4.36 MB | 477 | 4.36 MB | 151 | 4.36 MB | 13.0x | 41.1x |
| AvatarSample_A_1.0 | 18.48 MB | 6171 | 4.36 MB | 466 | 4.36 MB | 142 | 4.36 MB | 13.2x | 43.5x |
| AvatarSample_M | 20.32 MB | 7075 | 4.50 MB | 518 | 4.50 MB | 134 | 4.50 MB | 13.7x | 52.8x |
| NicoDanBoy | 10.64 MB | 4888 | 3.92 MB | 287 | 3.92 MB | 100 | 3.92 MB | 17.0x | 48.9x |
| NicoDanBoy_20260306 | 11.02 MB | 4994 | 3.95 MB | 293 | 3.95 MB | 104 | 3.95 MB | 17.0x | 48.0x |
| 1899578487613238293 | 15.86 MB | 6901 | 4.61 MB | 538 | 4.61 MB | 147 | 4.61 MB | 12.8x | 46.9x |
| 3800391986853067029 | 1.29 MB | 2165 | 871.7 KB | 291 | 871.7 KB | 54 | 871.7 KB | 7.4x | 40.1x |
| 8211396565083486995 | 370.6 KB | 468 | 169.6 KB | 73 | 169.7 KB | 23 | 169.7 KB | 6.4x | 20.3x |
| 8538742828286332800 | 17.62 MB | 7487 | 4.72 MB | 537 | 4.72 MB | 153 | 4.72 MB | 13.9x | 48.9x |
| 9119730241296603838 | 18.47 MB | 5819 | 3.15 MB | 590 | 3.15 MB | 148 | 3.15 MB | 9.9x | 39.3x |
| 7229542656829083947 | 16.15 MB | 7978 | 4.97 MB | 609 | 4.97 MB | 165 | 4.97 MB | 13.1x | 48.4x |
| 514340979744949531 | 543.6 KB | 976 | 397.5 KB | 157 | 398.3 KB | 48 | 398.3 KB | 6.2x | 20.3x |
| 4590875026920364234 | 1.40 MB | 2770 | 1.14 MB | 338 | 1.14 MB | 58 | 1.14 MB | 8.2x | 47.8x |
| 8954518223473550154 | 18.52 MB | 7905 | 5.04 MB | 628 | 5.04 MB | 152 | 5.04 MB | 12.6x | 52.0x |
| AvatarSample_C | 14.88 MB | 6274 | 4.33 MB | 442 | 4.33 MB | 144 | 4.33 MB | 14.2x | 43.6x |
| mod | 16.09 MB | - | - | 547 | 1.68 MB | 132 | 1.68 MB | - | - |
| NicoDanBoy | 11.02 MB | 4993 | 3.95 MB | 293 | 3.95 MB | 106 | 3.95 MB | 17.0x | 47.1x |
| AvatarSample_A | 18.48 MB | 6142 | 4.36 MB | 491 | 4.36 MB | 148 | 4.36 MB | 12.5x | 41.5x |
| AvatarSample_A | 18.48 MB | 6322 | 4.36 MB | 447 | 4.36 MB | 145 | 4.36 MB | 14.1x | 43.6x |
| mod | 23.51 MB | - | - | 696 | 2.25 MB | 188 | 2.25 MB | - | - |
| AvatarSample_A | 18.48 MB | 6185 | 4.36 MB | 474 | 4.36 MB | 144 | 4.36 MB | 13.0x | 43.0x |
| AvatarSample_A | 18.48 MB | 6294 | 4.36 MB | 475 | 4.36 MB | 176 | 4.36 MB | 13.3x | 35.8x |
| 超かぐや姫！酒寄彩葉「水色の描」 | 21.29 MB | 8009 | 4.97 MB | 629 | 4.97 MB | 187 | 4.97 MB | 12.7x | 42.8x |
| 8831901753414439164 | 8.80 MB | 5129 | 3.31 MB | 359 | 3.31 MB | 98 | 3.31 MB | 14.3x | 52.3x |
| プロレスラー_リンリン | 21.94 MB | 9720 | 6.65 MB | 982 | 6.65 MB | 241 | 6.65 MB | 9.9x | 40.3x |
| 和風リメイクあかおに | 18.65 MB | 6570 | 3.32 MB | 598 | 3.32 MB | 132 | 3.32 MB | 11.0x | 49.8x |

## Summary

- Avg Python: 5727 ms
- Avg Nim-exe: 458 ms
- Avg Nim-exe speedup: **12.5x**
- Avg Wasm: 129 ms
- Avg Wasm speedup: **44.3x**
