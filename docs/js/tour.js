// Guided Tour — lightweight walkthrough with spotlight overlay

const TOUR_STEPS = [
    {
        selectors: ["#tab-bar", ".card-map"],
        infoKey: "map",
        title: "Dashboard Views & Map",
        text: "Switch between three views: <strong>Influenza Trend</strong>, <strong>Influenza Activity</strong>, and <strong>Weekly Hospital Admissions</strong> to see the forecast levels within each state. Hover over a state to see detailed forecast information, and click a state to jump to its trajectory forecast below.",
        position: "bottom",
        wide: true,
        dropdown: {
            label: "Learn about each view",
            items: [
                {
                    title: "Influenza Trend",
                    body: "The trend forecast predicts whether flu hospitalizations are expected to <em>increase</em>, <em>decrease</em>, or <em>remain stable</em> relative to a reference week (the week prior to horizon 0). " +
                    "Each horizon and model trajectory is classified into one of five categories based on the predicted change in hospitalization rate per 100,000: " +
                    "<strong>Large Decrease</strong>, <strong>Decrease</strong>, <strong>Stable</strong>, <strong>Increase</strong>, and <strong>Large Increase</strong>.<br><br>" +
                    "To reduce the impact of reporting revisions and noise in small counts, any week pair with a difference of fewer than 10 hospital admissions is automatically classified as <strong>Stable</strong>. " +
                    "The remaining categories are determined by the magnitude and direction of the rate change difference between the forecasted and reference weeks. See the table below for thresholds (decreasing categories assume a negative change):<br><br> " +
                        '<table class="tour-threshold-table">' +
                        "<thead><tr><th>Horizon</th><th>Stable</th><th>Inc / Dec</th><th>Large Inc / Dec</th></tr></thead>" +
                        "<tbody>" +
                        "<tr><td>0 (1 wk ahead)</td><td>&lt; 0.3</td><td>0.3 \u2013 1.7</td><td>\u2265 1.7</td></tr>" +
                        "<tr><td>1 (2 wk ahead)</td><td>&lt; 0.5</td><td>0.5 \u2013 3.0</td><td>\u2265 3.0</td></tr>" +
                        "<tr><td>2 (3 wk ahead)</td><td>&lt; 0.7</td><td>0.7 \u2013 4.0</td><td>\u2265 4.0</td></tr>" +
                        "<tr><td>3 (4 wk ahead)</td><td>&lt; 1.0</td><td>1.0 \u2013 5.0</td><td>\u2265 5.0</td></tr>" +
                        "</tbody></table>" +
                        '<em style="font-size:11px;color:#888;">Rate change thresholds in hospitalizations per 100k. Counts &lt; 10 are always classified as Stable.</em><br><br>' +
                        "The map displays the trend direction with the highest probability for each state. " +
                        "Hover over a state to see the full probability distribution across all five trend categories."
                },
                {
                    title: "Influenza Activity",
                    body: "Activity levels represent how observed and predicted hospitalization incidence compare to historical baseline and epidemic values for a particular region. " +
                        "The thresholds between activity levels are obtained with the Moving Epidemic Method (MEM) using the MEM R package. " +
                        "Thresholds are based on three seasons of Health and Human Services data of weekly influenza hospital admissions from February 2022 through April 2024.<br><br>" +
                        "This method calculates activity thresholds that characterize the levels of intensity of the epidemic periods " +
                        "and the transition between non-epidemic and epidemic periods. " +
                        "The activity levels shown reflect epidemic intensity thresholds such that, over many seasons, an expected 40% of weeks would fall below the <strong>Medium</strong> threshold, " +
                        "50% of weeks would cross the Medium threshold but fall below the <strong>High</strong> threshold, " +
                        "and 10% of weeks would cross the <strong>High</strong> threshold.<br><br>" +
                        "Hover over a state to see the full probability distribution of activity levels during the forecast week.<br><br>" +
                        '<em style="font-size:11px;color:#888;">[1] Vega et al. (2012) Influenza surveillance in Europe: establishing epidemic thresholds by the moving epidemic method. <i>Influenza and Other Respiratory Viruses</i> 7(4), 546\u2013558.<br>' +
                        '[2] Lozano JE. lozalojo/mem: Second release of the MEM R library. Zenodo. Available from: <a href="https://zenodo.org/record/165983" target="_blank" style="color:#888;">https://zenodo.org/record/165983</a>.</em>'
                },
                {
                    title: "Weekly Hospital Admissions",
                    body: "This view shows the forecasted weekly influenza hospital admissions at different levels of uncertainty. " +
                        "The map is colored by the predicted hospitalization count (or rate per 100,000 population). " +
                        "Hover over a state to see the four-week-ahead forecasted hospitalization time series with different prediction intervals " +
                        "(these 4 weeks correspond to the Forecast Week dates at the bottom of the map). " +
                        "There is a vertical line over the horizon that is selected in the forecast week selector which represents what values the states are colored by."
                }
            ]
        }
    },
    {
        selector: ".horizon-control",
        infoKey: "map",
        title: "Forecast Week",
        text: "Each forecast predicts four weeks ahead. Click on a week to select it, the date range shown (e.g., Jan 5\u2013Jan 11) indicates the period that week covers. " +
            "For example, Wk 3 means the forecast is looking three weeks out from the last reported data at the time of the forecast.",
        position: "right"
    },
    {
        selector: ".estimate-control",
        infoKey: "map",
        title: "Uncertainty Estimates",
        text: "In order to show spatial uncertainty, we provide buttons that allow you to view different uncertainty estimates for each state. " +
            "For the <strong>Influenza Trend</strong> and <strong>Influenza Activity</strong> views, the <strong>Most Likely</strong> forecast is the category with the highest probability (the mode). " +
            "For <strong>Weekly Hospital Admissions</strong>, it is the median prediction of the forecast.<br><br>" +
            "The <strong>Lower End</strong> and <strong>Upper End</strong> estimates correspond to the 10th and 90th percentiles. " +
            "They indicate the probability that during a given week we will see either a lower or higher outcome than the most likely estimate " +
            "(for the trend and activity forecasts, the more certain forecasts could show the same category for the lower and upper predictions).",
        position: "right"
    },
    {
        selector: ".card-gauges",
        infoKey: "gauges",
        title: "US Summary",
        text: "This panel summarizes the most likely estimates for forecasted trend, activity, and hospital admissions, updating based on the selected view. The gauge dial shows a weighted average position across the trend or activity probability distribution for the US as a whole, while the bar chart below displays the full uncertainty distribution. The Weekly Hospital Admissions tab shows the binned probability distribution of forecasted admissions.",
        position: "left"
    },
    {
        selector: "#trajectory-section",
        infoKey: "traj",
        title: "Trajectory Forecasts",
        text: "The trajectory chart shows individual model realizations for a four week ahead forecast for a selected state.<br><br>" +
            "<strong>Click on the chart</strong> to change the date the forecast was generated. " +
            "<strong>Black dots</strong> represent surveillance data points known at the time of the forecast. " +
            "<strong>White dots with a black outline</strong> represent surveillance data that was reported after the forecast was made.<br><br>" +
            "<em>Note on data revisions:</em> hospitalization data is subject to reporting delays and revisions (known as backfill). " +
            "The data available when the forecast was generated may differ slightly from the final reported numbers, " +
            "so the model is fit to preliminary data that can change in subsequent weeks.",
        position: "top",
        wide: true
    },
    {
        selector: ".traj-controls",
        infoKey: "traj",
        title: "Trajectory Controls",
        text: "<strong>Location</strong> selects which state you want to view. You can also change the state by clicking on the map above. " +
            "The <strong>Trajectories</strong> slider controls how many individual simulations are shown (0\u2013200). " +
            "The <strong>Prediction Intervals</strong> buttons overlay fixed-time statistics on the chart: " +
            "specifically the 50%, 90%, and 95% prediction intervals, which show the range within which the actual value is expected to fall.",
        position: "bottom"
    },
    {
        selector: ".traj-context-panel",
        infoKey: "traj",
        title: "Add Context",
        text: "In some instances it's useful to see how the current season and the forecast compare to previous seasons or other contextual information.<br><br>" +
            "<strong>Compare to Previous Seasons</strong> overlays historical hospitalization curves behind the current visualization. " +
            "<strong>Activity Levels</strong> visually shows where the thresholds fall for each location, so you can see where each week's forecast falls relative to historical intensity levels. " +
            "<strong>Trend Forecasts</strong> highlights and colors each trajectory by its predicted direction (e.g., increasing or decreasing) " +
            "depending on which forecast week is chosen (the 1-to-4-week-ahead forecast).",
        position: "left"
    }
];

