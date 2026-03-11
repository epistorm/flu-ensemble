#!/usr/bin/env python3
"""
Preprocess ensemble forecast data into JSON for the flu dashboard.
Reads from data/ parquet files (output of the pipeline) and writes to docs/data/.

Outputs:
  - dashboard_data.json: trend/activity probabilities per location/horizon/refdate
  - locations.json: location metadata
  - target_data.json: historical observed data for all locations
  - historical_seasons.json: aligned seasonal curves for context overlay
  - trajectories/{fips}.json: per-location quantile forecasts (fan chart data)
"""

import pandas as pd
import numpy as np
import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
OUT_DIR = BASE_DIR / "docs" / "data"

# Quantile levels to export for fan chart
QUANTILE_LEVELS = [0.025, 0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95, 0.975]
QUANTILE_NAMES = ["p025", "p05", "p10", "p25", "p50", "p75", "p90", "p95", "p975"]

# Category orderings
TREND_ORDER = ["large_decrease", "decrease", "stable", "increase", "large_increase"]
ACTIVITY_ORDER = ["low", "moderate", "high", "very_high"]

# Max horizons for dashboard map (all horizons used for trajectory chart)
MAX_DASHBOARD_HORIZONS = 4


def export_target_data(target_data):
    """Export historical observed data as JSON grouped by location."""
    print("\nExporting target_data.json...")

    # Use observed_data.csv if available, otherwise fall back to parquet
    obs_csv = DATA_DIR / "observed_data.csv"
    if obs_csv.exists():
        target_data = pd.read_csv(obs_csv)
        target_data['date'] = pd.to_datetime(target_data['date']).dt.strftime('%Y-%m-%d')
        # Ensure location is zero-padded string
        target_data['location'] = target_data['location'].astype(str).str.zfill(2)
        target_data.loc[target_data['location'].str.len() > 2, 'location'] = \
            target_data.loc[target_data['location'].str.len() > 2, 'location'].str.upper()

    result = {}
    for loc, group in target_data.groupby("location"):
        if loc == "72":
            continue
        records = []
        for _, row in group.sort_values("date").iterrows():
            val = float(row["value"]) if pd.notna(row.get("value")) else None
            records.append({
                "date": row["date"],
                "value": round(val, 1) if val is not None else None,
            })
        result[loc] = records
    with open(OUT_DIR / "target_data.json", "w") as f:
        json.dump(result, f)
    print(f"  Wrote target_data.json ({len(result)} locations)")


def export_historical_seasons(target_data):
    """Export historical season curves aligned by week offset from Oct 1."""
    print("\nExporting historical_seasons.json...")
    seasons = {
        "2022-23": ("2022-10-01", "2023-09-30"),
        "2023-24": ("2023-10-01", "2024-09-30"),
        "2024-25": ("2024-10-01", "2025-09-30"),
    }

    result = {}
    for loc, group in target_data.groupby("location"):
        if loc == "72":
            continue
        loc_seasons = {}
        for season_name, (start, end) in seasons.items():
            mask = (group["date"] >= start) & (group["date"] <= end)
            season_data = group[mask].sort_values("date")
            if len(season_data) == 0:
                continue
            records = []
            for idx, (_, row) in enumerate(season_data.iterrows()):
                val = float(row["value"]) if pd.notna(row.get("value")) else None
                records.append({
                    "week": idx,
                    "date": row["date"],
                    "value": round(val, 1) if val is not None else None,
                })
            loc_seasons[season_name] = records
        result[loc] = loc_seasons

    with open(OUT_DIR / "historical_seasons.json", "w") as f:
        json.dump(result, f)
    print(f"  Wrote historical_seasons.json ({len(result)} locations)")


