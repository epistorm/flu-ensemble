"""
Script to fetch and cache forecast data from the FluSight-forecast-hub.
Run by GitHub Actions weekly.

Usage:
    python scripts/fetch_data.py                    # current season only (fast)
    python scripts/fetch_data.py --start 2023-10-01 # one-time multi-season backfill

Forecast parquets are MERGED into any existing file (union by identifying
columns), so a fast current-season weekly run never wipes backfilled history.
"""

import argparse
import os
import sys
import time
import pandas as pd
import requests
from io import StringIO
from datetime import datetime
from pathlib import Path
from epiweeks import Week

sys.path.insert(0, str(Path(__file__).resolve().parent))
from season_utils import season_of  # noqa: E402

# Configuration
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Full 12-member superset across all supported seasons. Members absent in a
# given week/season simply 404 and are skipped (see fetch_model_forecasts).
# NOTE: MOBS-GLEAM_FLUH (2023-24, 2024-25) and MOBS-GLEAM_RL_FLUH (2025-26) are
# two distinct MOBS models, not a rename; NU_UCSD-GLEAM_AI_FLUH is 2023-24 only.
MODELS = [
    'MIGHTE-Nsemble',
    'MIGHTE-Joint',
    'CEPH-Rtrend_fluH',
    'MOBS-EpyStrain_Flu',
    'MOBS-GLEAM_FLUH',
    'MOBS-GLEAM_RL_FLUH',
    'NU-PGF_FLUH',
    'NU_UCSD-GLEAM_AI_FLUH',
    'NEU_ISI-FluBcast',
    'NEU_ISI-AdaptiveEnsemble',
    'Gatech-ensemble_prob',
    'Gatech-ensemble_stat',
    'FluSight-ensemble',
]

FORECAST_KEY_COLS = [
    'reference_date', 'target_end_date', 'location', 'horizon',
    'output_type', 'output_type_id', 'target', 'model',
]

HUB_LOCATIONS_URL = (
    "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/"
    "refs/heads/main/auxiliary-data/locations.csv"
)


def default_start_date():
    """Start (Sep 1) of the current season -- derived dynamically, so a new
    season is picked up automatically without editing any season list."""
    season = season_of(datetime.now())        # e.g. "2026-27"
    start_year = int(season.split("-")[0])
    return datetime(start_year, 9, 1)


def merge_parquet(new_df, output_file, key_cols):
    """Union new_df with any existing parquet at output_file (new rows win)."""
    if new_df is None or new_df.empty:
        print(f"  (no new rows for {output_file})")
        return
    if Path(output_file).exists():
        existing = pd.read_parquet(output_file)
        combined = pd.concat([existing, new_df], ignore_index=True)
    else:
        combined = new_df
    for col in ('reference_date', 'target_end_date'):
        if col in combined.columns:
            combined[col] = pd.to_datetime(combined[col])
    present_keys = [c for c in key_cols if c in combined.columns]
    combined = combined.drop_duplicates(subset=present_keys, keep='last')
    combined.to_parquet(output_file, index=False)
    print(f"  Saved {output_file} ({len(combined)} rows total)")