// Build INFO_TEXT automatically from TOUR_STEPS — single source of truth.
// Each step's infoKey maps it to an info button. Steps sharing a key are combined.
function buildInfoText() {
    var result = {};
    var divider = '<hr class="info-divider">';
    TOUR_STEPS.forEach(function(step) {
        if (!step.infoKey) return;
        var html = '<div class="info-section"><strong class="info-section-title">' + step.title + '</strong>' + step.text;
        // Include dropdown content expanded inline
        if (step.dropdown) {
            step.dropdown.items.forEach(function(item) {
                html += divider + '<strong class="info-subsection-title">' + item.title + '</strong>' + item.body;
            });
        }
        html += '</div>';
        if (result[step.infoKey]) {
            result[step.infoKey] += divider + html;
        } else {
            result[step.infoKey] = html;
        }
    });
    return result;
}

var INFO_TEXT = buildInfoText();

let tourActive = false;
let tourStep = 0;
let tourOverlay = null;
let tourPopup = null;
let tourHighlighted = [];

function startTour() {
    tourActive = true;
    tourStep = 0;

    // Create overlay
    tourOverlay = document.createElement("div");
    tourOverlay.className = "tour-overlay";
    tourOverlay.addEventListener("click", endTour);
    document.body.appendChild(tourOverlay);

    // Create popup
    tourPopup = document.createElement("div");
    tourPopup.className = "tour-popup";
    tourPopup.addEventListener("click", e => e.stopPropagation());
    document.body.appendChild(tourPopup);

    // Keyboard navigation
    document.addEventListener("keydown", tourKeyHandler);

    goToStep(0);
}

