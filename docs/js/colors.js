// Color schemes and category constants for the flu dashboard

// Trend colors
const TREND_COLORS = {
    large_decrease: "#75BFBD",
    decrease: "#9CD3B4",
    stable: "#D3D3CD",
    increase: "#EFDA86",
    large_increase: "#E8A56D"
};

const TREND_ORDER = ["large_decrease", "decrease", "stable", "increase", "large_increase"];

const TREND_LABELS = {
    large_decrease: "Large Decrease",
    decrease: "Decrease",
    stable: "Stable",
    increase: "Increase",
    large_increase: "Large Increase"
};

// Activity colors
const ACTIVITY_COLORS = {
    low: "#E4F7EE",
    moderate: "#9CD8D3",
    high: "#4B9AC1",
    very_high: "#4D6891"
};

const ACTIVITY_ORDER = ["low", "moderate", "high", "very_high"];

const ACTIVITY_LABELS = {
    low: "Low",
    moderate: "Medium",
    high: "High",
    very_high: "Very High"
};

const NO_DATA_COLOR = "#f9f9f9";

// Darker variants for readable text on white backgrounds
const TREND_TEXT_COLORS = {
    large_decrease: "#4FA09E",
    decrease: "#6BAD8A",
    stable: "#999",
    increase: "#C4A840",
    large_increase: "#CF7A3A"
};

const ACTIVITY_TEXT_COLORS = {
    low: "#4A9A6F",
    moderate: "#4AA099",
    high: "#3A7BA0",
    very_high: "#4D6891"
};

// Gauge descriptive text
const TREND_DESCRIPTIONS = {
    large_decrease: "Flu hospitalizations are forecast to largely decrease",
    decrease: "Flu hospitalizations are forecast to decrease",
    stable: "Flu hospitalizations are forecast to remain stable",
    increase: "Flu hospitalizations are forecast to increase",
    large_increase: "Flu hospitalizations are forecast to largely increase"
};

const ACTIVITY_DESCRIPTIONS = {
    low: "Flu activity is at low levels nationally",
    moderate: "Flu activity is at moderate levels nationally",
    high: "Flu activity is at high levels nationally",
    very_high: "Flu activity is at very high levels nationally"
};

// Semi-transparent activity colors for chart band overlay (less fading)
const ACTIVITY_BAND_COLORS = {
    low: "rgba(228, 247, 238, 0.3)",
    moderate: "rgba(156, 216, 211, 0.25)",
    high: "rgba(75, 154, 193, 0.2)",
    very_high: "rgba(77, 104, 145, 0.2)"
};

// Historical season colors for "Add Context" (more distinct)
const SEASON_COLORS = {
    "2022-23": "#E07B54",
    "2023-24": "#7B68AE",
    "2024-25": "#4A9A6F"
};

// Classify a raw hospitalization value into an activity level using thresholds
function classifyActivity(value, fips) {
    if (typeof activityThresholds === "undefined" || !activityThresholds) return null;
    const th = activityThresholds[fips];
    if (!th || value == null) return null;
    if (value >= th.very_high) return "very_high";
    if (value >= th.high) return "high";
    if (value >= th.moderate) return "moderate";
    return "low";
}