def _socrata_topup(hub_df):
    """Append weeks newer than the hub max from CDC Socrata (ua7e-t2fy),
    preserving the observed_data.csv schema."""
    try:
        from sodapy import Socrata
    except ImportError:
        print("  - sodapy not installed; skipping Socrata top-up")
        return hub_df

    hub_max = pd.to_datetime(hub_df['date']).max()
    try:
        client = Socrata("data.cdc.gov", None, timeout=60)
        results = client.get("ua7e-t2fy", limit=100000)
    except Exception as e:
        print(f"  - Socrata fetch failed ({e}); using hub data only")
        return hub_df

    sur = pd.DataFrame.from_records(results)
    if sur.empty or 'weekendingdate' not in sur.columns:
        print("  - Socrata returned no usable rows; using hub data only")
        return hub_df

    sur = sur[['weekendingdate', 'jurisdiction', 'totalconfflunewadm']].copy()
    sur['date'] = pd.to_datetime(sur['weekendingdate'])
    sur['jurisdiction'] = sur['jurisdiction'].replace({'USA': 'US'})
    sur['value'] = (pd.to_numeric(sur['totalconfflunewadm'], errors='coerce')
                    .fillna(0).round(0))
    sur = sur[sur['date'] > hub_max]
    if sur.empty:
        print(f"  - Socrata has nothing newer than hub max {hub_max.date()}")
        return hub_df

    try:
        locs = pd.read_csv(HUB_LOCATIONS_URL)
    except Exception:
        locs = pd.read_csv(DATA_DIR / "locations.csv")
    keep = [c for c in ['abbreviation', 'location', 'location_name', 'population']
            if c in locs.columns]
    sur = sur.merge(locs[keep], left_on='jurisdiction', right_on='abbreviation',
                    how='inner')

    if 'population' in sur.columns:
        pop = pd.to_numeric(sur['population'], errors='coerce')
        sur['weekly_rate'] = (sur['value'] / pop * 100000).round(4)
    else:
        sur['weekly_rate'] = pd.NA

    sur['date'] = sur['date'].dt.strftime('%Y-%m-%d')
    add = sur[['date', 'location', 'location_name', 'value', 'weekly_rate']]
    print(f"  Socrata top-up: +{len(add)} rows across {add['date'].nunique()} "
          f"new week(s) (through {add['date'].max()})")

    combined = pd.concat([hub_df, add], ignore_index=True)
    combined = combined.drop_duplicates(subset=['date', 'location'], keep='first')
    return combined


def fetch_observed_data():
    """Fetch observed hospital admissions (hub base + Socrata top-up)."""
    print("Fetching observed data...")
    url = ("https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/"
           "refs/heads/main/target-data/target-hospital-admissions.csv")
    try:
        response = requests.get(url, timeout=60)
        data = pd.read_csv(StringIO(response.text))
        print(f"  Hub target data through {pd.to_datetime(data['date']).max().date()}")
    except Exception as e:
        print(f"  Error fetching hub observed data: {e}")
        return False

    try:
        data = _socrata_topup(data)
    except Exception as e:
        print(f"  - Socrata top-up errored ({e}); using hub data only")

    try:
        output_file = DATA_DIR / "observed_data.csv"
        data.to_csv(output_file, index=False)
        print(f"  Saved observed data to {output_file} "
              f"(through {pd.to_datetime(data['date']).max().date()})")
        return True
    except Exception as e:
        print(f"  Error saving observed data: {e}")
        return False


def _github_headers():
    """Authenticated headers if a token is available (raises rate limits)."""
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    return {"Authorization": f"Bearer {token}"} if token else {}


def _get_with_retry(url, tries=5, timeout=20, headers=None):
    """GET with exponential backoff. Returns Response, or None on 404/failure.

    404 is a real "file does not exist" -> None immediately. Other non-200
    (429/5xx, connection errors) are retried, so transient rate limiting is not
    mistaken for a missing file.
    """
    delay = 1.0
    for attempt in range(tries):
        try:
            resp = requests.get(url, timeout=timeout, headers=headers or {})
            if resp.status_code == 200:
                return resp
            if resp.status_code == 404:
                return None
            # 403/429/5xx -> back off and retry
        except requests.RequestException:
            pass
        time.sleep(delay)
        delay = min(delay * 2, 30)
    return None


def list_model_files(model_name):
    """List available {date}-{model}.csv filenames via the GitHub contents API
    (one request per model, avoids probing for 404s). Returns {} on failure."""
    api = ("https://api.github.com/repos/cdcepi/FluSight-forecast-hub/"
           f"contents/model-output/{model_name}")
    resp = _get_with_retry(api, headers=_github_headers())
    if resp is None:
        return {}
    try:
        entries = resp.json()
    except ValueError:
        return {}
    files = {}
    if isinstance(entries, list):
        for e in entries:
            name = e.get("name", "")
            if name.endswith(f"-{model_name}.csv"):
                date_str = name[:10]
                files[date_str] = e.get("download_url")
    return files


