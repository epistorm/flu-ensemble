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

    // Hover affordance: "What do these mean?" with a popover explaining the levels.
    const hint = container.append("div")
        .attr("class", "legend-info-hint")
        .attr("tabindex", "0")
        .html('<span class="legend-info-icon">i</span>What do these mean?');
    attachLegendInfo(hint, type);

    const boxW = 16;
    const boxH = 12;
    const rowGap = 3;
    const textOffset = boxW + 6;
    const rowHeight = boxH + rowGap;
    const svgWidth = 130;
    const svgHeight = order.length * rowHeight + 2;

    const svg = container.append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight);

    const g = svg.append("g")
        .attr("transform", "translate(2, 2)");

    order.forEach((cat, i) => {
        const y = i * rowHeight;
        const needsStroke = (cat === "low" || cat === "stable" || cat === "minimal");

        g.append("rect")
            .attr("x", 0)
            .attr("y", y)
            .attr("width", boxW)
            .attr("height", boxH)
            .attr("fill", colors[cat])
            .attr("stroke", needsStroke ? "#ccc" : "none")
            .attr("stroke-width", 0.5)
            .attr("rx", 2);

        g.append("text")
            .attr("x", textOffset)
            .attr("y", y + boxH / 2)
            .attr("dominant-baseline", "central")
            .attr("font-family", "Helvetica Neue, Arial, sans-serif")
            .attr("font-size", "11px")
            .attr("fill", "#666")
            .text(labels[cat]);
    });
}

// --- Legend hover popover: general explanation of the levels ---

function legendInfoHtml(type) {
    if (type === "trend") {
        return '<div class="legend-tip-title">Influenza Trend categories</div>' +
            '<p>The forecasted direction of change in weekly hospitalizations relative to the ' +
            'week before the forecast. Each category is defined by the change in rate ' +
            'per 100,000 population (counts differing by fewer than 10 admissions are ' +
            'always classified as Stable):</p>' +
            '<table class="legend-tip-table">' +
            '<thead><tr><th>Horizon</th><th>Stable</th><th>Inc / Dec</th><th>Large</th></tr></thead>' +
            '<tbody>' +
            '<tr><td>1 wk</td><td>&lt; 0.3</td><td>0.3–1.7</td><td>&ge; 1.7</td></tr>' +
            '<tr><td>2 wk</td><td>&lt; 0.5</td><td>0.5–3.0</td><td>&ge; 3.0</td></tr>' +
            '<tr><td>3 wk</td><td>&lt; 0.7</td><td>0.7–4.0</td><td>&ge; 4.0</td></tr>' +
            '<tr><td>4 wk</td><td>&lt; 1.0</td><td>1.0–5.0</td><td>&ge; 5.0</td></tr>' +
            '</tbody></table>' +
            '<p class="legend-tip-note">Rate change per 100k. Hover a state for its exact ' +
            'admission-count thresholds at the selected week.</p>';
    }
    return '<div class="legend-tip-title">Influenza Activity levels</div>' +
        '<p>How forecasted weekly hospital admissions compare to historical intensity, ' +
        'using the Moving Epidemic Method over three seasons of data (2022–2024). ' +
        'Thresholds are specific to each state.</p>' +
        '<ul class="legend-tip-list">' +
        '<li><b>Low</b> &mdash; below the Medium threshold (~40% of weeks historically)</li>' +
        '<li><b>Medium</b> &mdash; at or above Medium, below High (~50% of weeks)</li>' +
        '<li><b>High</b> &mdash; at or above High, below Very High (~10% of weeks)</li>' +
        '<li><b>Very High</b> &mdash; at or above the Very High threshold</li>' +
        '</ul>' +
        '<p class="legend-tip-note">Hover a state for its exact weekly-admission thresholds.</p>';
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
        tip.innerHTML = legendInfoHtml(type);
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
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
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
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text("0");

    // Right label (max)
    g.append("text")
        .attr("x", barW)
        .attr("y", barH + 12)
        .attr("text-anchor", "end")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(fmt(maxVal));

}
