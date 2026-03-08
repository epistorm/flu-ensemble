"""Download FluSight-Baseline forecasts, sample trajectories from quantile CDF,
and compute energy scores for comparison with our model."""

import numpy as np
import pandas as pd
import json
import time
from pathlib import Path

N_SAMPLES = 500
HORIZONS = [0, 1, 2, 3]
BASE_URL = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/model-output/FluSight-baseline"
SCORES_DIR = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "scores"
CODEBOOK = Path(__file__).resolve().parent.parent.parent / "epystrain-trajectory-analytics" / "data" / "location_codebook.csv"

# ── Vectorized energy score ──────────────────────────────────────────────────
def energyscore_fast(X, y):
    """X: (N, T) trajectories, y: (T,) observations."""
    term1 = np.mean(np.sqrt(np.sum((X - y) ** 2, axis=1)))
    diff = X[:, np.newaxis, :] - X[np.newaxis, :, :]
    term2 = np.mean(np.sqrt(np.sum(diff ** 2, axis=2)))
    return term1 - term2 / 2


# ── Get our reference dates from existing scores ─────────────────────────────
existing = pd.read_csv(SCORES_DIR / "epystrain_energyscore_dat.csv")
ref_dates = sorted(existing["reference_date"].unique())
print(f"Reference dates to process: {ref_dates}")

# ── Load location codebook ───────────────────────────────────────────────────
locations = pd.read_csv(CODEBOOK)[["location_code", "location_name"]]
loc_code_to_name = dict(zip(locations["location_code"], locations["location_name"]))

# ── Load surveillance data ───────────────────────────────────────────────────
print("Loading surveillance data...")
surv_url = "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/main/target-data/target-hospital-admissions.csv"
observations = pd.read_csv(surv_url, dtype={"location": str})
observations["date"] = pd.to_datetime(observations["date"])
obs_weekly = observations.groupby(
    ["location", pd.Grouper(key="date", freq="W-SAT")]
).sum(numeric_only=True).reset_index()
obs_max_date = obs_weekly.date.max()
print(f"Observations max date: {obs_max_date.date()}")

# ── Process each reference date ──────────────────────────────────────────────
np.random.seed(42)
results = []
t_start = time.time()

for idx, ref_date_str in enumerate(ref_dates):
    ref_date = pd.Timestamp(ref_date_str)
    print(f"  [{idx+1}/{len(ref_dates)}] {ref_date_str}...", end="", flush=True)
    t0 = time.time()

    # Download baseline forecast
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

    for loc in sorted(bl["location"].unique()):
        loc_bl = bl[bl["location"] == loc]

        # Get available horizons that have observation data
        available_dates = sorted(loc_bl["target_end_date"].unique())
        available_dates = [d for d in available_dates if d <= obs_max_date]
        if not available_dates:
            continue

        obs_filt = obs_weekly[
            (obs_weekly.location == loc)
            & (obs_weekly.date.isin(available_dates))
        ].sort_values("date")

        common_dates = sorted(
            set(pd.Timestamp(d) for d in available_dates) & set(obs_filt.date)
        )
        if not common_dates:
            continue

        y = np.array(
            obs_filt[obs_filt.date.isin(common_dates)].sort_values("date").value
        )

        # Sample 500 trajectories from quantile CDF, each horizon independently
        traj = np.zeros((N_SAMPLES, len(common_dates)))
        for h_idx, date in enumerate(common_dates):
            h_data = loc_bl[loc_bl["target_end_date"] == date].sort_values(
                "output_type_id"
            )
            if len(h_data) == 0:
                continue
            q_levels = h_data["output_type_id"].values
            q_values = h_data["value"].values
            # Sample from CDF via inverse transform
            u = np.random.uniform(q_levels[0], q_levels[-1], size=N_SAMPLES)
            traj[:, h_idx] = np.interp(u, q_levels, q_values)

        X = traj
        ES = energyscore_fast(X, y)
        ES_norm = ES / np.sum(y) if np.sum(y) > 0 else np.nan

        results.append({
            "location": loc,
            "reference_date": ref_date_str,
            "energyscore": ES,
            "energyscore_norm": ES_norm,
            "location_name": loc_code_to_name.get(loc, loc),
        })

    print(f" {time.time()-t0:.1f}s ({len([r for r in results if r['reference_date']==ref_date_str])} locs)")

# ── Save ─────────────────────────────────────────────────────────────────────
df = pd.DataFrame(results)
output_path = SCORES_DIR / "baseline_energyscore_dat.csv"
df.to_csv(output_path, index=False)
print(f"\nSaved {len(df)} rows to {output_path}")
print(f"Total time: {time.time()-t_start:.1f}s")
