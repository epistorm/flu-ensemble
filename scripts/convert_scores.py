"""Convert energy score and WIS CSVs to a single JSON for the evaluations page."""

import pandas as pd
import json
from pathlib import Path

SCORES_DIR = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "scores"
OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "evaluation_scores.json"

es = pd.read_csv(SCORES_DIR / "epystrain_energyscore_dat.csv")
wis = pd.read_csv(SCORES_DIR / "epystrain_WIS_dat.csv")
baseline = pd.read_csv(SCORES_DIR / "baseline_energyscore_dat.csv")

merged = es.merge(wis, on=["location", "reference_date", "location_name"], how="outer")
baseline = baseline.rename(columns={
    "energyscore": "baseline_energyscore",
    "energyscore_norm": "baseline_energyscore_norm",
})
merged = merged.merge(baseline, on=["location", "reference_date", "location_name"], how="outer")

# Round floats for smaller file size
for col in ["energyscore", "energyscore_norm", "WIS", "WIS_norm",
            "baseline_energyscore", "baseline_energyscore_norm"]:
    if col in merged.columns:
        merged[col] = merged[col].round(4)

records = merged.to_dict(orient="records")
for record in records:
    for key, val in record.items():
        if isinstance(val, float) and pd.isna(val):
            record[key] = None

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUTPUT, "w") as f:
    json.dump(records, f, separators=(",", ":"))

print(f"Wrote {len(records)} records to {OUTPUT}")
