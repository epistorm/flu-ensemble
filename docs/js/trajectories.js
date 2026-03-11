// Forecast Details chart — quantile fan chart with context panel

const TRAJ_WIDTH = 1100;
const TRAJ_HEIGHT = 420;
const TRAJ_MARGIN = { top: 20, right: 30, bottom: 40, left: 60 };
const TRAJ_FONT = "Helvetica Neue, Arial, sans-serif";
const TRAJ_FONT_SIZE = "12px";

let trajSvg, trajX, trajY, trajChartG;
let trajData = null;
let historicalSeasons = null;

// Context panel state
let contextSeasons = { "2022-23": true, "2023-24": true, "2024-25": true };
let showSeasons = false;
let showActivityBands = false;

// Season styling
const SEASON_STYLES = {
    "2022-23": { color: "#E07B54", dash: "8,4", width: 2 },
    "2023-24": { color: "#7B68AE", dash: "4,4", width: 2 },
    "2024-25": { color: "#4A9A6F", dash: "2,3", width: 2 }
};

// Fan chart band styling
const FAN_STYLES = {
    "95": { fill: "#b0d4e8", opacity: 0.35, label: "95% PI", lower: "p025", upper: "p975" },
    "90": { fill: "#6faed0", opacity: 0.35, label: "90% PI", lower: "p05", upper: "p95" },
    "50": { fill: "#4682B4", opacity: 0.3, label: "50% PI", lower: "p25", upper: "p75" }
};

// Store aligned season data for tooltip lookup
let _alignedSeasonData = {};

const trajTooltip = () => d3.select("#traj-tooltip");

