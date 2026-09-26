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

import {
    createRuntimeClient,
    DEFAULT_BRIDGE_URL,
} from "./runtime-client.js";


/* =========================================================
   CONFIGURATION
========================================================= */

let serverUrl = DEFAULT_BRIDGE_URL;
let requestCounter = 0;
let requestStartTime = 0;

// Single transport instance. There is intentionally no heartbeat:
// the bridge has no ping handler, and an unauthenticated {type:"ping"}
// frame would get this socket closed as unauthorized (ws-server rejects
// anything that is not pair/hello/authed). Liveness = socket state.
const runtime = createRuntimeClient({
    url: serverUrl,
    onStatus: (status) => {
        if (status.connected && status.paired) {
            updateServerStatus(true, "Connected + paired", true);
        } else if (status.connected) {
            updateServerStatus(true, "Reachable, not paired", false);
        } else {
            updateServerStatus(false, "Disconnected", false);
        }
    },
});

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



const privacyDetails =
    $("privacy-details");

const eventLog =
    $("event-log");


const themeToggle =
    $("theme-toggle");

const toolRequest =
    $("tool-request");

const toolResponse =
    $("tool-response");

const agentReasoning =
    $("agent-reasoning");

/* =========================================================
   CHAT PLAYGROUND
   ========================================================= */

const chat = $("chat");

const chatInput =
    $("chat-input");

const chatSend =
    $("chat-send");

const chatStatus =
    $("chat-status");

const thinkingCard =
    $("thinkingCard");


const wsUrl =
    $("ws-url");

const wsConnect =
    $("ws-connect");

const wsDisconnect =
    $("ws-disconnect");

const wsStatus =
    $("ws-status");
const progressFastToggle =
    $("progress-fast-toggle");
// No heartbeat by design (see runtime-client note above): the bridge
// closes sockets on unauthenticated frames, so pinging would disconnect
// us. Connection liveness comes from the socket itself.
/* =========================================================
   BRIDGE CONNECTION (via runtime-client)
========================================================= */

function connectToServer() {

    const current = runtime.getStatus();
    if (current.connected) {
        return;
    }


    const url =
        wsUrl?.value.trim();

    if (!url) {

        console.error(
            "[UI] WebSocket URL is empty"
        );

        return;
    }


    serverUrl = url;


    console.log(
        `[UI] Connecting to ${serverUrl}...`
    );


    updateServerStatus(
        false,
        "Connecting..."
    );


    runtime.connect(serverUrl).then(
        (status) => {

            console.log(
                "[UI] Connected to bridge"
            );


            addEvent(
                status.paired
                    ? "Connected to bridge (paired)"
                    : "Connected to bridge (not paired — enter a pairing code)",
                status.paired ? "success" : "warning",
                "Playground"
            );

        },
        (error) => {

            console.error(
                "[UI] Bridge connection failed:",
                error
            );


            addUIEvent(
                "Bridge connection failed: " +
                    (error?.message || error),
                "error",
                "Playground"
            );


            updateServerStatus(
                false,
                "Disconnected"
            );

        }
    );


}

//closeWebSocket()
function closeWebSocket() {

    const current = runtime.getStatus();

    if (!current.connected) {

        updateServerStatus(
            false,
            "Disconnected"
        );

        return;
    }


    console.log(
        "[UI] Closing bridge connection..."
    );


    runtime.disconnect();


    updateServerStatus(
        false,
        "Disconnected"
    );

}
/* =========================================================
   SERVER STATUS
========================================================= */

function updateServerStatus(
    connected,
    label = null,
    paired = false
) {

    /*
     * -----------------------------------------
     * NEW WS STATUS CONTROL
     * -----------------------------------------
     */

    if (wsStatus) {

        wsStatus.classList.toggle(
            "connected",
            connected
        );

        wsStatus.classList.toggle(
            "paired",
            connected && paired
        );

    }


    if (wsStatus) {

        const statusRow =
            wsStatus.parentElement;

        if (statusRow) {

            const text =
                statusRow.querySelector(
                    "span:last-child"
                );

            if (text) {

                text.textContent =
                    label ||
                    (
                        connected
                            ? "Connected"
                            : "Disconnected"
                    );

            }

        }

    }


    /*
     * -----------------------------------------
     * EXISTING HEADER STATUS
     * -----------------------------------------
     */

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
        serverCard.querySelector(
            "strong"
        );


    const dot =
        serverCard.querySelector(
            ".status-dot"
        );


    if (connected) {

        statusText.textContent =
            "Connected";

        statusText.style.color =
            "var(--green)";

        dot.classList.add(
            "green"
        );

    } else {

        statusText.textContent =
            "Disconnected";

        statusText.style.color =
            "var(--red)";

        dot.classList.remove(
            "green"
        );

    }

}


