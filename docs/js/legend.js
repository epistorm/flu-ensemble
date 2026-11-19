// Color bar legend component (vertical layout)

function initLegend() {
    updateLegend();
}

function updateLegend() {
    const container = d3.select("#legend");
    container.selectAll("*").remove();

    const type = AppState.currentTab;

    if (type === "admissions") {
        drawAdmissionsLegend(container);
        return;
    }

    const order = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = type === "trend" ? TREND_LABELS : ACTIVITY_LABELS;

    // Horizontal swatch row, laid out as a caption strip below the map.
    const row = container.append("div").attr("class", "legend-items");

    order.forEach((cat) => {
        const needsStroke = (cat === "low" || cat === "stable" || cat === "minimal");
        const item = row.append("div").attr("class", "legend-item");
        item.append("span")
            .attr("class", "legend-swatch" + (needsStroke ? " legend-swatch-bordered" : ""))
            .style("background-color", colors[cat]);
        item.append("span")
            .attr("class", "legend-label")
            .text(labels[cat]);
    });

    // Hover affordance: "What do these mean?" with a popover explaining the levels.
    const hint = container.append("div")
        .attr("class", "legend-info-hint")
        .attr("tabindex", "0")
        .html('<span class="legend-info-icon">i</span>What do these mean?');
    attachLegendInfo(hint, type);
}

// --- Legend hover popover: general explanation of the levels ---

function trendInfoHtml() {
    return '<div class="legend-tip-title">Influenza Trend</div>' +
        '<p>A forecast is labeled by <b>how much</b> flu hospitalizations change from the ' +
        'week before — the <b>change in rate per 100,000</b>. Each level below applies to ' +
        'both an increase and a decrease of that size.</p>' +
        '<table class="legend-tip-table">' +
        '<thead><tr><th>Weeks<br>ahead</th><th>Stable</th><th>Increase /<br>Decrease</th><th>Large<br>Inc / Dec</th></tr></thead>' +
        '<tbody>' +
        '<tr><td>1</td><td>&lt; 0.3</td><td>0.3 – 1.7</td><td>&ge; 1.7</td></tr>' +
        '<tr><td>2</td><td>&lt; 0.5</td><td>0.5 – 3.0</td><td>&ge; 3.0</td></tr>' +
        '<tr><td>3</td><td>&lt; 0.7</td><td>0.7 – 4.0</td><td>&ge; 4.0</td></tr>' +
        '<tr><td>4</td><td>&lt; 1.0</td><td>1.0 – 5.0</td><td>&ge; 5.0</td></tr>' +
        '</tbody></table>' +
        '<p class="legend-tip-note">Hover a state for its ranges in weekly admissions.</p>';
}

function activityInfoHtml() {
    return '<div class="legend-tip-title">Influenza Activity</div>' +
        '<p>Where this week’s forecasted hospitalizations fall relative to a state’s ' +
        'past flu seasons. <b>Thresholds are specific to each state.</b></p>' +
        '<ul class="legend-tip-list">' +
        '<li><b>Low</b> &mdash; below typical seasonal activity</li>' +
        '<li><b>Medium</b> &mdash; around typical seasonal activity</li>' +
        '<li><b>High</b> &mdash; busier than most weeks of a season</li>' +
        '<li><b>Very High</b> &mdash; near or above past seasonal peaks</li>' +
        '</ul>' +
        '<p class="legend-tip-note">Hover a state for its weekly-admission ranges.</p>';
}

function legendInfoHtml(type) {
    if (type === "trend") return trendInfoHtml();
    return activityInfoHtml();
}

// Full-number formatter for the national popover (e.g. 7408 -> "7,408").
function _fmtFullCount(v) {
    return Math.round(Math.abs(v)).toLocaleString("en-US");
}

// Compact formatter (e.g. 1020 -> "1.0k") for the denser trend table.
function _fmtCompactCount(v) {
    const n = Math.round(Math.abs(v));
    if (n >= 10000) return Math.round(n / 1000) + "k";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(n);
}

