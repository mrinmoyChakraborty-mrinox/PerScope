/* =========================================================
   PERSCOPE PLAYGROUND
   UI CONTROLLER
========================================================= */

import {
    demoState,
    addEvent,
    updatePage,
    updateTool,
    setNextAction,
    setLatency
} from "../js/demo/demo-state.js";


/* =========================================================
   CONFIGURATION
========================================================= */

const SERVER_URL = "ws://localhost:8080";

let socket = null;
let requestCounter = 0;
let requestStartTime = 0;
let paused = false;


/* =========================================================
   DOM HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);


/* =========================================================
   ELEMENTS
========================================================= */

const rawJsonToggle = $("raw-json-toggle");
const rawJson = $("raw-json");
const structuredState = $("structured-screen-state");

const privacyDetailsToggle =
    $("privacy-details-toggle");

const privacyDetails =
    $("privacy-details");

const eventLog =
    $("event-log");

const scenarioSelect =
    $("scenario-select");

const scenarioDescription =
    $("scenario-description");

const startDemoButton =
    $("start-demo");

const resetDemoButton =
    $("reset-demo");

const pauseDemoButton =
    $("pause-demo");

const themeToggle =
    $("theme-toggle");

const settingsThemeToggle =
    $("settings-theme-toggle");

const executeAction =
    $("execute-action");

const toolRequest =
    $("tool-request");

const toolResponse =
    $("tool-response");

const agentReasoning =
    $("agent-reasoning");


/* =========================================================
   SCENARIO DATA
========================================================= */

const scenarios = {

    normal: {
        name: "Normal Workflow",

        description:
            "Open a travel website, enter Mumbai as destination and search for hotels.",

        goal:
            "Find a hotel in Mumbai"
    },

    destructive: {
        name: "Destructive Action",

        description:
            "Test how the local action validator blocks a dangerous action.",

        goal:
            "Attempt a destructive browser action"
    },

    injection: {
        name: "Prompt Injection",

        description:
            "Test how untrusted page content is prevented from controlling the agent.",

        goal:
            "Handle untrusted instructions safely"
    }

};


/* =========================================================
   WEBSOCKET CONNECTION
========================================================= */

function connectToServer() {

    console.log(
        `[UI] Connecting to ${SERVER_URL}...`
    );

    socket = new WebSocket(SERVER_URL);


    socket.onopen = () => {

        console.log("[UI] Connected to server");

        updateServerStatus(true);

        addEvent(
            "Connected to WebSocket server",
            "success",
            "Playground"
        );

    };


    socket.onclose = () => {

        console.log("[UI] Server disconnected");

        updateServerStatus(false);

        addEvent(
            "WebSocket connection closed",
            "warning",
            "Playground"
        );

    };


    socket.onerror = () => {

        console.error(
            "[UI] WebSocket error"
        );

        updateServerStatus(false);

    };

}


/* =========================================================
   SERVER STATUS
========================================================= */

function updateServerStatus(connected) {

    const statusCards =
        document.querySelectorAll(
            ".status-card"
        );

    if (statusCards.length < 2) {
        return;
    }


    const serverCard =
        statusCards[1];

    const statusText =
        serverCard.querySelector("strong");

    const dot =
        serverCard.querySelector(".status-dot");


    if (connected) {

        statusText.textContent =
            "Connected";

        statusText.style.color =
            "var(--green)";

        dot.classList.add("green");

    } else {

        statusText.textContent =
            "Disconnected";

        statusText.style.color =
            "var(--red)";

        dot.classList.remove("green");

    }

}


/* =========================================================
   SEND TOOL REQUEST
========================================================= */

