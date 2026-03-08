# Methodology: Epistorm Ensemble Influenza Hospitalization Forecast

This document describes every calculation performed in the Epistorm Ensemble dashboard and evaluations page, from raw data through final visualization.

---

## Table of Contents

1. [Data Pipeline Overview](#1-data-pipeline-overview)
2. [Step 1: Data Fetching](#2-step-1-data-fetching)
3. [Step 2: Ensemble Creation](#3-step-2-ensemble-creation)
4. [Step 3: Score Calculation (WIS and Coverage)](#4-step-3-score-calculation)
5. [Step 4: Dashboard JSON Export](#5-step-4-dashboard-json-export)
6. [Dashboard Visualizations](#6-dashboard-visualizations)
7. [Evaluations Page](#7-evaluations-page)

---

## 1. Data Pipeline Overview

The pipeline runs weekly (every Thursday at 1 PM UTC via GitHub Actions) in four sequential steps:

```
fetch_data.py → create_ensemble_forecasts.py → calculate_scores.py → preprocess.py
```

Each step reads the outputs of the previous step and writes intermediate files to `data/`. The final step (`preprocess.py`) writes JSON files to `docs/data/` for the web dashboard.

---

## 2. Step 1: Data Fetching

**Script:** `scripts/fetch_data.py`

Downloads from the [FluSight-forecast-hub](https://github.com/cdcepi/FluSight-forecast-hub):

- **Observed data** (`data/observed_data.csv`): Weekly hospital admissions by location (FIPS code) and date.
- **Model forecasts** (`data/all_forecasts.parquet`): Quantile forecasts from 10 contributing models:
  - MIGHTE-Nsemble, MIGHTE-Joint, CEPH-Rtrend_fluH, MOBS-EpyStrain_Flu, MOBS-GLEAM_RL_FLUH, NU-PGF_FLUH, NEU_ISI-FluBcast, NEU_ISI-AdaptiveEnsemble, Gatech-ensemble_prob, Gatech-ensemble_stat
- **Baseline forecasts** (`data/baseline_forecasts.parquet`): FluSight-baseline model for comparison.

Each forecast row contains: model, location, reference_date, target_end_date, horizon, output_type (quantile/pmf), output_type_id (quantile level or category), and value.

**Horizons:** 0 = week ending on reference_date, 1 = +7 days, 2 = +14 days, 3 = +21 days.

**Quantile levels:** 23 levels from 0.01 to 0.99 (0.01, 0.025, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.975, 0.99).

---

## 3. Step 2: Ensemble Creation

**Script:** `scripts/create_ensemble_forecasts.py`
**Library:** `scripts/ensemble.py`

### 3.1 Median Quantile Ensemble

For each (reference_date, location, horizon, quantile_level), compute the **median** across all contributing models:

```
ensemble_q(τ) = median{ model_1(τ), model_2(τ), ..., model_K(τ) }
```

where τ is the quantile level and K is the number of models reporting for that combination.

The FluSight-ensemble model is excluded from the input. Output: `data/quantile_ensemble.pq`.

### 3.2 LOP (Linear Opinion Pool) Ensemble

The LOP method combines model CDFs rather than quantiles directly:

1. For each (reference_date, location, horizon), collect all quantile predictions from all models.
2. For each model, invert its quantile function: given a value x, find the quantile τ where x falls in that model's forecast distribution using linear interpolation between the model's quantile points.
3. Average the resulting quantiles across models:

```
F_ensemble(x) = (1/K) * Σ_{k=1}^{K} F_k(x)
```

where F_k(x) is model k's CDF evaluated at x (obtained by linearly interpolating between quantile points).

4. Invert the averaged CDF back to the target quantile levels using linear interpolation.

Output: `data/quantile_ensemble_LOP.pq`.

### 3.3 Categorical (Trend) Ensemble

Trend categories: `large_decrease`, `decrease`, `stable`, `increase`, `large_increase`.

The trend probabilities are derived from the Median Quantile Ensemble's quantile forecasts by:

1. Computing the change in hospitalizations relative to the most recent observation (using versioned data from Delphi Epidata API when available):
   ```
   count_diff = forecast_value - observed_value_last_week
   rate_change = (count_diff / population) * 100,000
   ```

2. Building a CDF from the quantile forecast via linear interpolation.

3. Applying horizon-specific thresholds to compute category probabilities:

   | Horizon | Stable Rate Max | Stable Count Max | Large Threshold |
   |---------|----------------|-----------------|-----------------|
   | 0 (Wk 1) | 0.3 per 100k | 10 | 1.7 per 100k |
   | 1 (Wk 2) | 0.5 per 100k | 10 | 3.0 per 100k |
   | 2 (Wk 3) | 0.7 per 100k | 10 | 4.0 per 100k |
   | 3 (Wk 4) | 1.0 per 100k | 10 | 5.0 per 100k |

4. The base probability assignment (using rate thresholds):
   ```
   P(large_decrease) = CDF_rate(-large_threshold)
   P(decrease)       = CDF_rate(-stable_rate_max) - CDF_rate(-large_threshold)
   P(stable)         = CDF_rate(+stable_rate_max) - CDF_rate(-stable_rate_max)
   P(increase)       = CDF_rate(+large_threshold) - CDF_rate(+stable_rate_max)
   P(large_increase) = 1 - CDF_rate(+large_threshold)
   ```

5. When the absolute count threshold is more restrictive than the rate threshold (for small states), the count threshold takes precedence, adjusting the boundaries accordingly (9 distinct cases handled in `ensemble.py`).

Output: `data/categorical_ensemble.pq`.

### 3.4 Activity Level Ensemble

Activity levels: `Low`, `Moderate`, `High`, `Very High`.

Per-location thresholds from `data/threshold_levels.csv` (derived from CDC activity levels). For each (reference_date, location, horizon):

1. Build a CDF from the quantile ensemble using linear interpolation.
2. Evaluate the CDF at each threshold:
   ```
   P(Low)       = CDF(threshold_moderate)
   P(Moderate)  = CDF(threshold_high) - CDF(threshold_moderate)
   P(High)      = CDF(threshold_very_high) - CDF(threshold_high)
   P(Very High) = 1 - CDF(threshold_very_high)
   ```
3. Clip negative values to 0 and renormalize so probabilities sum to 1.

Output: `data/activity_level_ensemble.pq`.

---

## 4. Step 3: Score Calculation

**Script:** `scripts/calculate_scores.py`

Scores are computed for all 13 models (10 contributing + FluSight-baseline + Median Epistorm Ensemble + LOP Epistorm Ensemble), for every (model, location, reference_date, horizon) combination where observed data is available.

### 4.1 Weighted Interval Score (WIS)

The WIS is a proper scoring rule for quantile forecasts. For a single forecast-observation pair with K symmetric prediction intervals:

**Interval Score** for a (1-α) prediction interval [l, u] with observation y:

```
IS_α(l, u, y) = (u - l) + (2/α) * (l - y) * 1{y < l} + (2/α) * (y - u) * 1{y > u}
```

The three terms represent:
- **Sharpness**: width of the interval (u - l)
- **Underprediction penalty**: if observation falls below the lower bound
- **Overprediction penalty**: if observation falls above the upper bound

**WIS** combines interval scores across all available prediction intervals plus the median absolute error:

```
WIS = (1 / (K + 0.5)) * [ Σ_{k=1}^{K} (α_k / 2) * IS_k + 0.5 * |median - y| ]
```

where:
- K = 11 (for interval ranges: 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%, 95%, 98%)
- α_k = 1 - (q_upper - q_lower) for interval k
- The quantile pairs are symmetric: (0.01réf, 0.99), (0.025, 0.975), (0.05, 0.95), ..., (0.45, 0.55)
- The 0.5 × |median - y| term accounts for the point forecast

Lower WIS = better forecast.

### 4.2 WIS Ratio

For each forecast row, the WIS ratio is computed as:

```
wis_ratio_row = wis_model / wis_baseline
```

This is stored per-row in `data/wis_ratio.pq` with columns: Model, location, horizon, reference_date, target_end_date, wis, wis_baseline, wis_ratio.

The **aggregated WIS ratio** used in the evaluations page is computed differently (see Section 7.1).

### 4.3 Coverage

Coverage measures the fraction of observations falling within a prediction interval. For a given PI level (e.g., 50%), the symmetric interval is:

```
lower = quantile(0.5 - PI/200)
upper = quantile(0.5 + PI/200)
```

For example, the 50% PI uses quantiles (0.25, 0.75). The 95% PI uses quantiles (0.025, 0.975).

Coverage for a single forecast-observation pair is binary:

```
coverage = 1{lower ≤ observation ≤ upper}
```

PI levels computed: 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%, 95%, 98%.

Output: `data/coverage.pq` with columns: Model, location, reference_date, target_end_date, horizon, 10_cov, 20_cov, ..., 98_cov.

---

## 5. Step 4: Dashboard JSON Export

**Script:** `scripts/preprocess.py`

Converts parquet files into JSON for the web frontend.

### 5.1 dashboard_data.json

For each (reference_date, location, horizon):

- **Trend probabilities**: 5 values summing to 1
- **Activity probabilities**: 4 values summing to 1
- **Most likely category**: argmax of probabilities
- **Lower/upper categories**: 10th and 90th percentile of the cumulative probability distribution:
  ```
  get_percentile_cat(probs, order, pct):
      cumulative = 0
      for each category in order:
          cumulative += prob[category]
          if cumulative >= pct: return category
  ```
- **Median value**: quantile 0.50 from the ensemble
- **Median rate**: median_value / population * 100,000
- **p10, p90 values**: 10th and 90th percentile values

### 5.2 trajectories/{FIPS}.json

Per-location quantile forecasts for the fan chart. For each reference_date and horizons 0-3:
- 9 quantile levels: p025, p05, p10, p25, p50, p75, p90, p95, p975
- Dates (target_end_date for each horizon)

### 5.3 eval_wis.json

Raw per-row data exported as compact arrays:
```json
{
  "models": ["CEPH-Rtrend_fluH", ...],
  "reference_dates": ["2025-11-22", ...],
  "columns": ["model", "location", "date", "horizon", "wis", "wis_baseline"],
  "rows": [["CEPH-Rtrend_fluH", "01", "2025-11-22", 0, 3.04, 7.06], ...]
}
```

The `date` column is the **reference_date** (when the forecast was made), not the target_end_date.

### 5.4 eval_coverage.json

Raw per-row coverage data:
```json
{
  "models": ["CEPH-Rtrend_fluH", ...],
  "pi_levels": [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 98],
  "columns": ["model", "location", "date", "horizon", "cov_10", ..., "cov_98"],
  "rows": [["CEPH-Rtrend_fluH", "01", "2025-11-22", 0, 0.0, 0.0, ..., 1.0], ...]
}
```

Each coverage value is 0 or 1 (binary per individual forecast-observation pair).

---

## 6. Dashboard Visualizations

### 6.1 Choropleth Map (Activity / Trend / Admissions)

**Activity tab**: Each state is colored by its most likely activity level. The "estimate" control selects which percentile to display:
- Most Likely = median forecast → classify using thresholds
- Lower End = 10th percentile → classify
- Upper End = 90th percentile → classify

Classification:
```
if value >= threshold_very_high → Very High
else if value >= threshold_high → High
else if value >= threshold_moderate → Moderate
else → Low
```

**Trend tab**: Each state is colored by its most likely trend category (or lower/upper percentile category).

**Admissions tab**: Each state is colored by its forecast hospitalization value using a sequential white-to-blue color scale. Supports total (absolute) and per 100k display:
```
per_capita_value = total_value / population * 100,000
```

### 6.2 Gauge

A semi-circular gauge with segments for each category. The needle angle is a probability-weighted average:

```
needle_angle = Σ_i (angle_i * prob_i) / Σ_i prob_i
```

where angle_i is the center angle of segment i and prob_i is the probability for that category.

### 6.3 Bar Chart (Uncertainty Distribution)

Horizontal bars showing the probability of each category. The bar width is proportional to the probability. The selected category (based on current estimate mode) is highlighted with a bold border.

### 6.4 Admissions Distribution Histogram

Converts the 9-point quantile forecast into a binned probability histogram:

1. **CDF interpolation**: Given 9 quantile points (p, value), construct a piecewise-linear CDF by interpolating between points:
   ```
   CDF(x) = linear_interp(x; values → quantile_levels)
   ```

2. **Binning**: Divide the forecast range [q0.025, q0.975] into 8 equal-width bins.

3. **Bin probability**: For each bin [lo, hi]:
   ```
   P(bin) = CDF(hi) - CDF(lo)
   ```

4. The bin containing the median (q0.50) is highlighted in darker blue.

### 6.5 Fan Chart (Forecast Details)

Displays quantile forecasts as shaded bands over time:
- **95% prediction interval**: area between p025 and p975 (lightest blue)
- **90% prediction interval**: area between p05 and p95
- **50% prediction interval**: area between p25 and p75 (darkest blue)
- **Median line**: p50 (solid blue line)
- **Observed data**: solid black line (in-sample), dashed gray (out-of-sample / most recent incomplete week)

Clicking on the chart jumps the reference date to the nearest forecast week, updating the map and gauges to that forecast.

**Context overlays** (toggleable):
- **Historical seasons** (2022-23, 2023-24, 2024-25): Dashed lines aligned by week offset from October 1.
- **Activity level bands**: Semi-transparent horizontal bands at threshold levels.

---

## 7. Evaluations Page

### 7.1 WIS Ratio (Relative) — Map and Timeline

The **aggregated WIS ratio** for a model over a set of forecast rows is:

```
WIS_ratio = mean(model_WIS) / mean(baseline_WIS)
```

where the mean is taken over all rows matching the current filters (location, aggregation period, selected horizons), and baseline_WIS is the FluSight-baseline WIS for the same (location, reference_date, horizon) combination.

This is **not** the mean of per-row ratios — it is the ratio of means, ensuring stable behavior even when baseline WIS values are small.

- Values < 1.0: model outperforms the baseline
- Values > 1.0: model underperforms the baseline
- Value = 1.0: equivalent to baseline

**Map color scale**: Diverging blue — light gray — brown, centered at 1.0. Domain [0.3, 3.0].

### 7.2 WIS Raw — Map and Timeline

The **raw WIS** for a model is simply the mean WIS across matching rows:

```
WIS_raw = mean(WIS values for matching rows)
```

Lower values indicate better forecast accuracy.

**Map color scale**: Sequential white to blue. The domain upper bound is set to the 95th percentile of state values (or minimum 10).

### 7.3 Coverage (50% and 95% PI) — Map and Timeline

The **aggregated coverage** at a given PI level is the mean of the binary coverage indicators:

```
Coverage = mean(coverage_indicator for matching rows)
```

where each row's coverage_indicator is 1 if the observation fell within the PI and 0 otherwise.

Ideal values: 50% PI coverage should be ~0.50; 95% PI coverage should be ~0.95.

**Map color scale**: Sequential white to blue. Domain [0, 1.0] (0% to 100%).

### 7.4 Aggregation Controls

**Time period**: Filters reference dates:
- Full Season: all available reference dates
- Last 2 Wk: the 2 most recent reference dates
- Last 4 Wk: the 4 most recent reference dates

**Horizons**: Filters by forecast horizon (multi-select):
- All: horizons 0, 1, 2, 3
- Individual: any subset of {0, 1, 2, 3}

All metrics (map, timeline, box plot, coverage chart) update dynamically when filters change.

### 7.5 Timeline Chart

Shows the selected metric over time (by **reference date**) for:
- The hovered state (when hovering over the map)
- United States overall (when not hovering)

The aggregation window is highlighted with a light blue rectangle. A reference line is drawn at:
- y = 1.0 for WIS Relative (labeled "Baseline")
- y = 0.50 or 0.95 for Coverage metrics (labeled "Ideal")
- No reference line for WIS Raw

### 7.6 Box Plot (Model Comparison)

For each of the 13 models, a horizontal box plot shows the distribution of **per-location WIS ratios** across all states:

1. Filter WIS rows by current aggregation period and horizons.
2. For each model, group by location and compute the aggregated WIS ratio per location:
   ```
   ratio_loc = mean(model_WIS for loc) / mean(baseline_WIS for loc)
   ```
3. Across all locations, compute box plot statistics:
   - **Q1**: 25th percentile of per-location ratios
   - **Median**: 50th percentile
   - **Q3**: 75th percentile
   - **Whiskers**: Q1 - 1.5×IQR and Q3 + 1.5×IQR (clamped to data range)
     ```
     IQR = Q3 - Q1
     whisker_low = max(min_value, Q1 - 1.5 * IQR)
     whisker_high = min(max_value, Q3 + 1.5 * IQR)
     ```
4. Models are sorted by median WIS ratio (best at top).

A vertical dashed line at x = 1.0 marks the baseline. A log scale toggle is available.

Hover tooltip shows: model name, median, mean, Q1-Q3, whisker range, and number of states.

### 7.7 Coverage Chart (Model Comparison)

A line chart showing mean coverage vs. PI level for each model:

1. Filter coverage rows by current aggregation period and horizons.
2. For each model and each PI level (10%, 20%, ..., 98%):
   ```
   mean_coverage = mean(coverage_indicator across all matching rows)
   ```
3. Plot one line per model. A dashed diagonal line represents ideal calibration (coverage = PI level).

Hover interaction: the nearest model line is highlighted and others fade. The tooltip shows the model name and its coverage at every PI level.

---

## Appendix: Key File Paths

| File | Description |
|------|-------------|
| `data/observed_data.csv` | Weekly hospital admissions |
| `data/all_forecasts.parquet` | Individual model forecasts |
| `data/baseline_forecasts.parquet` | FluSight-baseline forecasts |
| `data/quantile_ensemble.pq` | Median quantile ensemble |
| `data/quantile_ensemble_LOP.pq` | LOP quantile ensemble |
| `data/categorical_ensemble.pq` | Trend probabilities |
| `data/activity_level_ensemble.pq` | Activity level probabilities |
| `data/wis_ratio.pq` | Per-row WIS scores |
| `data/coverage.pq` | Per-row coverage scores |
| `data/locations.csv` | Location metadata (FIPS, population) |
| `data/threshold_levels.csv` | Activity level thresholds |
| `docs/data/dashboard_data.json` | Dashboard map/gauge data |
| `docs/data/trajectories/*.json` | Per-location fan chart data |
| `docs/data/eval_wis.json` | Evaluation WIS data |
| `docs/data/eval_coverage.json` | Evaluation coverage data |
