// Evaluations page — WIS map + hover time series + box plot + coverage chart

// ====================== STATE ======================
let evalWisRows = [];      // raw rows: [model, location, date, horizon, wis, wis_baseline]
let evalCovRows = [];      // raw rows: [model, location, date, horizon, cov10, cov20, ...]
let evalWisMeta = null;    // { models, reference_dates }
let evalCovMeta = null;    // { models, pi_levels }
let evalLocations = null;
let evalTopoData = null;
let evalFipsToName = {};
let evalFipsToAbbr = {};

let evalSelectedModel = "Median Epistorm Ensemble";
let evalMetric = "wis_relative"; // "wis_relative", "wis_raw", "cov50", "cov95"
let evalAgg = "last4";           // "season", "last2", "last4"
let evalSelectedHorizons = null; // null = all, or Set of ints
let evalBoxLogScale = false;
let evalHoveredFips = null;      // null = show US

const EVAL_MAP_W = 560;
const EVAL_MAP_H = 350;
const EVAL_TS_W = 300;
const EVAL_TS_H = 180;
const EVAL_BOX_W = 540;
const EVAL_BOX_H = 440;
const EVAL_COV_W = 440;
const EVAL_COV_H = 400;
const EVAL_FONT = "Helvetica Neue, Arial, sans-serif";

// Color palette for models (deterministic, assigned at init)
const MODEL_COLORS = {};
const MODEL_PALETTE = [
    "#7ec8e3", "#4682B4", "#90be6d", "#f9c74f",
    "#f8961e", "#c38d9e", "#a480cf", "#5e60ce",
    "#48bfe3", "#64dfdf", "#e07b54", "#f4845f",
    "#bc6c25", "#606c38"
];

// ====================== HELPERS ======================

/** Get the set of reference dates for the current aggregation period */
function getAggDates() {
    const allDates = evalWisMeta.reference_dates;
    if (evalAgg === "season") return allDates;
    const n = evalAgg === "last2" ? 2 : 4;
    return allDates.slice(-n);
}

/** Filter rows by current aggregation dates and horizons */
function filterRows(rows) {
    const dates = new Set(getAggDates());
    return rows.filter(r => {
        if (!dates.has(r[2])) return false;
        if (evalSelectedHorizons !== null && !evalSelectedHorizons.has(r[3])) return false;
        return true;
    });
}

/** Compute WIS ratio = mean(model_wis) / mean(baseline_wis) */
function computeWisRatio(modelRows) {
    if (modelRows.length === 0) return null;
    let sumWis = 0, sumBaseline = 0;
    for (const r of modelRows) {
        sumWis += r[4];
        sumBaseline += r[5];
    }
    if (sumBaseline === 0) return null;
    return sumWis / sumBaseline;
}

/** Compute mean raw WIS */
function computeRawWis(modelRows) {
    if (modelRows.length === 0) return null;
    let sum = 0;
    for (const r of modelRows) sum += r[4];
    return sum / modelRows.length;
}

/** Compute mean coverage at a given PI level index for coverage rows */
function computeCoverage(covRows, piIndex) {
    if (covRows.length === 0) return null;
    let sum = 0;
    for (const r of covRows) sum += r[4 + piIndex];
    return sum / covRows.length;
}

/** Get metric value for a set of WIS or Coverage rows */
function getMetricValue(wisRows, covRows, piLevels) {
    if (evalMetric === "wis_relative") return computeWisRatio(wisRows);
    if (evalMetric === "wis_raw") return computeRawWis(wisRows);
    if (evalMetric === "cov50") {
        const idx = piLevels ? piLevels.indexOf(50) : -1;
        return idx >= 0 ? computeCoverage(covRows, idx) : null;
    }
    if (evalMetric === "cov95") {
        const idx = piLevels ? piLevels.indexOf(95) : -1;
        return idx >= 0 ? computeCoverage(covRows, idx) : null;
    }
    return null;
}

/** Format metric value for display */
function formatMetric(val) {
    if (val == null) return "N/A";
    if (evalMetric === "cov50" || evalMetric === "cov95") return (val * 100).toFixed(1) + "%";
    if (evalMetric === "wis_raw") return val.toFixed(1);
    return val.toFixed(3);
}