function sendRequest(tool, params = {}) {

    return new Promise(
        (resolve, reject) => {

            if (
                !socket ||
                socket.readyState !== WebSocket.OPEN
            ) {

                reject(
                    new Error(
                        "WebSocket server is not connected."
                    )
                );

                return;
            }


            requestCounter++;

            const request = {

                id:
                    `req_${String(requestCounter).padStart(3, "0")}`,

                tool,

                params

            };


            requestStartTime =
                performance.now();


            /* Show request */

            showToolRequest(request);


            console.log(
                "[UI → SERVER]",
                request
            );


            socket.send(
                JSON.stringify(request)
            );


            const handleResponse =
                (event) => {

                    try {

                        const response =
                            JSON.parse(event.data);


                        if (
                            response.id !==
                            request.id
                        ) {
                            return;
                        }


                        socket.removeEventListener(
                            "message",
                            handleResponse
                        );


                        const latency =
                            Math.round(
                                performance.now() -
                                requestStartTime
                            );


                        setLatency(latency);


                        showLatency(latency);

                        showToolResponse(response);


                        resolve(response);


                    } catch (error) {

                        reject(error);

                    }

                };


            socket.addEventListener(
                "message",
                handleResponse
            );

        }
    );

}


/* =========================================================
   TOOL REQUEST DISPLAY
========================================================= */

function showToolRequest(request) {

    toolRequest.textContent =
        JSON.stringify(
            request,
            null,
            4
        );

}


/* =========================================================
   TOOL RESPONSE DISPLAY
========================================================= */

function showToolResponse(response) {

    toolResponse.textContent =
        JSON.stringify(
            response,
            null,
            4
        );

}


/* =========================================================
   LATENCY
========================================================= */

function showLatency(ms) {

    let latencyElement =
        document.getElementById(
            "latency-value"
        );


    if (!latencyElement) {

        latencyElement =
            document.createElement("span");

        latencyElement.id =
            "latency-value";

        latencyElement.style.marginLeft =
            "10px";

        latencyElement.style.color =
            "var(--green)";

        latencyElement.style.fontSize =
            "10px";


        const screenHeader =
            document.querySelector(
                ".screen-state-panel .panel-header"
            );


        if (screenHeader) {

            screenHeader.appendChild(
                latencyElement
            );

        }

    }


    latencyElement.textContent =
        `Latency: ${ms} ms`;

}


/* =========================================================
   EVENT LOG
========================================================= */

function addUIEvent(
    message,
    status = "success",
    source = "Agent"
) {

    addEvent(
        message,
        status,
        source
    );


    renderEventLog();

}


function renderEventLog() {

    eventLog.innerHTML = "";


    if (
        !demoState.events ||
        demoState.events.length === 0
    ) {

        return;

    }


    demoState.events.forEach(
        (event) => {

            const row =
                document.createElement("div");

            row.className =
                "event-row";


            const time =
                new Date(
                    event.timestamp
                ).toLocaleTimeString(
                    [],
                    {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                    }
                );


            const statusText =
                event.status || "success";


            row.innerHTML = `

                <span>
                    ${time}
                </span>

                <span>
                    ${event.message}
                </span>

                <span>
                    ${event.source || "Agent"}
                </span>

                <span class="event-status">
                    ${statusText}
                </span>

                <span>
                    —
                </span>

            `;


            eventLog.appendChild(row);

        }
    );


    const autoScroll =
        $("auto-scroll");


    if (
        autoScroll &&
        autoScroll.checked
    ) {

        eventLog.parentElement.scrollTop =
            eventLog.parentElement.scrollHeight;

    }

}


/* =========================================================
   SCREEN STATE
========================================================= */

function renderScreenState() {

    const page =
        demoState.currentPage;


    if (!page) {
        return;
    }


    const summary =
        document.querySelectorAll(
            ".state-summary strong"
        );


    if (summary.length >= 3) {

        summary[0].textContent =
            page.title || "Unknown Page";

        summary[1].textContent =
            page.summary || "Unknown state";

    }


    const table =
        document.querySelector(
            ".elements-table"
        );


    if (
        !table ||
        !demoState.lastResponse ||
        !demoState.lastResponse.result
    ) {
        return;
    }


    const elements =
        demoState.lastResponse.result.elements;


    if (!elements) {
        return;
    }


    const header =
        table.querySelector(
            ".table-header"
        );


    table.innerHTML = "";

    table.appendChild(header);


    elements.forEach(
        (element) => {

            const row =
                document.createElement("div");

            row.className =
                "table-row";


            row.innerHTML = `

                <span>
                    ${element.id}
                </span>

                <span>
                    ${element.type}
                </span>

                <span>
                    ${element.label || "—"}
                </span>

                <span>
                    ${element.value ?? "—"}
                </span>

                <span>
                    ${
                        element.bbox
                            ? `[${element.bbox.join(",")}]`
                            : "—"
                    }
                </span>

            `;


            table.appendChild(row);

        }
    );

}


