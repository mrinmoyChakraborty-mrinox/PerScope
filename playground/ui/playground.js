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

let socket = null;
let serverUrl = "ws://localhost:8080";
let requestCounter = 0;
let requestStartTime = 0;
let heartbeatTimer = null;
let heartbeatTimeout = null;

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
 //Create a startHeartbeat() function
   function startHeartbeat() {
    stopHeartbeat();

    heartbeatTimer = setInterval(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            socket.send(JSON.stringify({
                type: "ping"
            }));

            console.log("[UI → SERVER] ping");

            heartbeatTimeout = setTimeout(() => {
                console.warn("[UI] Heartbeat timeout");

                addEvent(
                    "WebSocket heartbeat timeout",
                    "error",
                    "Playground"
                );

                socket?.close();
            }, 5000);

        } catch (error) {
            console.error("[UI] Heartbeat failed:", error);
        }

    }, 20000);
}
//stopHeartbeat()
function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    if (heartbeatTimeout) {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = null;
    }
}
/* =========================================================
   WEBSOCKET CONNECTION
========================================================= */

function connectToServer() {

    if (socket) {

        if (
            socket.readyState ===
            WebSocket.OPEN
        ) {
            return;
        }

        if (
            socket.readyState ===
            WebSocket.CONNECTING
        ) {
            return;
        }

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


    try {

        socket =
            new WebSocket(
                serverUrl
            );

    } catch (error) {

        console.error(
            "[UI] WebSocket connection failed:",
            error
        );

        updateServerStatus(
            false,
            "Disconnected"
        );

        return;
    }


   socket.onopen = () => {

    console.log(
        "[UI] Connected to server"
    );

    updateServerStatus(
        true,
        "Connected"
    );
    startHeartbeat();
    addEvent(
        "Connected to WebSocket server",
        "success",
        "Playground"
    );

    socket.addEventListener(
        "message",
        (event) => {

            try {

                const response =
                    JSON.parse(event.data);
               {

              // =====================================
            // HEARTBEAT PONG
            // =====================================

            if (response.type === "pong") {

                if (heartbeatTimeout) {

                    clearTimeout(
                        heartbeatTimeout
                    );

                    heartbeatTimeout = null;
                }

                console.log(
                    "[UI] pong received"
                );

                return;
            }
}
                if (
                    response.type ===
                    "action_update"
                ) {

                    handleActionUpdate(
                        response
                    );

                }

            } catch (error) {

                console.error(
                    "[UI] Invalid WebSocket message:",
                    error
                );

            }

        }
    );

};

    socket.onclose = () => {
        stopHeartbeat();
        console.log(
            "[UI] Server disconnected"
        );


        updateServerStatus(
            false,
            "Disconnected"
        );


        addEvent(
            "WebSocket connection closed",
            "warning",
            "Playground"
        );


        socket = null;

    };


   socket.onerror = (error) => {

    const reason =
        error?.message ||
        error?.type ||
        "connection_error";

    console.error(
        "[UI] WebSocket error:",
        reason
    );

    addUIEvent(
        "WebSocket error: " + reason,
        "error",
        "Playground"
    );

    updateServerStatus(
        false,
        "Connection Error"
    );
};
}
//closeWebSocket()
function closeWebSocket() {

    if (!socket) {

        updateServerStatus(
            false,
            "Disconnected"
        );

        return;
    }


    console.log(
        "[UI] Closing WebSocket..."
    );

    stopHeartbeat();
    socket.close();


    socket = null;


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
    label = null
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

            if (
                !socket ||
                socket.readyState !== WebSocket.OPEN
            ) {

              const message =
    "WebSocket server is not connected.";

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
            let requestTimeout;

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


/* -----------------------------------------
   IGNORE RESPONSE FOR OTHER REQUESTS
----------------------------------------- */

if (
    response.id !==
    request.id
) {
    return;
}


/* -----------------------------------------
   RESPONSE RECEIVED
----------------------------------------- */

socket.removeEventListener(
    "message",
    handleResponse
);
clearTimeout(requestTimeout);

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
        "WebSocket"
    );

    reject(
        new Error(
            response.reason || "Tool request failed"
        )
    );

    return;
}

/* -----------------------------------------
   ACTION BLOCKED
----------------------------------------- */

if (response.status === "blocked") {

    console.warn(
        "[ACTION BLOCKED]",
        response
    );


    addUIEvent(
        "Validator: action blocked",
        "blocked",
        "Local Action Guard"
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


    if (response.pending_id) {

        showApprovalRequest(
            response.pending_id,
            request.tool === "click"
                ? `Click on element ${request.params.element_id}`
                : `Execute ${request.tool}`
        );

    }


    if (chatStatus) {

        chatStatus.textContent =
            "Waiting for approval...";

    }


    resolve(response);

    return;
}


/* -----------------------------------------
   NORMAL RESPONSE
----------------------------------------- */

resolve(response);

} catch (error) {

    addEvent(
        "Invalid JSON received from WebSocket server",
        "error",
        "WebSocket"
    );

    reject(
        new Error(
            "Invalid JSON received from WebSocket server"
        )
    );

}
                };


            socket.addEventListener(
                "message",
                handleResponse
            );
            requestTimeout = setTimeout(() => {

    socket.removeEventListener(
        "message",
        handleResponse
    );

    addUIEvent(
        `Request timeout: ${request.tool}`,
        "error",
        "WebSocket"
    );

    reject(
        new Error(
            `Request timed out after 5 seconds: ${request.tool}`
        )
    );

}, 5000);
        }
    );

}
/* =========================================================
   ACTION APPROVAL
   ========================================================= */