def export_quantile_trajectories(quantile_ensemble, locations, subfolder="trajectories"):
    """Export quantile-based trajectory data per location for fan chart."""
    print(f"\nExporting per-location quantile trajectory files to {subfolder}/...")
    traj_out_dir = OUT_DIR / subfolder
    os.makedirs(traj_out_dir, exist_ok=True)

    loc_pop = dict(zip(locations["location"], locations["population"]))

    # Filter for quantile output only
    df = quantile_ensemble.copy()
    df['reference_date'] = pd.to_datetime(df['reference_date'])
    df['target_end_date'] = pd.to_datetime(df['target_end_date'])
    df['output_type_id'] = df['output_type_id'].astype(float)

    ref_dates = sorted(df['reference_date'].dt.strftime('%Y-%m-%d').unique())
    all_fips = sorted(df['location'].unique())

    for fips in all_fips:
        if fips == "72":
            continue

        loc_df = df[df['location'] == fips]
        loc_result = {"reference_dates": ref_dates, "data": {}}

        for ref_date_str in ref_dates:
            ref_date = pd.to_datetime(ref_date_str)
            rd_df = loc_df[loc_df['reference_date'] == ref_date]

            if len(rd_df) == 0:
                continue

            horizons = sorted([h for h in rd_df['horizon'].unique() if 0 <= h <= 3])
            dates = []
            quantiles = {name: [] for name in QUANTILE_NAMES}

            for h in horizons:
                h_df = rd_df[rd_df['horizon'] == h]
                if len(h_df) == 0:
                    break

                target_date = h_df['target_end_date'].iloc[0].strftime('%Y-%m-%d')
                dates.append(target_date)

                for level, name in zip(QUANTILE_LEVELS, QUANTILE_NAMES):
                    # Find the closest quantile in the data
                    match = h_df[np.isclose(h_df['output_type_id'], level, atol=0.005)]
                    if len(match) > 0:
                        quantiles[name].append(round(float(match['value'].iloc[0]), 1))
                    else:
                        quantiles[name].append(None)

            if dates:
                loc_result["data"][ref_date_str] = {
                    "dates": dates,
                    "quantiles": quantiles,
                }

        with open(traj_out_dir / f"{fips}.json", "w") as f:
            json.dump(loc_result, f)

    print(f"  Wrote quantile trajectory files for {len(all_fips)} locations")