// National forecast popover: tab-specific, with the actual US threshold values
// (there is no per-state hover for the US as a whole).
function nationalInfoHtml() {
    const tab = AppState.currentTab;

    if (tab === "activity") {
        const th = (typeof activityThresholds !== "undefined" && activityThresholds)
            ? activityThresholds["US"] : null;
        let table = "";
        if (th) {
            table = '<table class="legend-tip-table">' +
                '<thead><tr><th>Level</th><th>Weekly admissions</th></tr></thead><tbody>' +
                '<tr><td>Low</td><td>0 – ' + _fmtFullCount(th.moderate) + '</td></tr>' +
                '<tr><td>Medium</td><td>' + _fmtFullCount(th.moderate) + ' – ' + _fmtFullCount(th.high) + '</td></tr>' +
                '<tr><td>High</td><td>' + _fmtFullCount(th.high) + ' – ' + _fmtFullCount(th.very_high) + '</td></tr>' +
                '<tr><td>Very High</td><td>&ge; ' + _fmtFullCount(th.very_high) + '</td></tr>' +
                '</tbody></table>';
        }
        return '<div class="legend-tip-title">Influenza Activity — United States</div>' +
            '<p>Where this week’s US forecast falls relative to past flu-season intensity. ' +
            '<b>Thresholds are national.</b></p>' +
            table;
    }

    // Trend: show all forecast weeks (horizons) in US admission counts, mirroring
    // the legend table's structure so the two read consistently.
    const tt = ((getActiveDashboardData() || {}).trend_thresholds || {})["US"];
    let table = "";
    if (tt) {
        let rows = "";
        for (let hh = 0; hh <= 3; hh++) {
            const th = tt[String(hh)];
            if (!th) continue;
            const s = _fmtCompactCount(th.stable);
            const l = _fmtCompactCount(th.large);
            rows += '<tr><td>' + (hh + 1) + '</td><td>&lt; ' + s + '</td><td>' +
                s + ' – ' + l + '</td><td>&ge; ' + l + '</td></tr>';
        }
        table = '<table class="legend-tip-table">' +
            '<thead><tr><th>Weeks<br>ahead</th><th>Stable</th><th>Increase /<br>Decrease</th><th>Large<br>Inc / Dec</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }
    return '<div class="legend-tip-title">Influenza Trend — United States</div>' +
        '<p>A forecast is labeled by <b>how much</b> weekly admissions change from the week ' +
        'before. Each level applies to both an increase and a decrease of that size.</p>' +
        table;
}

// Per-gauge popovers for the overview sidebar. These follow the selected
// location (US by default, or a state chosen from the map / dropdown) and show
// that location's actual threshold values, falling back to US thresholds.
function _sidebarLoc() {
    if (typeof getSidebarLocation === "function") return getSidebarLocation();
    return { fips: "US", name: "United States" };
}

function sidebarActivityInfoHtml() {
    const loc = _sidebarLoc();
    const thAll = (typeof activityThresholds !== "undefined" && activityThresholds)
        ? activityThresholds : {};
    const th = thAll[loc.fips] || thAll["US"] || null;
    let table = "";
    if (th) {
        table = '<table class="legend-tip-table">' +
            '<thead><tr><th>Level</th><th>Weekly admissions</th></tr></thead><tbody>' +
            '<tr><td>Low</td><td>0 – ' + _fmtFullCount(th.moderate) + '</td></tr>' +
            '<tr><td>Medium</td><td>' + _fmtFullCount(th.moderate) + ' – ' + _fmtFullCount(th.high) + '</td></tr>' +
            '<tr><td>High</td><td>' + _fmtFullCount(th.high) + ' – ' + _fmtFullCount(th.very_high) + '</td></tr>' +
            '<tr><td>Very High</td><td>&ge; ' + _fmtFullCount(th.very_high) + '</td></tr>' +
            '</tbody></table>';
    }
    return '<div class="legend-tip-title">Influenza Activity — ' + loc.name + '</div>' +
        '<p>Where this week’s forecast falls relative to past flu-season intensity. ' +
        '<b>Thresholds are specific to each location.</b></p>' +
        table;
}

function sidebarTrendInfoHtml() {
    const loc = _sidebarLoc();
    const allTt = (getActiveDashboardData() || {}).trend_thresholds || {};
    const tt = allTt[loc.fips] || allTt["US"];
    let table = "";
    if (tt) {
        let rows = "";
        for (let hh = 0; hh <= 3; hh++) {
            const th = tt[String(hh)];
            if (!th) continue;
            const s = _fmtCompactCount(th.stable);
            const l = _fmtCompactCount(th.large);
            rows += '<tr><td>' + (hh + 1) + '</td><td>&lt; ' + s + '</td><td>' +
                s + ' – ' + l + '</td><td>&ge; ' + l + '</td></tr>';
        }
        table = '<table class="legend-tip-table">' +
            '<thead><tr><th>Weeks<br>ahead</th><th>Stable</th><th>Increase /<br>Decrease</th><th>Large<br>Inc / Dec</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
    }
    return '<div class="legend-tip-title">Influenza Trend — ' + loc.name + '</div>' +
        '<p>A forecast is labeled by <b>how much</b> weekly admissions change from the week ' +
        'before. Each level applies to both an increase and a decrease of that size.</p>' +
        table;
}

function attachLegendInfo(hintSel, type) {
    let tip = document.getElementById("legend-info-tip");
    if (!tip) {
        tip = document.createElement("div");
        tip.id = "legend-info-tip";
        tip.className = "legend-info-tip";
        document.body.appendChild(tip);
    }

    const show = () => {
        tip.innerHTML = (typeof type === "function") ? type() : legendInfoHtml(type);
        tip.classList.add("visible");
        const r = hintSel.node().getBoundingClientRect();
        // Measure, then place to the right of the hint (flip left if needed)
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        let left = r.right + 10;
        let top = r.top;
        if (left + tw > window.innerWidth - 10) left = r.left - tw - 10;
        if (left < 10) left = 10;
        if (top + th > window.innerHeight - 10) top = window.innerHeight - th - 10;
        if (top < 10) top = 10;
        tip.style.left = left + "px";
        tip.style.top = top + "px";
    };
    const hide = () => tip.classList.remove("visible");

    hintSel.on("mouseenter", show);
    hintSel.on("mouseleave", hide);
    hintSel.on("focus", show);
    hintSel.on("blur", hide);
}

function drawAdmissionsLegend(container) {
    const scale = getAdmissionsColorScale();
    const maxVal = scale.domain()[1];

    const isPerCap = AppState.admissionsRate === "percapita";
    const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
    const unitLabel = isPerCap ? "Per 100k" : "Hospitalizations";

    const barW = 160;
    const barH = 10;
    const svgWidth = barW + 10;
    const svgHeight = barH + 38;

    const svg = container.append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight);

    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "admissions-gradient")
        .attr("x1", "0%").attr("x2", "100%")
        .attr("y1", "0%").attr("y2", "0%");

    const nStops = 10;
    for (let i = 0; i <= nStops; i++) {
        const t = i / nStops;
        gradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", scale(t * maxVal));
    }

    const g = svg.append("g")
        .attr("transform", "translate(2, 16)");

    // Unit label above the bar
    g.append("text")
        .attr("x", 0)
        .attr("y", -4)
        .attr("font-family", "Libre Franklin, Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(unitLabel);

    g.append("rect")
        .attr("width", barW)
        .attr("height", barH)
        .attr("rx", 2)
        .attr("fill", "url(#admissions-gradient)")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 0.5);

    // Left label (0)
    g.append("text")
        .attr("x", 0)
        .attr("y", barH + 12)
        .attr("font-family", "Libre Franklin, Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text("0");

    // Right label (max)
    g.append("text")
        .attr("x", barW)
        .attr("y", barH + 12)
        .attr("text-anchor", "end")
        .attr("font-family", "Libre Franklin, Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(fmt(maxVal));

}
