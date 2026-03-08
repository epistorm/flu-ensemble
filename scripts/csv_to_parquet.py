#!/usr/bin/env python3
"""
Convert epystrain trajectory files (CSV or parquet) in
raw/multistrain_retrospective_trajectories/ into per-location parquet files
in data/processed/trajectories/ for use by preprocess.py.

Transforms raw columns (sample_id, location, target_total, ...) into the
processed schema (location_id, run_id, location_name_epydemix, value, fips, ...).
"""

import pandas as pd
import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = BASE_DIR / "raw" / "multistrain_retrospective_trajectories"
OUT_DIR = BASE_DIR / "data" / "processed" / "trajectories"
LOCATIONS_FILE = BASE_DIR / "data" / "processed" / "locations.parquet"


def build_location_mapping(locations_df):
    """Build mapping from epydemix location name -> (location_id, fips)."""
    mapping = {}
    for idx, (_, row) in enumerate(locations_df.iterrows()):
        fips = row["location"]
        name = row["location_name"]
        if fips == "US":
            epydemix_name = "United_States"
        else:
            epydemix_name = "United_States_" + name.replace(" ", "_")
        mapping[epydemix_name] = {"location_id": idx, "fips": fips}
    return mapping


def process_file(filepath, loc_map):
    """Read a CSV or parquet file and split into per-location parquet files."""
    print(f"\nProcessing {filepath.name}...")
    if filepath.suffix == ".parquet":
        df = pd.read_parquet(filepath)
    else:
        df = pd.read_csv(filepath)

    # Normalize date columns to string YYYY-MM-DD
    df["reference_date"] = pd.to_datetime(df["reference_date"]).dt.strftime("%Y-%m-%d")
    df["date"] = pd.to_datetime(df["date"]).dt.strftime("%Y-%m-%d")
    ref_dates = sorted(df["reference_date"].unique())
    print(f"  Reference dates: {ref_dates}")

    for ref_date in ref_dates:
        ref_df = df[df["reference_date"] == ref_date]
        ref_dir = OUT_DIR / f"ref_{ref_date}"
        os.makedirs(ref_dir, exist_ok=True)

        for location, loc_df in ref_df.groupby("location"):
            if location not in loc_map:
                print(f"  Warning: unknown location '{location}', skipping")
                continue

            loc_info = loc_map[location]
            loc_id = loc_info["location_id"]
            fips = loc_info["fips"]

            out_df = pd.DataFrame({
                "location_id": loc_id,
                "run_id": loc_df["sample_id"].values,
                "location_name_epydemix": location,
                "date": loc_df["date"].values,
                "value": loc_df["target_total"].values,
                "epiweek": loc_df["epiweek"].values,
                "reference_date": loc_df["reference_date"].values,
                "horizon": loc_df["horizon"].values,
                "fips": fips,
            })

            out_df["location_id"] = out_df["location_id"].astype("int64")
            out_df["run_id"] = out_df["run_id"].astype("int64")
            out_df["value"] = out_df["value"].astype("float64")
            out_df["epiweek"] = out_df["epiweek"].astype("int64")
            out_df["horizon"] = out_df["horizon"].astype("int64")

            out_path = ref_dir / f"loc_{loc_id:02d}.parquet"
            out_df.to_parquet(out_path, index=False)

        n_files = len(list(ref_dir.glob("loc_*.parquet")))
        print(f"  ref_{ref_date}: wrote {n_files} location files")


def main():
    locations = pd.read_parquet(LOCATIONS_FILE)
    loc_map = build_location_mapping(locations)

    input_files = sorted(
        list(RAW_DIR.glob("epystrain_trajectories_*.csv"))
        + list(RAW_DIR.glob("epystrain_trajectories_*.parquet"))
    )
    print(f"Found {len(input_files)} input files")

    # Clear existing ref_* directories
    if OUT_DIR.exists():
        for d in OUT_DIR.iterdir():
            if d.is_dir() and d.name.startswith("ref_"):
                shutil.rmtree(d)
                print(f"  Removed old {d.name}")

    for f in input_files:
        process_file(f, loc_map)

    print("\nDone! Now run: python scripts/preprocess.py")


if __name__ == "__main__":
    main()
