"""Shared season helpers for the flu-ensemble pipeline.

A flu season runs Sep 1 -> Aug 31 and is labeled by its start year,
e.g. a reference date of 2024-11-30 belongs to season "2024-25".

Imported by the scripts/ pipeline (same directory).
"""
from datetime import date, datetime

import pandas as pd

# Sep 1 boundary. A date on/after Sep 1 of year Y belongs to season "Y-(Y+1)".
SEASON_BOUNDARY_MONTH = 9

# Seasons we support, oldest -> newest. Extend as new seasons are added.
SEASONS = ["2023-24", "2024-25", "2025-26"]

SEASON_STARTS = {
    "2023-24": date(2023, 9, 1),
    "2024-25": date(2024, 9, 1),
    "2025-26": date(2025, 9, 1),
}

def _to_date(value):
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    ts = pd.to_datetime(value, errors="coerce")
    if ts is pd.NaT or pd.isna(ts):
        return None
    return ts.date()


def season_of(value):
    """Return the season label ("YYYY-YY") for a date-like value, or None."""
    d = _to_date(value)
    if d is None:
        return None
    start_year = d.year if d.month >= SEASON_BOUNDARY_MONTH else d.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def add_season_column(df, date_col="reference_date", out_col="season"):
    """Return a copy of df with a season label column derived from date_col."""
    out = df.copy()
    dates = pd.to_datetime(out[date_col], errors="coerce")
    start_year = dates.dt.year.where(dates.dt.month >= SEASON_BOUNDARY_MONTH,
                                     dates.dt.year - 1)
    out[out_col] = start_year.map(
        lambda y: f"{int(y)}-{str(int(y) + 1)[-2:]}" if pd.notna(y) else None)
    return out


def current_season(today=None):
    """The season label for today's date (or a supplied reference date)."""
    return season_of(today or date.today())


if __name__ == "__main__":
    for v in ["2023-10-14", "2024-05-04", "2024-11-30", "2025-11-22",
              "2026-05-30", "2026-08-15"]:
        print(f"{v} -> {season_of(v)}")