function initTrajectoryChart() {
    trajSvg = d3.select("#traj-chart")
        .attr("viewBox", `0 0 ${TRAJ_WIDTH} ${TRAJ_HEIGHT}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    trajChartG = trajSvg.append("g")
        .attr("transform", `translate(${TRAJ_MARGIN.left},${TRAJ_MARGIN.top})`);

    // Layers for proper z-ordering
    trajChartG.append("g").attr("class", "layer-activity-bands");
    trajChartG.append("g").attr("class", "layer-fan-bands");
    trajChartG.append("g").attr("class", "layer-seasons");
    trajChartG.append("g").attr("class", "layer-median");
    trajChartG.append("g").attr("class", "layer-axes");
    trajChartG.append("g").attr("class", "layer-interaction");
    trajChartG.append("g").attr("class", "layer-observed");

    // Populate location dropdown
    const locSelect = d3.select("#traj-location");
    locationsData.forEach(loc => {
        locSelect.append("option")
            .attr("value", loc.fips)
            .text(loc.name === "US" ? "United States" : loc.name);
    });
    locSelect.property("value", "US");

    // Event listeners
    d3.select("#traj-location").on("change", function () {
        loadAndDrawTrajectories(this.value);
    });

    // Initialize context panel
    initContextPanel();

    // Load historical seasons then draw
    d3.json("data/historical_seasons.json").then(hs => {
        historicalSeasons = hs;
        loadAndDrawTrajectories("US");
    });
}

// --- Context Panel ---

function initContextPanel() {
    d3.selectAll(".context-section-header").on("click", function () {
        const section = d3.select(this).attr("data-section");
        toggleContextSection(section);
    });

    buildSeasonsSection();
    buildActivitySection();
}

function toggleContextSection(section) {
    if (section === "seasons") {
        showSeasons = !showSeasons;
        d3.select("#ctx-seasons .context-section-header").classed("active", showSeasons);
        d3.select("#ctx-seasons-body").classed("open", showSeasons);
        if (showSeasons) {
            Object.keys(contextSeasons).forEach(s => { contextSeasons[s] = true; });
            updateSeasonButtons();
        }
    } else if (section === "activity") {
        showActivityBands = !showActivityBands;
        d3.select("#ctx-activity .context-section-header").classed("active", showActivityBands);
        d3.select("#ctx-activity-body").classed("open", showActivityBands);
    }
    drawTrajectories();
}

function buildSeasonsSection() {
    const body = d3.select("#ctx-seasons-body");
    body.selectAll("*").remove();

    Object.keys(contextSeasons).forEach(season => {
        const style = SEASON_STYLES[season] || {};
        const btn = body.append("button")
            .attr("class", "ctx-season-btn" + (contextSeasons[season] ? " active" : ""))
            .attr("data-season", season)
            .on("click", function () {
                contextSeasons[season] = !contextSeasons[season];
                d3.select(this).classed("active", contextSeasons[season]);
                if (!Object.values(contextSeasons).some(v => v)) {
                    showSeasons = false;
                    d3.select("#ctx-seasons .context-section-header").classed("active", false);
                    d3.select("#ctx-seasons-body").classed("open", false);
                }
                drawTrajectories();
            });

        btn.append("span")
            .attr("class", "ctx-season-swatch")
            .style("background", style.color || "#ccc");
        btn.append("span").text(season);
    });
}

function updateSeasonButtons() {
    d3.selectAll(".ctx-season-btn").each(function () {
        const season = d3.select(this).attr("data-season");
        d3.select(this).classed("active", contextSeasons[season]);
    });
}

function buildActivitySection() {
    const body = d3.select("#ctx-activity-body");
    body.selectAll("*").remove();

    ACTIVITY_ORDER.forEach(cat => {
        const item = body.append("div").attr("class", "ctx-activity-item");
        item.append("span")
            .attr("class", "ctx-activity-swatch")
            .style("background", ACTIVITY_COLORS[cat]);
        item.append("span").text(ACTIVITY_LABELS[cat]);
    });
}



// --- Main draw function ---

async function loadAndDrawTrajectories(fips) {
    const folder = AppState.ensembleModel === "lop" ? "trajectories_lop" : "trajectories";
    try {
        trajData = await d3.json(`data/${folder}/${fips}.json`);
    } catch (e) {
        console.warn(`No trajectory data for ${fips} in ${folder}`);
        trajData = null;
    }
    drawTrajectories();
}

function setTrajectoryLocation(fips) {
    d3.select("#traj-location").property("value", fips);
    loadAndDrawTrajectories(fips);
}

function drawTrajectories() {
    const fips = d3.select("#traj-location").property("value");

    const innerW = TRAJ_WIDTH - TRAJ_MARGIN.left - TRAJ_MARGIN.right;
    const innerH = TRAJ_HEIGHT - TRAJ_MARGIN.top - TRAJ_MARGIN.bottom;

    // Get observed data
    const observed = targetDataAll?.[fips] || [];
    const observedParsed = observed
        .filter(d => d.value != null)
        .map(d => ({ date: new Date(d.date + "T00:00:00"), value: d.value, rate: d.rate }));

    const showFrom = new Date("2025-11-01T00:00:00");
    const recentObserved = observedParsed.filter(d => d.date >= showFrom);

    const refDate = AppState.currentRefDate;
    const refDateObj = new Date(refDate + "T00:00:00");
    const refQuantileData = trajData?.data?.[refDate];
    const refDates = dashboardData.reference_dates;

    // Compute domains
    let allDates = recentObserved.map(d => d.date);
    let allValues = recentObserved.map(d => d.value);
    allDates.push(showFrom);

    if (refQuantileData) {
        const qDates = refQuantileData.dates.map(d => new Date(d + "T00:00:00"));
        allDates = allDates.concat(qDates);
        // Use p975 (upper 95%) for domain
        refQuantileData.quantiles.p975.forEach(v => { if (v != null) allValues.push(v); });
        refQuantileData.quantiles.p025.forEach(v => { if (v != null) allValues.push(v); });
    }

    // Compute and store aligned season data for tooltip
    _alignedSeasonData = {};
    if (showSeasons && historicalSeasons?.[fips]) {
        const currentSeasonStart = new Date("2025-10-01T00:00:00");
        Object.keys(historicalSeasons[fips]).forEach(sName => {
            if (!contextSeasons[sName]) return;
            const season = historicalSeasons[fips][sName];
            _alignedSeasonData[sName] = season
                .filter(d => d.value != null)
                .map(d => {
                    const alignedDate = new Date(currentSeasonStart);
                    alignedDate.setDate(alignedDate.getDate() + d.week * 7);
                    return { date: alignedDate, value: d.value };
                })
                .filter(d => d.date >= showFrom);
        });

        Object.values(_alignedSeasonData).forEach(lineData => {
            lineData.forEach(d => allValues.push(d.value));
        });
    }

    // Add activity threshold values to domain if bands shown
    if (showActivityBands && activityThresholds?.[fips]) {
        const th = activityThresholds[fips];
        allValues.push(th.very_high);
    }

    if (allDates.length === 0) return;

    // Scales
    trajX = d3.scaleTime()
        .domain(d3.extent(allDates))
        .range([0, innerW]);

    const yMax = d3.max(allValues) || 1;
    trajY = d3.scaleLinear()
        .domain([0, yMax * 1.05])
        .range([innerH, 0]);

    // --- Draw activity bands ---
    drawActivityBands(fips, innerW, innerH);

    // --- Draw fan chart bands ---
    drawFanBands(refQuantileData, innerW, innerH);

    // --- Draw axes ---
    const axesG = trajChartG.select(".layer-axes");
    axesG.selectAll("*").remove();

    axesG.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(trajX).ticks(8).tickFormat(d3.timeFormat("%b %d")))
        .selectAll("text")
        .attr("font-family", TRAJ_FONT)
        .attr("font-size", TRAJ_FONT_SIZE);

    axesG.append("g")
        .call(d3.axisLeft(trajY).ticks(6).tickFormat(d3.format(",.0f")))
        .selectAll("text")
        .attr("font-family", TRAJ_FONT)
        .attr("font-size", TRAJ_FONT_SIZE);

    axesG.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -48)
        .attr("text-anchor", "middle")
        .attr("font-family", TRAJ_FONT)
        .attr("font-size", TRAJ_FONT_SIZE)
        .attr("fill", "#666")
        .text("Weekly Hospitalizations");

    // --- Draw historical seasons ---
    const seasonsG = trajChartG.select(".layer-seasons");
    seasonsG.selectAll("*").remove();

    if (showSeasons) {
        Object.entries(_alignedSeasonData).forEach(([sName, lineData]) => {
            if (lineData.length < 2) return;
            const style = SEASON_STYLES[sName] || { color: "#ccc", dash: "4,4", width: 2 };

            const line = d3.line()
                .x(d => trajX(d.date))
                .y(d => trajY(d.value))
                .defined(d => d.value != null);

            seasonsG.append("path")
                .datum(lineData)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", style.color)
                .attr("stroke-width", style.width)
                .attr("stroke-dasharray", style.dash)
                .attr("opacity", 0.7);

            const last = lineData[lineData.length - 1];
            seasonsG.append("text")
                .attr("x", trajX(last.date) + 4)
                .attr("y", trajY(last.value))
                .attr("font-family", TRAJ_FONT)
                .attr("font-size", TRAJ_FONT_SIZE)
                .attr("fill", style.color)
                .attr("dominant-baseline", "middle")
                .attr("font-weight", "600")
                .text(sName);
        });
    }

    // --- Draw median line ---
    const medianG = trajChartG.select(".layer-median");
    medianG.selectAll("*").remove();

    if (refQuantileData) {
        const dates = refQuantileData.dates.map(d => new Date(d + "T00:00:00"));
        const medianValues = refQuantileData.quantiles.p50;

        const medianPoints = dates.map((d, i) => ({ date: d, value: medianValues[i] }))
            .filter(d => d.value != null);

        if (medianPoints.length > 0) {
            const line = d3.line()
                .x(d => trajX(d.date))
                .y(d => trajY(d.value));

            medianG.append("path")
                .datum(medianPoints)
                .attr("d", line)
                .attr("fill", "none")
                .attr("stroke", "#4682B4")
                .attr("stroke-width", 2.5);

            medianG.selectAll(".median-dot")
                .data(medianPoints)
                .join("circle")
                .attr("class", "median-dot")
                .attr("cx", d => trajX(d.date))
                .attr("cy", d => trajY(d.value))
                .attr("r", 3)
                .attr("fill", "#4682B4")
                .attr("stroke", "#fff")
                .attr("stroke-width", 1)
                .style("pointer-events", "none");
        }
    }

    // --- Draw observed data ---
    const obsG = trajChartG.select(".layer-observed");
    obsG.selectAll("*").remove();

    const inSample = recentObserved.filter(d => d.date < refDateObj);
    const outOfSample = recentObserved.filter(d => d.date >= refDateObj);

    if (recentObserved.length > 1) {
        const line = d3.line()
            .x(d => trajX(d.date))
            .y(d => trajY(d.value));

        obsG.append("path")
            .datum(recentObserved)
            .attr("d", line)
            .attr("fill", "none")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 2);

        obsG.selectAll(".obs-in")
            .data(inSample)
            .join("circle")
            .attr("class", "obs-in")
            .attr("cx", d => trajX(d.date))
            .attr("cy", d => trajY(d.value))
            .attr("r", 3.5)
            .attr("fill", "#1a1a1a")
            .attr("stroke", "none")
            .style("pointer-events", "none");

        obsG.selectAll(".obs-out")
            .data(outOfSample)
            .join("circle")
            .attr("class", "obs-out")
            .attr("cx", d => trajX(d.date))
            .attr("cy", d => trajY(d.value))
            .attr("r", 3.5)
            .attr("fill", "#fff")
            .attr("stroke", "#1a1a1a")
            .attr("stroke-width", 1.5)
            .style("pointer-events", "none");
    }

    // --- Interaction overlay (hover line + tooltip + click-to-jump) ---
    const interG = trajChartG.select(".layer-interaction");
    interG.selectAll("*").remove();

    interG.append("rect")
        .attr("width", innerW)
        .attr("height", innerH)
        .attr("fill", "none")
        .attr("pointer-events", "all")
        .style("cursor", "crosshair")
        .on("click", (event) => {
            const [mx] = d3.pointer(event);
            const clickDate = trajX.invert(mx);
            let closest = refDates[0];
            let minDist = Infinity;
            refDates.forEach(rd => {
                const rdDate = new Date(rd + "T00:00:00");
                const dist = Math.abs(clickDate - rdDate);
                if (dist < minDist) { minDist = dist; closest = rd; }
            });
            if (closest !== AppState.currentRefDate) {
                AppState.currentRefDate = closest;
                buildDateButtons();
                updateAll();
                drawTrajectories();
            }
        })
        .on("mousemove", (event) => {
            const [mx] = d3.pointer(event);
            const hoverDate = trajX.invert(mx);

            // Find nearest weekly date from observed + forecast dates
            const allWeeklyDates = recentObserved.map(d => d.date);
            if (refQuantileData) {
                refQuantileData.dates.forEach(d => allWeeklyDates.push(new Date(d + "T00:00:00")));
            }
            Object.values(_alignedSeasonData).forEach(sd => {
                sd.forEach(d => allWeeklyDates.push(d.date));
            });

            let nearestDate = null;
            let minDist = Infinity;
            allWeeklyDates.forEach(d => {
                const dist = Math.abs(d - hoverDate);
                if (dist < minDist) { minDist = dist; nearestDate = d; }
            });

            if (!nearestDate) return;

            if (minDist > 5 * 24 * 60 * 60 * 1000) {
                interG.select(".hover-line").remove();
                hideTrajTooltip();
                return;
            }

            const hoverX = trajX(nearestDate);
            interG.select(".hover-line").remove();
            interG.append("line")
                .attr("class", "hover-line")
                .attr("x1", hoverX).attr("y1", 0)
                .attr("x2", hoverX).attr("y2", innerH)
                .attr("stroke", "#aaa")
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "4,3")
                .attr("pointer-events", "none");

            showHoverTooltip(event, nearestDate, recentObserved, refDateObj, refQuantileData);
        })
        .on("mouseleave", () => {
            interG.select(".hover-line").remove();
            hideTrajTooltip();
        });

    // --- Update legend ---
    updateTrajLegend();
}

// --- Fan Chart Bands ---

function drawFanBands(refQuantileData, innerW, innerH) {
    const fanG = trajChartG.select(".layer-fan-bands");
    fanG.selectAll("*").remove();

    if (!refQuantileData) return;

    const dates = refQuantileData.dates.map(d => new Date(d + "T00:00:00"));
    const q = refQuantileData.quantiles;

    // Draw bands from widest to narrowest
    ["95", "90", "50"].forEach(level => {
        const style = FAN_STYLES[level];
        const lowerVals = q[style.lower];
        const upperVals = q[style.upper];

        const bandData = dates.map((d, i) => ({
            date: d,
            lower: lowerVals[i],
            upper: upperVals[i]
        })).filter(d => d.lower != null && d.upper != null);

        if (bandData.length === 0) return;

        const area = d3.area()
            .x(d => trajX(d.date))
            .y0(d => trajY(d.lower))
            .y1(d => trajY(d.upper));

        fanG.append("path")
            .datum(bandData)
            .attr("d", area)
            .attr("fill", style.fill)
            .attr("opacity", style.opacity)
            .attr("stroke", "none");
    });
}

// --- Activity Bands ---

function drawActivityBands(fips, innerW, innerH) {
    const bandsG = trajChartG.select(".layer-activity-bands");
    bandsG.selectAll("*").remove();

    if (!showActivityBands || !activityThresholds?.[fips]) return;

    const th = activityThresholds[fips];

    const bands = [
        { y0: 0, y1: th.moderate, cat: "low" },
        { y0: th.moderate, y1: th.high, cat: "moderate" },
        { y0: th.high, y1: th.very_high, cat: "high" },
        { y0: th.very_high, y1: trajY.domain()[1], cat: "very_high" }
    ];

    bands.forEach(band => {
        const yTop = trajY(Math.min(band.y1, trajY.domain()[1]));
        const yBot = trajY(Math.max(band.y0, 0));
        const h = yBot - yTop;
        if (h <= 0) return;

        bandsG.append("rect")
            .attr("x", 0)
            .attr("y", yTop)
            .attr("width", innerW)
            .attr("height", h)
            .attr("fill", ACTIVITY_BAND_COLORS[band.cat])
            .attr("stroke", "none");

        const labelY = yTop + h / 2;
        if (h > 14) {
            bandsG.append("text")
                .attr("x", 6)
                .attr("y", labelY)
                .attr("text-anchor", "start")
                .attr("dominant-baseline", "middle")
                .attr("font-family", TRAJ_FONT)
                .attr("font-size", "14px")
                .attr("fill", ACTIVITY_TEXT_COLORS[band.cat])
                .attr("font-weight", "700")
                .text(ACTIVITY_LABELS[band.cat]);
        }
    });
}

// --- Legend ---

function updateTrajLegend() {
    const container = d3.select("#traj-legend");
    container.selectAll("*").remove();

    // Always show PI legend
    const medianItem = container.append("span").attr("class", "traj-legend-item");
    medianItem.append("span")
        .attr("class", "traj-legend-swatch")
        .style("background", "#4682B4")
        .style("height", "2px");
    medianItem.append("span").text("Median");

    ["50", "90", "95"].forEach(level => {
        const style = FAN_STYLES[level];
        const item = container.append("span").attr("class", "traj-legend-item");
        item.append("span")
            .attr("class", "traj-legend-swatch")
            .style("background", style.fill)
            .style("opacity", style.opacity + 0.2)
            .style("height", "10px")
            .style("border-radius", "2px");
        item.append("span").text(style.label);
    });

    // Observed
    const obsItem = container.append("span").attr("class", "traj-legend-item");
    obsItem.append("span")
        .attr("class", "traj-legend-swatch")
        .style("background", "#1a1a1a")
        .style("height", "2px");
    obsItem.append("span").text("Observed");

    // Activity bands if shown
    if (showActivityBands) {
        ACTIVITY_ORDER.forEach(cat => {
            const item = container.append("span").attr("class", "traj-legend-item");
            item.append("span")
                .attr("class", "traj-legend-swatch")
                .style("background", ACTIVITY_COLORS[cat])
                .style("opacity", "0.5")
                .style("height", "10px")
                .style("border-radius", "2px");
            item.append("span").text(ACTIVITY_LABELS[cat]);
        });
    }
}

// --- Hover Tooltip ---

function showHoverTooltip(event, nearestDate, recentObserved, refDateObj, refQuantileData) {
    const fmt = d3.timeFormat("%b %d, %Y");
    const valFmt = d3.format(",.0f");

    let html = `<div class="traj-tip-header">Week ending ${fmt(nearestDate)}</div>`;

    // Current season observed
    const obsPoint = recentObserved.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
    if (obsPoint) {
        const label = obsPoint.date >= refDateObj ? "Observed (out-of-sample)" : "Observed";
        html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:#1a1a1a"></span>${label}: <strong>${valFmt(obsPoint.value)}</strong></div>`;
    }

    // Quantile forecast values at this date
    if (refQuantileData) {
        const dateIdx = refQuantileData.dates.findIndex(d => {
            const dObj = new Date(d + "T00:00:00");
            return Math.abs(dObj - nearestDate) < 24 * 60 * 60 * 1000;
        });
        if (dateIdx >= 0) {
            const q = refQuantileData.quantiles;
            const median = q.p50[dateIdx];
            const lo90 = q.p05[dateIdx];
            const hi90 = q.p95[dateIdx];
            if (median != null) {
                html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:#4682B4"></span>Median: <strong>${valFmt(median)}</strong></div>`;
            }
            if (lo90 != null && hi90 != null) {
                html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:#6faed0;opacity:0.5"></span>90% PI: ${valFmt(lo90)} – ${valFmt(hi90)}</div>`;
            }
        }
    }

    // Previous season values
    Object.entries(_alignedSeasonData).forEach(([sName, data]) => {
        const style = SEASON_STYLES[sName] || {};
        const point = data.find(d => Math.abs(d.date - nearestDate) < 24 * 60 * 60 * 1000);
        if (point) {
            html += `<div class="traj-tip-row"><span class="traj-tip-swatch" style="background:${style.color}"></span>${sName}: <strong>${valFmt(point.value)}</strong></div>`;
        }
    });

    if (html.indexOf("traj-tip-row") === -1) return;

    const tt = trajTooltip();
    tt.html(html);
    tt.classed("visible", true);
    positionTrajTooltip(event);
}

// --- Tooltips ---

function hideTrajTooltip() {
    trajTooltip().classed("visible", false);
}

function positionTrajTooltip(event) {
    const tt = trajTooltip().node();
    const ttWidth = tt.offsetWidth;
    const ttHeight = tt.offsetHeight;
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;

    let left = event.clientX + 12;
    let top = event.clientY - 10;

    if (left + ttWidth > viewW - 10) left = event.clientX - ttWidth - 12;
    if (top + ttHeight > viewH - 10) top = viewH - ttHeight - 10;
    if (top < 10) top = 10;

    trajTooltip()
        .style("left", left + "px")
        .style("top", top + "px");
}
