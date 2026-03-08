"""Download FluSight-Baseline forecasts and extract quantile ribbons per location/ref date."""

import pandas as pd
import json
from pathlib import Path
from collections import defaultdict

HORIZONS = [0, 1, 2, 3]
QUANTILE_LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95]
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"
SCORES_DIR = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "scores"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "data" / "baseline_quantiles"
CODEBOOK = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "location_codebook.csv"

# Get reference dates from existing scores
existing = pd.read_csv(SCORES_DIR / "epystrain_energyscore_dat.csv")
ref_dates = sorted(existing["reference_date"].unique())
print(f"Reference dates to process: {ref_dates}")

# Location codebook
locations = pd.read_csv(CODEBOOK)[["location_code", "location_name"]]
loc_code_to_name = dict(zip(locations["location_code"], locations["location_name"]))

# Collect quantile data per (location, ref_date)
# Structure: loc_data[fips][ref_date] = { dates: [], q05: [], q25: [], median: [], q75: [], q95: [] }
loc_data = defaultdict(dict)

for idx, ref_date_str in enumerate(ref_dates):
    print(f"  [{idx+1}/{len(ref_dates)}] {ref_date_str}...", end="", flush=True)

    url = f"{BASE_URL}/{ref_date_str}-FluSight-baseline.csv"
    try:
        bl = pd.read_csv(url, dtype={"location": str})
    except Exception as e:
        print(f" FAILED: {e}")
        continue

    # Filter to quantile forecasts for hospitalizations, horizons 0-3
    bl = bl[
        (bl["output_type"] == "quantile")
        & (bl["target"] == "wk inc flu hosp")
        & (bl["horizon"].isin(HORIZONS))
    ].copy()
    bl["output_type_id"] = bl["output_type_id"].astype(float)
    bl["value"] = bl["value"].astype(float)
    bl["target_end_date"] = pd.to_datetime(bl["target_end_date"])

    loc_count = 0
    for loc in sorted(bl["location"].unique()):
        loc_bl = bl[bl["location"] == loc]
        dates_sorted = sorted(loc_bl["target_end_date"].unique())

        entry = {"dates": [], "median": [], "q05": [], "q25": [], "q75": [], "q95": []}
        for date in dates_sorted:
            h_data = loc_bl[loc_bl["target_end_date"] == date].sort_values("output_type_id")
            if len(h_data) == 0:
                continue
            q_levels = h_data["output_type_id"].values
            q_values = h_data["value"].values

            entry["dates"].append(str(date.date()))
            for q_name, q_level in [("q05", 0.05), ("q25", 0.25), ("median", 0.5), ("q75", 0.75), ("q95", 0.95)]:
                # Interpolate to get exact quantile value
                val = float(pd.Series(q_values).iloc[(pd.Series(q_levels) - q_level).abs().argsort().iloc[0]])
                entry[q_name].append(round(val, 1))

        if entry["dates"]:
            loc_data[loc][ref_date_str] = entry
            loc_count += 1

    print(f" {loc_count} locations")

# Save per-location JSON files
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
for loc, ref_dates_data in loc_data.items():
    output = {"data": ref_dates_data}
    output_path = OUTPUT_DIR / f"{loc}.json"
    with open(output_path, "w") as f:
        json.dump(output, f, separators=(",", ":"))

print(f"\nSaved {len(loc_data)} location files to {OUTPUT_DIR}")