function endTour() {
    tourActive = false;

    tourHighlighted.forEach(el => el.classList.remove("tour-spotlight"));
    tourHighlighted = [];

    if (tourOverlay) {
        tourOverlay.remove();
        tourOverlay = null;
    }
    if (tourPopup) {
        tourPopup.remove();
        tourPopup = null;
    }

    document.removeEventListener("keydown", tourKeyHandler);
}

function tourKeyHandler(e) {
    if (!tourActive) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        if (tourStep < TOUR_STEPS.length - 1) goToStep(tourStep + 1);
        else endTour();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        if (tourStep > 0) goToStep(tourStep - 1);
    } else if (e.key === "Escape") {
        e.preventDefault();
        endTour();
    }
}

function buildDropdownHTML(dropdown) {
    if (!dropdown) return "";
    let html = '<div class="tour-dropdown">';
    html += '<button class="tour-dropdown-toggle">' + dropdown.label + ' <span class="tour-dropdown-chevron">&#9662;</span></button>';
    html += '<div class="tour-dropdown-body" style="display:none;">';
    dropdown.items.forEach(function(item) {
        html += '<div class="tour-dropdown-item">';
        html += '<button class="tour-dropdown-item-header"><strong>' + item.title + '</strong> <span class="tour-dropdown-chevron">&#9662;</span></button>';
        html += '<div class="tour-dropdown-item-body" style="display:none;">' + item.body + '</div>';
        html += '</div>';
    });
    html += '</div></div>';
    return html;
}

