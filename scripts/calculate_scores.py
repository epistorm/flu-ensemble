"""
Script to calculate WIS and coverage scores for forecast models.
Run by GitHub Actions weekly after data fetching.
"""

import pandas as pd
import numpy as np
import sys
from datetime import datetime
from pathlib import Path

# Add scripts dir to path so we can import ensemble module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ensemble import create_ensemble_method1, create_ensemble_method2

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"


class scoring_functions:
    """
    Compute scores for forecasts.

    Methods:
        get_wis_scores: Calculate WIS for all models, horizons, locations, dates (vectorized)
        calculate_forecast_coverage: Calculate coverage for all forecasts (vectorized)
    """

    def get_wis_scores(self, predsall, surv, models, dates, save_location=False):
        """Calculate WIS for each model, horizon, location, and date (fully vectorized)."""

        surv = surv.copy()
        surv['date'] = pd.to_datetime(surv['date'])
        surv['value'] = pd.to_numeric(surv['value'], errors='coerce')
        surv['location'] = surv['location'].astype(str)
        max_surv_date = surv.date.max()

        # Pre-filter
        predsall = predsall[
            (predsall.target_end_date <= max_surv_date) &
            (predsall.horizon.isin([0, 1, 2, 3]))
        ].copy()

        # Pivot: one row per (Model, reference_date, horizon, location, target_end_date),
        # one column per quantile
        print("      Pivoting predictions into wide format...")
        group_cols = ['Model', 'reference_date', 'horizon', 'location', 'target_end_date']
        wide = predsall.pivot_table(
            index=group_cols, columns='output_type_id', values='value', aggfunc='first'
        ).reset_index()

        # Merge observations
        print("      Merging observations...")
        surv_dedup = surv.drop_duplicates(subset=['date', 'location'])
        wide = wide.merge(
            surv_dedup[['date', 'location', 'value']].rename(columns={'date': 'target_end_date', 'value': 'obs'}),
            on=['target_end_date', 'location'],
            how='inner'
        )

        print(f"      Computing WIS for {len(wide)} forecast-observation pairs...")

        # Get sorted quantile columns
        quantile_cols = sorted([c for c in wide.columns if isinstance(c, (int, float))])
        Q = wide[quantile_cols].values  # shape: (n_rows, n_quantiles)
        y = wide['obs'].values          # shape: (n_rows,)

        # Compute WIS vectorially across all rows at once
        n_quantiles = len(quantile_cols)
        quantiles = np.array(quantile_cols)

        interval_ranges = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98]
        WIS = np.zeros(len(y))

        for i in range(n_quantiles // 2):
            lower = Q[:, i]
            upper = Q[:, -(i+1)]
            interval_range = 100 * (quantiles[-(i+1)] - quantiles[i])
            alpha = 1 - (quantiles[-(i+1)] - quantiles[i])

            dispersion = upper - lower
            underprediction = (2 / alpha) * (lower - y) * (y < lower)
            overprediction = (2 / alpha) * (y - upper) * (y > upper)
            IS = dispersion + underprediction + overprediction

            WIS += IS * alpha / 2

        # Add median term (quantile index 11 = 0.5)
        median_idx = list(quantiles).index(0.5) if 0.5 in quantiles else 11
        WIS += 0.5 * np.abs(Q[:, median_idx] - y)
        WIS /= (len(interval_ranges) + 0.5)

        dfwis = wide[['Model', 'location', 'horizon', 'reference_date', 'target_end_date']].copy()
        dfwis['wis'] = WIS

        print(f"      Calculated WIS for {len(dfwis)} pairs")

        if save_location:
            dfwis.to_pickle(f'{save_location}fluforecast_timestamp_wis_{datetime.today().date()}.pkl')

        return dfwis

    def calculate_forecast_coverage(self, predsall, surv, models, dates,
                                    save_location=False):
        """Calculate coverage for each model, horizon, location, and date (fully vectorized)."""

        surv = surv.copy()
        surv['date'] = pd.to_datetime(surv['date'])
        surv['value'] = pd.to_numeric(surv['value'], errors='coerce')
        surv['location'] = surv['location'].astype(str)
        max_surv_date = surv.date.max()

        # Pre-filter
        predsall = predsall[
            (predsall.target_end_date <= max_surv_date) &
            (predsall.horizon.isin([0, 1, 2, 3]))
        ].copy()

        # Pivot: one row per group, one column per quantile
        print("      Pivoting predictions into wide format...")
        group_cols = ['Model', 'reference_date', 'horizon', 'location', 'target_end_date']
        wide = predsall.pivot_table(
            index=group_cols, columns='output_type_id', values='value', aggfunc='first'
        ).reset_index()

        # Merge observations
        print("      Merging observations...")
        surv_dedup = surv.drop_duplicates(subset=['date', 'location'])
        wide = wide.merge(
            surv_dedup[['date', 'location', 'value']].rename(columns={'date': 'target_end_date', 'value': 'obs'}),
            on=['target_end_date', 'location'],
            how='inner'
        )

        print(f"      Computing coverage for {len(wide)} forecast-observation pairs...")

        y = wide['obs'].values
        interval_ranges = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98]

        # Compute all coverages vectorially
        cov_data = {}
        for interval_range in interval_ranges:
            q_low = round(0.5 - interval_range / 200, 3)
            q_upp = round(0.5 + interval_range / 200, 3)

            if q_low in wide.columns and q_upp in wide.columns:
                lower = wide[q_low].values
                upper = wide[q_upp].values
                covered = ((y >= lower) & (y <= upper)).astype(float)
                cov_data[f'{interval_range}_cov'] = covered
            else:
                cov_data[f'{interval_range}_cov'] = np.nan

        dfcoverage = wide[['Model', 'reference_date', 'target_end_date', 'horizon', 'location']].copy()
        for col, vals in cov_data.items():
            dfcoverage[col] = vals

        print(f"      Calculated coverage for {len(dfcoverage)} pairs")

        if save_location:
            dfcoverage.to_pickle(f'{save_location}fluforecast_coverage_{datetime.today().date()}.pkl')

        return dfcoverage


