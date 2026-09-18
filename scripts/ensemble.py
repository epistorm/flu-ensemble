import pandas as pd
import numpy as np
from typing import List, Tuple
from scipy.interpolate import interp1d
from epiweeks import Week
import epiweeks
from datetime import datetime, date, timedelta
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

api_key = os.environ.get('COVIDCAST_API_KEY', '4bee67d2520898')
# epidatpy reads DELPHI_EPIDATA_KEY; mirror the same key so all clients work.
os.environ.setdefault('DELPHI_EPIDATA_KEY', api_key)

# Legacy V4 Delphi clients. Kept only as a fallback for get_versioned_data and
# guarded so the module still imports if these deprecated packages are absent
# (e.g. after the epidatpy / pandas>=2 migration removes `covidcast`).
try:
    import covidcast
    try:
        covidcast.use_api_key(api_key)
    except Exception:
        os.environ['COVIDCAST_API_KEY'] = api_key
except Exception:
    covidcast = None

try:
    from delphi_epidata import Epidata
    Epidata.auth = ('epidata', api_key)
except Exception:
    Epidata = None


# Columns returned by get_versioned_data(); used to build an empty frame when
# the upstream API is unavailable so downstream code can fall back cleanly.
VERSIONED_COLUMNS = ['geo_value', 'time_value', 'issue', 'value', 'issue_date',
                     'target_end_date', 'abbreviation', 'location', 'location_name']


def _empty_versioned():
    return pd.DataFrame(columns=VERSIONED_COLUMNS)


NHSN_SOURCE = 'nhsn'
# The signal was renamed in the Delphi v5 migration: the V4 preliminary signal
# `confirmed_admissions_flu_ew_prelim` is `confirmed_admissions_flu_ew` in V5
# (the `_prelim` suffix was dropped). NOTE: V5 also exposes a
# `hosprep_confirmed_admissions_flu_ew` (hospital-reported) variant whose values
# differ; confirm which one best matches the V4 `_prelim` series you relied on.
NHSN_SIGNAL_V5 = 'confirmed_admissions_flu_ew'
NHSN_SIGNAL_V4 = 'confirmed_admissions_flu_ew_prelim'


def _versioned_window():
    """(start_date, end_date) covering the current season's issues.

    Rolling ~400-day window so it always spans the active season without a
    hardcoded season start (works for 2025-26, 2026-27, ...)."""
    end = datetime.now().date()
    return end - timedelta(days=400), end


def _finalize_versioned(df):
    """Merge state/nation abbreviations to FluSight locations and select the
    standard VERSIONED_COLUMNS."""
    if df is None or len(df) == 0:
        return None
    locations = pd.read_csv(BASE_DIR / 'data' / 'locations.csv')[
        ['abbreviation', 'location', 'location_name']]
    df = df.merge(locations, on='abbreviation', how='inner')
    for c in VERSIONED_COLUMNS:
        if c not in df.columns:
            df[c] = pd.NA
    return df[VERSIONED_COLUMNS]


