// US Choropleth Map with rich tooltip bar plots

const MAP_WIDTH = 800;
const MAP_HEIGHT = 480;

let mapSvg, mapPath, stateFeatures;
let fipsToName = {};
let fipsToPopulation = {};

let _hoverFips = null;

function initMap(topoData) {
    mapSvg = d3.select("#us-map")
        .attr("viewBox", `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    stateFeatures = topojson.feature(topoData, topoData.objects.states).features;

    locationsData.forEach(loc => {
        fipsToName[loc.fips] = loc.name;
        fipsToPopulation[loc.fips] = loc.population;
    });

    const projection = d3.geoAlbersUsa()
        .fitSize([MAP_WIDTH - 20, MAP_HEIGHT - 10], {
            type: "FeatureCollection",
            features: stateFeatures
        });

    mapPath = d3.geoPath().projection(projection);

    // Hatched pattern for "No Data" states
    const defs = mapSvg.append("defs");
    const pattern = defs.append("pattern")
        .attr("id", "no-data-pattern")
        .attr("width", 6)
        .attr("height", 6)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("patternTransform", "rotate(45)");
    pattern.append("rect")
        .attr("width", 6).attr("height", 6)
        .attr("fill", "#f5f5f5");
    pattern.append("line")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", 0).attr("y2", 6)
        .attr("stroke", "#ddd")
        .attr("stroke-width", 1.5);

    mapSvg.selectAll(".state")
        .data(stateFeatures)
        .join("path")
        .attr("class", "state")
        .attr("d", mapPath)
        .attr("fill", d => getStateColor(d))
        .on("mouseenter", handleMouseEnter)
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave)
        .on("click", handleStateClick);

    mapSvg.append("path")
        .attr("class", "state-border")
        .datum(topojson.mesh(topoData, topoData.objects.states, (a, b) => a !== b))
        .attr("d", mapPath);

    addDCInset();
}

function addDCInset() {
    // Position near the VA/MD coast on AlbersUSA projection
    const insetX = 700;
    const insetY = 235;
    const boxSize = 16;

    const g = mapSvg.append("g")
        .attr("class", "dc-inset")
        .attr("transform", `translate(${insetX}, ${insetY})`);

    g.append("rect")
        .attr("class", "dc-inset-box state")
        .attr("width", boxSize)
        .attr("height", boxSize)
        .attr("rx", 2)
        .attr("fill", getColorForFips("11") || "url(#no-data-pattern)")
        .attr("stroke", "#999")
        .attr("stroke-width", 0.5)
        .attr("cursor", "pointer")
        .datum({ id: 11 })
        .on("mouseenter", handleMouseEnter)
        .on("mousemove", handleMouseMove)
        .on("mouseleave", handleMouseLeave)
        .on("click", handleStateClick);

    g.append("text")
        .attr("class", "dc-inset-label")
        .attr("x", boxSize + 4)
        .attr("y", boxSize / 2 + 4)
        .attr("text-anchor", "start")
        .attr("font-size", "9px")
        .attr("fill", "#666")
        .text("DC");
}

function getStateFips(d) {
    return String(d.id).padStart(2, "0");
}

// Convert a raw value to per-100k if in per capita mode
function toDisplayValue(rawValue, fips) {
    if (AppState.admissionsRate === "percapita") {
        const pop = fipsToPopulation[fips];
        if (pop && pop > 0) return rawValue / pop * 100000;
        return null;
    }
    return rawValue;
}

// Get the admission display value for a FIPS code based on current estimate + rate mode
function getAdmissionValue(fips) {
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const estimate = AppState.currentEstimate;
    const dd = getActiveDashboardData();
    const entry = dd.data[refDate]?.[fips]?.[String(horizon)];
    if (!entry) return null;

    let raw;
    if (estimate === "most_likely") raw = entry.median_value;
    else if (estimate === "lower") raw = entry.p10_value;
    else raw = entry.p90_value;

    return toDisplayValue(raw, fips);
}

// Build a color scale for admissions values.
// Uses the MAX across all three estimates (p90) so the scale is consistent
// regardless of which estimate is selected.
let _admissionsScaleCache = null;
let _admissionsScaleKey = "";

function getAdmissionsColorScale() {
    const rateMode = AppState.admissionsRate;
    const ensModel = AppState.ensembleModel;
    const key = `${rateMode}-${ensModel}`;

    if (_admissionsScaleCache && _admissionsScaleKey === key) {
        return _admissionsScaleCache;
    }

    // Compute global max across ALL reference dates and ALL horizons
    // so the color scale is stable when changing dates or horizons
    const dd = getActiveDashboardData();
    let allValues = [];
    for (const refDate of Object.keys(dd.data)) {
        for (const fipsKey of Object.keys(dd.data[refDate])) {
            if (fipsKey === "US") continue;
            const fipsData = dd.data[refDate][fipsKey];
            for (let h = 0; h <= 3; h++) {
                const entry = fipsData[String(h)];
                if (!entry) continue;
                const raw = entry.p90_value;
                if (raw != null) {
                    allValues.push(toDisplayValue(raw, fipsKey));
                }
            }
        }
    }

    const maxVal = d3.max(allValues) || 1;
    _admissionsScaleCache = d3.scaleSequential(d3.interpolateBlues)
        .domain([0, maxVal]);
    _admissionsScaleKey = key;
    return _admissionsScaleCache;
}

function getColorForFips(fips) {
    const type = AppState.currentTab;
    const estimate = AppState.currentEstimate;
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;

    const dd = getActiveDashboardData();
    const entry = dd.data[refDate]?.[fips]?.[String(horizon)];
    if (!entry) return null;

    if (type === "admissions") {
        const val = getAdmissionValue(fips);
        if (val == null) return "url(#no-data-pattern)";
        const scale = getAdmissionsColorScale();
        return scale(val);
    }

    let category;
    if (type === "trend") {
        category = estimate === "most_likely" ? entry.trend_most_likely
            : estimate === "lower" ? entry.trend_lower
                : entry.trend_upper;
    } else {
        // Classify using activity thresholds from the file
        let raw;
        if (estimate === "most_likely") raw = entry.median_value;
        else if (estimate === "lower") raw = entry.p10_value;
        else raw = entry.p90_value;
        category = classifyActivity(raw, fips);
    }

    const colorMap = type === "trend" ? TREND_COLORS : ACTIVITY_COLORS;
    return colorMap[category] || "url(#no-data-pattern)";
}

function getStateColor(d) {
    const fips = getStateFips(d);
    return getColorForFips(fips) || "url(#no-data-pattern)";
}

function updateMapColors() {
    mapSvg.selectAll("path.state")
        .transition()
        .duration(300)
        .attr("fill", d => getStateColor(d));

    mapSvg.select(".dc-inset-box")
        .transition()
        .duration(300)
        .attr("fill", getColorForFips("11") || "url(#no-data-pattern)");
}

// --- State click → update trajectory chart ---
function handleStateClick(event, d) {
    const fips = getStateFips(d);
    if (typeof setTrajectoryLocation === "function") {
        setTrajectoryLocation(fips);
    }
    // Scroll to trajectory section
    document.getElementById("trajectory-section")?.scrollIntoView({ behavior: "smooth" });
}

// --- Rich Tooltip with Bar Plot PMF ---

async function handleMouseEnter(event, d) {
    const fips = getStateFips(d);
    _hoverFips = fips;
    const name = fipsToName[fips] || `State ${fips}`;
    const type = AppState.currentTab;
    const refDate = AppState.currentRefDate;
    const horizon = AppState.currentHorizon;
    const dd = getActiveDashboardData();
    const entry = dd.data[refDate]?.[fips]?.[String(horizon)];

    const tooltip = d3.select("#tooltip");
    tooltip.selectAll("*").remove();

    tooltip.append("div")
        .attr("class", "tooltip-header")
        .text(name);

    if (!entry) {
        tooltip.append("div")
            .style("color", "#999")
            .text("No forecast data available");
        tooltip.classed("visible", true);
        positionTooltip(event);
        return;
    }

    // Admissions tab: time series chart with forecast PI
    if (type === "admissions") {
        drawAdmissionsTooltip(tooltip, fips, refDate, horizon);
        tooltip.classed("visible", true);
        positionTooltip(event);
        return;
    }

    let probs;
    if (type === "activity") {
        probs = entry.activity_probs;
    } else {
        probs = entry.trend_probs;
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

    // Build bar plot SVG
    const chartW = 240;
    const chartH = 110;
    const margin = { top: 8, right: 12, bottom: 30, left: 38 };
    const innerW = chartW - margin.left - margin.right;
    const innerH = chartH - margin.top - margin.bottom;

    const svg = tooltip.append("div")
        .attr("class", "tooltip-chart")
        .append("svg")
        .attr("width", chartW)
        .attr("height", chartH)
        .style("overflow", "visible");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
        .domain(order)
        .range([0, innerW])
        .padding(0.2);

    const maxProb = Math.max(0.15, d3.max(order, cat => probs[cat] || 0));
    const y = d3.scaleLinear()
        .domain([0, Math.min(1, maxProb * 1.15)])
        .range([innerH, 0]);

    // Grid lines
    [0, 0.25, 0.5, 0.75, 1.0].filter(v => v <= maxProb * 1.2).forEach(v => {
        g.append("line")
            .attr("x1", 0).attr("y1", y(v))
            .attr("x2", innerW).attr("y2", y(v))
            .attr("stroke", "#eee")
            .attr("stroke-width", 0.5);

        g.append("text")
            .attr("x", -4)
            .attr("y", y(v))
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "8px")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("fill", "#999")
            .text(`${Math.round(v * 100)}%`);
    });

    // Bars
    order.forEach(cat => {
        const prob = probs[cat] || 0;
        const isSelected = cat === selectedCat;
        const needsStroke = (cat === "low" || cat === "stable");

        g.append("rect")
            .attr("x", x(cat))
            .attr("y", y(prob))
            .attr("width", x.bandwidth())
            .attr("height", Math.max(0, innerH - y(prob)))
            .attr("fill", colors[cat])
            .attr("stroke", isSelected ? "#1a1a1a" : (needsStroke ? "#ccc" : "none"))
            .attr("stroke-width", isSelected ? 2 : 0.5)
            .attr("rx", 1);

        if (prob > 0.01) {
            g.append("text")
                .attr("class", "tooltip-bar-value")
                .attr("x", x(cat) + x.bandwidth() / 2)
                .attr("y", y(prob) - 3)
                .attr("text-anchor", "middle")
                .attr("font-family", "Helvetica Neue, Arial, sans-serif")
                .text(`${Math.round(prob * 100)}%`);
        }
    });

    // X-axis labels
    const shortLabels = type === "trend"
        ? { large_decrease: "Lg\u2193", decrease: "Dec", stable: "Stbl", increase: "Inc", large_increase: "Lg\u2191" }
        : { low: "Low", moderate: "Med", high: "High", very_high: "V.Hi" };

    order.forEach(cat => {
        g.append("text")
            .attr("class", "tooltip-bar-label")
            .attr("x", x(cat) + x.bandwidth() / 2)
            .attr("y", innerH + 13)
            .attr("text-anchor", "middle")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .text(shortLabels[cat]);
    });

    // Y-axis line
    g.append("line")
        .attr("x1", 0).attr("y1", 0)
        .attr("x2", 0).attr("y2", innerH)
        .attr("stroke", "#ddd")
        .attr("stroke-width", 0.5);

    tooltip.classed("visible", true);
    positionTooltip(event);
}

function handleMouseMove(event) {
    positionTooltip(event);
}

function handleMouseLeave() {
    d3.select("#tooltip").classed("visible", false);
}

function positionTooltip(event) {
    const tooltip = d3.select("#tooltip").node();
    const ttWidth = tooltip.offsetWidth;
    const ttHeight = tooltip.offsetHeight;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let left = event.clientX + 15;
    let top = event.clientY - 10;

    if (left + ttWidth > viewW - 10) {
        left = event.clientX - ttWidth - 15;
    }
    if (top + ttHeight > viewH - 10) {
        top = viewH - ttHeight - 10;
    }
    if (top < 10) top = 10;

    d3.select("#tooltip")
        .style("left", left + "px")
        .style("top", top + "px");
}

// --- Admissions tooltip: time series with forecast PI bands ---

function drawAdmissionsTooltip(tooltip, fips, refDate, horizon) {
    const isPerCap = AppState.admissionsRate === "percapita";
    const pop = fipsToPopulation[fips];
    const toVal = v => (isPerCap && pop) ? v / pop * 100000 : v;

    // Gather forecast data for horizons 0-3 only
    const dd = getActiveDashboardData();
    const forecast = [];
    for (let h = 0; h <= 3; h++) {
        const e = dd.data[refDate]?.[fips]?.[String(h)];
        if (e) {
            const med = toVal(e.median_value);
            const lo = toVal(e.p10_value);
            const hi = toVal(e.p90_value);
            // Approximate 50% PI by shrinking toward median (~60% of 80% PI width)
            const p25 = med - (med - lo) * 0.6;
            const p75 = med + (hi - med) * 0.6;
            forecast.push({
                date: new Date(e.forecast_date + "T00:00:00"),
                median: med,
                p10: lo, p90: hi,
                p25: p25, p75: p75
            });
        }
    }

    // Last forecast date
    const lastForecastDate = forecast.length > 0
        ? forecast[forecast.length - 1].date
        : new Date(refDate + "T00:00:00");

    // Observed data: in-sample (before ref date) + out-of-sample (up to last forecast week)
    const refDt = new Date(refDate + "T00:00:00");
    const allObs = (targetDataAll?.[fips] || [])
        .map(d => ({ date: new Date(d.date + "T00:00:00"), value: toVal(d.value) }));

    const inSample = allObs.filter(d => d.date < refDt).slice(-8);
    const outSample = allObs.filter(d => d.date >= refDt && d.date <= lastForecastDate);

    if (inSample.length === 0 && forecast.length === 0) {
        tooltip.append("div")
            .style("color", "#999")
            .text("No data available");
        return;
    }

    // Chart dimensions
    const chartW = 310;
    const chartH = 175;
    const margin = { top: 12, right: 12, bottom: 36, left: 42 };
    const innerW = chartW - margin.left - margin.right;
    const innerH = chartH - margin.top - margin.bottom;

    // Compute domains
    const allDates = [
        ...inSample.map(d => d.date),
        ...outSample.map(d => d.date),
        ...forecast.map(d => d.date)
    ];
    const allValues = [
        ...inSample.map(d => d.value),
        ...outSample.map(d => d.value),
        ...forecast.map(d => d.p90),
        0
    ];

    const x = d3.scaleTime()
        .domain(d3.extent(allDates))
        .range([0, innerW]);

    const y = d3.scaleLinear()
        .domain([0, d3.max(allValues) * 1.1])
        .range([innerH, 0])
        .nice();

    const svg = tooltip.append("div")
        .attr("class", "tooltip-chart")
        .append("svg")
        .attr("width", chartW)
        .attr("height", chartH);

    // Clip path to prevent PI bands from overflowing
    svg.append("defs").append("clipPath")
        .attr("id", "tt-clip")
        .append("rect")
        .attr("width", innerW)
        .attr("height", innerH);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const clipped = g.append("g")
        .attr("clip-path", "url(#tt-clip)");

    // Grid lines
    const yTicks = y.ticks(4);
    yTicks.forEach(v => {
        g.append("line")
            .attr("x1", 0).attr("y1", y(v))
            .attr("x2", innerW).attr("y2", y(v))
            .attr("stroke", "#eee")
            .attr("stroke-width", 0.5);
    });

    // 80% PI band (outer, lighter)
    if (forecast.length > 0) {
        const area80 = d3.area()
            .x(d => x(d.date))
            .y0(d => y(d.p10))
            .y1(d => y(d.p90));
        clipped.append("path")
            .datum(forecast)
            .attr("d", area80)
            .attr("fill", "#b0d4e8")
            .attr("opacity", 0.3);
    }

    // 50% PI band (inner, darker)
    if (forecast.length > 0) {
        const area50 = d3.area()
            .x(d => x(d.date))
            .y0(d => y(d.p25))
            .y1(d => y(d.p75));
        clipped.append("path")
            .datum(forecast)
            .attr("d", area50)
            .attr("fill", "#6faed0")
            .attr("opacity", 0.35);
    }

    // In-sample observed line + dots (solid black)
    if (inSample.length > 1) {
        clipped.append("path")
            .datum(inSample)
            .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)))
            .attr("fill", "none")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 2);
    }
    inSample.forEach(d => {
        clipped.append("circle")
            .attr("cx", x(d.date)).attr("cy", y(d.value))
            .attr("r", 3).attr("fill", "#1a1a1a");
    });

    // Out-of-sample observed (white dot with black stroke)
    if (outSample.length > 0) {
        const obsLine = [...inSample.slice(-1), ...outSample];
        if (obsLine.length > 1) {
            clipped.append("path")
                .datum(obsLine)
                .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)))
                .attr("fill", "none")
                .attr("stroke", "#1a1a1a")
                .attr("stroke-width", 1.5)
                .attr("stroke-dasharray", "3,2");
        }
        outSample.forEach(d => {
            clipped.append("circle")
                .attr("cx", x(d.date)).attr("cy", y(d.value))
                .attr("r", 3)
                .attr("fill", "#fff")
                .attr("stroke", "#1a1a1a")
                .attr("stroke-width", 1.5);
        });
    }

    // Forecast median line + dots
    if (forecast.length > 0) {
        clipped.append("path")
            .datum(forecast)
            .attr("d", d3.line().x(d => x(d.date)).y(d => y(d.median)))
            .attr("fill", "none")
            .attr("stroke", "#4682B4")
            .attr("stroke-width", 2);
        forecast.forEach(d => {
            clipped.append("circle")
                .attr("cx", x(d.date)).attr("cy", y(d.median))
                .attr("r", 3).attr("fill", "#4682B4");
        });
    }

    // Vertical dashed line at selected forecast week
    const selectedEntry = dd.data[refDate]?.[fips]?.[String(horizon)];
    if (selectedEntry) {
        const selDate = new Date(selectedEntry.forecast_date + "T00:00:00");
        g.append("line")
            .attr("x1", x(selDate)).attr("y1", 0)
            .attr("x2", x(selDate)).attr("y2", innerH)
            .attr("stroke", "#999")
            .attr("stroke-width", 1)
            .attr("stroke-dasharray", "3,2");
    }

    // X-axis
    g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(4).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "8px")
        .attr("fill", "#999");

    g.selectAll(".domain").attr("stroke", "#ddd");
    g.selectAll(".tick line").attr("stroke", "#ddd");

    // Y-axis labels
    const fmtY = isPerCap ? d3.format(",.1f") : (v => {
        if (v >= 1000) return d3.format(",.0f")(v / 1000) + "k";
        return d3.format(",.0f")(v);
    });
    yTicks.forEach(v => {
        g.append("text")
            .attr("x", -4).attr("y", y(v))
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "middle")
            .attr("font-size", "8px")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("fill", "#999")
            .text(fmtY(v));
    });

    // Legend
    const legendY = chartH - 6;
    const items = [
        { label: "Observed", type: "line", color: "#1a1a1a" },
        { label: "Forecast", type: "line", color: "#4682B4" },
        { label: "50% PI", type: "rect", color: "#6faed0", opacity: 0.5 },
        { label: "95% PI", type: "rect", color: "#b0d4e8", opacity: 0.5 }
    ];
    let lx = margin.left;
    items.forEach(item => {
        if (item.type === "rect") {
            svg.append("rect")
                .attr("x", lx).attr("y", legendY - 4)
                .attr("width", 12).attr("height", 8)
                .attr("fill", item.color).attr("opacity", item.opacity)
                .attr("rx", 1);
        } else {
            svg.append("line")
                .attr("x1", lx).attr("y1", legendY)
                .attr("x2", lx + 12).attr("y2", legendY)
                .attr("stroke", item.color).attr("stroke-width", 2);
        }
        svg.append("text")
            .attr("x", lx + 15).attr("y", legendY + 1)
            .attr("dominant-baseline", "central")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "7px")
            .attr("fill", "#666")
            .text(item.label);
        lx += 15 + item.label.length * 4.5 + 8;
    });
}
