// Semi-circular gauge + NYT-style bar chart + admissions distribution

const GAUGE_WIDTH = 240;
const GAUGE_HEIGHT = 125;
const GAUGE_RADIUS = 80;
const GAUGE_INNER_RADIUS = 48;
const GAUGE_CENTER_Y = GAUGE_HEIGHT - 16;

let _currentGaugeType = null; // track to avoid unnecessary recreation

// The overview card follows the selected location (US by default, or a state
// chosen by clicking the map / the trajectory location dropdown).
function getSidebarLocation() {
    const fips = AppState.selectedState || "US";
    let name;
    if (fips === "US") {
        name = "United States";
    } else if (typeof fipsToName !== "undefined" && fipsToName[fips]) {
        name = fipsToName[fips];
    } else {
        name = `State ${fips}`;
    }
    return { fips, name };
}

function initGauges() {
    // Both national gauges are always shown (activity + trend)
    createGauge("#gauge-activity", "activity");
    createGauge("#gauge-trend", "trend");

    // Hover popover beside each gauge, so both the activity and trend scales can
    // be understood on their own. Content follows the selected location and shows
    // the actual threshold values at show time.
    if (typeof attachLegendInfo === "function") {
        const actHint = d3.select("#activity-info-hint");
        if (!actHint.empty() && typeof sidebarActivityInfoHtml === "function") {
            attachLegendInfo(actHint, sidebarActivityInfoHtml);
        }
        const trendHint = d3.select("#trend-info-hint");
        if (!trendHint.empty() && typeof sidebarTrendInfoHtml === "function") {
            attachLegendInfo(trendHint, sidebarTrendInfoHtml);
        }
    }
}