/** Get metric label */
function getMetricLabel() {
    if (evalMetric === "wis_relative") return "WIS / Baseline";
    if (evalMetric === "wis_raw") return "WIS (Raw)";
    if (evalMetric === "cov50") return "50% PI Coverage";
    if (evalMetric === "cov95") return "95% PI Coverage";
    return "";
}

// ====================== INIT ======================
async function initEvaluations() {
    try {
        const [wis, coverage, locations, topo] = await Promise.all([
            d3.json("data/eval_wis.json"),
            d3.json("data/eval_coverage.json"),
            d3.json("data/locations.json"),
            d3.json("data/us-states.json")
        ]);

        evalWisRows = wis.rows;
        evalWisMeta = { models: wis.models, reference_dates: wis.reference_dates };
        evalCovRows = coverage.rows;
        evalCovMeta = { models: coverage.models, pi_levels: coverage.pi_levels };
        evalLocations = locations;
        evalTopoData = topo;

        locations.forEach(loc => {
            evalFipsToName[loc.fips] = loc.name;
            evalFipsToAbbr[loc.fips] = loc.abbreviation;
        });

        // Assign colors
        const allModels = [...new Set([...wis.models, ...coverage.models])].sort();
        allModels.forEach((m, i) => {
            MODEL_COLORS[m] = MODEL_PALETTE[i % MODEL_PALETTE.length];
        });

        setupEvalControls();
        setupEvalModal();
        updateAll();

    } catch (err) {
        console.error("Failed to load evaluation data:", err);
        document.querySelector("main").innerHTML = `
            <div style="padding:40px;text-align:center;font-family:sans-serif;color:#c00">
                <h2>Error loading evaluation data</h2>
                <p>${err.message}</p>
            </div>`;
    }
}

function setupEvalModal() {
    document.getElementById("eval-info-btn").addEventListener("click", () => {
        document.getElementById("eval-modal-overlay").classList.add("visible");
    });
    document.getElementById("eval-modal-close").addEventListener("click", () => {
        document.getElementById("eval-modal-overlay").classList.remove("visible");
    });
    document.getElementById("eval-modal-overlay").addEventListener("click", (e) => {
        if (e.target === e.currentTarget) e.currentTarget.classList.remove("visible");
    });
}

function updateAll() {
    drawEvalMap();
    drawHoverTimeSeries(evalHoveredFips); // null = US
    drawBoxPlot();
    drawCoveragePlot();
}

// ====================== CONTROLS ======================
function setupEvalControls() {
    // Model buttons
    document.querySelectorAll(".eval-model-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".eval-model-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            evalSelectedModel = btn.dataset.model;
            updateAll();
        });
    });

    // Metric buttons — two paired groups, only one active across both
    document.querySelectorAll(".eval-metric-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".eval-metric-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            evalMetric = btn.dataset.metric;
            updateAll();
        });
    });

    // Aggregation buttons
    document.querySelectorAll(".eval-agg-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".eval-agg-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            evalAgg = btn.dataset.agg;
            updateAll();
        });
    });

    // Horizon buttons (multi-select)
    document.querySelectorAll(".eval-hz-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const hz = btn.dataset.hz;
            if (hz === "all") {
                evalSelectedHorizons = null;
                document.querySelectorAll(".eval-hz-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            } else {
                document.querySelector('.eval-hz-btn[data-hz="all"]').classList.remove("active");
                btn.classList.toggle("active");
                const active = [];
                document.querySelectorAll('.eval-hz-btn.active').forEach(b => {
                    if (b.dataset.hz !== "all") active.push(parseInt(b.dataset.hz));
                });
                if (active.length === 0 || active.length === 4) {
                    evalSelectedHorizons = null;
                    document.querySelectorAll(".eval-hz-btn").forEach(b => b.classList.remove("active"));
                    document.querySelector('.eval-hz-btn[data-hz="all"]').classList.add("active");
                } else {
                    evalSelectedHorizons = new Set(active);
                }
            }
            updateAll();
        });
    });

    // Log scale toggle
    document.querySelectorAll(".eval-log-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".eval-log-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            evalBoxLogScale = btn.dataset.scale === "log";
            drawBoxPlot();
        });
    });
}