/* =========================================================
   RAW JSON
========================================================= */

function updateRawJSON() {

    const payload = {

        url:
            demoState.currentPage?.url || "",

        title:
            demoState.currentPage?.title || "",

        summary:
            demoState.currentPage?.summary || "",

        elements:
            demoState.lastResponse?.result
                ?.elements || []

    };


    rawJson.textContent =
        JSON.stringify(
            payload,
            null,
            4
        );

}


/* =========================================================
   NEXT ACTION
========================================================= */

function updateNextActionUI() {

    if (!demoState.nextAction) {
        return;
    }


    const actionTitle =
        document.querySelector(
            ".next-action h3"
        );


    if (actionTitle) {

        actionTitle.textContent =
            demoState.nextAction;

    }

}


/* =========================================================
   PRIVACY SUMMARY
========================================================= */

function updatePrivacySummary() {

    $("pii-count").textContent = "3";

    $("sanitized-count").textContent = "3";

    $("audit-status").textContent =
        "PASS";

}


/* =========================================================
   TOOL STATE
========================================================= */

function updateToolUI(
    tool,
    request,
    response
) {

    updateTool(
        tool,
        request,
        response
    );


    const toolRows =
        document.querySelectorAll(
            ".tool-row"
        );


    toolRows.forEach(
        (row) => {

            const name =
                row.children[0]
                    ?.textContent
                    ?.trim();


            if (
                name === tool
            ) {

                const status =
                    row.querySelector(
                        ".tool-status"
                    );


                if (status) {

                    status.textContent =
                        "Active";

                    status.className =
                        "tool-status read";

                }

            }

        }
    );

}


/* =========================================================
   NORMAL DEMO
========================================================= */