// Get combined bounding rect for multiple selectors
function getCombinedRect(selectors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const els = [];
    selectors.forEach(function(sel) {
        const el = document.querySelector(sel);
        if (!el) return;
        els.push(el);
        const r = el.getBoundingClientRect();
        minX = Math.min(minX, r.left);
        minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right);
        maxY = Math.max(maxY, r.bottom);
    });
    return {
        els: els,
        rect: { left: minX, top: minY, right: maxX, bottom: maxY,
                width: maxX - minX, height: maxY - minY }
    };
}

function goToStep(n) {
    tourStep = n;
    var step = TOUR_STEPS[n];

    // Resolve target elements
    var selectors = step.selectors || [step.selector];
    var combined = getCombinedRect(selectors);
    var targets = combined.els;
    var rect = combined.rect;

    if (targets.length === 0) return;

    // Remove previous highlights
    tourHighlighted.forEach(function(el) { el.classList.remove("tour-spotlight"); });
    tourHighlighted = [];

    // Scroll first target into view
    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });

    setTimeout(function() {
        targets.forEach(function(el) {
            el.classList.add("tour-spotlight");
        });
        tourHighlighted = targets;

        // Recompute rect after scroll
        combined = getCombinedRect(selectors);
        rect = combined.rect;

        var pad = 8;
        var r = 6;
        var x1 = rect.left - pad;
        var y1 = rect.top - pad;
        var x2 = rect.right + pad;
        var y2 = rect.bottom + pad;

        tourOverlay.style.clipPath = 'polygon(' +
            '0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ' +
            x1 + 'px ' + (y1 + r) + 'px, ' +
            (x1 + r) + 'px ' + y1 + 'px, ' +
            (x2 - r) + 'px ' + y1 + 'px, ' +
            x2 + 'px ' + (y1 + r) + 'px, ' +
            x2 + 'px ' + (y2 - r) + 'px, ' +
            (x2 - r) + 'px ' + y2 + 'px, ' +
            (x1 + r) + 'px ' + y2 + 'px, ' +
            x1 + 'px ' + (y2 - r) + 'px, ' +
            x1 + 'px ' + (y1 + r) + 'px)';

        var isLast = n === TOUR_STEPS.length - 1;
        var isFirst = n === 0;
        var dropdownHTML = buildDropdownHTML(step.dropdown);

        // Apply wide class for steps with longer content
        tourPopup.className = "tour-popup" + (step.wide ? " tour-popup-wide" : "");

        tourPopup.innerHTML =
            '<button class="tour-close" aria-label="Close tour">&times;</button>' +
            '<div class="tour-popup-body">' +
                '<div class="tour-step-title">' + step.title + '</div>' +
                '<div class="tour-step-text">' + step.text + '</div>' +
                dropdownHTML +
            '</div>' +
            '<div class="tour-nav">' +
                '<span class="tour-counter">' + (n + 1) + ' of ' + TOUR_STEPS.length + '</span>' +
                '<div class="tour-arrows">' +
                    '<button class="tour-arrow tour-prev" ' + (isFirst ? 'disabled' : '') + ' aria-label="Previous">&#8592;</button>' +
                    '<button class="tour-arrow tour-next" aria-label="' + (isLast ? 'Finish' : 'Next') + '">' + (isLast ? 'Finish &#10003;' : '&#8594;') + '</button>' +
                '</div>' +
            '</div>';

        tourPopup.querySelector(".tour-close").addEventListener("click", endTour);
        tourPopup.querySelector(".tour-prev").addEventListener("click", function() {
            if (tourStep > 0) goToStep(tourStep - 1);
        });
        tourPopup.querySelector(".tour-next").addEventListener("click", function() {
            if (tourStep < TOUR_STEPS.length - 1) goToStep(tourStep + 1);
            else endTour();
        });

        // Wire up dropdown toggles
        var mainToggle = tourPopup.querySelector(".tour-dropdown-toggle");
        if (mainToggle) {
            mainToggle.addEventListener("click", function() {
                var body = mainToggle.nextElementSibling;
                var chevron = mainToggle.querySelector(".tour-dropdown-chevron");
                var isOpen = body.style.display !== "none";
                body.style.display = isOpen ? "none" : "block";
                chevron.innerHTML = isOpen ? "&#9662;" : "&#9652;";
                setTimeout(function() { positionPopup(rect, step.position); }, 50);
            });
        }
        tourPopup.querySelectorAll(".tour-dropdown-item-header").forEach(function(hdr) {
            hdr.addEventListener("click", function() {
                var itemBody = hdr.nextElementSibling;
                var chevron = hdr.querySelector(".tour-dropdown-chevron");
                var isOpen = itemBody.style.display !== "none";
                itemBody.style.display = isOpen ? "none" : "block";
                chevron.innerHTML = isOpen ? "&#9662;" : "&#9652;";
                setTimeout(function() { positionPopup(rect, step.position); }, 50);
            });
        });

        positionPopup(rect, step.position);
    }, 350);
}

