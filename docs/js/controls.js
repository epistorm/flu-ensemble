// Controls: tabs, estimate buttons, date selector, rate toggle

function initControls() {
    initTabs();
    initEstimateButtons();
    initRateToggle();
    initEnsembleToggle();
    buildDateButtons();
}

function initTabs() {
    d3.selectAll(".tab").on("click", function () {
        const tab = d3.select(this).attr("data-tab");
        AppState.currentTab = tab;
        d3.selectAll(".tab").classed("active", false);
        d3.select(this).classed("active", true);
        updateRateToggleVisibility();
        updateAll();
    });
}

function initEstimateButtons() {
    d3.selectAll(".estimate-seg").on("click", function () {
        const est = d3.select(this).attr("data-estimate");
        AppState.currentEstimate = est;
        d3.selectAll(".estimate-seg").classed("active", false);
        d3.select(this).classed("active", true);
        updateAll();
    });
}

function initRateToggle() {
    d3.selectAll(".rate-btn").on("click", function () {
        const rate = d3.select(this).attr("data-rate");
        AppState.admissionsRate = rate;
        d3.selectAll(".rate-btn").classed("active", false);
        d3.select(this).classed("active", true);
        updateAll();
    });
    updateRateToggleVisibility();
}

function initEnsembleToggle() {
    d3.selectAll(".ensemble-btn").on("click", function () {
        const model = d3.select(this).attr("data-ensemble");
        AppState.ensembleModel = model;
        d3.selectAll(".ensemble-btn").classed("active", false);
        d3.select(this).classed("active", true);
        // Sync trajectory ensemble toggle
        d3.selectAll(".traj-ensemble-btn").classed("active", false);
        d3.select(`.traj-ensemble-btn[data-ensemble="${model}"]`).classed("active", true);
        updateAll();
        // Reload trajectory chart with the selected ensemble's data
        const fips = d3.select("#traj-location").property("value");
        loadAndDrawTrajectories(fips);
    });
    updateEnsembleToggleVisibility();
}

function updateRateToggleVisibility() {
    const isAdmissions = AppState.currentTab === "admissions";
    const toggle = document.getElementById("rate-toggle");
    if (toggle) {
        toggle.style.display = isAdmissions ? "flex" : "none";
    }
    updateEnsembleToggleVisibility();
}

function updateEnsembleToggleVisibility() {
    const toggle = document.getElementById("ensemble-toggle");
    if (toggle) {
        toggle.style.display = "block";
    }
}

function buildDateButtons() {
    const refDate = AppState.currentRefDate;
    const container = d3.select("#date-buttons");
    container.selectAll("*").remove();

    const horizonLabels = {0: "Wk 1", 1: "Wk 2", 2: "Wk 3", 3: "Wk 4"};

    for (let h = 0; h <= 3; h++) {
        const targetSat = new Date(refDate + "T00:00:00");
        targetSat.setDate(targetSat.getDate() + h * 7);

        const targetSun = new Date(targetSat);
        targetSun.setDate(targetSun.getDate() - 6);

        const label = horizonLabels[h] || `Wk ${h + 1}`;
        const dateRange = `${formatShortDate(targetSun)}\u2013${formatShortDate(targetSat)}`;

        const btn = container.append("button")
            .attr("class", `seg-btn${h === AppState.currentHorizon ? " active" : ""}`)
            .attr("data-horizon", h)
            .on("click", function () {
                const horizon = +d3.select(this).attr("data-horizon");
                AppState.currentHorizon = horizon;
                container.selectAll(".seg-btn").classed("active", false);
                d3.select(this).classed("active", true);
                updateAll();
            });

        btn.append("span").attr("class", "date-range").text(dateRange);
        btn.append("span").attr("class", "date-label").text(label);
    }
}

function formatShortDate(date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getDate()}`;
}
