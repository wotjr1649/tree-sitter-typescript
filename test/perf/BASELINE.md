# Incremental parsing baseline

Machine-specific measurements from 2026-11-23 on Windows 11 Pro x64
(build 26200), Intel Core Ultra 9 285H, 31.5 GiB visible RAM. The driver
was pinned to logical CPU 13. The runner used Python 3.14.8. MSYS2
UCRT64 GCC 16.2.0 used `-O2 -std=c11 -D_DEFAULT_SOURCE -D_POSIX_C_SOURCE=200809L` for both
versions, with the Tree-sitter v0.25.0 runtime at
`16aaed78ae6582ea55a94419828922c7b0960e10`.

```powershell
$env:PERF_CPU = '13'
python test/perf/bench.py v2.0.0 v3.1.0 --size sample --rounds 4
```

- v2.0.0 `d25555bb91be6002c88c44cf767abe3a057d52f3`
- v3.1.0 `c37edc69610d304fb2a11005ca9c4e52ad1f4863`
- desktop `01cde4fd4d7bb07e642bcbf330e3f1bf3180ef38`
- redux `67a2f96073a21ce0366b673ff0372daf6ee409c3`
- vscode `36e8c0289a5f29eae15a933263220d9895302ff6`

v3.1.0 had higher median latency for all seven edit kinds in both
dialects. TypeScript whole-line deletion moved from 12.119 to 19.855 ms
at p99.9. Compare future changes with a paired run on the same machine.

## TypeScript

| Edit | Revision | Samples | Median ms | p90 ms | p99 ms | p99.9 ms | Max ms | >16 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| indent | v2.0.0 | 2968 | 0.024 | 0.085 | 1.023 | 4.284 | 4.435 | 0 |
| indent | v3.1.0 | 2968 | 0.034 | 0.111 | 1.286 | 10.332 | 11.991 | 0 |
| type | v2.0.0 | 2888 | 0.018 | 0.070 | 0.609 | 4.146 | 7.122 | 0 |
| type | v3.1.0 | 2888 | 0.029 | 0.095 | 0.806 | 10.655 | 11.304 | 0 |
| insert_line | v2.0.0 | 2968 | 0.019 | 0.069 | 0.498 | 3.776 | 4.175 | 0 |
| insert_line | v3.1.0 | 2968 | 0.028 | 0.090 | 0.714 | 10.266 | 12.126 | 0 |
| delete_line | v2.0.0 | 2968 | 0.028 | 0.306 | 2.866 | 12.119 | 20.244 | 1 |
| delete_line | v3.1.0 | 2968 | 0.041 | 0.609 | 5.649 | 19.855 | 25.056 | 4 |
| member | v2.0.0 | 2928 | 0.021 | 0.071 | 0.785 | 9.523 | 27.553 | 1 |
| member | v3.1.0 | 2928 | 0.030 | 0.095 | 0.784 | 11.089 | 13.331 | 0 |
| string | v2.0.0 | 2536 | 0.024 | 0.074 | 0.798 | 9.826 | 17.484 | 1 |
| string | v3.1.0 | 2536 | 0.034 | 0.097 | 0.894 | 14.528 | 17.155 | 1 |
| comment | v2.0.0 | 2896 | 0.011 | 0.060 | 0.521 | 3.814 | 6.518 | 0 |
| comment | v3.1.0 | 2896 | 0.018 | 0.082 | 0.767 | 9.691 | 11.470 | 0 |

- v2.0.0 fresh median 0.448 ms (742 files per round), peak RSS 172.42 MiB
- v3.1.0 fresh median 0.453 ms (742 files per round), peak RSS 171.61 MiB

## TSX

| Edit | Revision | Samples | Median ms | p90 ms | p99 ms | p99.9 ms | Max ms | >16 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| indent | v2.0.0 | 2840 | 0.036 | 0.081 | 0.203 | 0.902 | 3.779 | 0 |
| indent | v3.1.0 | 2840 | 0.049 | 0.120 | 0.561 | 2.054 | 3.766 | 0 |
| type | v2.0.0 | 2816 | 0.028 | 0.068 | 0.161 | 1.162 | 1.237 | 0 |
| type | v3.1.0 | 2816 | 0.039 | 0.099 | 0.361 | 1.167 | 1.411 | 0 |
| insert_line | v2.0.0 | 2840 | 0.030 | 0.069 | 0.156 | 1.949 | 5.442 | 0 |
| insert_line | v3.1.0 | 2840 | 0.041 | 0.104 | 0.448 | 1.026 | 1.742 | 0 |
| delete_line | v2.0.0 | 2836 | 0.042 | 0.368 | 1.786 | 9.124 | 15.828 | 0 |
| delete_line | v3.1.0 | 2836 | 0.064 | 0.670 | 2.896 | 13.213 | 63.775 | 2 |
| member | v2.0.0 | 2804 | 0.031 | 0.072 | 0.287 | 1.121 | 3.523 | 0 |
| member | v3.1.0 | 2804 | 0.043 | 0.104 | 0.469 | 1.141 | 1.739 | 0 |
| string | v2.0.0 | 2724 | 0.031 | 0.066 | 0.158 | 0.949 | 1.100 | 0 |
| string | v3.1.0 | 2724 | 0.041 | 0.099 | 0.443 | 1.819 | 7.728 | 0 |
| comment | v2.0.0 | 2328 | 0.016 | 0.065 | 0.149 | 0.299 | 0.542 | 0 |
| comment | v3.1.0 | 2328 | 0.031 | 0.095 | 0.316 | 0.859 | 1.744 | 0 |

- v2.0.0 fresh median 0.317 ms (710 files per round), peak RSS 8.73 MiB
- v3.1.0 fresh median 0.354 ms (710 files per round), peak RSS 9.41 MiB