async function runNormalDemo() {

    if (paused) {
        return;
    }


    resetVisualState();


    /* -----------------------------------------
       PERCEIVE
    ----------------------------------------- */

    setPipelineStep("perceive");

    addUIEvent(
        "Calling tool: read_page",
        "success",
        "Agent"
    );


    const pageResponse =
        await sendRequest(
            "read_page"
        );


    if (
        pageResponse.status !== "ok"
    ) {

        addUIEvent(
            "read_page failed",
            "error",
            "Server"
        );

        return;
    }


    updatePage(
        pageResponse.result
    );


    updateToolUI(
        "read_page",
        {},
        pageResponse
    );


    renderScreenState();


    addUIEvent(
        "Page state received",
        "success",
        "Extension"
    );


    await delay(700);


    /* -----------------------------------------
       PROTECT
    ----------------------------------------- */

    setPipelineStep("protect");


    addUIEvent(
        "PII detection complete",
        "success",
        "Local Extension"
    );


    addUIEvent(
        "Sanitization complete",
        "success",
        "Local Extension"
    );


    updatePrivacySummary();


    await delay(700);


    /* -----------------------------------------
       READ ELEMENTS
    ----------------------------------------- */

    addUIEvent(
        "Calling tool: list_interactive_elements",
        "success",
        "Agent"
    );


    const elementsResponse =
        await sendRequest(
            "list_interactive_elements"
        );


    updateToolUI(
        "list_interactive_elements",
        {},
        elementsResponse
    );


    if (
        elementsResponse.result?.elements
    ) {

        const count =
            elementsResponse.result.elements.length;


        const summary =
            document.querySelectorAll(
                ".state-summary strong"
            );


        if (summary.length >= 3) {

            summary[2].textContent =
                `${count} interactive`;

        }

    }


    renderScreenState();


    await delay(700);


    /* -----------------------------------------
       REASON
    ----------------------------------------- */

    setPipelineStep("reason");


    setNextAction(
        'Click on "Search Hotels" button'
    );


    updateNextActionUI();


    agentReasoning.innerHTML = `

        <h3>
            Agent Decision
        </h3>

        <p>
            The agent identified the
            Search Hotels button as the
            next required action.
        </p>

        <p>
            The action will be sent to the
            local validator before execution.
        </p>

    `;


    addUIEvent(
        "Agent selected next action: click(el_5)",
        "success",
        "Agent"
    );


    await delay(700);


    /* -----------------------------------------
       ACT
    ----------------------------------------- */

    setPipelineStep("act");


    addUIEvent(
        "Calling tool: click",
        "success",
        "Agent"
    );


    const clickResponse =
        await sendRequest(
            "click",
            {
                element_id: "el_5"
            }
        );


    updateToolUI(
        "click",
        {
            element_id: "el_5"
        },
        clickResponse
    );


    addUIEvent(
        "Validator: action allowed",
        "success",
        "Local Extension"
    );


    addUIEvent(
        'Clicked "Search Hotels"',
        "success",
        "Extension"
    );


    await delay(700);


    /* -----------------------------------------
       TYPE
    ----------------------------------------- */

    addUIEvent(
        "Calling tool: type",
        "success",
        "Agent"
    );


    const typeResponse =
        await sendRequest(
            "type",
            {
                element_id: "el_1",
                text: "Mumbai"
            }
        );


    updateToolUI(
        "type",
        {
            element_id: "el_1",
            text: "Mumbai"
        },
        typeResponse
    );


    addUIEvent(
        "Destination updated",
        "success",
        "Extension"
    );


    await delay(500);


    /* -----------------------------------------
       SELECT OPTION
    ----------------------------------------- */

    addUIEvent(
        "Calling tool: select_option",
        "success",
        "Agent"
    );


    const selectResponse =
        await sendRequest(
            "select_option",
            {
                element_id: "el_4",
                option: "3 Adults"
            }
        );


    updateToolUI(
        "select_option",
        {
            element_id: "el_4",
            option: "3 Adults"
        },
        selectResponse
    );


    addUIEvent(
        "Guest option selected",
        "success",
        "Extension"
    );


    await delay(500);


    /* -----------------------------------------
       SUBMIT
    ----------------------------------------- */

    addUIEvent(
        "Calling tool: submit",
        "success",
        "Agent"
    );


    const submitResponse =
        await sendRequest(
            "submit"
        );


    updateToolUI(
        "submit",
        {},
        submitResponse
    );


    addUIEvent(
        "Form submitted",
        "success",
        "Extension"
    );


    await delay(500);


    /* -----------------------------------------
       SCROLL
    ----------------------------------------- */

    addUIEvent(
        "Calling tool: scroll",
        "success",
        "Agent"
    );


    const scrollResponse =
        await sendRequest(
            "scroll",
            {
                direction: "down",
                amount: 1
            }
        );


    updateToolUI(
        "scroll",
        {
            direction: "down",
            amount: 1
        },
        scrollResponse
    );


    addUIEvent(
        "Page scrolled down",
        "success",
        "Extension"
    );


    /* -----------------------------------------
       REPEAT
    ----------------------------------------- */

    setPipelineStep("repeat");


    addUIEvent(
        "New screen detected",
        "success",
        "Extension"
    );


    console.log(
        "NORMAL DEMO COMPLETE"
    );

}


/* =========================================================
   DESTRUCTIVE SCENARIO
========================================================= */

async function runDestructiveScenario() {

    resetVisualState();

    setPipelineStep("perceive");


    addUIEvent(
        "Destructive scenario started",
        "success",
        "Playground"
    );


    await delay(500);


    setPipelineStep("protect");


    addUIEvent(
        "Page state sanitized",
        "success",
        "Local Extension"
    );


    await delay(500);


    setPipelineStep("reason");


    setNextAction(
        "Attempt destructive action"
    );


    updateNextActionUI();


    agentReasoning.innerHTML = `

        <h3>
            Agent Decision
        </h3>

        <p>
            The simulated agent is requesting
            a potentially destructive action.
        </p>

        <p>
            The local Action Guard must
            validate the request.
        </p>

    `;


    await delay(700);


    setPipelineStep("act");


    addUIEvent(
        "Destructive action requested",
        "warning",
        "Agent"
    );


    addUIEvent(
        "Validator: action blocked",
        "blocked",
        "Local Extension"
    );


    const validator =
        document.querySelector(
            ".validator > strong"
        );


    if (validator) {

        validator.textContent =
            "BLOCKED";

        validator.style.color =
            "var(--red)";

    }


    addUIEvent(
        "User confirmation required",
        "blocked",
        "Action Guard"
    );


}