def _normalize_epiweek_frame(df):
    """Normalize a V4-style frame (geo_value, time_value, issue, value with
    epiweek ints/strings) into the standard versioned shape."""
    d = df[['geo_value', 'time_value', 'issue', 'value']].copy()
    d['time_value'] = d['time_value'].apply(lambda x: int(str(x)))
    d['issue'] = d['issue'].apply(lambda x: int(str(x)))
    d['issue_date'] = d['issue'].apply(lambda x: Week(x // 100, x % 100).enddate())
    d['target_end_date'] = d['time_value'].apply(lambda x: Week(x // 100, x % 100).enddate())
    d['abbreviation'] = d['geo_value'].apply(lambda x: str(x).upper())
    return d


def _normalize_v5_archive(df):
    """Normalize a V5 archive frame (reference_time, report_time, geo_value,
    value) into the standard versioned shape.

    IMPORTANT: V5 report_time is the actual publication date (a Wed/Fri), not the
    epiweek-ending Saturday that V4 `issue` resolved to. The categorical lookup
    keys on issue_date == reference_date (a Saturday), so we normalize both dates
    to their epiweek-ending Saturday; otherwise the versioned lookup would never
    hit and would silently fall back to finalized data.

    Forecasts are made on the Wednesday of the reference week, so within each
    forecast week we keep the EARLIEST report (the Wednesday preliminary release)
    -- i.e. the data actually available at forecast time -- not a later same-week
    (Friday) revision. This matches V4's one-value-per-issue-epiweek behavior.
    """
    d = df.copy()
    raw_report = pd.to_datetime(d['report_time'])
    d['target_end_date'] = pd.to_datetime(d['reference_time']).apply(
        lambda x: Week.fromdate(x).enddate())
    d['issue_date'] = raw_report.apply(lambda x: Week.fromdate(x).enddate())
    d['abbreviation'] = d['geo_value'].apply(lambda x: str(x).upper())
    # Keep the earliest (Wednesday) report within each (geo, reference week,
    # forecast week) -- the value available when the forecast was generated.
    d['_raw_report'] = raw_report
    d = (d.sort_values('_raw_report')
           .drop_duplicates(subset=['geo_value', 'target_end_date', 'issue_date'],
                            keep='first'))
    d['time_value'] = pd.NA
    d['issue'] = pd.NA
    return d[['geo_value', 'time_value', 'issue', 'value',
              'issue_date', 'target_end_date', 'abbreviation']]


def _fetch_epidatpy(start, end):
    """Fetch versioned NHSN data via epidatpy: V5 archive first, then the V4
    covidcast endpoint. Returns a normalized frame, or None if unavailable."""
    from epidatpy import EpiDataContext, EpiRange  # lazy: optional dependency
    ctx = EpiDataContext(use_cache=False)

    # --- V5 archive (preferred; nhsn not migrated to V5 as of 2026-09) ---
    try:
        frames = []
        for geo in ('state', 'nation'):
            r = ctx.epidata_archive(
                source=NHSN_SOURCE, signals=NHSN_SIGNAL_V5,
                geo_type=geo, geo_values='*',
                reference_time=EpiRange(start.isoformat(), end.isoformat()),
                report_time=EpiRange(start.isoformat(), end.isoformat()),
            ).df()
            if r is not None and len(r):
                frames.append(r)
        if frames:
            print("   Using Delphi V5 archive endpoint for versioned data.")
            return _normalize_v5_archive(pd.concat(frames, ignore_index=True))
    except Exception as e:
        print(f"   (V5 archive unavailable: {type(e).__name__}: {e})")

    # --- V4 covidcast via epidatpy (works until the V4 sunset ~Oct 2026) ---
    try:
        sw, ew = Week.fromdate(start), Week.fromdate(end)
        se = int(f"{sw.year}{sw.week:02d}")
        ee = int(f"{ew.year}{ew.week:02d}")
        frames = []
        for geo in ('state', 'nation'):
            r = ctx.pub_covidcast(
                data_source=NHSN_SOURCE, signals=NHSN_SIGNAL_V4,
                time_type='week', time_values=EpiRange(se, ee),
                geo_type=geo, geo_values='*', issues=EpiRange(se, ee),
            ).df()
            if r is not None and len(r):
                frames.append(r)
        if frames:
            print("   Using Delphi V4 covidcast endpoint (epidatpy) for versioned data.")
            return _normalize_epiweek_frame(pd.concat(frames, ignore_index=True))
    except Exception as e:
        print(f"   (V4 epidatpy fetch failed: {type(e).__name__}: {e})")
    return None


def _fetch_legacy(start, end):
    """Fetch versioned NHSN data via the legacy delphi_epidata V4 client.
    Returns a normalized frame, or None if unavailable."""
    if Epidata is None:
        return None
    try:
        sw, ew = Week.fromdate(start), Week.fromdate(end)
        se = int(f"{sw.year}{sw.week:02d}")
        ee = int(f"{ew.year}{ew.week:02d}")
        frames = []
        for geo in ('state', 'nation'):
            res = Epidata.covidcast(
                data_source=NHSN_SOURCE, signals=NHSN_SIGNAL_V4, time_type='week',
                geo_type=geo, time_values=Epidata.range(se, ee),
                geo_value='*', issues='*')
            if res.get('result') == 1:
                frames.append(pd.DataFrame(res['epidata']))
            else:
                raise RuntimeError(f"Epidata API error ({geo}): {res.get('message')}")
        if frames:
            print("   Using legacy delphi_epidata V4 client for versioned data.")
            return _normalize_epiweek_frame(pd.concat(frames, ignore_index=True))
    except Exception as e:
        print(f"   (legacy delphi_epidata fetch failed: {type(e).__name__}: {e})")
    return None


def get_versioned_data():
    """Fetch versioned (as-of) NHSN flu admissions from Delphi Epidata.

    Transition-ready and resilient: tries the Delphi V5 archive endpoint
    (via epidatpy), then the V4 covidcast endpoint (epidatpy, then the legacy
    delphi_epidata client). If everything is unavailable — e.g. during the
    Delphi v5 migration (tentatively Oct 2026) — it returns an EMPTY frame
    instead of raising, and the categorical/trend ensemble falls back to
    finalized observed data (see create_categorical_ensemble_quantile), so the
    pipeline keeps running.
    """
    start, end = _versioned_window()

    # Preferred path: epidatpy (V5 archive -> V4 covidcast).
    try:
        df = _fetch_epidatpy(start, end)
        if df is not None and len(df):
            out = _finalize_versioned(df)
            if out is not None and len(out):
                return out
    except ImportError:
        print("   (epidatpy not installed; trying legacy delphi_epidata)")
    except Exception as e:
        print(f"   (epidatpy path errored: {type(e).__name__}: {e})")

    # Fallback: legacy delphi_epidata V4 client.
    df = _fetch_legacy(start, end)
    if df is not None and len(df):
        out = _finalize_versioned(df)
        if out is not None and len(out):
            return out

    print("WARNING: versioned NHSN data unavailable from all endpoints.")
    print("         Trend/categorical ensemble will fall back to finalized "
          "observed data; pipeline continues.")
    return _empty_versioned()


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

 
def create_categorical_ensemble_quantile(df, obs_vers=None, model_name='Median Epistorm Ensemble'):
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

    # Fetch versioned data ONCE outside the loop (or use pre-fetched data)
    if obs_vers is None:
        print("   Fetching versioned observation data (one-time API call)...")
        obs_vers = get_versioned_data()
    else:
        print("   Using pre-fetched versioned observation data...")
    obs_vers['target_end_date'] = pd.to_datetime(obs_vers['target_end_date'])
    obs_vers['issue_date'] = pd.to_datetime(obs_vers['issue_date'])

    # --- Pre-build lookup dicts for O(1) access instead of per-row filtering ---
    # Population lookup: location -> population
    pop_dict = dict(zip(locations['location'], locations['population']))

    # Versioned obs lookup: (location, target_end_date, issue_date) -> value
    obs_vers_dict = {}
    for _, r in obs_vers.iterrows():
        obs_vers_dict[(r['location'], r['target_end_date'], r['issue_date'])] = r['value']

    # Fallback obs lookup: (location, date) -> value
    obs_dict = {}
    for _, r in obs.iterrows():
        obs_dict[(r['location'], r['date'])] = r['value']

    # Sort df once by output_type_id within each group
    df = df.sort_values(by=['reference_date', 'horizon', 'location', 'output_type_id'])

    # Get all unique combinations
    combinations = df[['reference_date', 'horizon', 'location']].drop_duplicates()
    print(f"   Processing {len(combinations)} combinations...")

    # Group df once for O(1) group lookups
    grouped = df.groupby(['reference_date', 'horizon', 'location'])

    # Pre-allocate result arrays (5 categories per combination)
    n_combos = len(combinations)
    categories = ['large_decrease', 'decrease', 'stable', 'increase', 'large_increase']
    res_ref_dates = np.empty(n_combos * 5, dtype=object)
    res_target_dates = np.empty(n_combos * 5, dtype=object)
    res_horizons = np.empty(n_combos * 5, dtype=int)
    res_locations = np.empty(n_combos * 5, dtype=object)
    res_categories = np.empty(n_combos * 5, dtype=object)
    res_values = np.empty(n_combos * 5, dtype=float)
    valid_count = 0

    combo_values = combinations.values  # numpy array for fast iteration

    for i in range(len(combo_values)):
        reference_date = combo_values[i, 0]
        horizon = combo_values[i, 1]
        loc = combo_values[i, 2]

        try:
            # Get group directly via dict lookup (no filtering)
            grp = grouped.get_group((reference_date, horizon, loc))

            target_end_date = grp['target_end_date'].iloc[0]

            # Get observed value via dict lookup
            last_obs = pd.to_datetime(reference_date) - timedelta(days=7)
            ref_dt = pd.to_datetime(reference_date)

            val = obs_vers_dict.get((loc, last_obs, ref_dt))
            if val is None:
                val = obs_dict.get((loc, last_obs))
            if val is None:
                continue

            # Compute count and rate changes using numpy arrays
            forecast_values = grp['value'].values.astype(float)
            quantiles = grp['output_type_id'].values.astype(float)
            count_changes = forecast_values - float(val)

            population = pop_dict.get(loc)
            if population is None:
                continue

            rate_changes = count_changes * (100000.0 / population)

            # Get thresholds
            trends = TREND_MAP[horizon]
            countmap = trends['stable_count_max']
            ratemap = trends['stable_rate_max']
            largemap = trends['large_threshold']

            # Use np.interp instead of scipy.interp1d (much faster, no object creation)
            # np.interp(x, xp, fp) — xp must be increasing
            # CDF: maps value -> quantile, so xp=count_changes, fp=quantiles
            p_count_minus10 = float(np.interp(-countmap, count_changes, quantiles, left=0.0, right=1.0))
            p_count_plus10 = float(np.interp(countmap, count_changes, quantiles, left=0.0, right=1.0))
            p_rate_decrease = float(np.interp(-ratemap, rate_changes, quantiles, left=0.0, right=1.0))
            p_rate_increase = float(np.interp(ratemap, rate_changes, quantiles, left=0.0, right=1.0))
            p_rate_largedec = float(np.interp(-largemap, rate_changes, quantiles, left=0.0, right=1.0))
            p_rate_largeinc = float(np.interp(largemap, rate_changes, quantiles, left=0.0, right=1.0))

            # Calculate rates at count boundaries
            rate_count10 = countmap * (100000.0 / population)
            rate_countminus10 = -rate_count10

            # Initialize probabilities with defaults (rate-based)
            p_stable = p_rate_increase - p_rate_decrease
            p_increase = p_rate_largeinc - p_rate_increase
            p_large_increase = 1 - p_rate_largeinc
            p_decrease = p_rate_decrease - p_rate_largedec
            p_large_decrease = p_rate_largedec

            # Apply logic based on which constraints are binding
            if rate_count10 < ratemap and rate_countminus10 > -ratemap:
                pass

            elif rate_count10 < largemap and rate_count10 >= ratemap and rate_countminus10 > -ratemap:
                p_stable = p_count_plus10 - p_rate_decrease
                p_increase = p_rate_largeinc - p_count_plus10

            elif rate_count10 >= largemap and rate_countminus10 > -ratemap:
                p_stable = p_count_plus10 - p_rate_decrease
                p_increase = 0
                p_large_increase = 1 - p_count_plus10

            elif rate_count10 < ratemap and rate_countminus10 > -largemap and rate_countminus10 <= -ratemap:
                p_stable = p_rate_increase - p_count_minus10
                p_decrease = p_count_minus10 - p_rate_largedec

            elif rate_count10 < ratemap and rate_countminus10 <= -largemap:
                p_stable = p_rate_increase - p_count_minus10
                p_decrease = 0
                p_large_decrease = p_count_minus10

            elif rate_count10 < largemap and rate_countminus10 > -largemap and rate_countminus10 <= -ratemap and rate_count10 >= ratemap:
                p_stable = p_count_plus10 - p_count_minus10
                p_increase = p_rate_largeinc - p_count_plus10
                p_decrease = p_count_minus10 - p_rate_largedec

            elif rate_count10 >= largemap and rate_countminus10 > -largemap and rate_countminus10 <= -ratemap:
                p_stable = p_count_plus10 - p_count_minus10
                p_increase = 0
                p_large_increase = 1 - p_count_plus10
                p_decrease = p_count_minus10 - p_rate_largedec

            elif rate_count10 < largemap and rate_countminus10 <= -largemap and rate_count10 >= ratemap:
                p_stable = p_count_plus10 - p_count_minus10
                p_decrease = 0
                p_large_decrease = p_count_minus10
                p_increase = p_rate_largeinc - p_count_plus10

            elif rate_count10 >= largemap and rate_countminus10 <= -largemap:
                p_stable = p_count_plus10 - p_count_minus10
                p_decrease = 0
                p_increase = 0
                p_large_decrease = p_count_minus10
                p_large_increase = 1 - p_count_plus10

            else:
                p_stable = 1
                p_increase = 0
                p_large_increase = 0
                p_decrease = 0
                p_large_decrease = 0

            probs = [p_large_decrease, p_decrease, p_stable, p_increase, p_large_increase]

            # Verify probabilities sum to 1
            total = sum(probs)
            if abs(total - 1.0) > 0.01:
                print(f"WARNING: Probabilities don't sum to 1 for {loc}, horizon {horizon}, date {reference_date}: {total:.4f}")

            # Write results directly into pre-allocated arrays
            idx = valid_count * 5
            for j in range(5):
                res_ref_dates[idx + j] = reference_date
                res_target_dates[idx + j] = target_end_date
                res_horizons[idx + j] = horizon
                res_locations[idx + j] = loc
                res_categories[idx + j] = categories[j]
                res_values[idx + j] = probs[j]
            valid_count += 1

        except Exception as e:
            print(f"Error processing {loc}, horizon {horizon}, reference_date {reference_date}: {str(e)}")
            continue

    # Trim arrays to valid entries
    n_valid = valid_count * 5
    results_df = pd.DataFrame({
        'target_end_date': res_target_dates[:n_valid],
        'horizon': res_horizons[:n_valid],
        'output_type_id': res_categories[:n_valid],
        'value': res_values[:n_valid],
        'location': res_locations[:n_valid],
        'target': 'wk flu hosp rate change',
        'Model': model_name,
        'output_type': 'pmf',
        'reference_date': res_ref_dates[:n_valid],
    })

    return results_df


def create_activity_level_ensemble(quantile_ensemble_path=None,
                                    thresholds_path=None,
                                    output_path=None,
                                    df=None):
    """
    Convert quantile ensemble forecasts into activity level probabilities
    (Low, Moderate, High, Very High) using state-specific thresholds.

    Pass `df` (a quantile-ensemble DataFrame) to operate in-memory instead of
    reading `quantile_ensemble_path` -- used for incremental generation. When
    `output_path` is None the result is returned without being written to disk.
    """
    if thresholds_path is None:
        thresholds_path = BASE_DIR / 'data' / 'threshold_levels.csv'

    if df is None:
        if quantile_ensemble_path is None:
            quantile_ensemble_path = BASE_DIR / 'data' / 'quantile_ensemble.pq'
        df = pd.read_parquet(quantile_ensemble_path)
    else:
        df = df.copy()
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

    if output_path is not None:
        results_df.to_parquet(output_path, index=False)
        print(f"Saved activity level ensemble to {output_path}")
        print(f"Shape: {results_df.shape}")
        print(f"Locations: {results_df.location.nunique()}")
        print(f"Reference dates: {results_df.reference_date.nunique()}")

    return results_df
