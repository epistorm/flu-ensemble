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

function drawAdmissionsLegend(container) {
    const scale = getAdmissionsColorScale();
    const maxVal = scale.domain()[1];

    const isPerCap = AppState.admissionsRate === "percapita";
    const fmt = isPerCap ? d3.format(",.1f") : d3.format(",.0f");
    const unitLabel = isPerCap ? "Per 100k" : "Hosp.";

    const gradientH = 80;
    const barW = 16;
    const svgWidth = 130;
    const svgHeight = gradientH + 24;

    const svg = container.append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight);

    const defs = svg.append("defs");
    const gradient = defs.append("linearGradient")
        .attr("id", "admissions-gradient")
        .attr("x1", "0%").attr("x2", "0%")
        .attr("y1", "100%").attr("y2", "0%");

    const nStops = 10;
    for (let i = 0; i <= nStops; i++) {
        const t = i / nStops;
        gradient.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", scale(t * maxVal));
    }

    const g = svg.append("g")
        .attr("transform", "translate(2, 2)");

    g.append("rect")
        .attr("width", barW)
        .attr("height", gradientH)
        .attr("rx", 2)
        .attr("fill", "url(#admissions-gradient)")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 0.5);

    // Top label (max)
    g.append("text")
        .attr("x", barW + 6)
        .attr("y", 4)
        .attr("dominant-baseline", "hanging")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(fmt(maxVal));

    // Bottom label (0)
    g.append("text")
        .attr("x", barW + 6)
        .attr("y", gradientH - 2)
        .attr("dominant-baseline", "auto")
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text("0");

    // Unit label below
    g.append("text")
        .attr("x", 0)
        .attr("y", gradientH + 14)
        .attr("font-family", "Helvetica Neue, Arial, sans-serif")
        .attr("font-size", "10px")
        .attr("fill", "#666")
        .text(unitLabel);
}
