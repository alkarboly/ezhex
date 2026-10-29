"""Extract NOAA MRMS MESH_Max_1440min for selected hex bboxes.

Reads only the 12Z (120000) file per day. Never sums overlapping intra-day
files. Downloads gzip GRIB2, decodes with xarray+cfgrib, converts lon 0-360
to -180..180, then keeps max MESH mm per hex. Deletes temp files.

Values: >0 hail mm, 0 none, -1 missing, -3 no coverage.
MESH is usable from 2020-11-01.

Usage:
  python pipelines/hail/extract_mesh.py --job job.json --out out.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import sys
import tempfile
import urllib.request
from pathlib import Path

HAIL_START = "2020-11-01"
BUCKET = "https://noaa-mrms-pds.s3.amazonaws.com"
PREFIX = "CONUS/MESH_Max_1440min_00.50"
CYCLE = "120000"


def compact_day(day: str) -> str:
    return day.replace("-", "")


def object_key(day: str) -> str:
    ymd = compact_day(day)
    return f"{PREFIX}/{ymd}/MRMS_MESH_Max_1440min_00.50_{ymd}-{CYCLE}.grib2.gz"


def https_url(day: str) -> str:
    return f"{BUCKET}/{object_key(day)}"


def decode_mesh(grib_path: Path):
    try:
        import xarray as xr
    except ModuleNotFoundError as error:
        raise SystemExit(
            "Missing Python dependency: xarray. Run `pip install -r pipelines/hail/requirements.txt`."
        ) from error

    dataset = xr.open_dataset(grib_path, engine="cfgrib")
    field = next(iter(dataset.data_vars.values()))
    lats = field.latitude.values
    lons = field.longitude.values
    lons = ((lons + 180) % 360) - 180
    values = field.values
    dataset.close()
    return lats, lons, values


def max_for_bbox(lats, lons, values, west, south, east, north):
    import numpy as np

    if lats.ndim == 1 and lons.ndim == 1:
        lat_mask = (lats >= south) & (lats <= north)
        lon_mask = (lons >= west) & (lons <= east)
        if not lat_mask.any() or not lon_mask.any():
            return None
        block = values[np.ix_(lat_mask, lon_mask)]
    else:
        lat_mask = (lats >= south) & (lats <= north)
        lon_mask = (lons >= west) & (lons <= east)
        block = values[lat_mask & lon_mask]
    if block.size == 0:
        return None
    valid = block[block >= 0]
    if valid.size == 0:
        return None
    return float(valid.max())


def download_12z(day: str, dest: Path) -> str:
    url = https_url(day)
    request = urllib.request.Request(url, headers={"User-Agent": "readyhex-hail/1"})
    with urllib.request.urlopen(request, timeout=60) as response, dest.open("wb") as out:
        shutil.copyfileobj(response, out)
    return object_key(day)


def gunzip(src: Path, dest: Path) -> None:
    with gzip.open(src, "rb") as incoming, dest.open("wb") as outgoing:
        shutil.copyfileobj(incoming, outgoing)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    job = json.loads(Path(args.job).read_text(encoding="utf-8"))
    days = job["days"]
    hexes = job["hexes"]
    rows = []
    temp = Path(tempfile.mkdtemp(prefix="wp-hail-"))
    try:
        for day in days:
            if day < HAIL_START:
                raise SystemExit(f"Hail history starts on {HAIL_START}.")
            gz_path = temp / f"{compact_day(day)}.grib2.gz"
            grib_path = temp / f"{compact_day(day)}.grib2"
            key = download_12z(day, gz_path)
            gunzip(gz_path, grib_path)
            gz_path.unlink(missing_ok=True)
            lats, lons, values = decode_mesh(grib_path)
            grib_path.unlink(missing_ok=True)
            for hex_row in hexes:
                rows.append(
                    {
                        "h3": hex_row["h3"],
                        "day": day,
                        "mesh_mm_max": max_for_bbox(
                            lats,
                            lons,
                            values,
                            hex_row["west"],
                            hex_row["south"],
                            hex_row["east"],
                            hex_row["north"],
                        ),
                        "source_key": key,
                    }
                )
            del lats, lons, values
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    Path(args.out).write_text(json.dumps(rows), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
