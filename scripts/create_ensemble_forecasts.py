"""
Script to create ensemble forecasts (both quantile and categorical).
Runs as part of GitHub Actions workflow.
"""

import pandas as pd
import numpy as np
import sys
from pathlib import Path

# Add scripts dir to path so we can import ensemble module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ensemble import create_ensemble_method1, create_ensemble_method2, create_categorical_ensemble_quantile, create_activity_level_ensemble

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"

def main():
    try:
        print("=" * 60)
        print("Creating Ensemble Forecasts")
        print("=" * 60)

        # Load forecast data
        print("\n1. Loading forecast data...")
        forecast_path = DATA_DIR / 'all_forecasts.parquet'

        if not forecast_path.exists():
            print(f"ERROR: Forecast file not found at {forecast_path}")
            sys.exit(1)

        df = pd.read_parquet(forecast_path)
        df = df[df.model!='FluSight-ensemble'].copy()  # Exclude existing ensemble forecasts
        print(f"   Loaded {len(df):,} forecast rows")
        print(f"   Models: {df['model'].nunique()}")
        print(f"   Reference dates: {df['reference_date'].nunique()}")
        print(f"   Locations: {df['location'].nunique()}")
        print(f"   Horizons: {sorted(df['horizon'].unique())}")

        # =====================================================================
        # PART 1a: Create Quantile Ensemble (Median Method)
        # =====================================================================
        print("\n" + "=" * 60)
        print("PART 1a: Creating Quantile Ensemble (Median Method)")
        print("=" * 60)

        quantile_ensemble = create_ensemble_method1(df)

        if len(quantile_ensemble) == 0:
            print("ERROR: No quantile ensemble forecasts generated!")
            sys.exit(1)

        quantile_ensemble['model'] = 'Median Epistorm Ensemble'

        print(f"   Generated {len(quantile_ensemble):,} quantile forecast rows")
        print(f"   Reference dates: {quantile_ensemble['reference_date'].nunique()}")
        print(f"   Locations: {quantile_ensemble['location'].nunique()}")
        print(f"   Quantiles: {sorted(quantile_ensemble['output_type_id'].unique())}")

        # Save quantile ensemble
        print("\n   Saving quantile ensemble...")
        quantile_output_path = DATA_DIR / 'quantile_ensemble.pq'
        quantile_ensemble.to_parquet(quantile_output_path, index=False)
        print(f"   Saved to {quantile_output_path}")

        # =====================================================================
        # PART 1b: Creating Quantile Ensemble (LOP Method)
        # =====================================================================
        print("\n" + "=" * 60)
        print("PART 1b: Creating Quantile Ensemble (LOP Method)")
        print("=" * 60)

        quantile_ensemble_LOP = create_ensemble_method2(df)

        if len(quantile_ensemble_LOP) == 0:
            print("ERROR: No LOP quantile ensemble forecasts generated!")
            sys.exit(1)

        quantile_ensemble_LOP['model'] = 'LOP Epistorm Ensemble'

        print(f"   Generated {len(quantile_ensemble_LOP):,} quantile forecast rows")
        print(f"   Reference dates: {quantile_ensemble_LOP['reference_date'].nunique()}")
        print(f"   Locations: {quantile_ensemble_LOP['location'].nunique()}")
        print(f"   Quantiles: {sorted(quantile_ensemble_LOP['output_type_id'].unique())}")

        # Save LOP quantile ensemble
        print("\n   Saving LOP quantile ensemble...")
        quantile_output_path = DATA_DIR / 'quantile_ensemble_LOP.pq'
        quantile_ensemble_LOP.to_parquet(quantile_output_path, index=False)
        print(f"   Saved to {quantile_output_path}")

        # =====================================================================
        # PART 2: Create Categorical Ensemble
        # =====================================================================
        print("\n" + "=" * 60)
        print("PART 2: Creating Categorical Ensemble (Trend Predictions)")
        print("=" * 60)

        # Load observations
        print("\n   Loading observation data...")
        obs_url = 'https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/refs/heads/main/target-data/target-hospital-admissions.csv'
        obs = pd.read_csv(obs_url)
        obs['date'] = pd.to_datetime(obs['date'])
        print(f"   Loaded {len(obs):,} observation rows")

        # Load locations
        print("\n   Loading location data...")
        locations_path = DATA_DIR / 'locations.csv'

        if not locations_path.exists():
            print(f"ERROR: Locations file not found at {locations_path}")
            sys.exit(1)

        locations = pd.read_csv(locations_path)
        print(f"   Loaded {len(locations)} locations")

        # Use the quantile ensemble to create categorical forecasts
        print("\n   Creating categorical ensemble from quantile ensemble...")
        print("   This may take a few minutes...")

        categorical_ensemble = create_categorical_ensemble_quantile(
            quantile_ensemble[quantile_ensemble.horizon>=0])

        if len(categorical_ensemble) == 0:
            print("WARNING: No categorical forecasts generated!")
            sys.exit(1)

        print(f"   Generated {len(categorical_ensemble):,} categorical forecast rows")

        # Validate categorical output
        print("\n   Validating categorical output...")
        prob_check = categorical_ensemble.groupby(
            ['reference_date', 'horizon', 'location']
        )['value'].sum()

        invalid_probs = prob_check[(prob_check < 0.99) | (prob_check > 1.01)]
        if len(invalid_probs) > 0:
            print(f"   WARNING: {len(invalid_probs)} groups have probabilities not summing to 1")
            print(invalid_probs.head())
        else:
            print("   All probability distributions sum to 1")

        # Save categorical results
        print("\n   Saving categorical ensemble...")
        categorical_output_path = DATA_DIR / 'categorical_ensemble.pq'
        categorical_ensemble.to_parquet(categorical_output_path, index=False)
        print(f"   Saved to {categorical_output_path}")

        # =====================================================================
        # PART 3: Create Activity Level Ensemble
        # =====================================================================
        print("\n" + "=" * 60)
        print("PART 3: Creating Activity Level Ensemble")
        print("=" * 60)

        # Load thresholds
        print("\n   Loading activity level thresholds...")
        thresholds_path = DATA_DIR / 'threshold_levels.csv'

        if not thresholds_path.exists():
            print(f"ERROR: Thresholds file not found at {thresholds_path}")
            sys.exit(1)

        thresholds = pd.read_csv(thresholds_path)
        thresholds['location'] = thresholds['location'].astype(str).str.zfill(2)
        print(f"   Loaded thresholds for {len(thresholds)} locations")

        # Create activity level ensemble from quantile ensemble
        print("\n   Creating activity level ensemble from quantile ensemble...")

        activity_level_ensemble = create_activity_level_ensemble(
            quantile_ensemble_path=str(DATA_DIR / 'quantile_ensemble.pq'),
            thresholds_path=str(DATA_DIR / 'threshold_levels.csv'),
            output_path=str(DATA_DIR / 'activity_level_ensemble.pq')
        )

        if len(activity_level_ensemble) == 0:
            print("WARNING: No activity level forecasts generated!")
            sys.exit(1)

        print(f"   Generated {len(activity_level_ensemble):,} activity level forecast rows")

        # Save activity level results
        print("\n   Saving activity level ensemble...")
        activity_output_path = DATA_DIR / 'activity_level_ensemble.pq'
        activity_level_ensemble.to_parquet(activity_output_path, index=False)
        print(f"   Saved to {activity_output_path}")

        # =====================================================================
        # PART 4: Combine Everything
        # =====================================================================
        print("\n" + "=" * 60)
        print("PART 4: Combining All Ensemble Forecasts")
        print("=" * 60)

        # Combine quantile and categorical ensembles
        if 'model' in quantile_ensemble.columns and 'Model' in categorical_ensemble.columns:
            categorical_ensemble = categorical_ensemble.rename(columns={'Model': 'model'})
        elif 'Model' in quantile_ensemble.columns and 'model' in categorical_ensemble.columns:
            quantile_ensemble = quantile_ensemble.rename(columns={'model': 'Model'})
        if 'model' in quantile_ensemble_LOP.columns and 'Model' in categorical_ensemble.columns:
            categorical_ensemble = categorical_ensemble.rename(columns={'Model': 'model'})
        elif 'Model' in quantile_ensemble_LOP.columns and 'model' in categorical_ensemble.columns:
            quantile_ensemble_LOP = quantile_ensemble_LOP.rename(columns={'model': 'Model'})

        combined_ensemble = pd.concat([quantile_ensemble, categorical_ensemble, quantile_ensemble_LOP], ignore_index=True)
        combined_all = pd.concat([combined_ensemble, activity_level_ensemble], ignore_index=True)
        print(f"   Combined ensemble (with activity levels) has {len(combined_all):,} total rows")

        print(f"   Combined ensemble has {len(combined_ensemble):,} total rows")
        print(f"      - Quantile forecasts: {len(quantile_ensemble):,}")
        print(f"      - Categorical forecasts: {len(categorical_ensemble):,}")
        print(f"      - LOP Quantile forecasts: {len(quantile_ensemble_LOP):,}")
        print(f"      - Activity level forecasts: {len(activity_level_ensemble):,}")

        # Save combined
        combined_path = DATA_DIR / 'ensemble_forecasts.pq'
        combined_ensemble.to_parquet(combined_path, index=False)
        print(f"   Saved combined ensemble to {combined_path}")

        # Print final summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)

        print("\nQuantile Ensemble by Reference Date:")
        quantile_summary = quantile_ensemble.groupby('reference_date').agg({
            'location': 'nunique',
            'horizon': 'nunique',
            'output_type_id': 'nunique'
        })
        quantile_summary.columns = ['Locations', 'Horizons', 'Quantiles']
        print(quantile_summary)

        print("\nCategorical Ensemble by Reference Date:")
        categorical_summary = categorical_ensemble.groupby('reference_date').agg({
            'location': 'nunique',
            'horizon': 'nunique',
            'output_type_id': 'nunique'
        })
        categorical_summary.columns = ['Locations', 'Horizons', 'Categories']
        print(categorical_summary)

        print("\nAll ensemble forecasts created successfully!")

    except Exception as e:
        print(f"\nERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