/* =========================================================
   PROMPT INJECTION SCENARIO
========================================================= */

async function runInjectionScenario() {

    resetVisualState();

    setPipelineStep("perceive");


    addUIEvent(
        "Prompt injection scenario started",
        "success",
        "Playground"
    );


    await delay(500);


    setPipelineStep("protect");


    addUIEvent(
        "Untrusted page content detected",
        "warning",
        "Local Extension"
    );


    addUIEvent(
        "Page instructions treated as untrusted",
        "success",
        "Privacy Firewall"
    );


    await delay(600);


    setPipelineStep("reason");


    setNextAction(
        "Ignore untrusted page instruction"
    );


    updateNextActionUI();


    agentReasoning.innerHTML = `

        <h3>
            Agent Decision
        </h3>

        <p>
            The page contains an instruction
            attempting to influence agent behavior.
        </p>

        <p>
            The instruction is treated as
            untrusted web content.
        </p>

    `;


    await delay(700);


    setPipelineStep("act");


    addUIEvent(
        "Potentially unsafe action prevented",
        "blocked",
        "Action Guard"
    );


    const validator =
        document.querySelector(
            ".validator > strong"
        );


    if (validator) {

        validator.textContent =
            "BLOCKED";

        validator.style.color =
            "var(--red)";

    }

}


/* =========================================================
   PIPELINE CONTROL
========================================================= */

function setPipelineStep(step) {

    const steps = [
        "perceive",
        "protect",
        "reason",
        "act",
        "repeat"
    ];


    const currentIndex =
        steps.indexOf(step);


    steps.forEach(
        (name, index) => {

            const element =
                $(`step-${name}`);


            if (!element) {
                return;
            }


            element.classList.remove(
                "active",
                "completed"
            );


            if (
                index < currentIndex
            ) {

                element.classList.add(
                    "completed"
                );

            }


            if (
                index === currentIndex
            ) {

                element.classList.add(
                    "active"
                );

            }

        }
    );

}


/* =========================================================
   RESET VISUAL STATE
========================================================= */

function resetVisualState() {

    setPipelineStep("perceive");


    const validator =
        document.querySelector(
            ".validator > strong"
        );


    if (validator) {

        validator.textContent =
            "SAFE";

        validator.style.color =
            "var(--green)";

    }


    demoState.events = [];


    addEvent(
        "Session started",
        "success",
        "Playground"
    );


    renderEventLog();

}


/* =========================================================
   SCENARIO SELECTION
========================================================= */

function updateScenario() {

    const selected =
        scenarioSelect.value;


    const scenario =
        scenarios[selected];


    if (!scenario) {
        return;
    }


    scenarioDescription.textContent =
        scenario.description;


    const cards =
        document.querySelectorAll(
            ".scenario-card"
        );


    cards.forEach(
        (card) => {

            card.classList.toggle(
                "active",
                card.dataset.scenario ===
                selected
            );

        }
    );


    addUIEvent(
        `Scenario selected: ${scenario.name}`,
        "success",
        "Playground"
    );

}


/* =========================================================
   START DEMO
========================================================= */

async function startDemo() {

    if (paused) {

        paused = false;

        pauseDemoButton.textContent =
            "◉ Pause";

    }


    const scenario =
        scenarioSelect.value;


    if (scenario === "normal") {

        await runNormalDemo();

    } else if (
        scenario === "destructive"
    ) {

        await runDestructiveScenario();

    } else if (
        scenario === "injection"
    ) {

        await runInjectionScenario();

    }

}


/* =========================================================
   RESET
========================================================= */

