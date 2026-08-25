// Main entry point — app state, data loading, initialization

const AppState = {
    currentTab: "activity",
    currentEstimate: "most_likely",
    currentRefDate: null,
    currentHorizon: 0,
    selectedState: "US",
    admissionsRate: "total", // "total" or "percapita"
    ensembleModel: "median", // "median" or "lop"
    currentSeason: null      // e.g. "2025-26"; null = latest
};

// --- Season helpers (Sep-1 boundary, mirrors scripts/season_utils.py) ---
function seasonOfDate(dstr) {
    const d = new Date(dstr + "T00:00:00");
    // getMonth() is 0-indexed; 8 = September.
    const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String(y + 1).slice(-2)}`;
}

function seasonStartYear(season) {
    return parseInt(season.slice(0, 4), 10);
}

// Reference dates (from the active dashboard data) belonging to a season.
function refDatesForSeason(season) {
    const dd = dashboardData;
    const map = dd.reference_date_seasons || {};
    return dd.reference_dates.filter(rd => (map[rd] || seasonOfDate(rd)) === season);
}

// The seasons available in the data, newest first.
function availableSeasons() {
    return (dashboardData.seasons || [seasonOfDate(dashboardData.most_recent_reference_date)])
        .slice().sort().reverse();
}

// Forecasts built from this many member models or fewer get a caution note.
const THIN_ENSEMBLE_MAX = 3;

// Number of member models that contributed to a given date/location forecast.
function getModelCount(refDate, fips) {
    const mc = (getActiveDashboardData() || {}).model_counts || {};
    return mc[refDate] ? mc[refDate][fips] : undefined;
}

// Show/refresh the National Overview (US) thin-ensemble disclaimer.
function updateDisclaimers() {
    const el = document.getElementById("overview-disclaimer");
    if (!el) return;
    const n = getModelCount(AppState.currentRefDate, "US");
    if (n != null && n <= THIN_ENSEMBLE_MAX) {
        el.textContent = `⚠ This forecast combines only ${n} model${n === 1 ? "" : "s"} for this week — interpret with added caution.`;
        el.style.display = "";
    } else {
        el.style.display = "none";
    }
}

let dashboardData = null;
let dashboardDataLOP = null;
let locationsData = null;
let topoData = null;
let usTrajData = null;
let usTrajDataLOP = null;
let targetDataAll = null;
let activityThresholds = null;

// Get the active dashboard data based on selected ensemble model
function getActiveDashboardData() {
    if (AppState.ensembleModel === "lop" && dashboardDataLOP) {
        return dashboardDataLOP;
    }
    return dashboardData;
}

// Get the active US trajectory data based on selected ensemble model
function getActiveUsTrajData() {
    if (AppState.ensembleModel === "lop" && usTrajDataLOP) {
        return usTrajDataLOP;
    }
    return usTrajData;
}

async function init() {
    try {
        const [dd, ddLop, ld, td, ut, utLop, tgt, at] = await Promise.all([
            d3.json("data/dashboard_data.json"),
            d3.json("data/dashboard_data_lop.json").catch(() => null),
            d3.json("data/locations.json"),
            d3.json("data/us-states.json"),
            d3.json("data/trajectories/US.json"),
            d3.json("data/trajectories_lop/US.json").catch(() => null),
            d3.json("data/target_data.json"),
            d3.json("data/activity_thresholds.json")
        ]);

        dashboardData = dd;
        dashboardDataLOP = ddLop;
        locationsData = ld;
        topoData = td;
        usTrajData = ut;
        usTrajDataLOP = utLop;
        targetDataAll = tgt;
        activityThresholds = at;

        // Auto-detect most recent reference date + its season
        AppState.currentRefDate = dashboardData.most_recent_reference_date;
        AppState.currentSeason = seasonOfDate(AppState.currentRefDate);

        // Display last-updated timestamp (Wednesday of the reference date week)
        const lastUpdatedEl = document.getElementById("last-updated");
        if (lastUpdatedEl && AppState.currentRefDate) {
            const refSat = new Date(AppState.currentRefDate + "T00:00:00");
            // Reference date is Saturday; Wednesday of that week is 3 days earlier
            const wed = new Date(refSat);
            wed.setDate(wed.getDate() - 3);
            const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            const formatted = `${months[wed.getMonth()]} ${wed.getDate()}, ${wed.getFullYear()}`;
            lastUpdatedEl.textContent = `\u00A0\u00A0|\u00A0\u00A0Last Updated: ${formatted}`;
        }

        // Initialize components
        initControls();
        initMap(topoData);
        initLegend();
        initGauges();
        initTrajectoryChart();
        initInfoButtons();
        initSeasonSelector();
        initForecastDateSelector();

        // Initial render
        updateAll();

    } catch (err) {
        console.error("Failed to load dashboard data:", err);
        document.body.innerHTML = `
            <div style="padding:40px;text-align:center;font-family:sans-serif;color:#c00">
                <h2>Error loading dashboard</h2>
                <p>${err.message}</p>
                <p>Make sure to serve this directory with a local web server.</p>
            </div>`;
    }
}

function updateAll() {
    updateMapColors();
    updateGauges();
    updateLegend();
    updateDisclaimers();
}

// --- Forecast-date selector (near the map) ---
function formatRefDateLabel(dstr) {
    const d = new Date(dstr + "T00:00:00");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Rebuild the forecast-date dropdown for the active season (newest first).
function populateForecastDateSelector() {
    const sel = document.getElementById("overview-date-select");
    if (!sel) return;
    const dates = refDatesForSeason(AppState.currentSeason).slice().reverse();
    sel.innerHTML = "";
    dates.forEach(d => {
        const o = document.createElement("option");
        o.value = d;
        o.textContent = formatRefDateLabel(d);
        sel.appendChild(o);
    });
    sel.value = AppState.currentRefDate;
}

// Keep the dropdown in sync when the ref date changes elsewhere (e.g. chart click).
function syncForecastDateSelector() {
    const sel = document.getElementById("overview-date-select");
    if (sel && sel.value !== AppState.currentRefDate) sel.value = AppState.currentRefDate;
}

function initForecastDateSelector() {
    const sel = document.getElementById("overview-date-select");
    if (!sel) return;
    populateForecastDateSelector();
    sel.addEventListener("change", () => {
        AppState.currentRefDate = sel.value;
        buildDateButtons();
        updateAll();
        drawTrajectories();
    });
}

// Populate + wire the global season selector.
function initSeasonSelector() {
    const sel = document.getElementById("season-select");
    if (!sel) return;
    const seasons = availableSeasons();
    sel.innerHTML = "";
    seasons.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        if (s === AppState.currentSeason) opt.selected = true;
        sel.appendChild(opt);
    });
    sel.value = AppState.currentSeason;
    sel.addEventListener("change", () => switchSeason(sel.value));
}

// Switch the whole dashboard to a season: jump to that season's latest forecast.
function switchSeason(season) {
    if (season === AppState.currentSeason) return;
    AppState.currentSeason = season;
    const dates = refDatesForSeason(season);
    if (dates.length) {
        AppState.currentRefDate = dates[dates.length - 1];
    }
    AppState.currentHorizon = 0;
    if (typeof refreshContextSeasons === "function") refreshContextSeasons();
    populateForecastDateSelector();
    buildDateButtons();
    updateAll();
    drawTrajectories();
}

// Reset to most recent forecast and scroll to top
function jumpToMostRecent() {
    if (!dashboardData) return;
    AppState.currentRefDate = dashboardData.most_recent_reference_date;
    AppState.currentSeason = seasonOfDate(AppState.currentRefDate);
    AppState.currentHorizon = 0;
    AppState.currentEstimate = "most_likely";
    AppState.currentTab = "activity";
    AppState.admissionsRate = "total";
    AppState.ensembleModel = "median";
    AppState.selectedState = "US";
    const seasonSel = document.getElementById("season-select");
    if (seasonSel) seasonSel.value = AppState.currentSeason;

    // Reset UI controls
    d3.selectAll(".tab").classed("active", false);
    d3.select('.tab[data-tab="activity"]').classed("active", true);
    d3.selectAll(".estimate-seg").classed("active", false);
    d3.select('.estimate-seg[data-estimate="most_likely"]').classed("active", true);
    d3.selectAll(".rate-btn").classed("active", false);
    d3.select('.rate-btn[data-rate="total"]').classed("active", true);
    d3.selectAll(".ensemble-btn").classed("active", false);
    d3.select('.ensemble-btn[data-ensemble="median"]').classed("active", true);
    updateRateToggleVisibility();

    if (typeof refreshContextSeasons === "function") refreshContextSeasons();
    populateForecastDateSelector();
    buildDateButtons();
    updateAll();
    drawTrajectories();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

// Start the app
init();