function createGauge(selector, type) {
    const svg = d3.select(selector)
        .attr("viewBox", `0 0 ${GAUGE_WIDTH} ${GAUGE_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    svg.selectAll("*").remove();

    const g = svg.append("g")
        .attr("class", "gauge-group")
        .attr("transform", `translate(${GAUGE_WIDTH / 2}, ${GAUGE_CENTER_Y})`);

    const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;

    const arcGen = d3.arc()
        .innerRadius(GAUGE_INNER_RADIUS)
        .outerRadius(GAUGE_RADIUS);

    const segmentAngle = Math.PI / categories.length;

    categories.forEach((cat, i) => {
        const startAngle = -Math.PI / 2 + i * segmentAngle;
        const endAngle = startAngle + segmentAngle;

        g.append("path")
            .attr("class", `gauge-segment gauge-segment-${cat}`)
            .attr("d", arcGen({ startAngle, endAngle }))
            .attr("fill", colors[cat])
            .attr("stroke", "#fff")
            .attr("stroke-width", 0.8);
    });

    const shortLabels = type === "trend"
        ? ["Lg\u2193", "Dec", "Stbl", "Inc", "Lg\u2191"]
        : ["Low", "Med", "High", "V.High"];

    categories.forEach((cat, i) => {
        const midAngle = -Math.PI / 2 + (i + 0.5) * segmentAngle;
        const labelR = GAUGE_RADIUS + 18;

        g.append("text")
            .attr("x", Math.sin(midAngle) * labelR)
            .attr("y", -Math.cos(midAngle) * labelR)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-family", "Libre Franklin, Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", "#777")
            .attr("font-weight", "500")
            .text(shortLabels[i]);
    });

    g.append("line")
        .attr("class", "gauge-needle")
        .attr("x1", 0).attr("y1", 4)
        .attr("x2", 0).attr("y2", -(GAUGE_RADIUS - 6))
        .attr("stroke", "#1a1a1a")
        .attr("stroke-width", 2.5)
        .attr("stroke-linecap", "round");

    g.append("circle")
        .attr("cx", 0).attr("cy", 0)
        .attr("r", 5)
        .attr("fill", "#1a1a1a");
}

function updateGauges() {
    // The overview card always shows both summaries (activity + trend),
    // independent of which layer the map is colored by, for the selected location.
    const loc = getSidebarLocation();
    d3.select("#activity-gauge-title").text(`Activity Level: ${loc.name}`);
    d3.select("#trend-gauge-title").text(`Trend Forecast: ${loc.name}`);

    updateSingleGauge("#gauge-activity", "activity");
    updateSingleGauge("#gauge-trend", "trend");
    updateUSBarChart("activity", "#activity-bar-chart");
    updateUSBarChart("trend", "#trend-bar-chart");

    updateOverviewText();
}

function updateSingleGauge(selector, type) {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const fips = AppState.selectedState || "US";
    const entry = getActiveDashboardData().data[refDate]?.[fips]?.[String(horizon)];
    if (!entry) return;

    const categories = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    let probs;
    if (type === "trend") {
        probs = entry.trend_probs;
    } else {
        probs = entry.activity_probs;
    }

    const segmentAngle = Math.PI / categories.length;
    let weightedAngle = 0;
    let totalWeight = 0;
    categories.forEach((cat, i) => {
        const angle = -Math.PI / 2 + (i + 0.5) * segmentAngle;
        const w = probs[cat] || 0;
        weightedAngle += angle * w;
        totalWeight += w;
    });
    const needleAngle = totalWeight > 0 ? weightedAngle / totalWeight : 0;

    const needleLength = GAUGE_RADIUS - 6;
    const nx = Math.sin(needleAngle) * needleLength;
    const ny = -Math.cos(needleAngle) * needleLength;
    const nx1 = -Math.sin(needleAngle) * 4;
    const ny1 = Math.cos(needleAngle) * 4;

    d3.select(selector).select(".gauge-needle")
        .transition()
        .duration(500)
        .ease(d3.easeCubicOut)
        .attr("x2", nx)
        .attr("y2", ny)
        .attr("x1", nx1)
        .attr("y1", ny1);
}

// --- NYT-style horizontal bar chart for US probabilities ---

function updateUSBarChart(type, containerSel) {
    const container = d3.select(containerSel);
    container.selectAll("*").remove();

    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const fips = AppState.selectedState || "US";
    const entry = getActiveDashboardData().data[refDate]?.[fips]?.[String(horizon)];
    if (!entry) return;

    let probs;
    if (type === "trend") {
        probs = entry.trend_probs;
    } else {
        probs = entry.activity_probs;
    }
    const order = type === "trend" ? TREND_ORDER : ACTIVITY_ORDER;
    const colors = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    const labels = type === "trend" ? TREND_LABELS : ACTIVITY_LABELS;

    const estimate = AppState.currentEstimate;
    let selectedCat;
    if (type === "trend") {
        selectedCat = estimate === "most_likely" ? entry.trend_most_likely
            : estimate === "lower" ? entry.trend_lower : entry.trend_upper;
    } else {
        // Use threshold-based classification
        let raw;
        if (estimate === "most_likely") raw = entry.median_value;
        else if (estimate === "lower") raw = entry.p10_value;
        else raw = entry.p90_value;
        selectedCat = classifyActivity(raw, fips) || entry.activity_most_likely;
    }

    const chartW = 258;
    const rowH = 40;
    const labelW = 84;
    const barMaxW = 118;
    const pctW = 44;
    const chartH = order.length * rowH + 4;

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${chartW} ${chartH}`)
        .attr("preserveAspectRatio", "xMinYMid meet")
        .style("width", "100%")
        .style("height", "auto")
        .style("overflow", "visible");

    order.forEach((cat, i) => {
        const y = i * rowH + 4;
        const prob = probs[cat] || 0;
        const pctText = prob < 0.01 ? (prob > 0 ? "<1%" : "0%") : `${Math.round(prob * 100)}%`;
        const barW = Math.max(0, prob * barMaxW);
        const isSelected = cat === selectedCat;
        const needsStroke = (cat === "low" || cat === "stable");

        // Category label
        svg.append("text")
            .attr("x", labelW - 6)
            .attr("y", y + rowH / 2 - 2)
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "central")
            .attr("font-family", "Libre Franklin, Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "13px")
            .attr("fill", "#666")
            .attr("font-weight", "400")
            .text(labels[cat]);

        // Bar
        if (barW > 0) {
            svg.append("rect")
                .attr("x", labelW)
                .attr("y", y + 2)
                .attr("width", barW)
                .attr("height", rowH - 8)
                .attr("fill", colors[cat])
                .attr("stroke", needsStroke ? "#ccc" : "none")
                .attr("stroke-width", 0.5)
                .attr("rx", 2);
        }

        // Percentage label
        svg.append("text")
            .attr("x", labelW + barW + 6)
            .attr("y", y + rowH / 2 - 2)
            .attr("dominant-baseline", "central")
            .attr("font-family", "Libre Franklin, Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "13px")
            .attr("fill", "#333")
            .attr("font-weight", "600")
            .text(pctText);
    });
}

// --- Enhanced overview text ---

function updateOverviewText() {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const tab = AppState.currentTab;

    const refDt = new Date(refDate + "T00:00:00");
    const dd = getActiveDashboardData();
    const horizonData = dd.data[refDate];
    if (!horizonData) return;

    // Compute forecast week dates (horizon h maps to refDate + h weeks)
    const targetSat = new Date(refDt);
    targetSat.setDate(targetSat.getDate() + horizon * 7);
    const targetSun = new Date(targetSat);
    targetSun.setDate(targetSun.getDate() - 6);

    // The overview card follows the selected location (US by default).
    const loc = getSidebarLocation();

    // Update forecast context title
    const titleEl = d3.select("#forecast-context-title");
    const horizonText = `Wk ${horizon + 1}`;
    const titleLabel = loc.fips === "US" ? "National Forecast" : loc.name;
    titleEl.html(`${titleLabel}: Week of ${formatShortDate(targetSun)}\u2013${formatShortDate(targetSat)}<span class="forecast-week-range">${horizonText}</span>`);

    // Overview: narrative summary for the selected location with colored categories
    const selEntry = horizonData[loc.fips]?.[String(horizon)];
    if (selEntry) {
        const trendCat = selEntry.trend_most_likely;
        const actCat = classifyActivity(selEntry.median_value, loc.fips) || selEntry.activity_most_likely;
        const hospVal = d3.format(",")(Math.round(selEntry.median_value));

        const actColor = ACTIVITY_TEXT_COLORS[actCat] || ACTIVITY_COLORS[actCat];
        const trendColor = TREND_TEXT_COLORS[trendCat] || TREND_COLORS[trendCat];

        const trendProb = Math.round((selEntry.trend_probs[trendCat] || 0) * 100);
        const actProb = Math.round((selEntry.activity_probs[actCat] || 0) * 100);

        // Trend adverb + direction
        const TREND_ADVERBS = {
            large_decrease: "largely", decrease: "", stable: "",
            increase: "", large_increase: "largely"
        };
        const TREND_DIRECTIONS = {
            large_decrease: "decrease", decrease: "decrease",
            stable: "remain stable", increase: "increase",
            large_increase: "increase"
        };
        const trendAdverb = TREND_ADVERBS[trendCat] || "";
        const trendDirection = TREND_DIRECTIONS[trendCat] || "remain stable";
        const trendPhrase = trendAdverb ? `${trendAdverb} ${trendDirection}` : trendDirection;

        // Comparison week: the week ending 7 days before refDate (Sun–Sat)
        const compSat = new Date(refDt);
        compSat.setDate(compSat.getDate() - 7);
        const compSun = new Date(compSat);
        compSun.setDate(compSun.getDate() - 6);
        const compWeekStr = `the week of ${formatShortDate(compSun)}\u2013${formatShortDate(compSat)}`;

        const leadIn = loc.fips === "US" ? "Nationally," : `In ${loc.name},`;
        d3.select("#overview-primary").html(
            `${leadIn} hospitalizations are forecasted to be at ` +
            `<strong style="color:${actColor}">${ACTIVITY_LABELS[actCat].toLowerCase()}</strong> ` +
            `activity <span class="overview-pct">(${actProb}% chance)</span>, ` +
            `with an estimated <strong>${hospVal}</strong> new weekly hospital admissions. ` +
            `Compared to ${compWeekStr}, weekly hospitalizations are expected to ` +
            `<strong style="color:${trendColor}">${trendPhrase}</strong> ` +
            `<span class="overview-pct">(${trendProb}% chance)</span>.`
        );
    }

    // Left-side text: original sentence format
    const dateStr = `${formatShortDate(targetSun)}\u2013${formatShortDate(targetSat)}`;
    const horizonLabel = `(Wk ${horizon + 1})`;
    let para2 = "";

    if (tab === "trend") {
        const counts = {};
        TREND_ORDER.forEach(cat => counts[cat] = 0);
        locationsData.forEach(loc => {
            if (loc.fips === "US") return;
            const stateEntry = horizonData[loc.fips]?.[String(horizon)];
            if (!stateEntry) return;
            const trend = stateEntry.trend_most_likely;
            if (counts[trend] !== undefined) counts[trend]++;
        });
        const parts = [];
        TREND_ORDER.forEach(cat => {
            if (counts[cat] > 0) {
                const s = counts[cat] !== 1 ? "s" : "";
                parts.push(`<strong>${counts[cat]}</strong> ${TREND_LABELS[cat].toLowerCase()} state${s}`);
            }
        });
        para2 = `For the week of ${dateStr} ${horizonLabel}, ` + parts.join(", ") + ".";
    } else if (tab === "activity") {
        const counts = { low: 0, moderate: 0, high: 0, very_high: 0 };
        locationsData.forEach(loc => {
            if (loc.fips === "US") return;
            const stateEntry = horizonData[loc.fips]?.[String(horizon)];
            if (!stateEntry) return;
            // Use threshold-based classification instead of pre-computed category
            const activity = classifyActivity(stateEntry.median_value, loc.fips) || stateEntry.activity_most_likely;
            if (counts[activity] !== undefined) counts[activity]++;
        });
        const parts = [];
        ACTIVITY_ORDER.forEach(cat => {
            if (counts[cat] > 0) {
                const s = counts[cat] !== 1 ? "s" : "";
                parts.push(`<strong>${counts[cat]}</strong> ${ACTIVITY_LABELS[cat].toLowerCase()} state${s}`);
            }
        });
        para2 = `For the week of ${dateStr} ${horizonLabel}, ` + parts.join(", ") + ".";
    } else if (tab === "admissions") {
        const isPerCap = AppState.admissionsRate === "percapita";
        const estimate = AppState.currentEstimate;
        if (selEntry) {
            let raw;
            if (estimate === "most_likely") raw = selEntry.median_value;
            else if (estimate === "lower") raw = selEntry.p10_value;
            else raw = selEntry.p90_value;
            const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
            const pop = fipsToPopulation[loc.fips];
            const val = isPerCap && pop ? raw / pop * 100000 : raw;
            const unit = isPerCap ? "per 100k" : "hospitalizations";
            const where = loc.fips === "US" ? "nationally" : `in ${loc.name}`;
            para2 = `For the week of ${dateStr} ${horizonLabel}, ` +
                `an estimated <strong>${fmt(val)}</strong> ${unit} ${where}.`;
        }
    }

    d3.select("#map-trend-summary").html(para2);
}

// --- Helper functions ---

function getMMWRWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const saturday = new Date(d);
    saturday.setDate(d.getDate() + (6 - day));
    const mmwrYear = saturday.getFullYear();

    const jan4 = new Date(mmwrYear, 0, 4);
    const jan4Day = jan4.getDay();
    const firstSunday = new Date(jan4);
    firstSunday.setDate(jan4.getDate() - jan4Day);

    const diffMs = saturday - firstSunday;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}

function formatLongDate(d) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