/* =========================================================
   SEND TOOL REQUEST
========================================================= */

function sendRequest(tool, params = {}) {

    return new Promise(
        (resolve, reject) => {

            const bridge = runtime.getStatus();

            if (!bridge.connected) {

              const message =
    "Bridge is not connected. Click Start first.";

addUIEvent(
    message,
    "error",
    "Playground"
);

reject(
    new Error(message)
);

                return;
            }


            if (!bridge.paired) {

              const message =
    "Bridge is reachable but not paired. Enter the pairing code first.";

addUIEvent(
    message,
    "error",
    "Playground"
);

reject(
    new Error(message)
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
                "[UI → BRIDGE]",
                request
            );


            // Blocking call through the runtime client: resolves with the
            // extension's terminal response (ok / denied / timeout / error).
            // There is no push step after this — approval happens in the
            // extension, and its verdict arrives here.
            runtime.callTool(tool, params).then(
                (response) => {

                    const latency =
                        Math.round(
                            performance.now() -
                            requestStartTime
                        );


                    setLatency(latency);

                    showLatency(latency);

                    showToolResponse(response);

/* -----------------------------------------
   TOOL ERROR
----------------------------------------- */

if (response.status === "error") {

    addEvent(
        `Tool error: ${response.reason || "unknown_error"}`,
        "error",
        "Bridge"
    );

    reject(
        new Error(
            response.reason || "Tool request failed"
        )
    );

    return;
}

/* -----------------------------------------
   TERMINAL VERDICTS (blocking contract)
----------------------------------------- */

if (
    response.status === "denied" ||
    response.status === "timeout"
) {

    console.warn(
        "[ACTION NOT EXECUTED]",
        response
    );


    addUIEvent(
        response.status === "denied"
            ? "Validator: action denied (human decision in extension)"
            : "Validator: action timed out waiting for approval",
        "blocked",
        "Extension Validator"
    );

    updateValidatorUI(
        "BLOCKED",
        response.status === "denied"
            ? "The action was denied and not executed"
            : "No approval within 60s — not executed"
    );


    if (chatStatus) {

        chatStatus.textContent =
            response.status === "denied"
                ? "Action denied"
                : "Approval timed out";

    }


    resolve(response);

    return;
}


if (response.status === "ok") {

    updateValidatorUI(
        "SAFE",
        "Action executed"
    );

}


/* -----------------------------------------
   NORMAL RESPONSE
----------------------------------------- */

resolve(response);

                },
                (error) => {

                    addEvent(
                        `Transport error: ${error?.message || error}`,
                        "error",
                        "Bridge"
                    );

                    reject(error instanceof Error ? error : new Error(String(error)));

                }
            );
        }
    );

}
/* =========================================================
   ACTION APPROVAL
   ========================================================= */
/* =========================================================
   ACTION VERDICTS (blocking contract)
   =========================================================
   Deleted: handleActionUpdate (action_update push) and sendActionDecision
   (action_decision sender). The bridge holds each gated call open until
   the extension answers ok / denied / timeout, so verdicts arrive as the
   terminal response inside sendRequest — there is nothing to push and
   nowhere to send a decision. Approval itself happens in the extension. */
/* =========================================================
   APPROVAL UI
   =========================================================
   Deleted: showApprovalRequest (Approve/Deny card + action_decision
   senders). Under the blocking contract there is no pending_id to act
   on — approval happens in the extension's own UI, and the verdict
   arrives as the terminal tool response handled in sendRequest. */
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
   CHAT MESSAGES
   ========================================================= */

function addChatMessage(
    message,
    type = "agent"
) {

    if (!chat) {
        return;
    }

    const messageElement =
        document.createElement("div");

    messageElement.className =
        `chat-message ${type}`;

    messageElement.textContent =
        message;

    chat.appendChild(
        messageElement
    );

    const chatWrap =
        $("chatWrap");

    if (chatWrap) {

        chatWrap.scrollTop =
            chatWrap.scrollHeight;

    }

}

/* =========================================================
   CHAT PROCESS TRACE
   ========================================================= */

function setChatStep(step, state = "active") {

    const node =
        document.querySelector(
            `.process-node[data-step="${step}"]`
        );

    if (!node) {
        return;
    }

    node.classList.remove(
        "active",
        "done",
        "error",
        "blocked"
    );

    node.classList.add(state);
}
function resetChatProcess() {

    const nodes =
        document.querySelectorAll(
            ".process-node"
        );

    nodes.forEach(
        (node) => {

            node.classList.remove(
                "active",
                "done",
                "error",
                "blocked"
            );

        }
    );

}
function showThinkingCard() {

    if (!thinkingCard) {
        return;
    }

    thinkingCard.classList.remove(
        "hidden"
    );

}


function hideThinkingCard() {

    if (!thinkingCard) {
        return;
    }

    thinkingCard.classList.add(
        "hidden"
    );

}
function progressDelay() {

    if (
        progressFastToggle &&
        progressFastToggle.checked
    ) {
        return 700;
    }

    return 1600;
}
function handleToolResponseError(
    tool,
    response
) {

    if (!response) {

        addUIEvent(
            `${tool} no_response`,
            "error",
            "Server"
        );

        throw new Error(
            `${tool} no_response`
        );
    }

    if (response.status !== "ok") {

        const reason =
            response.reason ||
            response.status ||
            "unknown_error";

        addUIEvent(
            `${tool} ${reason}`,
            "error",
            "Server"
        );

        if (chatStatus) {
            chatStatus.textContent =
                "Error";
        }

        const activeNode =
            document.querySelector(
                ".process-node.active"
            );

        if (activeNode) {
            activeNode.classList.remove(
                "active"
            );

            activeNode.classList.add(
                "error"
            );
        }

        throw new Error(
            `${tool}: ${reason}`
        );
    }

    return response;
}
/* =========================================================
   CHAT TASK
   ========================================================= */

async function runChatTask(task) {

    if (!task.trim()) {
        return;
    }

    const bridgeState = runtime.getStatus();

    if (!bridgeState.connected) {

        addChatMessage(
            "Bridge is not connected. Click Start first.",
            "agent"
        );

        return;
    }


    if (!bridgeState.paired) {

        addChatMessage(
            "Bridge is reachable but not paired. Enter the pairing code first.",
            "agent"
        );

        return;
    }


    /* -----------------------------------------
       USER MESSAGE
    ----------------------------------------- */

    addChatMessage(
        task,
        "user"
    );


    /* -----------------------------------------
       PREPARE UI
    ----------------------------------------- */

    chatInput.value = "";

    chatSend.disabled = true;
if (chatStatus) {

    chatStatus.textContent =
        "Thinking...";

}

    resetChatProcess();
    setNextAction(
    "Waiting for agent..."
);

updateNextActionUI(
    "-",
    "-"
);
    showThinkingCard();


    /* -----------------------------------------
       PERCEPTION
    ----------------------------------------- */

    setChatStep(
        "perception",
        "active"
    );
if (chatStatus) {

    chatStatus.textContent =
        "Perception...";

}

  const normalizedTask =
    task.toLowerCase();

const isDeleteAccountTask =
    normalizedTask.includes("delete my account") ||
    normalizedTask.includes("delete account") ||
    normalizedTask.includes("remove my account");

addUIEvent(
    "Chat task received",
    "success",
    "User"
);

const reasoningText =
    isDeleteAccountTask
        ? "The agent identified a Delete Account action and is checking whether confirmation is required."
        : "The agent is analyzing the request and determining the appropriate next action.";

if (agentReasoning) {
    agentReasoning.textContent =
        reasoningText;
}
const reasoningElement =
    document.querySelector("#agent-reasoning");

if (reasoningElement) {
    reasoningElement.textContent =
        reasoningText;
}

await delay(progressDelay());


    /* -----------------------------------------
       READ PAGE
    ----------------------------------------- */

    try {

        addUIEvent(
            "Calling tool: read_page",
            "success",
            "Agent"
        );


const pageResponse =
    await sendRequest("read_page");

handleToolResponseError(
    "read_page",
    pageResponse
);

updatePage(
    pageResponse.result
);

updateToolUI(
    "read_page",
    {},
    pageResponse
);

renderScreenState();

setChatStep(
    "perception",
    "done"
);


        /* -------------------------------------
           PROTECT
        ------------------------------------- */

        setChatStep(
            "redacting",
            "active"
        );
if (chatStatus) {

    chatStatus.textContent =
        "Redacting...";

}

        await delay(progressDelay());


        addUIEvent(
            "Local sanitization complete",
            "success",
            "Local Extension"
        );


        setChatStep(
            "redacting",
            "done"
        );
/* -------------------------------------
   READ INTERACTIVE ELEMENTS
------------------------------------- */

addUIEvent(
    "Calling tool: list_interactive_elements",
    "success",
    "Agent"
);

const elementsResponse =
    await sendRequest(
        "list_interactive_elements"
    );

handleToolResponseError(
    "list_interactive_elements",
    elementsResponse
);
updateToolUI(
    "list_interactive_elements",
    {},
    elementsResponse
);

renderScreenState();
const interactiveElements =
    elementsResponse.result?.elements || [];

const screenSummary =
    document.querySelectorAll(
        ".state-summary strong"
    );

if (screenSummary.length >= 3) {
    screenSummary[2].textContent =
        interactiveElements.length;
}

        /* -------------------------------------
           REASON
        ------------------------------------- */

        setChatStep(
            "reasoning",
            "active"
        );
if (chatStatus) {

    chatStatus.textContent =
        "Reasoning...";

}

        await delay(progressDelay());


        addUIEvent(
            "Agent reasoning complete",
            "success",
            "Agent"
        );


        setChatStep(
            "reasoning",
            "done"
        );


 /* -------------------------------------
   ACT
------------------------------------- */

setChatStep(
    "acting",
    "active"
);
if (chatStatus) {

    chatStatus.textContent =
        "Acting...";

}
if (isDeleteAccountTask) {

    addUIEvent(
        "Agent selected Delete Account",
        "warning",
        "Agent"
    );
    setNextAction(
    "Click Delete Account"
);

updateNextActionUI(
    "click",
    "el_8"
);
   await delay(progressDelay());

  const actionResponse =
        await sendRequest(
            "click",
            {
                ref: "el_8"
            }
        );
    // Terminal verdicts arrive here directly (blocking contract) —
    // there is no follow-up push, so denied/timeout end the turn now.
    if (
        actionResponse.status ===
        "denied" ||
        actionResponse.status ===
        "timeout"
    ) {

        setChatStep(
            "acting",
            "blocked"
        );
          updateValidatorUI(
            "BLOCKED",
            actionResponse.status === "denied"
                ? "Denied in the extension — not executed"
                : "Approval timed out in the extension — not executed"
        );
        addUIEvent(
            "Validator verdict: " + actionResponse.status,
            "blocked",
            "Extension Validator"
        );

        if (
            chatStatus
        ) {chatStatus.textContent
             =
                actionResponse.status === "denied"
                    ? "Action denied"
                    : "Approval timed out";
        }

        return;
    }

    if (
        actionResponse.status !==
        "ok"
    ) {
        throw new Error(
            actionResponse.reason ||
            "Action failed"
        );
    }

    setChatStep(
        "acting",
        "done"
    );

} else {

    addUIEvent(
        "No browser action required",
        "success",
        "Agent"
    );

await delay(300);

    setChatStep(
        "acting",
        "done"
    );
}
        /* -------------------------------------
           DONE
        ------------------------------------- */

        setChatStep(
            "done",
            "done"
        );


        addChatMessage(
            `I understood your task: "${task}". ` +
            `The current page was successfully perceived ` +
            `through the local WebSocket tool.`,
            "agent"
        );


        if (chatStatus) {

            chatStatus.textContent =
               "Complete";

        }


    } catch (error) {

        console.error(
            "[CHAT] Task failed:",
            error
        );


        addChatMessage(
            `Task failed: ${error.message}`,
            "agent"
        );


        const activeNode =
            document.querySelector(
                ".process-node.active"
            );


        if (activeNode) {

            activeNode.classList.remove(
                "active"
            );

            activeNode.classList.add(
                "error"
            );

        }


        if (chatStatus) {

            chatStatus.textContent =
                "Error";

        }

    } finally {

        chatSend.disabled =
            false;

    }

}
/* =========================================================
   CHAT CONTROLS
   ========================================================= */

function setupChat() {

    if (!chatInput || !chatSend) {
        console.warn(
            "[CHAT] Chat elements not found."
        );

        return;
    }


    chatSend.addEventListener(
        "click",
        () => {

            runChatTask(
                chatInput.value
            );

        }
    );


    chatInput.addEventListener(
        "keydown",
        (event) => {

            /*
             * Enter = send
             * Shift + Enter = new line
             */

            if (
                event.key === "Enter" &&
                !event.shiftKey
            ) {

                event.preventDefault();

                runChatTask(
                    chatInput.value
                );

            }

        }
    );

}
/* =========================================================
   LATENCY
========================================================= */

function showLatency(ms) {

    const latencyElement =
        document.getElementById(
            "latency-value"
        );

    if (!latencyElement) {
        return;
    }

    latencyElement.textContent =
        `Latency: ${ms} ms`;

}
/* =========================================================
   EVENT LOG
========================================================= */


   function addUIEvent(
    message,
    status = "info",
    source = "Playground"
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
   CAPTURE RESULT (capture_tab rendering)
   ========================================================= */

function renderCaptureResult(response) {

    const view = $("capture-view");
    const img = $("capture-img");
    const meta = $("capture-meta");

    if (!view || !img || !meta) {
        return;
    }

    if (response && response.redactedImage) {
        img.src =
            "data:image/png;base64," + response.redactedImage;

        const evidence = response.evidence || {};
        const count = Array.isArray(evidence.findings)
            ? evidence.findings.length
            : "—";

        meta.textContent =
            `Redacted image + evidence (${count} findings` +
            (response.totalTimeMs != null ? `, ${response.totalTimeMs} ms` : "") +
            ")";

        view.classList.remove("hidden");
    }

    addUIEvent(
        "capture_tab returned redacted image + evidence",
        "success",
        "Bridge"
    );

}


const captureTabButton = $("capture-tab-btn");
if (captureTabButton) {
    captureTabButton.addEventListener("click", () => {
        sendRequest("capture_tab", {}).then(
            (response) => {
                renderCaptureResult(response);
            },
            (error) => {
                addUIEvent(
                    "capture_tab failed: " + (error?.message || error),
                    "error",
                    "Playground"
                );
            }
        );
    });
}

/* =========================================================
   MANUAL SIDE (T5: tab picker + generic tool sender)
   =========================================================
   Results land in the Tool inspector through sendRequest, byte-identical
   to what an agent sees on the same call. */

function refreshManualTabs() {
    sendRequest("list_tabs", {}).then(
        (response) => {
            const picker = $("manual-tab-picker");
            if (!picker) return;
            const current = picker.value;
            picker.innerHTML = "";
            const active = document.createElement("option");
            active.value = "";
            active.textContent = "Active tab";
            picker.appendChild(active);
            for (const tab of response.tabs || []) {
                const option = document.createElement("option");
                option.value = String(tab.tabId);
                const label = tab.title || tab.url || `Tab ${tab.tabId}`;
                option.textContent = `${tab.active ? "● " : ""}${label}`.slice(0, 60);
                picker.appendChild(option);
            }
            if (current) picker.value = current;
            if (typeof response.titlesAvailable === "boolean") {
                addUIEvent(
                    response.titlesAvailable
                        ? `Tab list: ${response.tabs.length} tab(s), titles populated`
                        : "Tab list has BLANK titles/URLs — D4 fallback (tabs permission) may be needed",
                    response.titlesAvailable ? "success" : "warning",
                    "Playground"
                );
            }
        },
        (error) => {
            addUIEvent(
                "Tab list failed: " + (error?.message || error),
                "error",
                "Playground"
            );
        }
    );
}

const manualRefreshButton = $("manual-refresh-tabs");
if (manualRefreshButton) {
    manualRefreshButton.addEventListener("click", refreshManualTabs);
}

const manualSendButton = $("manual-send");
if (manualSendButton) {
    manualSendButton.addEventListener("click", () => {
        const toolEl = $("manual-tool");
        const paramsEl = $("manual-params");
        const pickerEl = $("manual-tab-picker");
        const tool = toolEl?.value || "";
        if (!tool) return;
        let params;
        try {
            params = paramsEl && paramsEl.value.trim() ? JSON.parse(paramsEl.value) : {};
        } catch {
            addUIEvent("Params are not valid JSON.", "error", "Playground");
            return;
        }
        if (tool !== "list_tabs" && pickerEl && pickerEl.value !== "") {
            const tabId = Number(pickerEl.value);
            if (Number.isInteger(tabId)) params = { ...params, tabId };
        }
        sendRequest(tool, params).then(
            () => {},
            (error) => {
                addUIEvent(
                    `${tool} failed: ` + (error?.message || error),
                    "error",
                    "Playground"
                );
            }
        );
    });
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

function updateNextActionUI(
    tool = "-",
    elementId = "-"
) {

    if (!demoState.nextAction) {
        return;
    }

    // -----------------------------
    // Action title
    // -----------------------------

    const actionTitle =
        document.querySelector(
            ".next-action h3"
        );

    if (actionTitle) {

        actionTitle.textContent =
            demoState.nextAction;

    }


    // -----------------------------
    // Tool + Element information
    // -----------------------------

    const actionTags =
        document.querySelectorAll(
            ".next-action .action-tags span"
        );

    if (actionTags.length >= 2) {

        actionTags[0].textContent =
            `Tool: ${tool}`;

        actionTags[1].textContent =
            `Element: ${elementId}`;    

    }

}

/* =========================================================
   VALIDATOR UI
========================================================= */

function updateValidatorUI(
    status,
    message
) {

    const validator =
        document.querySelector(
            ".validator > strong"
        );

    const validatorMessage =
        document.querySelector(
            ".validator > small"
        );


    if (validator) {

        validator.textContent =
            status;


        if (status === "BLOCKED") {

            validator.style.color =
                "var(--red)";

        } else if (status === "SAFE") {

            validator.style.color =
                "var(--green)";

        }

    }


    if (validatorMessage) {

        validatorMessage.textContent =
            message;

    }

}

/* =========================================================
   PRIVACY DETAILS
========================================================= */

function updatePrivacySummary() {

    if (!privacyDetails) {
        return;
    }

    privacyDetails.open = false;

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

    const gatedTools = [
        "click",
        "type",
        "submit",
        "select_option"
    ];

    if (gatedTools.includes(tool)) {

        status.textContent =
            "Gated";

        status.className =
            "tool-status gated";

    } else {

        status.textContent =
            "Active";

        status.className =
            "tool-status read";

    }

}

            }

        }
    );

}