if __name__ == "__main__":
    print("=" * 60)
    print("Starting score calculation process...")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Load all the forecasts
    print("\n1. Loading forecast data...")
    all_forecasts = pd.read_parquet(DATA_DIR / "all_forecasts.parquet")
    baseline_forecasts = pd.read_parquet(DATA_DIR / "baseline_forecasts.parquet")
    observed_data = pd.read_csv(DATA_DIR / "observed_data.csv")
    print(f"   Loaded {len(all_forecasts)} forecast rows")
    print(f"   Loaded {len(baseline_forecasts)} baseline rows")
    print(f"   Loaded {len(observed_data)} observation rows")

    # Create ensemble
    print("\n2. Creating ensemble forecasts...")
    ensemble1 = create_ensemble_method1(all_forecasts)
    ensemble1['model'] = 'Median Epistorm Ensemble'
    print(f"   Created ensemble with {len(ensemble1)} rows")

    ensemble2 = create_ensemble_method2(all_forecasts)
    ensemble2['model'] = 'LOP Epistorm Ensemble'
    print(f"   Created LOP ensemble with {len(ensemble2)} rows")

    # Combine all forecasts
    print("\n3. Combining all forecasts...")
    all_forecasts = pd.concat([all_forecasts, baseline_forecasts, ensemble1, ensemble2],
                              ignore_index=True)
    print(f"   Combined total: {len(all_forecasts)} rows")

    # Prepare data for scoring
    print("\n4. Preparing data for scoring...")
    predsall = all_forecasts[all_forecasts.output_type == 'quantile'].copy()
    predsall['target_end_date'] = pd.to_datetime(predsall['target_end_date'])
    predsall['output_type_id'] = predsall["output_type_id"].astype(float)
    predsall = predsall[predsall.target == 'wk inc flu hosp']
    predsall = predsall.rename(columns={'model': 'Model'})
    print(f"   Prepared {len(predsall)} quantile predictions")

    # Initialize scoring
    scoring = scoring_functions()

    # Calculate WIS
    print("\n5. Calculating WIS scores...")
    print("   This may take several minutes...")
    dfwis = scoring.get_wis_scores(
        predsall,
        observed_data,
        models=predsall.Model.unique(),
        dates=predsall.reference_date.unique(),
        save_location=False
    )
    print(f"   Calculated WIS for {len(dfwis)} forecast-observation pairs")

    # Compute WIS ratio
    print("\n6. Computing WIS ratios...")
    baseline = dfwis[dfwis.Model == 'FluSight-baseline']
    baseline = baseline.rename(columns={'wis': 'wis_baseline', 'Model': 'baseline'})
    dfwis_test = dfwis[dfwis.Model != 'FluSight-baseline']

    dfwis_ratio = pd.merge(
        dfwis_test,
        baseline,
        how='inner',
        on=['location', 'target_end_date', 'horizon', 'reference_date']
    )
    dfwis_ratio['wis_ratio'] = dfwis_ratio['wis'] / dfwis_ratio['wis_baseline']

    # Save WIS ratio
    output_file = DATA_DIR / 'wis_ratio.pq'
    dfwis_ratio.to_parquet(output_file)
    print(f"   Saved WIS ratios to {output_file}")
    print(f"   Total WIS ratio records: {len(dfwis_ratio)}")

    # Calculate coverage
    print("\n7. Calculating coverage scores...")
    print("   This may take several minutes...")
    dfcoverage = scoring.calculate_forecast_coverage(
        predsall,
        observed_data,
        models=predsall.Model.unique(),
        dates=predsall.reference_date.unique(),
        save_location=False
    )

    # Save coverage
    output_file = DATA_DIR / 'coverage.pq'
    dfcoverage.to_parquet(output_file)
    print(f"   Saved coverage scores to {output_file}")
    print(f"   Total coverage records: {len(dfcoverage)}")

    print("\n" + "=" * 60)
    print("Score calculation completed successfully!")
    print("=" * 60)