def export_dashboard_data(categorical_ensemble, activity_ensemble, quantile_ensemble, locations,
                          output_name="dashboard_data.json"):
    """Export dashboard_data.json with trend/activity probabilities."""
    print(f"\nExporting {output_name}...")

    loc_pop = dict(zip(locations["location"], locations["population"]))
    loc_name_map = dict(zip(locations["location"], locations["location_name"]))

    # Process categorical ensemble (trend probabilities)
    cat_df = categorical_ensemble.copy()
    cat_df['reference_date'] = pd.to_datetime(cat_df['reference_date'])

    # Process activity level ensemble
    act_df = activity_ensemble.copy()
    act_df['reference_date'] = pd.to_datetime(act_df['reference_date'])

    # Process quantile ensemble for median values
    quant_df = quantile_ensemble.copy()
    quant_df['reference_date'] = pd.to_datetime(quant_df['reference_date'])
    quant_df['output_type_id'] = quant_df['output_type_id'].astype(float)

    ref_dates = sorted(cat_df['reference_date'].dt.strftime('%Y-%m-%d').unique())
    most_recent = ref_dates[-1] if ref_dates else None

    output = {
        "most_recent_reference_date": most_recent,
        "reference_dates": ref_dates,
        "trend_categories": TREND_ORDER,
        "activity_categories": ACTIVITY_ORDER,
        "data": {},
    }

    # Map from categorical output_type_id to our internal names
    trend_category_map = {
        "large_decrease": "large_decrease",
        "decrease": "decrease",
        "stable": "stable",
        "increase": "increase",
        "large_increase": "large_increase",
    }
    activity_category_map = {
        "Low": "low",
        "Moderate": "moderate",
        "High": "high",
        "Very High": "very_high",
    }

    for ref_date_str in ref_dates:
        ref_date = pd.to_datetime(ref_date_str)
        ref_data = {}

        # Get all locations from categorical data for this ref date
        cat_rd = cat_df[cat_df['reference_date'] == ref_date]
        act_rd = act_df[act_df['reference_date'] == ref_date]
        quant_rd = quant_df[quant_df['reference_date'] == ref_date]

        all_locations = set(cat_rd['location'].unique()) | set(act_rd['location'].unique())

        for fips in sorted(all_locations):
            if fips == "72":
                continue

            population = loc_pop.get(fips)
            if not population:
                continue

            loc_cat = cat_rd[cat_rd['location'] == fips]
            loc_act = act_rd[act_rd['location'] == fips]
            loc_quant = quant_rd[quant_rd['location'] == fips]

            loc_data = {}

            for horizon in range(MAX_DASHBOARD_HORIZONS):
                # Trend probabilities
                h_cat = loc_cat[loc_cat['horizon'] == horizon]
                trend_probs = {cat: 0.0 for cat in TREND_ORDER}
                if len(h_cat) > 0:
                    for _, row in h_cat.iterrows():
                        cat_id = str(row['output_type_id'])
                        internal = trend_category_map.get(cat_id)
                        if internal:
                            trend_probs[internal] = round(float(row['value']), 4)

                # Activity probabilities
                h_act = loc_act[loc_act['horizon'] == horizon]
                activity_probs = {cat: 0.0 for cat in ACTIVITY_ORDER}
                if len(h_act) > 0:
                    for _, row in h_act.iterrows():
                        cat_id = str(row['output_type_id'])
                        internal = activity_category_map.get(cat_id)
                        if internal:
                            activity_probs[internal] = round(float(row['value']), 4)

                # Skip if no data for this horizon
                if sum(trend_probs.values()) == 0 and sum(activity_probs.values()) == 0:
                    continue

                # Most likely categories
                trend_most_likely = max(trend_probs, key=trend_probs.get) if sum(trend_probs.values()) > 0 else "stable"
                activity_most_likely = max(activity_probs, key=activity_probs.get) if sum(activity_probs.values()) > 0 else "low"

                # Percentile categories
                def get_percentile_cat(probs, order, pct):
                    cumul = 0.0
                    for cat in order:
                        cumul += probs.get(cat, 0.0)
                        if cumul >= pct:
                            return cat
                    return order[-1]

                # Median and PI values from quantile ensemble
                h_quant = loc_quant[loc_quant['horizon'] == horizon]
                median_value = None
                median_rate = None
                p10_value = None
                p90_value = None
                forecast_date = None

                if len(h_quant) > 0:
                    forecast_date = pd.to_datetime(h_quant['target_end_date'].iloc[0]).strftime('%Y-%m-%d')
                    median_match = h_quant[np.isclose(h_quant['output_type_id'], 0.5, atol=0.005)]
                    if len(median_match) > 0:
                        median_value = round(float(median_match['value'].iloc[0]), 1)
                        median_rate = round(median_value / population * 100000, 2)
                    p10_match = h_quant[np.isclose(h_quant['output_type_id'], 0.1, atol=0.005)]
                    if len(p10_match) > 0:
                        p10_value = round(float(p10_match['value'].iloc[0]), 1)
                    p90_match = h_quant[np.isclose(h_quant['output_type_id'], 0.9, atol=0.005)]
                    if len(p90_match) > 0:
                        p90_value = round(float(p90_match['value'].iloc[0]), 1)

                loc_data[str(horizon)] = {
                    "trend_probs": trend_probs,
                    "activity_probs": activity_probs,
                    "trend_most_likely": trend_most_likely,
                    "trend_lower": get_percentile_cat(trend_probs, TREND_ORDER, 0.10),
                    "trend_upper": get_percentile_cat(trend_probs, TREND_ORDER, 0.90),
                    "activity_most_likely": activity_most_likely,
                    "activity_lower": get_percentile_cat(activity_probs, ACTIVITY_ORDER, 0.10),
                    "activity_upper": get_percentile_cat(activity_probs, ACTIVITY_ORDER, 0.90),
                    "forecast_date": forecast_date,
                    "median_value": median_value,
                    "median_rate": median_rate,
                    "p10_value": p10_value,
                    "p90_value": p90_value,
                }

            if loc_data:
                ref_data[fips] = loc_data

        output["data"][ref_date_str] = ref_data
        print(f"  {ref_date_str}: {len(ref_data)} locations")

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_DIR / output_name, "w") as f:
        json.dump(output, f)
    print(f"Wrote {output_name}")