/* =========================================================
   RESET VISUAL STATE
========================================================= */

function resetVisualState() {

    updateValidatorUI(
        "SAFE",
        "This action is allowed"
    );
    const latencyElement =
    document.getElementById(
        "latency-value"
    );

if (latencyElement) {

    latencyElement.textContent =
        "Latency: —";

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
    const settingsPanel =
        $("settings");

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
   BUTTON EVENTS
========================================================= */

function setupButtons() {

    rawJsonToggle.addEventListener(
        "click",
        toggleRawJSON
    );


    
    themeToggle.addEventListener(
        "click",
        toggleTheme
    );

  wsConnect.addEventListener(
    "click",
    connectToServer
);


wsDisconnect.addEventListener(
    "click",
    closeWebSocket
);


const wsPairButton = $("ws-pair");
if (wsPairButton) {
    wsPairButton.addEventListener("click", async () => {
        const codeEl = $("ws-pair-code");
        const code = codeEl?.value || "";
        wsPairButton.disabled = true;
        addUIEvent("Pairing with bridge…", "info", "Playground");
        try {
            const res = await runtime.pair(code);
            if (res?.ok) {
                addUIEvent("Paired. Token stored for reconnects.", "success", "Playground");
                if (codeEl) codeEl.value = "";
            } else {
                addUIEvent(
                    "Pair failed: " + (res?.reason || "unknown") + " — retry.",
                    "error",
                    "Playground"
                );
            }
        } catch (err) {
            addUIEvent(
                "Pair failed: " + (err?.message || err),
                "error",
                "Playground"
            );
        } finally {
            wsPairButton.disabled = false;
        }
    });
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

    setupButtons();
    setupChat();  
    if (toolRequest) {
    toolRequest.textContent =
        "Waiting for tool request...";
}

if (toolResponse) {
    toolResponse.textContent =
        "Waiting for tool response...";
}
    updatePrivacySummary();

    renderEventLog();
updateServerStatus(
    false,
    "Disconnected"
);

}
initialize();