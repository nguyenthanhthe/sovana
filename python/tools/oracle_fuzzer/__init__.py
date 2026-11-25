"""Streaming differential fuzzer against v4.0-13d (.jsonl.zst) and lasotuvi-vn."""

from oracle_fuzzer.fuzz_v4_and_lasotuvi import (
    LasotuviDiffSummary,
    V4SweepSummary,
    fuzz_lasotuvi_vn,
    get_process_rss_mb,
    open_zst_binary_lines,
    stream_verify_zst_file,
    sweep_v4_dataset,
)

__all__ = [
    "LasotuviDiffSummary",
    "V4SweepSummary",
    "fuzz_lasotuvi_vn",
    "get_process_rss_mb",
    "open_zst_binary_lines",
    "stream_verify_zst_file",
    "sweep_v4_dataset",
]