def main():
    print("Loading data files...")

    # Load locations
    locations = pd.read_csv(DATA_DIR / "locations.csv")
    # Ensure location is string
    locations['location'] = locations['location'].astype(str)

    # Load observed data
    obs_path = DATA_DIR / "observed_data.csv"
    if obs_path.exists():
        target_data = pd.read_csv(obs_path)
        target_data['location'] = target_data['location'].astype(str).str.zfill(2)
        target_data.loc[target_data['location'].str.len() > 2, 'location'] = \
            target_data.loc[target_data['location'].str.len() > 2, 'location'].str.upper()
        target_data['date'] = pd.to_datetime(target_data['date']).dt.strftime('%Y-%m-%d')
    else:
        processed_path = DATA_DIR / "processed" / "target_data.parquet"
        if processed_path.exists():
            target_data = pd.read_parquet(processed_path)
        else:
            print("WARNING: No observed data found")
            target_data = pd.DataFrame(columns=['date', 'location', 'value'])

    # Load ensemble outputs
    quantile_path = DATA_DIR / "quantile_ensemble.pq"
    categorical_path = DATA_DIR / "categorical_ensemble.pq"
    activity_path = DATA_DIR / "activity_level_ensemble.pq"

    if not quantile_path.exists():
        print(f"ERROR: {quantile_path} not found. Run the pipeline first:")
        print("  python scripts/fetch_data.py")
        print("  python scripts/create_ensemble_forecasts.py")
        return

    quantile_ensemble = pd.read_parquet(quantile_path)
    quantile_ensemble['location'] = quantile_ensemble['location'].astype(str)

    categorical_ensemble = pd.read_parquet(categorical_path) if categorical_path.exists() else pd.DataFrame()
    if not categorical_ensemble.empty:
        categorical_ensemble['location'] = categorical_ensemble['location'].astype(str)

    activity_ensemble = pd.read_parquet(activity_path) if activity_path.exists() else pd.DataFrame()
    if not activity_ensemble.empty:
        activity_ensemble['location'] = activity_ensemble['location'].astype(str)

    print(f"  Quantile ensemble: {len(quantile_ensemble):,} rows")
    print(f"  Categorical ensemble: {len(categorical_ensemble):,} rows")
    print(f"  Activity level ensemble: {len(activity_ensemble):,} rows")

    # --- Write locations.json ---
    os.makedirs(OUT_DIR, exist_ok=True)
    locations_out = []
    for _, row in locations.iterrows():
        fips = row["location"]
        if fips == "72":
            continue
        locations_out.append({
            "fips": fips,
            "abbreviation": row["abbreviation"],
            "name": row["location_name"],
            "population": int(row["population"]),
        })

    with open(OUT_DIR / "locations.json", "w") as f:
        json.dump(locations_out, f)
    print(f"\nWrote locations.json ({len(locations_out)} locations)")

    # --- Dashboard data (Median ensemble) ---
    if not categorical_ensemble.empty and not activity_ensemble.empty:
        export_dashboard_data(categorical_ensemble, activity_ensemble, quantile_ensemble, locations)
    else:
        print("\nWARNING: Missing categorical or activity ensemble data, skipping dashboard_data.json")

    # --- Dashboard data (LOP ensemble) ---
    lop_quant_path = DATA_DIR / "quantile_ensemble_LOP.pq"
    if lop_quant_path.exists() and not categorical_ensemble.empty and not activity_ensemble.empty:
        lop_quant = pd.read_parquet(lop_quant_path)
        lop_quant['location'] = lop_quant['location'].astype(str)
        export_dashboard_data(categorical_ensemble, activity_ensemble, lop_quant, locations,
                              output_name="dashboard_data_lop.json")
    else:
        print("\nWARNING: LOP quantile data not found, skipping dashboard_data_lop.json")

    # --- Target data ---
    export_target_data(target_data)

    # --- Historical seasons ---
    export_historical_seasons(target_data)

    # --- Per-location quantile trajectories (Median ensemble) ---
    export_quantile_trajectories(quantile_ensemble, locations, subfolder="trajectories")

    # --- Per-location quantile trajectories (LOP ensemble) ---
    lop_path = DATA_DIR / "quantile_ensemble_LOP.pq"
    if lop_path.exists():
        lop_ensemble = pd.read_parquet(lop_path)
        lop_ensemble['location'] = lop_ensemble['location'].astype(str)
        print(f"  LOP ensemble: {len(lop_ensemble):,} rows")
        export_quantile_trajectories(lop_ensemble, locations, subfolder="trajectories_lop")
    else:
        print("  WARNING: quantile_ensemble_LOP.pq not found, skipping LOP trajectories")

    # --- Evaluation data ---
    export_evaluation_data()

    print("\nDone!")