// ====================== MAP ======================
function drawEvalMap() {
    const svg = d3.select("#eval-map")
        .attr("viewBox", `0 0 ${EVAL_MAP_W} ${EVAL_MAP_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("*").remove();

    const projection = d3.geoAlbersUsa()
        .fitSize([EVAL_MAP_W - 40, EVAL_MAP_H - 20],
            topojson.feature(evalTopoData, evalTopoData.objects.states));
    const path = d3.geoPath().projection(projection);
    const states = topojson.feature(evalTopoData, evalTopoData.objects.states).features;

    // Compute per-state metric for selected model
    const filteredWis = filterRows(evalWisRows).filter(r => r[0] === evalSelectedModel);
    const filteredCov = filterRows(evalCovRows).filter(r => r[0] === evalSelectedModel);

    const wisByLoc = {};
    for (const r of filteredWis) {
        if (!wisByLoc[r[1]]) wisByLoc[r[1]] = [];
        wisByLoc[r[1]].push(r);
    }
    const covByLoc = {};
    for (const r of filteredCov) {
        if (!covByLoc[r[1]]) covByLoc[r[1]] = [];
        covByLoc[r[1]].push(r);
    }

    const stateValues = {};
    const piLevels = evalCovMeta.pi_levels;
    for (const state of states) {
        const loc = state.id;
        stateValues[loc] = getMetricValue(wisByLoc[loc] || [], covByLoc[loc] || [], piLevels);
    }

    // Color scale depends on metric
    const colorScale = getMapColorScale(stateValues);

    const g = svg.append("g");
    g.selectAll("path")
        .data(states)
        .join("path")
        .attr("d", path)
        .attr("fill", d => {
            const val = stateValues[d.id];
            return val != null ? colorScale(clampForScale(val)) : "#ddd";
        })
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5)
        .style("cursor", "pointer")
        .on("mouseenter", (event, d) => {
            const fips = d.id;
            const val = stateValues[fips];
            const name = evalFipsToName[fips] || fips;
            d3.select("#eval-tooltip")
                .style("display", "block")
                .html(`<strong>${name}</strong><br>${getMetricLabel()}: ${formatMetric(val)}`);
            evalHoveredFips = fips;
            drawHoverTimeSeries(fips);
        })
        .on("mousemove", (event) => {
            d3.select("#eval-tooltip")
                .style("left", (event.pageX + 12) + "px")
                .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseleave", () => {
            d3.select("#eval-tooltip").style("display", "none");
            evalHoveredFips = null;
            drawHoverTimeSeries(null); // Show US
        });

    drawEvalLegend(colorScale);
}

function getMapColorScale(stateValues) {
    if (evalMetric === "wis_relative") {
        // Diverging: blue (good) — light gray — brown (bad), centered at 1.0
        return d3.scaleDiverging()
            .domain([0.3, 1.0, 3.0])
            .interpolator(d3.interpolateRgbBasis(["#4A7FB5", "#eef2f6", "#B8663D"]));
    }
    if (evalMetric === "wis_raw") {
        // Sequential white to blue — higher WIS = darker blue
        const vals = Object.values(stateValues).filter(v => v != null);
        const maxVal = vals.length > 0 ? d3.quantile(vals.sort((a,b) => a-b), 0.95) : 50;
        return d3.scaleSequential()
            .domain([0, Math.max(maxVal, 10)])
            .interpolator(d3.interpolateRgbBasis(["#ffffff", "#d0dff0", "#7BAFD4", "#4A7FB5", "#2C5F8A"]));
    }
    // Coverage: 0–100%, sequential white to blue — higher coverage = darker blue
    return d3.scaleSequential()
        .domain([0, 1.0])
        .interpolator(d3.interpolateRgbBasis(["#ffffff", "#d0dff0", "#7BAFD4", "#4A7FB5", "#2C5F8A"]));
}

function clampForScale(val) {
    if (evalMetric === "wis_relative") return Math.max(0.3, Math.min(3.0, val));
    if (evalMetric === "wis_raw") return Math.max(0, val);
    return Math.max(0, Math.min(1.0, val));
}

function drawEvalLegend(colorScale) {
    const container = d3.select("#eval-legend");
    container.selectAll("*").remove();

    // Vertical legend
    const barW = 14, barH = 180;
    const svg = container.append("svg").attr("width", barW + 60).attr("height", barH + 30);
    const g = svg.append("g").attr("transform", "translate(6, 8)");

    const defs = svg.append("defs");
    const grad = defs.append("linearGradient").attr("id", "eval-legend-grad")
        .attr("x1", "0%").attr("y1", "100%").attr("x2", "0%").attr("y2", "0%");

    let domainMin, domainMax;
    if (evalMetric === "wis_relative") { domainMin = 0.3; domainMax = 3.0; }
    else if (evalMetric === "wis_raw") { domainMin = colorScale.domain()[0]; domainMax = colorScale.domain()[1]; }
    else { domainMin = 0; domainMax = 1.0; }

    for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const val = domainMin + t * (domainMax - domainMin);
        grad.append("stop").attr("offset", `${t * 100}%`)
            .attr("stop-color", colorScale(val));
    }
    g.append("rect").attr("width", barW).attr("height", barH).attr("fill", "url(#eval-legend-grad)").attr("rx", 2);

    // Tick values
    let tickVals, tickFmt;
    if (evalMetric === "wis_relative") {
        tickVals = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
        tickFmt = d3.format(".1f");
    } else if (evalMetric === "wis_raw") {
        tickVals = d3.scaleLinear().domain([domainMin, domainMax]).ticks(5);
        tickFmt = d3.format(".0f");
    } else {
        tickVals = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
        tickFmt = v => (v * 100).toFixed(0) + "%";
    }

    const yScale = d3.scaleLinear().domain([domainMin, domainMax]).range([barH, 0]);
    const axis = g.append("g").attr("transform", `translate(${barW}, 0)`)
        .call(d3.axisRight(yScale).tickValues(tickVals).tickFormat(tickFmt).tickSize(3));
    axis.selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px");
    axis.select(".domain").remove();

    // Label
    g.append("text")
        .attr("transform", `rotate(-90)`)
        .attr("x", -barH / 2).attr("y", barW + 48)
        .attr("text-anchor", "middle").attr("font-family", EVAL_FONT)
        .attr("font-size", "9px").attr("fill", "#888")
        .text(getMetricLabel());
}

// ====================== HOVER TIME SERIES ======================
function drawHoverTimeSeries(fips) {
    const loc = fips || "US";
    const svg = d3.select("#eval-ts-chart")
        .attr("viewBox", `0 0 ${EVAL_TS_W} ${EVAL_TS_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("*").remove();

    const margin = { top: 22, right: 12, bottom: 30, left: 40 };
    const innerW = EVAL_TS_W - margin.left - margin.right;
    const innerH = EVAL_TS_H - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const tooltip = d3.select("#eval-tooltip");
    const name = evalFipsToName[loc] || (loc === "US" ? "United States" : loc);
    const isCovMetric = evalMetric === "cov50" || evalMetric === "cov95";

    // Get rows for this model + location
    const locWisRows = evalWisRows.filter(r =>
        r[0] === evalSelectedModel && r[1] === loc &&
        (evalSelectedHorizons === null || evalSelectedHorizons.has(r[3]))
    );
    const locCovRows = evalCovRows.filter(r =>
        r[0] === evalSelectedModel && r[1] === loc &&
        (evalSelectedHorizons === null || evalSelectedHorizons.has(r[3]))
    );

    // Group by reference date
    const byDateWis = {};
    for (const r of locWisRows) {
        if (!byDateWis[r[2]]) byDateWis[r[2]] = [];
        byDateWis[r[2]].push(r);
    }
    const byDateCov = {};
    for (const r of locCovRows) {
        if (!byDateCov[r[2]]) byDateCov[r[2]] = [];
        byDateCov[r[2]].push(r);
    }

    const allDates = [...new Set([...Object.keys(byDateWis), ...Object.keys(byDateCov)])].sort();
    const piLevels = evalCovMeta.pi_levels;

    const data = allDates.map(date => ({
        date: new Date(date + "T00:00:00"),
        dateStr: date,
        value: getMetricValue(byDateWis[date] || [], byDateCov[date] || [], piLevels)
    })).filter(d => d.value != null).sort((a, b) => a.date - b.date);

    // Title
    svg.append("text").attr("x", margin.left).attr("y", 14)
        .attr("font-family", EVAL_FONT).attr("font-size", "10px")
        .attr("font-weight", "600").attr("fill", "#555")
        .text(`${getMetricLabel()} Over Time: ${name}`);

    if (data.length < 2) {
        g.append("text").attr("x", innerW / 2).attr("y", innerH / 2)
            .attr("text-anchor", "middle").attr("font-family", EVAL_FONT)
            .attr("font-size", "11px").attr("fill", "#999")
            .text("Insufficient data");
        return;
    }

    const x = d3.scaleTime().domain(d3.extent(data, d => d.date)).range([0, innerW]);
    let yDomain;
    if (isCovMetric) {
        yDomain = [0, 1.05];
    } else {
        const yMax = Math.max(d3.max(data, d => d.value), evalMetric === "wis_relative" ? 1.5 : 10);
        yDomain = [0, yMax * 1.1];
    }
    const y = d3.scaleLinear().domain(yDomain).range([innerH, 0]);

    g.append("g").attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px");

    const yFmt = isCovMetric ? (d => (d * 100).toFixed(0) + "%") : (evalMetric === "wis_raw" ? d3.format(".0f") : d3.format(".1f"));
    g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(yFmt))
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px");

    // Reference line
    if (evalMetric === "wis_relative") {
        g.append("line").attr("x1", 0).attr("y1", y(1)).attr("x2", innerW).attr("y2", y(1))
            .attr("stroke", "#aaa").attr("stroke-width", 1).attr("stroke-dasharray", "4,3");
        g.append("text").attr("x", innerW - 2).attr("y", y(1) - 4)
            .attr("text-anchor", "end").attr("font-family", EVAL_FONT)
            .attr("font-size", "8px").attr("fill", "#aaa").text("Baseline");
    } else if (isCovMetric) {
        const nominal = evalMetric === "cov50" ? 0.50 : 0.95;
        g.append("line").attr("x1", 0).attr("y1", y(nominal)).attr("x2", innerW).attr("y2", y(nominal))
            .attr("stroke", "#aaa").attr("stroke-width", 1).attr("stroke-dasharray", "4,3");
        g.append("text").attr("x", innerW - 2).attr("y", y(nominal) - 4)
            .attr("text-anchor", "end").attr("font-family", EVAL_FONT)
            .attr("font-size", "8px").attr("fill", "#aaa").text("Ideal");
    }

    // Highlight aggregation window
    const aggDates = new Set(getAggDates());
    const aggData = data.filter(d => aggDates.has(d.dateStr));
    if (aggData.length >= 2) {
        g.append("rect")
            .attr("x", x(aggData[0].date))
            .attr("y", 0)
            .attr("width", x(aggData[aggData.length - 1].date) - x(aggData[0].date))
            .attr("height", innerH)
            .attr("fill", "#4682B4")
            .attr("opacity", 0.08);
    }

    const lineColor = MODEL_COLORS[evalSelectedModel] || "#4682B4";
    const line = d3.line().x(d => x(d.date)).y(d => y(d.value));
    g.append("path").datum(data).attr("d", line)
        .attr("fill", "none").attr("stroke", lineColor).attr("stroke-width", 2);

    g.selectAll(".ts-dot").data(data).join("circle")
        .attr("cx", d => x(d.date)).attr("cy", d => y(d.value))
        .attr("r", 3).attr("fill", lineColor)
        .attr("stroke", "#fff").attr("stroke-width", 1);

    // Hover overlay for tooltips on each dot
    const hoverG = g.append("g");
    data.forEach(d => {
        hoverG.append("circle")
            .attr("cx", x(d.date)).attr("cy", y(d.value))
            .attr("r", 8).attr("fill", "transparent").style("cursor", "pointer")
            .on("mouseenter", (event) => {
                tooltip.style("display", "block").html(
                    `<strong>${name}</strong><br>` +
                    `${d3.timeFormat("%b %d, %Y")(d.date)}<br>` +
                    `${getMetricLabel()}: ${formatMetric(d.value)}`
                );
            })
            .on("mousemove", (event) => {
                tooltip.style("left", (event.pageX + 12) + "px").style("top", (event.pageY - 10) + "px");
            })
            .on("mouseleave", () => { tooltip.style("display", "none"); });
    });
}

// ====================== BOX PLOT ======================
function drawBoxPlot() {
    const svg = d3.select("#eval-boxplot")
        .attr("viewBox", `0 0 ${EVAL_BOX_W} ${EVAL_BOX_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("*").remove();

    const margin = { top: 10, right: 30, bottom: 36, left: 180 };
    const innerW = EVAL_BOX_W - margin.left - margin.right;
    const innerH = EVAL_BOX_H - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const tooltip = d3.select("#eval-tooltip");
    const filtered = filterRows(evalWisRows);
    const allModels = evalWisMeta.models;

    // For each model, compute WIS ratio per location → distribution
    const modelRatios = {};
    for (const model of allModels) {
        const mRows = filtered.filter(r => r[0] === model);
        const byLoc = {};
        for (const r of mRows) {
            if (!byLoc[r[1]]) byLoc[r[1]] = [];
            byLoc[r[1]].push(r);
        }
        const ratios = [];
        for (const rows of Object.values(byLoc)) {
            const ratio = computeWisRatio(rows);
            if (ratio != null) ratios.push(ratio);
        }
        if (ratios.length > 0) modelRatios[model] = ratios;
    }

    // Compute box stats
    const stats = {};
    for (const [model, vals] of Object.entries(modelRatios)) {
        const sorted = vals.slice().sort((a, b) => a - b);
        const q1 = d3.quantile(sorted, 0.25);
        const median = d3.quantile(sorted, 0.5);
        const q3 = d3.quantile(sorted, 0.75);
        const iqr = q3 - q1;
        const wLow = Math.max(sorted[0], q1 - 1.5 * iqr);
        const wHigh = Math.min(sorted[sorted.length - 1], q3 + 1.5 * iqr);
        const mean = d3.mean(vals);
        stats[model] = { q1, median, q3, whisker_low: wLow, whisker_high: wHigh, mean, n: vals.length };
    }

    const models = Object.keys(stats).sort((a, b) => stats[a].median - stats[b].median);
    const y = d3.scaleBand().domain(models).range([0, innerH]).padding(0.25);
    const xMax = evalBoxLogScale ? 4.0 : Math.min(d3.max(models, m => stats[m].whisker_high) * 1.1, 5);
    const xMin = evalBoxLogScale ? 0.1 : 0;
    const x = evalBoxLogScale
        ? d3.scaleLog().domain([0.1, xMax]).range([0, innerW]).clamp(true)
        : d3.scaleLinear().domain([xMin, xMax]).range([0, innerW]);

    // Grid
    const xTicks = evalBoxLogScale ? [0.1, 0.2, 0.3, 0.5, 0.8, 1, 2, 3, 4] : x.ticks(6);
    g.selectAll(".grid").data(xTicks).join("line")
        .attr("x1", d => x(d)).attr("y1", 0).attr("x2", d => x(d)).attr("y2", innerH)
        .attr("stroke", "#eee").attr("stroke-width", 0.5);

    // Baseline reference
    g.append("line").attr("x1", x(1)).attr("y1", 0).attr("x2", x(1)).attr("y2", innerH)
        .attr("stroke", "#999").attr("stroke-width", 1).attr("stroke-dasharray", "6,4");

    // Boxes
    models.forEach(model => {
        const s = stats[model];
        const cy = y(model) + y.bandwidth() / 2;
        const boxH = y.bandwidth() * 0.7;
        const boxTop = cy - boxH / 2;
        const color = MODEL_COLORS[model] || "#888";
        const cl = v => Math.max(evalBoxLogScale ? 0.1 : 0, Math.min(xMax, v));

        // Whisker line
        g.append("line")
            .attr("x1", x(cl(s.whisker_low))).attr("y1", cy)
            .attr("x2", x(cl(s.whisker_high))).attr("y2", cy)
            .attr("stroke", color).attr("stroke-width", 1.5);

        // Whisker caps
        [s.whisker_low, s.whisker_high].forEach(w => {
            g.append("line")
                .attr("x1", x(cl(w))).attr("y1", cy - boxH / 4)
                .attr("x2", x(cl(w))).attr("y2", cy + boxH / 4)
                .attr("stroke", color).attr("stroke-width", 1.5);
        });

        // Box
        g.append("rect")
            .attr("x", x(cl(s.q1))).attr("y", boxTop)
            .attr("width", Math.max(1, x(cl(s.q3)) - x(cl(s.q1))))
            .attr("height", boxH)
            .attr("fill", color).attr("opacity", 0.5)
            .attr("stroke", color).attr("stroke-width", 1).attr("rx", 2);

        // Median line
        g.append("line")
            .attr("x1", x(cl(s.median))).attr("y1", boxTop)
            .attr("x2", x(cl(s.median))).attr("y2", boxTop + boxH)
            .attr("stroke", "#1a1a1a").attr("stroke-width", 2).attr("stroke-dasharray", "3,2");

        // Hover rect for tooltip
        g.append("rect")
            .attr("x", 0).attr("y", y(model))
            .attr("width", innerW).attr("height", y.bandwidth())
            .attr("fill", "transparent").style("cursor", "pointer")
            .on("mouseenter", (event) => {
                tooltip.style("display", "block").html(
                    `<strong>${model}</strong><br>` +
                    `Median: ${s.median.toFixed(3)}<br>` +
                    `Mean: ${s.mean.toFixed(3)}<br>` +
                    `Q1–Q3: ${s.q1.toFixed(3)} – ${s.q3.toFixed(3)}<br>` +
                    `Whiskers: ${s.whisker_low.toFixed(3)} – ${s.whisker_high.toFixed(3)}<br>` +
                    `States: ${s.n}`
                );
            })
            .on("mousemove", (event) => {
                tooltip.style("left", (event.pageX + 12) + "px").style("top", (event.pageY - 10) + "px");
            })
            .on("mouseleave", () => { tooltip.style("display", "none"); });
    });

    // X axis
    const xAxis = evalBoxLogScale
        ? d3.axisBottom(x).tickValues([0.1, 0.2, 0.3, 0.5, 0.8, 1, 2, 3]).tickFormat(d3.format(".1f"))
        : d3.axisBottom(x).ticks(6);
    g.append("g").attr("transform", `translate(0,${innerH})`).call(xAxis)
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "10px");

    g.append("text").attr("x", innerW / 2).attr("y", innerH + 30)
        .attr("text-anchor", "middle").attr("font-family", EVAL_FONT)
        .attr("font-size", "11px").attr("fill", "#666").text("WIS / Baseline");

    // Y axis
    const yAxis = g.append("g").call(d3.axisLeft(y));
    yAxis.selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "10px");
}

// ====================== COVERAGE PLOT ======================
function drawCoveragePlot() {
    const svg = d3.select("#eval-coverage")
        .attr("viewBox", `0 0 ${EVAL_COV_W} ${EVAL_COV_H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");
    svg.selectAll("*").remove();

    // No legend needed — more space for chart
    const margin = { top: 10, right: 20, bottom: 36, left: 48 };
    const innerW = EVAL_COV_W - margin.left - margin.right;
    const innerH = EVAL_COV_H - margin.top - margin.bottom;
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const tooltip = d3.select("#eval-tooltip");
    const piLevels = evalCovMeta.pi_levels;
    const models = evalCovMeta.models;

    // Filter coverage rows
    const aggDates = new Set(getAggDates());
    const filteredCov = evalCovRows.filter(r => {
        if (!aggDates.has(r[2])) return false;
        if (evalSelectedHorizons !== null && !evalSelectedHorizons.has(r[3])) return false;
        return true;
    });

    // Compute mean coverage per model per PI level
    const modelCov = {};
    for (const model of models) {
        const mRows = filteredCov.filter(r => r[0] === model);
        if (mRows.length === 0) continue;
        const means = [];
        for (let p = 0; p < piLevels.length; p++) {
            let sum = 0;
            for (const r of mRows) sum += r[4 + p];
            means.push(sum / mRows.length);
        }
        modelCov[model] = means;
    }

    const activeModels = Object.keys(modelCov);

    // Scales
    const x = d3.scaleLinear().domain([piLevels[0], piLevels[piLevels.length - 1]]).range([0, innerW]);
    const y = d3.scaleLinear().domain([0, 100]).range([innerH, 0]);

    // Grid
    y.ticks(5).forEach(t => {
        g.append("line").attr("x1", 0).attr("y1", y(t)).attr("x2", innerW).attr("y2", y(t))
            .attr("stroke", "#eee").attr("stroke-width", 0.5);
    });

    // Ideal diagonal
    g.append("line")
        .attr("x1", x(piLevels[0])).attr("y1", y(piLevels[0]))
        .attr("x2", x(piLevels[piLevels.length - 1])).attr("y2", y(piLevels[piLevels.length - 1]))
        .attr("stroke", "#999").attr("stroke-width", 1.5).attr("stroke-dasharray", "6,4");

    // Lines
    const lineGen = d3.line().x((d, i) => x(piLevels[i])).y(d => y(d * 100));

    const lineGroups = g.selectAll(".cov-line-group")
        .data(activeModels).join("g").attr("class", "cov-line-group");

    lineGroups.each(function (model) {
        const el = d3.select(this);
        const data = modelCov[model];
        const color = MODEL_COLORS[model] || "#888";

        el.append("path").datum(data).attr("d", lineGen)
            .attr("fill", "none").attr("stroke", color).attr("stroke-width", 2).attr("opacity", 0.8)
            .attr("class", "cov-line");

        el.selectAll(".cov-dot").data(data).join("circle")
            .attr("cx", (d, i) => x(piLevels[i])).attr("cy", d => y(d * 100))
            .attr("r", 3).attr("fill", color).attr("stroke", "#fff").attr("stroke-width", 1)
            .attr("class", "cov-dot");
    });

    // Hover interaction — find nearest model line, highlight, show tooltip with all PI coverages
    const overlay = g.append("rect")
        .attr("width", innerW).attr("height", innerH)
        .attr("fill", "none").attr("pointer-events", "all");

    overlay.on("mousemove", (event) => {
        const [mx, my] = d3.pointer(event);
        let nearestModel = null, nearestDist = Infinity;
        activeModels.forEach(model => {
            modelCov[model].forEach((val, i) => {
                const dist = Math.sqrt((mx - x(piLevels[i])) ** 2 + (my - y(val * 100)) ** 2);
                if (dist < nearestDist) { nearestDist = dist; nearestModel = model; }
            });
        });

        if (nearestDist < 30 && nearestModel) {
            lineGroups.each(function (model) {
                const hl = model === nearestModel;
                d3.select(this).selectAll(".cov-line").attr("opacity", hl ? 1 : 0.12).attr("stroke-width", hl ? 3.5 : 1.5);
                d3.select(this).selectAll(".cov-dot").attr("opacity", hl ? 1 : 0.12).attr("r", hl ? 4.5 : 2.5);
            });

            const data = modelCov[nearestModel];
            let html = `<strong>${nearestModel}</strong>`;
            piLevels.forEach((pi, i) => {
                html += `<br>${pi}% PI: ${(data[i] * 100).toFixed(1)}%`;
            });
            tooltip.style("display", "block").html(html);
            tooltip.style("left", (event.pageX + 12) + "px").style("top", (event.pageY - 10) + "px");
        } else {
            resetCovHighlight();
            tooltip.style("display", "none");
        }
    });

    overlay.on("mouseleave", () => {
        resetCovHighlight();
        tooltip.style("display", "none");
    });

    function resetCovHighlight() {
        lineGroups.each(function () {
            d3.select(this).selectAll(".cov-line").attr("opacity", 0.8).attr("stroke-width", 2);
            d3.select(this).selectAll(".cov-dot").attr("opacity", 1).attr("r", 3);
        });
    }

    // Axes
    g.append("g").attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).tickValues(piLevels).tickFormat(d => d + "%"))
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px");

    g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d => d + "%"))
        .selectAll("text").attr("font-family", EVAL_FONT).attr("font-size", "9px");

    g.append("text").attr("x", innerW / 2).attr("y", innerH + 30)
        .attr("text-anchor", "middle").attr("font-family", EVAL_FONT)
        .attr("font-size", "11px").attr("fill", "#666").text("Prediction Interval");

    g.append("text").attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2).attr("y", -36).attr("text-anchor", "middle")
        .attr("font-family", EVAL_FONT).attr("font-size", "11px").attr("fill", "#666")
        .text("Coverage %");
}

// Start
initEvaluations();