function resetDemo() {

    paused = false;


    pauseDemoButton.textContent =
        "◉ Pause";


    demoState.events = [];

    demoState.lastTool = null;

    demoState.lastRequest = null;

    demoState.lastResponse = null;

    demoState.nextAction = null;

    demoState.latency = null;


    addEvent(
        "Session reset",
        "success",
        "Playground"
    );


    renderEventLog();


    setPipelineStep(
        "perceive"
    );


    updatePrivacySummary();


    rawJson.classList.add(
        "hidden"
    );

    structuredState.classList.remove(
        "hidden"
    );


    privacyDetails.classList.add(
        "hidden"
    );


    const validator =
        document.querySelector(
            ".validator > strong"
        );


    if (validator) {

        validator.textContent =
            "SAFE";

        validator.style.color =
            "var(--green)";

    }


    showToolRequest({
        id: "req_001",
        tool: "read_page",
        params: {}
    });


    showToolResponse({
        id: "req_001",
        status: "ok",
        result: {}
    });

}


/* =========================================================
   PAUSE
========================================================= */

function togglePause() {

    paused = !paused;


    if (paused) {

        pauseDemoButton.textContent =
            "▶ Resume";


        addUIEvent(
            "Demo paused",
            "warning",
            "Playground"
        );

    } else {

        pauseDemoButton.textContent =
            "◉ Pause";


        addUIEvent(
            "Demo resumed",
            "success",
            "Playground"
        );

    }

}


/* =========================================================
   RAW JSON BUTTON
========================================================= */

function toggleRawJSON() {

    const showingRaw =
        !rawJson.classList.contains(
            "hidden"
        );


    if (showingRaw) {

        rawJson.classList.add(
            "hidden"
        );

        structuredState.classList.remove(
            "hidden"
        );

        rawJsonToggle.textContent =
            "View Raw JSON";

    } else {

        updateRawJSON();

        structuredState.classList.add(
            "hidden"
        );

        rawJson.classList.remove(
            "hidden"
        );

        rawJsonToggle.textContent =
            "View Screen State";

    }

}


/* =========================================================
   PRIVACY DETAILS BUTTON
========================================================= */

function togglePrivacyDetails() {

    const showing =
        !privacyDetails.classList.contains(
            "hidden"
        );


    if (showing) {

        privacyDetails.classList.add(
            "hidden"
        );

        privacyDetailsToggle.textContent =
            "View Details";

    } else {

        privacyDetails.classList.remove(
            "hidden"
        );

        privacyDetailsToggle.textContent =
            "Hide Details";

    }

}


/* =========================================================
   THEME
========================================================= */

function toggleTheme() {

    document.body.classList.toggle(
        "light-theme"
    );


    const light =
        document.body.classList.contains(
            "light-theme"
        );


    themeToggle.textContent =
        light ? "☀" : "☾";


    if (settingsThemeToggle) {

        settingsThemeToggle.textContent =
            light
                ? "Switch to Dark"
                : "Switch to Light";

    }

}


/* =========================================================
   INSPECTOR TABS
========================================================= */

function setupInspectorTabs() {

    const tabs =
        document.querySelectorAll(
            ".inspector-tab"
        );


    tabs.forEach(
        (tab) => {

            tab.addEventListener(
                "click",
                () => {

                    tabs.forEach(
                        (item) => {

                            item.classList.remove(
                                "active"
                            );

                        }
                    );


                    tab.classList.add(
                        "active"
                    );


                    const selected =
                        tab.dataset.tab;


                    document
                        .querySelectorAll(
                            ".inspector-content"
                        )
                        .forEach(
                            (content) => {

                                content.classList.add(
                                    "hidden"
                                );

                            }
                        );


                    const target =
                        $(selected);


                    if (target) {

                        target.classList.remove(
                            "hidden"
                        );

                    }

                }
            );

        }
    );

}


/* =========================================================
   SIDEBAR NAVIGATION
========================================================= */

function setupNavigation() {

    const navItems =
        document.querySelectorAll(
            ".nav-item"
        );


    navItems.forEach(
        (item) => {

            item.addEventListener(
                "click",
                () => {

                    navItems.forEach(
                        (nav) => {

                            nav.classList.remove(
                                "active"
                            );

                        }
                    );


                    item.classList.add(
                        "active"
                    );


                    const section =
                        item.dataset.section;


                    navigateToSection(
                        section
                    );

                }
            );

        }
    );

}


/* =========================================================
   NAVIGATION LOGIC
========================================================= */

