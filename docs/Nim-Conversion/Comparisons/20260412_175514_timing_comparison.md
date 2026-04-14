# Frontend Timing Comparison (2026-04-12 17:55)

## Settings

- Search path: `D:\Users\maedashingo\Downloads\MMD\VRoid`
- Nim exe: `D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\vrm2pmx-md\src\nim\pmx_lite_main.exe`
- Wasm: `D:\Users\maedashingo\Documents\_MyDocument\Dev\_MyWork\vrm2pmx-md\vrm2pmx-md\frontend\public\nim\vrm2pmx_nim_runtime.wasm`
- Models: 28

## Results

Elapsed times are wall-clock milliseconds for a single conversion run.

| Model                            | VRM size | Python ms | Python PMX | Nim-exe ms | Nim-exe PMX | Wasm ms | Wasm PMX | Nim-exe speedup | Wasm speedup |
| -------------------------------- | -------: | --------: | ---------: | ---------: | ----------: | ------: | -------: | --------------: | -----------: |
| AvatarSample_A                   | 18.48 MB |      7663 |    4.36 MB |       1588 |     4.36 MB |     182 |  4.36 MB |            4.8x |        42.1x |
| AvatarSample_A_1.0               | 18.48 MB |      8500 |    4.36 MB |       1493 |     4.36 MB |     175 |  4.36 MB |            5.7x |        48.6x |
| AvatarSample_M                   | 20.32 MB |      7945 |    4.50 MB |       1597 |     4.50 MB |     196 |  4.50 MB |            5.0x |        40.5x |
| NicoDanBoy                       | 10.64 MB |      6005 |    3.92 MB |        952 |     3.92 MB |     121 |  3.92 MB |            6.3x |        49.6x |
| NicoDanBoy_20260306              | 11.02 MB |      6106 |    3.95 MB |        961 |     3.95 MB |     129 |  3.95 MB |            6.4x |        47.3x |
| 1899578487613238293              | 15.86 MB |      8491 |    4.61 MB |       1683 |     4.61 MB |     178 |  4.61 MB |            5.0x |        47.7x |
| 8211396565083486995              | 370.6 KB |       494 |   169.6 KB |        176 |    169.7 KB |      29 | 169.6 KB |            2.8x |        17.0x |
| 8538742828286332800              | 17.62 MB |      8831 |    4.72 MB |       1688 |     4.72 MB |     164 |  4.72 MB |            5.2x |        53.8x |
| 9119730241296603838              | 18.47 MB |      7202 |    3.15 MB |       1740 |     3.15 MB |     182 |  3.15 MB |            4.1x |        39.6x |
| 7229542656829083947              | 16.15 MB |      9660 |    4.97 MB |       1991 |     4.97 MB |     217 |  4.97 MB |            4.9x |        44.5x |
| 8954518223473550154              | 18.52 MB |      9358 |    5.04 MB |       1922 |     5.04 MB |     195 |  5.04 MB |            4.9x |        48.0x |
| 3800391986853067029              |  1.29 MB |      2644 |   871.7 KB |        750 |    871.6 KB |      64 | 871.7 KB |            3.5x |        41.3x |
| 7457736558016798615              | 150.7 KB |       404 |   127.2 KB |        162 |    128.0 KB |      24 | 127.7 KB |            2.5x |        16.8x |
| 7656413436555301200              |  2.22 MB |      5166 |    1.79 MB |       1393 |     1.79 MB |      97 |  1.79 MB |            3.7x |        53.3x |
| 514340979744949531               | 543.6 KB |      1230 |   397.5 KB |        388 |    398.3 KB |      41 | 398.0 KB |            3.2x |        30.0x |
| 4590875026920364234              |  1.40 MB |      2939 |    1.14 MB |        871 |     1.14 MB |      71 |  1.14 MB |            3.4x |        41.4x |
| AvatarSample_C                   | 14.88 MB |      7352 |    4.33 MB |       1466 |     4.33 MB |     159 |  4.33 MB |            5.0x |        46.2x |
| mod                              | 16.09 MB |         - |          - |       1539 |     1.68 MB |     135 |  1.68 MB |               - |            - |
| NicoDanBoy                       | 11.02 MB |      6147 |    3.95 MB |        964 |     3.95 MB |     120 |  3.95 MB |            6.4x |        51.2x |
| AvatarSample_A                   | 18.48 MB |      7437 |    4.36 MB |       1475 |     4.36 MB |     189 |  4.36 MB |            5.0x |        39.3x |
| AvatarSample_A                   | 18.48 MB |      7881 |    4.36 MB |       1447 |     4.36 MB |     203 |  4.36 MB |            5.4x |        38.8x |
| mod                              | 23.51 MB |         - |          - |       2091 |     2.25 MB |     174 |  2.25 MB |               - |            - |
| AvatarSample_A                   | 18.48 MB |      7433 |    4.36 MB |       1421 |     4.36 MB |     173 |  4.36 MB |            5.2x |        43.0x |
| AvatarSample_A                   | 18.48 MB |      7475 |    4.36 MB |       1480 |     4.36 MB |     178 |  4.36 MB |            5.1x |        42.0x |
| 超かぐや姫！酒寄彩葉「水色の描」 | 21.29 MB |      9124 |    4.97 MB |       1946 |     4.97 MB |     228 |  4.97 MB |            4.7x |        40.0x |
| 8831901753414439164              |  8.80 MB |      5865 |    3.31 MB |       1117 |     3.30 MB |     121 |  3.31 MB |            5.3x |        48.5x |
| プロレスラー\_リンリン           | 21.94 MB |     11729 |    6.65 MB |       2850 |     6.65 MB |     273 |  6.65 MB |            4.1x |        43.0x |
| 和風リメイクあかおに             | 18.65 MB |      7803 |    3.32 MB |       2038 |     3.32 MB |     156 |  3.32 MB |            3.8x |        50.0x |

## Summary

- Avg Python: 6572 ms
- Avg Nim-exe: 1368 ms
- Avg Nim-exe speedup: **4.8x**
- Avg Wasm: 149 ms
- Avg Wasm speedup: **44.2x**