function positionPopup(targetRect, preferred) {
    var popup = tourPopup;
    var gap = 14;

    popup.style.left = "0px";
    popup.style.top = "0px";
    var pw = popup.offsetWidth;
    var ph = popup.offsetHeight;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    var left, top;

    if (preferred === "bottom") {
        left = targetRect.left + targetRect.width / 2 - pw / 2;
        top = targetRect.bottom + gap;
    } else if (preferred === "top") {
        left = targetRect.left + targetRect.width / 2 - pw / 2;
        top = targetRect.top - ph - gap;
    } else if (preferred === "right") {
        left = targetRect.right + gap;
        top = targetRect.top + targetRect.height / 2 - ph / 2;
    } else if (preferred === "left") {
        left = targetRect.left - pw - gap;
        top = targetRect.top + targetRect.height / 2 - ph / 2;
    }

    if (left + pw > vw - 16) left = vw - pw - 16;
    if (left < 16) left = 16;
    if (top + ph > vh - 16) top = vh - ph - 16;
    if (top < 16) top = 16;

    popup.style.left = left + "px";
    popup.style.top = top + "px";
}

// --- Info Buttons (modal panel) ---

function initInfoButtons() {
    document.querySelectorAll(".info-btn").forEach(function(btn) {
        btn.addEventListener("click", function(e) {
            e.stopPropagation();
            var key = btn.getAttribute("data-info");
            var text = INFO_TEXT[key];
            if (!text) return;
            openInfoModal(text);
        });
    });
}

function openInfoModal(html) {
    // Remove existing modal if open
    closeInfoModal();

    var backdrop = document.createElement("div");
    backdrop.className = "info-modal-backdrop";
    backdrop.addEventListener("click", closeInfoModal);

    var panel = document.createElement("div");
    panel.className = "info-modal";
    panel.addEventListener("click", function(e) { e.stopPropagation(); });
    panel.innerHTML =
        '<button class="info-modal-close" aria-label="Close">&times;</button>' +
        '<div class="info-modal-body">' + html + '</div>';

    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    panel.querySelector(".info-modal-close").addEventListener("click", closeInfoModal);

    // Close on Escape
    document.addEventListener("keydown", infoModalKeyHandler);
}

function closeInfoModal() {
    var existing = document.querySelector(".info-modal-backdrop");
    if (existing) existing.remove();
    document.removeEventListener("keydown", infoModalKeyHandler);
}

function infoModalKeyHandler(e) {
    if (e.key === "Escape") {
        e.preventDefault();
        closeInfoModal();
    }
}
