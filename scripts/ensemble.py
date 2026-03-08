import pandas as pd
import numpy as np
from typing import List, Tuple
from scipy.interpolate import interp1d
from datetime import timedelta
from epiweeks import Week
import epiweeks
import covidcast
from delphi_epidata import Epidata
from datetime import datetime
from datetime import date, timedelta
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

api_key = os.environ.get('COVIDCAST_API_KEY', '4bee67d2520898')

# Option A: If the old method still exists in your version
try:
    covidcast.use_api_key(api_key)
except AttributeError:
    # Newer versions don't have this method
    os.environ['COVIDCAST_API_KEY'] = api_key


def get_versioned_data():
    TODAY = datetime.now()

    # Convert dates to epiweeks
    start_week = Week.fromdate(date(2025, 10, 1))
    end_week = Week.fromdate(TODAY)

    start_epiweek = int(f"{start_week.year}{start_week.week:02d}")
    end_epiweek = int(f"{end_week.year}{end_week.week:02d}")

    result_adm = Epidata.covidcast(data_source='nhsn', signals='confirmed_admissions_flu_ew_prelim',
        time_type='week', geo_type='state', time_values=Epidata.range(start_epiweek, end_epiweek), geo_value='*',
                                issues='*')
    result_adm_us = Epidata.covidcast(data_source='nhsn', signals='confirmed_admissions_flu_ew_prelim',
        time_type='week', geo_type='nation', time_values=Epidata.range(start_epiweek, end_epiweek), geo_value='*',
                                issues='*')

    # Convert to DataFrame
    if result_adm['result'] == 1:
        dfadm = pd.DataFrame(result_adm['epidata'])
        dfadm_us = pd.DataFrame(result_adm_us['epidata'])
    else:
        print(f"No results: {result_adm.get('message')}")

    dfadm = dfadm[['geo_value', 'time_value','issue','value']]
    dfadm_us = dfadm_us[['geo_value', 'time_value','issue','value']]


    df = pd.concat([dfadm, dfadm_us])
    df['issue_date'] = df['issue'].apply(lambda x: Week(x//100, x %100).enddate())
    df['target_end_date'] = df['time_value'].apply(lambda x: Week(x//100, x %100).enddate())

    df['abbreviation'] = df['geo_value'].apply(lambda x: x.upper())

    locations = pd.read_csv(BASE_DIR / 'data' / 'locations.csv')[['abbreviation', 'location', 'location_name']]

    df = df.merge(locations, on='abbreviation')

    return df


def create_ensemble_method1(forecast_data):
    """
    Ensemble Method 1: Create ensemble forecasts from individual model predictions.
    Uses median across models for each quantile.
    """

    # Filter for quantile forecasts only
    quantile_data = forecast_data[(forecast_data['output_type'] == 'quantile') & (forecast_data['target']=='wk inc flu hosp') & (forecast_data.model!='FluSight-ensemble')].copy()

    # Group by all relevant columns except model and value
    grouping_cols = ['reference_date', 'location', 'horizon', 'target',  'target_end_date', 'output_type', 'output_type_id']

    # Calculate median across models for each quantile
    ensemble = quantile_data.groupby(grouping_cols, as_index=False)['value'].median()

    return ensemble


def create_categorical_ensemble(forecast_data):
    """
    Create ensemble categorical forecasts by averaging probabilities across models.
    """

    # Filter for categorical forecasts
    df = forecast_data[
        (forecast_data['output_type'] == 'pmf') &
        (forecast_data['target'] == 'wk flu hosp rate change')
    ].copy()

    if df.empty:
        return pd.DataFrame()

    # Convert date columns
    df['reference_date'] = pd.to_datetime(df['reference_date'])
    df['target_end_date'] = pd.to_datetime(df['target_end_date'])

    # Group by all dimensions except model and value
    group_cols = ['reference_date', 'location', 'horizon', 'target',
                  'target_end_date', 'output_type', 'output_type_id']

    # Calculate mean probability across models
    ensemble = df.groupby(group_cols)['value'].mean().reset_index()

    # Normalize probabilities to sum to 1 for each (reference_date, location, horizon) group
    normalize_cols = ['reference_date', 'location', 'horizon']

    # Calculate sum of probabilities for each group
    prob_sums = ensemble.groupby(normalize_cols)['value'].transform('sum')

    # Normalize (handle division by zero)
    ensemble['value'] = np.where(
        prob_sums > 0,
        ensemble['value'] / prob_sums,
        0
    )

    # Add model identifier
    ensemble['model'] = 'Median Epistorm Ensemble'

    return ensemble


def create_ensemble_method2(forecast_data: pd.DataFrame) -> pd.DataFrame:
    """
    Ensemble Method 2 (LOP): Create ensemble forecasts from individual model predictions.
    Uses Linear Opinion Pool method.
    """

    # Filter once at the beginning
    df = forecast_data[
        (forecast_data['output_type'] == 'quantile') &
        (forecast_data['target'] == 'wk inc flu hosp') &
        (forecast_data['model'] != 'FluSight-ensemble')
    ].copy()

    # Convert types once
    df['output_type_id'] = df['output_type_id'].astype(float)
    df['reference_date'] = pd.to_datetime(df['reference_date'])
    df['target_end_date'] = pd.to_datetime(df['target_end_date'])

    # Exclude specific locations upfront
    df = df[~df['location'].isin(['66',])]

    # Group by date and location to process in batches
    grouped = df.groupby(['reference_date', 'location'])

    # Collect results in a list for efficient concatenation
    results_list = []

    for (date, location), group_data in grouped:
        try:
            ensemble_result = process_location_date(group_data, date, location)
            if ensemble_result is not None:
                results_list.append(ensemble_result)
        except Exception as e:
            print(f'Error processing {date}, location {location}: {e}')
            continue

    if not results_list:
        return pd.DataFrame()

    # Add model identifier
    ensemble = pd.concat(results_list, ignore_index=True)
    ensemble['model'] = 'LOP Epistorm Ensemble'
    ensemble['output_type_id'] = ensemble['output_type_id'].astype(str)
    ensemble['output_type'] = 'quantile'
    ensemble['target'] = 'wk inc flu hosp'

    return ensemble


def process_location_date(group_data: pd.DataFrame, date, location) -> pd.DataFrame:
    """Process ensemble for a single location and date"""

    # Get unique models and horizons
    models = group_data['model'].unique()
    horizons = sorted(group_data['horizon'].unique())

    if len(models) == 0:
        return None

    # Pre-compute interpolation values for all horizons
    interp_data = {}

    for horizon in horizons:
        horizon_data = group_data[group_data['horizon'] == horizon]

        # Collect all values from all models for this horizon
        all_values = horizon_data['value'].values

        if len(all_values) == 0:
            continue

        interp_data[horizon] = all_values

    if not interp_data:
        return None

    # Process each model's quantiles
    quantile_results = []

    for model in models:
        model_data = group_data[group_data['model'] == model]

        for horizon in horizons:
            if horizon not in interp_data:
                continue

            horizon_model_data = model_data[model_data['horizon'] == horizon]

            if len(horizon_model_data) == 0:
                continue

            # Sort by quantile for interpolation
            horizon_model_data = horizon_model_data.sort_values('output_type_id')
            quantiles = horizon_model_data['output_type_id'].values
            values = horizon_model_data['value'].values

            # Interpolate
            interp_vals = interp_data[horizon]
            interp_quantiles = np.interp(interp_vals, values, quantiles)

            # Store results
            for val, quant in zip(interp_vals, interp_quantiles):
                quantile_results.append({
                    'horizon': horizon,
                    'xvalue': val,
                    'quantile_val': quant
                })

    if not quantile_results:
        return None

    # Convert to DataFrame and compute means
    quant_df = pd.DataFrame(quantile_results)
    avg_quantiles = quant_df.groupby(['horizon', 'xvalue'])['quantile_val'].mean().reset_index()

    # Get target quantiles from first model
    first_model = group_data[group_data['model'] == models[0]]

    # Build final results
    final_results = []

    for horizon in horizons:
        horizon_avg = avg_quantiles[avg_quantiles['horizon'] == horizon]

        if len(horizon_avg) == 0:
            continue

        # Get target quantiles and end date for this horizon
        horizon_first = first_model[first_model['horizon'] == horizon]

        if len(horizon_first) == 0:
            continue

        target_quantiles = sorted(horizon_first['output_type_id'].unique())
        target_end_date = horizon_first['target_end_date'].iloc[0]

        # Sort for interpolation
        horizon_avg = horizon_avg.sort_values('quantile_val')
        source_quantiles = horizon_avg['quantile_val'].values
        source_values = horizon_avg['xvalue'].values

        # Interpolate back to target quantiles
        final_values = np.interp(target_quantiles, source_quantiles, source_values)

        # Create result rows
        for quant, val in zip(target_quantiles, final_values):
            final_results.append({
                'output_type_id': quant,
                'value': val,
                'horizon': horizon,
                'target_end_date': target_end_date,
                'location': location,
                'reference_date': date
            })

    if not final_results:
        return None

    return pd.DataFrame(final_results)

 
def create_categorical_ensemble_quantile(df):
    obs = pd.read_csv('https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/refs/heads/main/target-data/target-hospital-admissions.csv')
    obs['date'] = pd.to_datetime(obs['date'])
    locations = pd.read_csv(BASE_DIR / 'data' / 'locations.csv')

    TREND_MAP = {0: {  # 1-week ahead
                "stable_rate_max": 0.3,
                "stable_count_max": 10,
                "large_threshold": 1.7, },
            1: {  # 2-week ahead
                "stable_rate_max": 0.5,
                "stable_count_max": 10,
                "large_threshold": 3.0,},
            2: {  # 3-week ahead
                "stable_rate_max": 0.7,
                "stable_count_max": 10,
                "large_threshold": 4.0,},
            3: {  # 4- & 5-week ahead
                "stable_rate_max": 1.0,
                "stable_count_max": 10,
                "large_threshold": 5.0,},}

    results = []

    # Fetch versioned data ONCE outside the loop
    print("   Fetching versioned observation data (one-time API call)...")
    obs_vers = get_versioned_data()
    obs_vers['target_end_date'] = pd.to_datetime(obs_vers['target_end_date'])
    obs_vers['issue_date'] = pd.to_datetime(obs_vers['issue_date'])

    # Get all unique combinations
    combinations = df[['reference_date', 'horizon', 'location']].drop_duplicates()
    print(f"   Processing {len(combinations)} combinations...")

    for idx, row in combinations.iterrows():
        reference_date = row['reference_date']
        horizon = row['horizon']
        loc = row['location']

        try:
            # Filter data for this combination
            df_subset = df[
                (df.reference_date == reference_date) &
                (df.horizon == horizon) &
                (df.location == loc)
            ].sort_values(by='output_type_id')

            if len(df_subset) == 0:
                print(f"No data for {loc}, horizon {horizon}, reference_date {reference_date}")
                continue

            # Get target_end_date (should be same for all quantiles in this subset)
            target_end_date = df_subset['target_end_date'].iloc[0]

            # Get observed value
            last_obs = pd.to_datetime(reference_date) - timedelta(days=7)

            obs_subset = obs_vers[(obs_vers.location == loc) & (obs_vers.target_end_date == last_obs) &\
                                (obs_vers.issue_date==pd.to_datetime(reference_date))]

            if len(obs_subset) == 0:
                obs_subset = obs[(obs.location == loc) & (obs.date == last_obs)]


            if len(obs_subset) == 0:
                print(f"No observation for {loc} on {last_obs}")
                continue

            val = obs_subset.value.values[0]

            # Calculate count differences
            df_subset = df_subset.copy()
            df_subset['count_diff'] = df_subset['value'] - val

            quantiles = list(df_subset['output_type_id'])
            count_changes = list(df_subset['count_diff'])

            # Get population
            pop_subset = locations[locations.location == loc]
            if len(pop_subset) == 0:
                print(f"No population data for {loc}")
                continue

            population = pop_subset.population.values[0]
            rate_changes = (np.array(count_changes) / population) * 100000

            # Create CDFs
            cdf_count = interp1d(
                count_changes, quantiles,
                kind='linear', bounds_error=False, fill_value=(0, 1)
            )
            cdf_rate = interp1d(
                rate_changes, quantiles,
                kind='linear', bounds_error=False, fill_value=(0, 1)
            )

            # Get thresholds
            trends = TREND_MAP[horizon]
            countmap = trends['stable_count_max']
            ratemap = trends['stable_rate_max']
            largemap = trends['large_threshold']

            # Get CDF values at boundaries
            p_count_minus10 = float(cdf_count(-countmap))
            p_count_plus10 = float(cdf_count(countmap))
            p_rate_decrease = float(cdf_rate(-ratemap))
            p_rate_increase = float(cdf_rate(ratemap))
            p_rate_largedec = float(cdf_rate(-largemap))
            p_rate_largeinc = float(cdf_rate(largemap))

            # Calculate rates at count boundaries
            rate_count10 = (countmap / population) * 100000
            rate_countminus10 = (-countmap / population) * 100000

            # Initialize probabilities with defaults (rate-based)
            probs = {}
            probs['stable'] = p_rate_increase - p_rate_decrease
            probs['increase'] = p_rate_largeinc - p_rate_increase
            probs['large_increase'] = 1 - p_rate_largeinc
            probs['decrease'] = p_rate_decrease - p_rate_largedec
            probs['large_decrease'] = p_rate_largedec

            # Apply logic based on which constraints are binding
            if rate_count10 < ratemap and rate_countminus10 > -ratemap:
                pass

            elif rate_count10 < largemap and rate_count10 >= ratemap and rate_countminus10 > -ratemap:
                probs['stable'] = p_count_plus10 - p_rate_decrease
                probs['increase'] = p_rate_largeinc - p_count_plus10

            elif rate_count10 >= largemap and rate_countminus10 > -ratemap:
                probs['stable'] = p_count_plus10 - p_rate_decrease
                probs['increase'] = 0
                probs['large_increase'] = 1 - p_count_plus10

            elif rate_count10 < ratemap and rate_countminus10 > -largemap and rate_countminus10 <= -ratemap:
                probs['stable'] = p_rate_increase - p_count_minus10
                probs['decrease'] = p_count_minus10 - p_rate_largedec

            elif rate_count10 < ratemap and rate_countminus10 <= -largemap:
                probs['stable'] = p_rate_increase - p_count_minus10
                probs['decrease'] = 0
                probs['large_decrease'] = p_count_minus10

            elif rate_count10 < largemap and rate_countminus10 > -largemap and rate_countminus10 <= -ratemap and rate_count10 >= ratemap:
                probs['stable'] = p_count_plus10 - p_count_minus10
                probs['increase'] = p_rate_largeinc - p_count_plus10
                probs['decrease'] = p_count_minus10 - p_rate_largedec

            elif rate_count10 >= largemap and rate_countminus10 > -largemap and rate_countminus10 <= -ratemap:
                probs['stable'] = p_count_plus10 - p_count_minus10
                probs['increase'] = 0
                probs['large_increase'] = 1 - p_count_plus10
                probs['decrease'] = p_count_minus10 - p_rate_largedec

            elif rate_count10 < largemap and rate_countminus10 <= -largemap and rate_count10 >= ratemap:
                probs['stable'] = p_count_plus10 - p_count_minus10
                probs['decrease'] = 0
                probs['large_decrease'] = p_count_minus10
                probs['increase'] = p_rate_largeinc - p_count_plus10

            elif rate_count10 >= largemap and rate_countminus10 <= -largemap:
                probs['stable'] = p_count_plus10 - p_count_minus10
                probs['decrease'] = 0
                probs['increase'] = 0
                probs['large_decrease'] = p_count_minus10
                probs['large_increase'] = 1 - p_count_plus10

            else:
                probs['stable'] = 1
                probs['increase'] = 0
                probs['large_increase'] = 0
                probs['decrease'] = 0
                probs['large_decrease'] = 0

            # Verify probabilities sum to 1
            total = sum(probs.values())
            if abs(total - 1.0) > 0.01:
                print(f"WARNING: Probabilities don't sum to 1 for {loc}, horizon {horizon}, date {reference_date}: {total:.4f}")

            # Create output rows
            for category, probability in probs.items():
                results.append({
                    'reference_date': reference_date,
                    'target_end_date': target_end_date,
                    'horizon': horizon,
                    'location': loc,
                    'target': 'wk flu hosp rate change',
                    'output_type': 'pmf',
                    'output_type_id': category,
                    'value': probability,
                    'Model': 'Median Epistorm Ensemble'
                })

        except Exception as e:
            print(f"Error processing {loc}, horizon {horizon}, reference_date {reference_date}: {str(e)}")
            continue

    # Create DataFrame
    results_df = pd.DataFrame(results)

    # Reorder columns
    results_df = results_df[[
        'target_end_date', 'horizon', 'output_type_id', 'value',
        'location', 'target', 'Model', 'output_type', 'reference_date'
    ]]

    return results_df


def create_activity_level_ensemble(quantile_ensemble_path=None,
                                    thresholds_path=None,
                                    output_path=None):
    """
    Convert quantile ensemble forecasts into activity level probabilities
    (Low, Moderate, High, Very High) using state-specific thresholds.
    """
    if quantile_ensemble_path is None:
        quantile_ensemble_path = BASE_DIR / 'data' / 'quantile_ensemble.pq'
    if thresholds_path is None:
        thresholds_path = BASE_DIR / 'data' / 'threshold_levels.csv'
    if output_path is None:
        output_path = BASE_DIR / 'data' / 'activity_level_ensemble.pq'

    df = pd.read_parquet(quantile_ensemble_path)
    df['reference_date'] = pd.to_datetime(df['reference_date'])
    df['target_end_date'] = pd.to_datetime(df['target_end_date'])

    # Only quantile rows
    df = df[df['output_type'] == 'quantile'].copy()
    df['output_type_id'] = df['output_type_id'].astype(float)

    thresholds = pd.read_csv(thresholds_path)
    thresholds['location'] = thresholds['location'].astype(str).str.zfill(2)

    results = []

    combinations = df[['reference_date', 'horizon', 'location', 'target_end_date']].drop_duplicates()

    for _, row in combinations.iterrows():
        reference_date = row['reference_date']
        horizon = row['horizon']
        loc = row['location']
        target_end_date = row['target_end_date']

        try:
            # Get quantile forecast for this combination
            df_subset = df[
                (df.reference_date == reference_date) &
                (df.horizon == horizon) &
                (df.location == loc)
            ].sort_values(by='output_type_id')

            if len(df_subset) == 0:
                continue

            # Get thresholds for this location
            loc_thresh = thresholds[thresholds['location'] == loc]
            if len(loc_thresh) == 0:
                print(f"No thresholds for location {loc}, skipping.")
                continue

            thresh_medium = loc_thresh['Medium'].values[0]
            thresh_high = loc_thresh['High'].values[0]
            thresh_very_high = loc_thresh['Very High'].values[0]

            # Build CDF from quantiles
            quantiles = df_subset['output_type_id'].values
            values = df_subset['value'].values

            cdf = interp1d(
                values, quantiles,
                kind='linear', bounds_error=False, fill_value=(0, 1)
            )

            # Calculate probabilities for each activity level
            p_below_medium = float(cdf(thresh_medium))
            p_below_high = float(cdf(thresh_high))
            p_below_very_high = float(cdf(thresh_very_high))

            probs = {
                'Low': p_below_medium,
                'Moderate': p_below_high - p_below_medium,
                'High': p_below_very_high - p_below_high,
                'Very High': 1.0 - p_below_very_high
            }

            # Clip any small negative values from interpolation
            probs = {k: max(0.0, v) for k, v in probs.items()}

            # Renormalize to sum to 1
            total = sum(probs.values())
            if total > 0:
                probs = {k: v / total for k, v in probs.items()}

            # Verify
            if abs(sum(probs.values()) - 1.0) > 0.01:
                print(f"WARNING: Probabilities don't sum to 1 for {loc}, horizon {horizon}, date {reference_date}")

            for level, probability in probs.items():
                results.append({
                    'reference_date': reference_date,
                    'target_end_date': target_end_date,
                    'horizon': horizon,
                    'location': loc,
                    'target': 'wk flu hosp activity level',
                    'output_type': 'pmf',
                    'output_type_id': level,
                    'value': probability,
                })

        except Exception as e:
            print(f"Error processing {loc}, horizon {horizon}, date {reference_date}: {e}")
            continue

    results_df = pd.DataFrame(results)

    results_df = results_df[[
        'reference_date', 'target_end_date', 'horizon', 'location',
        'target', 'output_type', 'output_type_id', 'value'
    ]]

    results_df.to_parquet(output_path, index=False)
    print(f"Saved activity level ensemble to {output_path}")
    print(f"Shape: {results_df.shape}")
    print(f"Locations: {results_df.location.nunique()}")
    print(f"Reference dates: {results_df.reference_date.nunique()}")

    return results_df