function navigateToSection(section) {

    /* Hide special workspaces */

    const scenariosPanel =
        $("scenarios");

    const settingsPanel =
        $("settings");

    const agentInputPanel =
        $("agent-input-panel");


    scenariosPanel.classList.add(
        "hidden"
    );

    settingsPanel.classList.add(
        "hidden"
    );


    agentInputPanel.style.display =
        "none";


    /* Main dashboard sections */

    if (
        section === "playground"
    ) {

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

        return;

    }


    if (
        section === "live-view"
    ) {

        scrollToElement(
            $("live-view")
        );

        return;

    }


    if (
        section === "screen-state"
    ) {

        scrollToElement(
            $("screen-state")
        );

        return;

    }


    if (
        section === "action-logs"
    ) {

        scrollToElement(
            $("action-logs")
        );

        return;

    }


    if (
        section === "agent-input"
    ) {

        agentInputPanel.style.display =
            "block";

        scrollToElement(
            agentInputPanel
        );

        return;

    }


    if (
        section === "scenarios"
    ) {

        scenariosPanel.classList.remove(
            "hidden"
        );

        scrollToElement(
            scenariosPanel
        );

        return;

    }


    if (
        section === "settings"
    ) {

        settingsPanel.classList.remove(
            "hidden"
        );

        scrollToElement(
            settingsPanel
        );

        return;

    }

}


/* =========================================================
   SCROLL HELPER
========================================================= */

function scrollToElement(element) {

    if (!element) {
        return;
    }


    element.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

}


/* =========================================================
   SCENARIO CARDS
========================================================= */

function setupScenarioCards() {

    const cards =
        document.querySelectorAll(
            ".scenario-card"
        );


    cards.forEach(
        (card) => {

            card.addEventListener(
                "click",
                () => {

                    const scenario =
                        card.dataset.scenario;


                    scenarioSelect.value =
                        scenario;


                    updateScenario();


                    startDemo();

                }
            );

        }
    );

}


/* =========================================================
   MOCK BROWSER INTERACTION
========================================================= */

function setupMockBrowser() {

    const searchButton =
        $("mock-search-button");


    if (searchButton) {

        searchButton.addEventListener(
            "click",
            () => {

                addUIEvent(
                    "Search Hotels clicked in simulated browser",
                    "success",
                    "Browser"
                );

            }
        );

    }


    const guests =
        $("mock-guests");


    if (guests) {

        guests.addEventListener(
            "change",
            () => {

                addUIEvent(
                    `Guest selection changed to ${guests.value}`,
                    "success",
                    "Browser"
                );

            }
        );

    }

}


/* =========================================================
   BUTTON EVENTS
========================================================= */

function setupButtons() {

    rawJsonToggle.addEventListener(
        "click",
        toggleRawJSON
    );


    privacyDetailsToggle.addEventListener(
        "click",
        togglePrivacyDetails
    );


    themeToggle.addEventListener(
        "click",
        toggleTheme
    );


    if (settingsThemeToggle) {

        settingsThemeToggle.addEventListener(
            "click",
            toggleTheme
        );

    }


    startDemoButton.addEventListener(
        "click",
        startDemo
    );


    resetDemoButton.addEventListener(
        "click",
        resetDemo
    );


    pauseDemoButton.addEventListener(
        "click",
        togglePause
    );


    scenarioSelect.addEventListener(
        "change",
        updateScenario
    );


    if (executeAction) {

        executeAction.addEventListener(
            "click",
            () => {

                addUIEvent(
                    "Execute Action clicked",
                    "success",
                    "Playground"
                );

            }
        );

    }

}


/* =========================================================
   DELAY
========================================================= */

function delay(ms) {

    return new Promise(
        resolve =>
            setTimeout(resolve, ms)
    );

}


/* =========================================================
   INITIALIZE
========================================================= */

function initialize() {

    console.log(
        "================================"
    );

    console.log(
        "PERSCOPE PLAYGROUND UI"
    );

    console.log(
        "================================"
    );


    setupInspectorTabs();

    setupNavigation();

    setupScenarioCards();

    setupMockBrowser();

    setupButtons();


    updatePrivacySummary();

    renderEventLog();

    setPipelineStep(
        "perceive"
    );


    updateScenario();


    connectToServer();

}


initialize();