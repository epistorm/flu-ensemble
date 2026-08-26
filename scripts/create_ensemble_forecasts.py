"""
Create ensemble forecasts (quantile, LOP, categorical, activity) for both the
Median and LOP methods. Runs as part of the GitHub Actions workflow.

INCREMENTAL: an ensemble forecast is a fixed function of the member forecasts
submitted that week, so it never changes once created. Only reference dates
missing from the caches are computed; results are merged back in. Keeps the
weekly run to seconds and lets a one-time backfill (cold cache) generate all
historical seasons. (Scoring depends on the revisable observed truth and is
recomputed in full by calculate_scores.py.)
"""

import sys
import pandas as pd
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ensemble import (create_ensemble_method1, create_ensemble_method2,
                      create_categorical_ensemble_quantile,
                      create_activity_level_ensemble, get_versioned_data)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

QUANTILE_PATH = DATA_DIR / 'quantile_ensemble.pq'
LOP_PATH = DATA_DIR / 'quantile_ensemble_LOP.pq'
CAT_PATH = DATA_DIR / 'categorical_ensemble.pq'
CAT_LOP_PATH = DATA_DIR / 'categorical_ensemble_LOP.pq'
ACT_PATH = DATA_DIR / 'activity_level_ensemble.pq'
ACT_LOP_PATH = DATA_DIR / 'activity_level_ensemble_LOP.pq'
COMBINED_PATH = DATA_DIR / 'ensemble_forecasts.pq'

QUANTILE_KEYS = ['reference_date', 'target_end_date', 'location', 'horizon',
                 'output_type', 'output_type_id', 'model']
CAT_KEYS = ['reference_date', 'target_end_date', 'location', 'horizon',
            'output_type', 'output_type_id', 'model']
ACT_KEYS = ['reference_date', 'target_end_date', 'location', 'horizon',
            'output_type', 'output_type_id']


def _date_key(series):
    return pd.to_datetime(series).dt.strftime('%Y-%m-%d')


def existing_ref_dates(path):
    if not Path(path).exists():
        return set()
    df = pd.read_parquet(path, columns=['reference_date'])
    return set(_date_key(df['reference_date']))


def merge_parquet(new_df, path, key_cols):
    """Union new_df into the parquet at path (new rows win on key collision)."""
    if new_df is None or len(new_df) == 0:
        print(f"   (nothing new to merge into {path})")
        return
    new_df = new_df.copy()
    if 'Model' in new_df.columns and 'model' not in new_df.columns:
        new_df = new_df.rename(columns={'Model': 'model'})
    for col in ('reference_date', 'target_end_date'):
        if col in new_df.columns:
            new_df[col] = pd.to_datetime(new_df[col])
    if Path(path).exists():
        existing = pd.read_parquet(path)
        if 'Model' in existing.columns and 'model' not in existing.columns:
            existing = existing.rename(columns={'Model': 'model'})
        for col in ('reference_date', 'target_end_date'):
            if col in existing.columns:
                existing[col] = pd.to_datetime(existing[col])
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df
    keys = [c for c in key_cols if c in combined.columns]
    combined = combined.drop_duplicates(subset=keys, keep='last')
    combined.to_parquet(path, index=False)
    print(f"   {path.name}: +{len(new_df)} new rows -> {len(combined)} total")


def main():
    print("=" * 60)
    print("Creating Ensemble Forecasts (incremental)")
    print("=" * 60)

    forecast_path = DATA_DIR / 'all_forecasts.parquet'
    if not forecast_path.exists():
        print(f"ERROR: Forecast file not found at {forecast_path}")
        sys.exit(1)

    df = pd.read_parquet(forecast_path)
    df = df[df.model != 'FluSight-ensemble'].copy()
    df['reference_date'] = pd.to_datetime(df['reference_date'])
    df['target_end_date'] = pd.to_datetime(df['target_end_date'])
    print(f"   Loaded {len(df):,} rows, {df['reference_date'].nunique()} ref dates, "
          f"{df['model'].nunique()} models")

    # Ensemble forecasts are a fixed function of the (already-submitted) member
    # forecasts, so an existing reference date never changes -- only compute
    # reference dates missing from the cache. (Scoring, which depends on the
    # revisable observed truth, is recomputed in full by calculate_scores.py.)
    target_dates = set(_date_key(df['reference_date']))
    done_dates = existing_ref_dates(QUANTILE_PATH)
    missing = sorted(target_dates - done_dates)
    if not missing:
        print("\nAll reference dates already present. Nothing to compute.")
        return
    print(f"\n   {len(missing)} new reference date(s) to compute:\n   " + ", ".join(missing))
    df_new = df[_date_key(df['reference_date']).isin(missing)].copy()

    # --- Quantile ensembles ---
    print("\nPART 1a: Median quantile ensemble...")
    q_med = create_ensemble_method1(df_new)
    if len(q_med) == 0:
        print("ERROR: no median quantile rows generated"); sys.exit(1)
    q_med['model'] = 'Median Epistorm Ensemble'
    merge_parquet(q_med, QUANTILE_PATH, QUANTILE_KEYS)

    print("\nPART 1b: LOP quantile ensemble...")
    q_lop = create_ensemble_method2(df_new)
    if len(q_lop) == 0:
        print("ERROR: no LOP quantile rows generated"); sys.exit(1)
    q_lop['model'] = 'LOP Epistorm Ensemble'
    merge_parquet(q_lop, LOP_PATH, QUANTILE_KEYS)

    # --- Categorical ensembles (versioned obs fetched once) ---
    print("\nPART 2: Categorical ensembles...")
    obs_vers = get_versioned_data()
    print(f"   Fetched {len(obs_vers):,} versioned observation rows")

    cat_med = create_categorical_ensemble_quantile(
        q_med[q_med.horizon >= 0], obs_vers=obs_vers,
        model_name='Median Epistorm Ensemble')
    merge_parquet(cat_med, CAT_PATH, CAT_KEYS)

    cat_lop = create_categorical_ensemble_quantile(
        q_lop[q_lop.horizon >= 0], obs_vers=obs_vers,
        model_name='LOP Epistorm Ensemble')
    merge_parquet(cat_lop, CAT_LOP_PATH, CAT_KEYS)

    # --- Activity level ensembles (season-agnostic thresholds) ---
    print("\nPART 3: Activity level ensembles...")
    act_med = create_activity_level_ensemble(df=q_med, output_path=None)
    merge_parquet(act_med, ACT_PATH, ACT_KEYS)

    act_lop = create_activity_level_ensemble(df=q_lop, output_path=None)
    merge_parquet(act_lop, ACT_LOP_PATH, ACT_KEYS)

    # --- Combined convenience file (full caches) ---
    print("\nPART 4: Rebuilding combined ensemble_forecasts.pq...")
    parts = []
    for p in (QUANTILE_PATH, LOP_PATH, CAT_PATH, CAT_LOP_PATH):
        if Path(p).exists():
            part = pd.read_parquet(p)
            if 'Model' in part.columns and 'model' not in part.columns:
                part = part.rename(columns={'Model': 'model'})
            parts.append(part)
    if parts:
        pd.concat(parts, ignore_index=True).to_parquet(COMBINED_PATH, index=False)
        print(f"   Saved {COMBINED_PATH}")

    print("\nEnsemble forecasts updated successfully!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
