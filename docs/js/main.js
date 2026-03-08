// Main entry point — app state, data loading, initialization

const AppState = {
    currentTab: "activity",
    currentEstimate: "most_likely",
    currentRefDate: null,
    currentHorizon: 0,
    selectedState: "US",
    admissionsRate: "total" // "total" or "percapita"
};

let dashboardData = null;
let locationsData = null;
let topoData = null;
let usTrajData = null;
let targetDataAll = null;
let activityThresholds = null;

async function init() {
    try {
        const [dd, ld, td, ut, tgt, at] = await Promise.all([
            d3.json("data/dashboard_data.json"),
            d3.json("data/locations.json"),
            d3.json("data/us-states.json"),
            d3.json("data/trajectories/US.json"),
            d3.json("data/target_data.json"),
            d3.json("data/activity_thresholds.json")
        ]);

        dashboardData = dd;
        locationsData = ld;
        topoData = td;
        usTrajData = ut;
        targetDataAll = tgt;
        activityThresholds = at;

        // Auto-detect most recent reference date
        AppState.currentRefDate = dashboardData.most_recent_reference_date;

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
}

// Reset to most recent forecast and scroll to top
function jumpToMostRecent() {
    if (!dashboardData) return;
    AppState.currentRefDate = dashboardData.most_recent_reference_date;
    AppState.currentHorizon = 0;
    AppState.currentEstimate = "most_likely";
    AppState.currentTab = "activity";
    AppState.admissionsRate = "total";
    AppState.selectedState = "US";

    // Reset UI controls
    d3.selectAll(".tab").classed("active", false);
    d3.select('.tab[data-tab="activity"]').classed("active", true);
    d3.selectAll(".estimate-seg").classed("active", false);
    d3.select('.estimate-seg[data-estimate="most_likely"]').classed("active", true);
    d3.selectAll(".rate-btn").classed("active", false);
    d3.select('.rate-btn[data-rate="total"]').classed("active", true);
    updateRateToggleVisibility();

    buildDateButtons();
    updateAll();
    drawTrajectories();

    window.scrollTo({ top: 0, behavior: "smooth" });
}

// Start the app
init();