def export_evaluation_data():
    """Export WIS and coverage evaluation data as JSON for the evaluations page.

    Exports raw per-row WIS values so the frontend can compute
    mean(wis)/mean(wis_baseline) dynamically based on selected
    aggregation period and horizons.
    """
    print("\nExporting evaluation data...")

    wis_path = DATA_DIR / "wis_ratio.pq"
    cov_path = DATA_DIR / "coverage.pq"

    if not wis_path.exists() or not cov_path.exists():
        print("  WARNING: wis_ratio.pq or coverage.pq not found, skipping evaluation export")
        return

    wis_df = pd.read_parquet(wis_path)
    cov_df = pd.read_parquet(cov_path)

    # --- eval_wis.json ---
    # Export raw rows: model, location, date, horizon, wis, wis_baseline
    # JS will aggregate dynamically
    models = sorted(wis_df['Model'].unique().tolist())
    ref_dates = sorted(wis_df['reference_date'].dt.strftime('%Y-%m-%d').unique().tolist())

    rows = []
    for _, r in wis_df.iterrows():
        rows.append([
            r['Model'],
            r['location'],
            r['reference_date'].strftime('%Y-%m-%d'),
            int(r['horizon']),
            round(float(r['wis']), 2),
            round(float(r['wis_baseline']), 2),
        ])

    eval_wis = {
        "models": models,
        "reference_dates": ref_dates,
        "columns": ["model", "location", "date", "horizon", "wis", "wis_baseline"],
        "rows": rows,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_DIR / "eval_wis.json", "w") as f:
        json.dump(eval_wis, f)
    print(f"  Wrote eval_wis.json ({len(models)} models, {len(ref_dates)} dates, {len(rows)} rows)")

    # --- eval_coverage.json ---
    # Export raw rows so JS can filter by horizon/date
    cov_cols_ordered = sorted(
        [c for c in cov_df.columns if c.endswith('_cov')],
        key=lambda c: int(c.replace('_cov', ''))
    )
    pi_levels = [int(c.replace('_cov', '')) for c in cov_cols_ordered]
    cov_models = sorted(cov_df['Model'].unique().tolist())

    cov_rows = []
    for _, r in cov_df.iterrows():
        cov_vals = [round(float(r[c]), 4) for c in cov_cols_ordered]
        cov_rows.append([
            r['Model'],
            r['location'],
            r['reference_date'].strftime('%Y-%m-%d'),
            int(r['horizon']),
        ] + cov_vals)

    eval_coverage = {
        "models": cov_models,
        "pi_levels": pi_levels,
        "columns": ["model", "location", "date", "horizon"] + [f"cov_{p}" for p in pi_levels],
        "rows": cov_rows,
    }

    with open(OUT_DIR / "eval_coverage.json", "w") as f:
        json.dump(eval_coverage, f)
    print(f"  Wrote eval_coverage.json ({len(cov_models)} models, {len(pi_levels)} PI levels, {len(cov_rows)} rows)")


if __name__ == "__main__":
    main()
