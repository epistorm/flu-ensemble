# Activity Snapshot — Flu Forecasting Dashboard

*Content outline for an Epistorm "Activity in a Snapshot" one-pager. Plain-language,
nontechnical. Headings and copy below; design/layout handled separately. Figure
suggestions are noted in italics under the sections where a screenshot would help.*

---

## Flu Forecasting Dashboard

**Launch the dashboard:** fluforecast.epistorm.org · **Forecasts** / **Evaluations** / **About**

---

## At a Glance

The Epistorm Flu Forecasting Dashboard turns the week's influenza forecasts into
visualizations anyone can explore. Each week it shows where flu hospitalizations
stand, how they are expected to change over the next month, and how far they might
rise or fall — for every US state, Washington DC, and the nation as a whole.

The dashboard combines many independent forecasting models into a single "ensemble"
forecast, and then lets you check, in retrospect, how well those forecasts actually
performed. Anticipating flu activity ahead of time helps hospitals, public health
officials, and the public manage uncertainty and plan for what is coming.

## Public Health Relevance

Gives public health officials, policymakers, health care providers, and the public
an easy-to-read, interactive view of up-to-date flu forecasts — plus an honest,
side-by-side record of how reliable those forecasts have been.

## Background: Influenza Forecasting & FluSight

The US flu season typically runs from October through May, usually peaking between
December and February, but its timing and severity change from year to year.
**FluSight** is the CDC's collaborative forecasting effort: research teams across the
country submit weekly predictions of flu hospital admissions, which are combined into
ensemble forecasts that inform decisions about staffing, vaccination campaigns, and
public messaging. FluSight has collected consistent, comparable forecasts every
season since 2021–22.

The **Epistorm Ensemble**, developed at Northeastern University, contributes several
models to FluSight and publishes this dashboard to make the forecasts — and their
track record — transparent and explorable.

## How the Ensemble Works

Rather than relying on any single model, the dashboard blends the forecasts that many
teams submit to FluSight each week into one combined prediction. Two blending methods
are offered side by side:

- **Median ensemble** — takes the middle value across all models. Simple and robust;
  a few unusual forecasts can't skew the result.
- **Linear Opinion Pool (LOP) ensemble** — averages the models' full probability
  distributions, so genuine disagreement between models shows up as wider, more honest
  uncertainty.

The pool of contributing models has grown each season — from a handful early on to
more than a dozen today — and the dashboard now spans multiple past seasons, so you
can look back as well as ahead. The CDC's own FluSight ensemble is shown alongside for
comparison. When only a few models contribute in a given week, the dashboard flags it
so forecasts are read with appropriate caution.

## The Forecasts Page

The main page presents the forecast three complementary ways. A national summary sits
at the top, a US map lets you compare states at a glance, and hovering any state opens
a detailed breakdown.

*Figure: annotated screenshot of the Forecasts page — national summary, map, and the
three view tabs.*

**A. Influenza Activity** — How busy is flu season right now, and where is it headed?
Each state is colored by its forecasted activity level: **Low, Medium, High, or Very
High**. These levels are calibrated **separately for each state** against its own
history, so "High" means high *for that state* — not just a large raw number in a
populous one. Hovering a state shows the exact weekly-admission ranges behind each level.

**B. Influenza Trend** — Is flu expected to rise, fall, or hold steady? Each state is
classified into one of five directions — **large decrease, decrease, stable, increase,
or large increase** — based on how much weekly hospitalizations are expected to change
from the week before. Hovering a state shows the probability of each direction and the
admission-count ranges that define them.

**C. Weekly Hospital Admissions** — The underlying numbers. Four-week-ahead forecasts
of new weekly flu hospital admissions, shown with a central estimate and prediction
intervals that convey how uncertain the forecast is, at both national and state levels.

**Forecast Details** — Below the map, a detailed chart shows the full forecast for any
selected state over time, with options to overlay previous seasons for context and to
shade the state's activity-level bands — so you can see where this season's forecast
falls relative to past years.

## The Evaluations Page

Forecasts are only useful if they are reliable, so the dashboard keeps score. The
Evaluations page compares model performance across states, forecast weeks, and
seasons using standard metrics:

- **Weighted Interval Score (WIS)** — overall forecast accuracy, shown relative to a
  simple baseline (below 1.0 means a model beat the baseline) or as a raw score.
- **Coverage** — how often the real value landed inside the model's stated prediction
  intervals (50% and 95%), a check on whether uncertainty is honestly calibrated.

A state-level map shows where models do better or worse, interactive box plots compare
all contributing teams, and users can filter by forecast horizon (1–4 weeks ahead) and
by time period — the full season, or just the most recent 2 or 4 weeks — across
multiple flu seasons. Individual model performance over time is available too.

*Figure: annotated screenshot of the Evaluations page — performance map, metric
toggles, and model-comparison box plots.*

## Meet the Models

The ensemble draws on a diverse set of approaches, so its strengths don't depend on
any one modeling style. Contributors span, among others:

- **Mechanistic / metapopulation models** (e.g., MOBS-GLEAM) that simulate how flu
  spreads through the population using human-mobility data.
- **Compartmental models** (e.g., NEU_ISI-FluBcast, MOBS-EpyStrain) that track flu
  through population groups, some including behavioral feedback.
- **Renewal-equation / Rt models** (e.g., CEPH-Rtrend) that estimate how fast flu is
  currently spreading and project it forward.
- **Statistical and machine-learning models** (e.g., the MIGHTE and Gatech ensembles)
  that learn patterns from past data and signals like Google Trends.
- **AI surrogate models** (e.g., GLEAM_AI) trained to reproduce slower mechanistic
  models at a fraction of the cost.

*Full model descriptions and the seasons each participated in are on the dashboard's
About page.*

## Data & Updates

- **Source:** Weekly influenza hospital-admission reports (NHSN), as published through
  the CDC FluSight Forecast Hub, using the data that was available at forecast time.
- **Coverage:** All 50 states, Washington DC, and the US nationally; forecasts for 1–4
  weeks ahead, with multiple past seasons available for review.
- **Cadence:** The dashboard updates automatically every week — it fetches the latest
  model submissions, builds the ensemble, scores performance, and redeploys.

## Access

- **Dashboard:** fluforecast.epistorm.org
- **Methods & model details:** the dashboard's About page
- **Code & data:** the Epistorm flu-ensemble GitHub repository

## Funding

This project was made possible by cooperative agreement CDC-RFA-FT-23-0069 from the
CDC's Center for Forecasting and Outbreak Analytics. Its contents are solely the
responsibility of the authors and do not necessarily represent the official views of
the Centers for Disease Control and Prevention.
