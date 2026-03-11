// Semi-circular gauge + NYT-style bar chart + admissions distribution

const GAUGE_WIDTH = 240;
const GAUGE_HEIGHT = 125;
const GAUGE_RADIUS = 80;
const GAUGE_INNER_RADIUS = 48;
const GAUGE_CENTER_Y = GAUGE_HEIGHT - 16;

let _currentGaugeType = null; // track to avoid unnecessary recreation

function initGauges() {
    // Create initial gauge based on default tab
    const type = AppState.currentTab === "activity" ? "activity" : "trend";
    createGauge("#gauge-active", type);
    _currentGaugeType = type;
}

function createGauge(selector, type) {
    const svg = d3.select(selector)
        .attr("width", GAUGE_WIDTH)
        .attr("height", GAUGE_HEIGHT);

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
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "9px")
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
    const tab = AppState.currentTab;

    if (tab === "admissions") {
        // Hide gauge and bar chart, show admissions distribution
        d3.select("#active-gauge-wrapper").style("display", "none");
        d3.select("#us-bar-chart").style("display", "none");
        d3.select("#admissions-dist").style("display", "block");
        updateAdmissionsDist();
    } else {
        // Show gauge and bar chart, hide admissions distribution
        d3.select("#active-gauge-wrapper").style("display", "block");
        d3.select("#us-bar-chart").style("display", "block");
        d3.select("#admissions-dist").style("display", "none");

        const gaugeType = tab === "activity" ? "activity" : "trend";
        const title = tab === "activity" ? "Activity Level: United States" : "Trend Forecast: United States";

        // Recreate gauge if type changed
        if (_currentGaugeType !== gaugeType) {
            createGauge("#gauge-active", gaugeType);
            _currentGaugeType = gaugeType;
        }

        d3.select("#active-gauge-title").text(title);
        updateSingleGauge("#gauge-active", gaugeType);
        updateUSBarChart();
    }

    updateOverviewText();
}

function updateSingleGauge(selector, type) {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
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

function updateUSBarChart() {
    const container = d3.select("#us-bar-chart");
    container.selectAll("*").remove();

    const tab = AppState.currentTab;
    if (tab === "admissions") return;

    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const entry = dashboardData.data[refDate]?.["US"]?.[String(horizon)];
    if (!entry) return;

    const type = tab === "activity" ? "activity" : "trend";
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
        selectedCat = classifyActivity(raw, "US") || entry.activity_most_likely;
    }

    const chartW = 320;
    const rowH = 28;
    const labelW = 100;
    const barMaxW = 170;
    const pctW = 50;
    const chartH = order.length * rowH + 8;

    const svg = container.append("svg")
        .attr("width", chartW)
        .attr("height", chartH)
        .style("overflow", "visible");

    // Title
    svg.append("text")
        .attr("x", 0)
        .attr("y", 10)
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .attr("text-transform", "uppercase")
        .attr("letter-spacing", "0.5px")
        .attr("fill", "#999")
        .text("UNCERTAINTY DISTRIBUTION");

    order.forEach((cat, i) => {
        const y = i * rowH + 22;
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
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", isSelected ? "#1a1a1a" : "#666")
            .attr("font-weight", isSelected ? "700" : "400")
            .text(labels[cat]);

        // Bar
        if (barW > 0) {
            svg.append("rect")
                .attr("x", labelW)
                .attr("y", y + 2)
                .attr("width", barW)
                .attr("height", rowH - 8)
                .attr("fill", colors[cat])
                .attr("stroke", isSelected ? "#1a1a1a" : (needsStroke ? "#ccc" : "none"))
                .attr("stroke-width", isSelected ? 1.5 : 0.5)
                .attr("rx", 2);
        }

        // Percentage label
        svg.append("text")
            .attr("x", labelW + barW + 6)
            .attr("y", y + rowH / 2 - 2)
            .attr("dominant-baseline", "central")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "12px")
            .attr("fill", "#333")
            .attr("font-weight", "600")
            .text(pctText);
    });
}

// --- Admissions tab: trajectory distribution histogram ---