def fetch_model_forecasts(model_name, start_date, end_date):
    """Fetch weekly forecast files for a model over [start_date, end_date]."""
    available = list_model_files(model_name)
    if not available:
        print(f"    (no directory listing for {model_name})")
        return pd.DataFrame()

    start_str = start_date.strftime('%Y-%m-%d')
    end_str = end_date.strftime('%Y-%m-%d')
    wanted = sorted(d for d in available if start_str <= d <= end_str)

    all_forecasts = []
    for date_str in wanted:
        url = available[date_str] or (
            "https://raw.githubusercontent.com/cdcepi/FluSight-forecast-hub/"
            f"main/model-output/{model_name}/{date_str}-{model_name}.csv")
        resp = _get_with_retry(url)
        if resp is None:
            print(f"    Failed {date_str} (after retries)")
            continue
        try:
            df = pd.read_csv(StringIO(resp.text))
        except Exception as e:
            print(f"    Parse error {date_str}: {e}")
            continue
        df['model'] = model_name
        if 'location' in df.columns:
            df['location'] = df['location'].astype(str)
            if df['location'].str.match(r'^\d+$').any():
                df['location'] = df['location'].str.zfill(2)
        all_forecasts.append(df)
        print(f"    Fetched {date_str}")

    if all_forecasts:
        return pd.concat(all_forecasts, ignore_index=True)
    return pd.DataFrame()


def _normalize_and_merge(frames, output_file):
    if not frames:
        print(f"  No data collected for {output_file}")
        return False
    combined = pd.concat(frames, ignore_index=True)
    for col in combined.columns:
        if combined[col].dtype == 'object':
            combined[col] = combined[col].astype(str)
    if 'reference_date' in combined.columns:
        combined['reference_date'] = pd.to_datetime(combined['reference_date'])
    if 'target_end_date' in combined.columns:
        combined['target_end_date'] = pd.to_datetime(combined['target_end_date'])
    merge_parquet(combined, output_file, FORECAST_KEY_COLS)
    return True


def fetch_all_forecasts(start_date, end_date):
    print("Fetching all model forecasts...")
    frames = []
    for idx, model in enumerate(MODELS):
        print(f"  [{idx+1}/{len(MODELS)}] Fetching {model}...")
        df = fetch_model_forecasts(model, start_date, end_date)
        if not df.empty:
            frames.append(df)
            print(f"    Got {len(df)} rows")
        else:
            print("    No data found")
    return _normalize_and_merge(frames, DATA_DIR / "all_forecasts.parquet")


def fetch_baseline_forecasts(start_date, end_date):
    print("Fetching baseline forecasts...")
    df = fetch_model_forecasts('FluSight-baseline', start_date, end_date)
    return _normalize_and_merge([df] if not df.empty else [],
                                DATA_DIR / "baseline_forecasts.parquet")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch FluSight forecast data")
    parser.add_argument("--start", default=None,
                        help="Start date YYYY-MM-DD (default: current season)")
    parser.add_argument("--end", default=None,
                        help="End date YYYY-MM-DD (default: this epiweek's end)")
    args = parser.parse_args()

    start_date = (pd.to_datetime(args.start).to_pydatetime() if args.start
                  else default_start_date())
    end_date = (pd.to_datetime(args.end) if args.end
                else pd.to_datetime(Week.fromdate(datetime.now()).enddate()))

    print("=" * 60)
    print("Starting data fetch process...")
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Range: {start_date.strftime('%Y-%m-%d')} -> {end_date.strftime('%Y-%m-%d')}")
    print("=" * 60)

    success_count = 0
    if fetch_observed_data():
        success_count += 1
    if fetch_all_forecasts(start_date, end_date):
        success_count += 1
    if fetch_baseline_forecasts(start_date, end_date):
        success_count += 1

    print("=" * 60)
    print(f"Completed: {success_count}/3 tasks successful")
    print("=" * 60)
