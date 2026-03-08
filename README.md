# Epistorm Ensemble — Influenza Hospitalization Forecast Dashboard

A quantile-based forecast dashboard for the Epistorm Ensemble model, showing weekly influenza hospitalization forecasts for all US states with prediction intervals, trend forecasts, and activity level classifications.

For detailed methodology including all formulas and calculations, see [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Contributing Models

MIGHTE-Nsemble, MIGHTE-Joint, CEPH-Rtrend_fluH, MOBS-EpyStrain_Flu, MOBS-GLEAM_RL_FLUH, NU-PGF_FLUH, NEU_ISI-FluBcast, NEU_ISI-AdaptiveEnsemble, Gatech-ensemble_prob, Gatech-ensemble_stat

## Repository Structure

```
flu-ensemble/
├── data/
│   ├── locations.csv                  # Location metadata (FIPS, name, population)
│   ├── threshold_levels.csv           # Activity level thresholds
│   ├── observed_data.csv              # Observed hospitalizations (fetched)
│   ├── all_forecasts.parquet          # All model forecasts (fetched)
│   ├── baseline_forecasts.parquet     # FluSight-baseline forecasts (fetched)
│   ├── quantile_ensemble.pq           # Median ensemble quantile forecasts
│   ├── quantile_ensemble_LOP.pq       # LOP ensemble quantile forecasts
│   ├── categorical_ensemble.pq        # Trend categorical forecasts
│   ├── activity_level_ensemble.pq     # Activity level forecasts
│   ├── ensemble_forecasts.pq          # Combined ensemble output
│   ├── wis_ratio.pq                   # WIS ratio scores
│   └── coverage.pq                    # PI coverage scores
├── scripts/
│   ├── fetch_data.py                  # Step 1: Fetch forecasts from FluSight hub
│   ├── create_ensemble_forecasts.py   # Step 2: Create ensemble forecasts
│   ├── calculate_scores.py            # Step 3: Calculate WIS and coverage scores
│   ├── ensemble.py                    # Ensemble methods library
│   └── preprocess.py                  # Step 4: Generate dashboard JSON
├── docs/                              # Dashboard (GitHub Pages)
│   ├── index.html
│   ├── evaluations.html
│   ├── about.html
│   ├── css/style.css
│   ├── js/
│   │   ├── main.js
│   │   ├── trajectories.js
│   │   ├── map.js
│   │   ├── gauges.js
│   │   ├── controls.js
│   │   ├── colors.js
│   │   ├── legend.js
│   │   ├── evaluations.js
│   │   └── tour.js
│   └── data/                          # Generated JSON (output of preprocess.py)
│       ├── dashboard_data.json
│       ├── locations.json
│       ├── target_data.json
│       ├── historical_seasons.json
│       ├── activity_thresholds.json
│       ├── eval_wis.json
│       ├── eval_coverage.json
│       ├── trajectories/
│       └── baseline_quantiles/
└── .github/workflows/
    └── update_data.yml                # Weekly automated pipeline
```

## Data Pipeline

A GitHub Actions workflow (`.github/workflows/update_data.yml`) runs automatically every Thursday at 1 PM UTC:

1. **Fetch** (`scripts/fetch_data.py`) — Downloads the latest model forecasts and observed data from the [FluSight-forecast-hub](https://github.com/cdcepi/FluSight-forecast-hub)
2. **Ensemble** (`scripts/create_ensemble_forecasts.py`) — Creates quantile (Median and LOP), categorical (trend), and activity-level ensemble forecasts using methods in `scripts/ensemble.py`
3. **Score** (`scripts/calculate_scores.py`) — Calculates WIS and prediction interval coverage for all 13 models (10 contributing + baseline + 2 ensembles)
4. **Dashboard** (`scripts/preprocess.py`) — Converts ensemble output and scores into JSON files for the dashboard and evaluations page
5. **Deploy** — Commits updated `data/` and `docs/data/` to main, then deploys to GitHub Pages

## Updating Models Each Week

### Automatic updates

The GitHub Actions workflow handles the full pipeline automatically. No manual intervention is required unless:
- A new contributing model is added or removed
- The Delphi Epidata API key (`COVIDCAST_API_KEY`) expires (stored as a GitHub repository secret)
- Thresholds change (update `data/threshold_levels.csv`)

To manually trigger the workflow: Go to the repository's **Actions** tab → "Update Forecast Data and Deploy Dashboard" → **Run workflow**.

### Manual local update

#### Setup

```bash
pip install pandas numpy pyarrow requests epiweeks scipy covidcast delphi_epidata
export COVIDCAST_API_KEY=your_key_here
```

Note: `create_ensemble_forecasts.py` requires the `COVIDCAST_API_KEY` environment variable for accessing the Delphi Epidata API (used to fetch versioned observation data for trend classification).

#### Run the full pipeline

```bash
# 1. Fetch latest forecasts and observed data
python scripts/fetch_data.py

# 2. Create ensemble forecasts (quantile, categorical, activity level)
python scripts/create_ensemble_forecasts.py

# 3. Calculate WIS and coverage scores (may take several minutes)
python scripts/calculate_scores.py

# 4. Generate dashboard JSON files (dashboard + evaluations)
python scripts/preprocess.py
```

Each step depends on the previous step's output. They must run in order.

#### Verify locally

```bash
python -m http.server -d docs
```

Open `http://localhost:8000` and check:
- **Dashboard**: Map shows data for the latest reference date; forecast week buttons include all dates; fan chart shows quantile bands; "Most Recent Forecast" button works
- **Evaluations**: Map shows WIS ratio; aggregation and horizon controls update all charts; box plot and coverage chart render for all 13 models

### Adding or removing a contributing model

1. Update `scripts/fetch_data.py` to include/exclude the model from the download list.
2. Re-run the full pipeline. The ensemble, scores, and dashboard will automatically pick up the change.
3. No changes to the frontend are needed — models are discovered dynamically from the data.

## What Each Script Produces

### fetch_data.py
- `data/observed_data.csv` — Hospital admissions from CDC
- `data/all_forecasts.parquet` — Forecasts from all contributing models
- `data/baseline_forecasts.parquet` — FluSight-baseline forecasts

### create_ensemble_forecasts.py
- `data/quantile_ensemble.pq` — Median method quantile ensemble
- `data/quantile_ensemble_LOP.pq` — LOP method quantile ensemble
- `data/categorical_ensemble.pq` — Trend category probabilities (large_decrease, decrease, stable, increase, large_increase)
- `data/activity_level_ensemble.pq` — Activity level probabilities (Low, Moderate, High, Very High)
- `data/ensemble_forecasts.pq` — All ensemble outputs combined

### calculate_scores.py
- `data/wis_ratio.pq` — WIS ratios relative to FluSight-baseline
- `data/coverage.pq` — Prediction interval coverage

### preprocess.py
- `docs/data/dashboard_data.json` — Trend/activity probabilities for the map and gauges
- `docs/data/trajectories/{FIPS}.json` — Quantile forecasts for the fan chart
- `docs/data/target_data.json` — Observed data for all locations
- `docs/data/historical_seasons.json` — Previous season curves
- `docs/data/locations.json` — Location metadata
- `docs/data/eval_wis.json` — Per-row WIS scores for the evaluations page (raw data for client-side aggregation)
- `docs/data/eval_coverage.json` — Per-row PI coverage for the evaluations page