function updateAdmissionsDist() {
    const container = d3.select("#admissions-dist");
    container.selectAll("*").remove();

    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;

    const dd = getActiveDashboardData();
    const forecastEntry = dd.data[refDate]?.["US"]?.[String(horizon)];
    if (!forecastEntry) return;

    const forecastDate = forecastEntry.forecast_date;
    const isPerCap = AppState.admissionsRate === "percapita";
    const pop = fipsToPopulation["US"];
    const toVal = v => (isPerCap && pop) ? v / pop * 100000 : v;
    const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
    const fmtK = v => {
        if (!isPerCap && v >= 1000) return d3.format(",.0f")(v / 1000) + "k";
        return fmt(v);
    };

    // Compute forecast week date range for title
    const fcDt = new Date(forecastDate + "T00:00:00");
    const weekStart = new Date(fcDt);
    weekStart.setDate(weekStart.getDate() - 6);
    const monthsFmt = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const weekLabel = `${monthsFmt[weekStart.getMonth()]} ${weekStart.getDate()}, ${weekStart.getFullYear()} to ${monthsFmt[fcDt.getMonth()]} ${fcDt.getDate()}, ${fcDt.getFullYear()}`;
    const unitLabel = isPerCap ? "per 100k" : "";

    // Get quantile data from active trajectory data
    const activeTraj = getActiveUsTrajData();
    let quantileRow = null;
    if (activeTraj?.data?.[refDate]) {
        const rdData = activeTraj.data[refDate];
        const dateIdx = rdData.dates.indexOf(forecastDate);
        if (dateIdx >= 0) {
            quantileRow = {};
            for (const [key, vals] of Object.entries(rdData.quantiles)) {
                quantileRow[key] = vals[dateIdx];
            }
        }
    }

    if (!quantileRow) return;

    // Build sorted quantile points for CDF interpolation
    const quantileDefs = [
        { p: 0.025, key: "p025" }, { p: 0.05, key: "p05" },
        { p: 0.10, key: "p10" }, { p: 0.25, key: "p25" },
        { p: 0.50, key: "p50" }, { p: 0.75, key: "p75" },
        { p: 0.90, key: "p90" }, { p: 0.95, key: "p95" },
        { p: 0.975, key: "p975" }
    ];

    const qPoints = quantileDefs
        .filter(q => quantileRow[q.key] != null)
        .map(q => ({ p: q.p, value: toVal(quantileRow[q.key]) }));

    if (qPoints.length < 2) return;

    // Interpolate CDF: given a value, return the approximate cumulative probability
    function interpCDF(val) {
        if (val <= qPoints[0].value) return qPoints[0].p;
        if (val >= qPoints[qPoints.length - 1].value) return qPoints[qPoints.length - 1].p;
        for (let i = 0; i < qPoints.length - 1; i++) {
            if (val >= qPoints[i].value && val <= qPoints[i + 1].value) {
                const t = (val - qPoints[i].value) / (qPoints[i + 1].value - qPoints[i].value);
                return qPoints[i].p + t * (qPoints[i + 1].p - qPoints[i].p);
            }
        }
        return 0.5;
    }

    // Create bins: divide the range into 6 equal-width bins
    const minVal = qPoints[0].value;
    const maxVal = qPoints[qPoints.length - 1].value;
    const range = maxVal - minVal;
    const nBins = 6;
    const binWidth = range / nBins;

    const bins = [];
    for (let i = 0; i < nBins; i++) {
        const lo = minVal + i * binWidth;
        const hi = minVal + (i + 1) * binWidth;
        const pLo = interpCDF(lo);
        const pHi = interpCDF(hi);
        const prob = pHi - pLo;
        bins.push({ lo, hi, prob });
    }

    const medianVal = toVal(quantileRow.p50);

    // Chart dimensions
    const chartW = 320;
    const margin = { top: 38, right: 10, bottom: 32, left: 10 };
    const barH = 18;
    const barGap = 2;
    const innerH = nBins * (barH + barGap);
    const chartH = margin.top + innerH + margin.bottom;

    const svg = container.append("svg")
        .attr("width", chartW)
        .attr("height", chartH)
        .style("overflow", "visible");

    // Title
    svg.append("text")
        .attr("x", 0)
        .attr("y", 10)
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("font-weight", "600")
        .attr("fill", "#555")
        .text(`Weekly Hospitalizations Forecast: United States (${AppState.ensembleModel === "lop" ? "LOP" : "Median"} Ensemble)`);

    svg.append("text")
        .attr("x", 0)
        .attr("y", 23)
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "9px")
        .attr("font-weight", "400")
        .attr("fill", "#888")
        .text(`Week of ${weekLabel}` + (unitLabel ? ` (${unitLabel})` : ""));

    const maxProb = d3.max(bins, d => d.prob) || 0.01;
    const barMaxW = chartW - margin.left - margin.right - 80; // leave room for labels

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    bins.forEach((bin, i) => {
        const y = i * (barH + barGap);
        const barW = Math.max(1, (bin.prob / maxProb) * barMaxW);
        const isMedianBin = medianVal >= bin.lo && medianVal <= bin.hi;
        const pct = Math.round(bin.prob * 100);
        const pctText = pct < 1 ? (bin.prob > 0 ? "<1%" : "0%") : `${pct}%`;

        // Bar
        g.append("rect")
            .attr("x", 0)
            .attr("y", y)
            .attr("width", barW)
            .attr("height", barH)
            .attr("fill", isMedianBin ? "#4682B4" : "#6faed0")
            .attr("opacity", isMedianBin ? 0.9 : 0.6)
            .attr("rx", 2);

        if (isMedianBin) {
            g.append("rect")
                .attr("x", 0)
                .attr("y", y)
                .attr("width", barW)
                .attr("height", barH)
                .attr("fill", "none")
                .attr("stroke", "#1a1a1a")
                .attr("stroke-width", 1.5)
                .attr("rx", 2);
        }

        // Bin range label
        g.append("text")
            .attr("x", barW + 4)
            .attr("y", y + barH / 2)
            .attr("dominant-baseline", "central")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "10px")
            .attr("fill", "#666")
            .text(`${fmtK(bin.lo)}–${fmtK(bin.hi)}`);

        // Probability label
        g.append("text")
            .attr("x", chartW - margin.left - margin.right)
            .attr("y", y + barH / 2)
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "central")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", "#333")
            .attr("font-weight", isMedianBin ? "700" : "500")
            .text(pctText);
    });

    // Median annotation
    g.append("text")
        .attr("x", 0)
        .attr("y", innerH + 14)
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#555")
        .html(`Highlighted bar contains the median forecast: <tspan font-weight="700">${fmtK(medianVal)}</tspan>`);
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

    // Update forecast context title
    const titleEl = d3.select("#forecast-context-title");
    const horizonText = `Wk ${horizon + 1}`;
    titleEl.html(`National Forecast: Week of ${formatShortDate(targetSun)}\u2013${formatShortDate(targetSat)}<span class="forecast-week-range">${horizonText}</span>`);

    // Overview: narrative summary for US with colored categories
    const usEntry = horizonData["US"]?.[String(horizon)];
    if (usEntry) {
        const trendCat = usEntry.trend_most_likely;
        const actCat = classifyActivity(usEntry.median_value, "US") || usEntry.activity_most_likely;
        const hospVal = d3.format(",")(Math.round(usEntry.median_value));

        const actColor = ACTIVITY_TEXT_COLORS[actCat] || ACTIVITY_COLORS[actCat];
        const trendColor = TREND_TEXT_COLORS[trendCat] || TREND_COLORS[trendCat];

        const trendProb = Math.round((usEntry.trend_probs[trendCat] || 0) * 100);
        const actProb = Math.round((usEntry.activity_probs[actCat] || 0) * 100);

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

        d3.select("#overview-primary").html(
            `Nationally, hospitalizations are forecasted to be at ` +
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
        if (usEntry) {
            let raw;
            if (estimate === "most_likely") raw = usEntry.median_value;
            else if (estimate === "lower") raw = usEntry.p10_value;
            else raw = usEntry.p90_value;
            const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
            const pop = fipsToPopulation["US"];
            const val = isPerCap && pop ? raw / pop * 100000 : raw;
            const unit = isPerCap ? "per 100k" : "hospitalizations";
            para2 = `For the week of ${dateStr} ${horizonLabel}, ` +
                `an estimated <strong>${fmt(val)}</strong> ${unit} nationally.`;
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