function handleActionUpdate(response) {

    console.log(
        "[ACTION UPDATE]",
        response
    );


    if (response.type !== "action_update") {
        return;
    }


    /* -----------------------------------------
       ACTION APPROVED / COMPLETED
    ----------------------------------------- */

   if (response.status === "ok") {

    updateValidatorUI(
        "SAFE",
        "Action approved and executed"
    );
    setChatStep(
        "acting",
        "done"
    );

    setChatStep(
        "done",
        "done"
    );
     

    addUIEvent(
        "Action approved and executed",
        "success",
        "Action Guard"
    );
     if (chatStatus) {

            chatStatus.textContent =
                "Action completed";

        }


        addChatMessage(
            "The approved action was successfully executed.",
            "agent"
        );

        return;
    }


    /* -----------------------------------------
       ACTION DENIED / BLOCKED
    ----------------------------------------- */

    else if (
        response.status === "denied" ||
        response.status === "blocked"
    ) {
    updateValidatorUI(
    "BLOCKED",
    "The action was denied and not executed"
        );
         /* Acting was stopped */

        setChatStep(
            "acting",
            "blocked"
        );

        addUIEvent(
            "Action denied by user",
            "blocked",
            "Action Guard"
        );


        if (chatStatus) {

            chatStatus.textContent =
                "Action denied";
        }


        addChatMessage(
            "The action was not executed.",
            "agent"
        );
        return;
    }

}
function sendActionDecision(pendingId, decision) {

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        console.error(
            "[ACTION] WebSocket not connected"
        );

        return;
    }

    const message = {
        type: "action_decision",
        pending_id: pendingId,
        decision: decision
    };

    console.log(
        "[ACTION DECISION]",
        message
    );

    socket.send(
        JSON.stringify(message)
    );
}
/* =========================================================
   APPROVAL UI
   ========================================================= */

function showApprovalRequest(
    pendingId,
    actionLabel
) {

    const chatWrap =
        $("chatWrap");

    if (!chatWrap) {
        return;
    }

    const card =
        document.createElement("div");

    card.className =
        "approval-card";

    card.innerHTML = `
        <div class="approval-title">
            ⚠ Action requires approval
        </div>

        <div class="approval-action">
            ${actionLabel}
        </div>

        <div class="approval-buttons">

            <button
                class="approval-approve"
                type="button"
            >
                Approve
            </button>

            <button
                class="approval-deny"
                type="button"
            >
                Deny
            </button>

        </div>
    `;

    chatWrap.appendChild(card);

    chatWrap.scrollTop =
        chatWrap.scrollHeight;


    const approveButton =
        card.querySelector(
            ".approval-approve"
        );

    const denyButton =
        card.querySelector(
            ".approval-deny"
        );


    approveButton.addEventListener(
        "click",
        () => {

            approveButton.disabled =
                true;

            denyButton.disabled =
                true;

            approveButton.textContent =
                "Approving...";

            sendActionDecision(
                pendingId,
                "approve"
            );

        }
    );


    denyButton.addEventListener(
        "click",
        () => {

            approveButton.disabled =
                true;

            denyButton.disabled =
                true;

            denyButton.textContent =
                "Denying...";

            sendActionDecision(
                pendingId,
                "deny"
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

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {

        addChatMessage(
            "WebSocket server is not connected.",
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
                element_id: "el_8"
            }
        );
    if (
        actionResponse.status ===
        "blocked"
    ) {

        setChatStep(
            "acting",
            "blocked"
        );
          updateValidatorUI(
            "BLOCKED",
            "This action requires user approval"
        );
        addUIEvent(
            "Validator blocked destructive action",
            "blocked",
            "Action Guard"
        );

        if (
            chatStatus
        ) {chatStatus.textContent
             =
                "Waiting for approval...";
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