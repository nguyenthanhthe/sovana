"""Copy compiled specs into python/sovana/src/sovana/geo_time/data before building wheel/sdist."""

from __future__ import annotations

import pathlib
import shutil


def main() -> None:
    sovana_pkg_root = pathlib.Path(__file__).resolve().parent
    repo_root = sovana_pkg_root.parents[1]
    data_dir = sovana_pkg_root / "src" / "sovana" / "geo_time" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    mapping = [
        (
            repo_root / "specs" / "ephemeris" / "ephemeris_1900_2100.bin",
            data_dir / "ephemeris_1900_2100.bin",
        ),
        (
            repo_root / "specs" / "geo" / "vn_bi_temporal_geo.json",
            data_dir / "vn_bi_temporal_geo.json",
        ),
        (
            repo_root / "specs" / "geo" / "vn_tz_regimes.json",
            data_dir / "vn_tz_regimes.json",
        ),
    ]
    for src, dst in mapping:
        shutil.copy2(src, dst)
        print(f"Copied {src.name} -> {dst}")


if __name__ == "__main__":
    main()
