/* DEMO ONLY — NOT the production path.
 *
 * This is the retired mock browser runtime: canned elements, fabricated
 * verdicts, home-grown safety logic. It exists for offline UI development
 * only (run explicitly via `npm run mock`) and must never be mistaken for
 * the real PerScope runtime (bridge -> extension -> browser). Do not add
 * features here; do not point production UI at it.
 */
import { WebSocketServer } from "ws";

const PORT = 8080;
/* =========================================================
   PENDING ACTIONS
========================================================= */

const pendingActions = new Map();
/* =========================================================
   DESTRUCTIVE ACTION CHECK
========================================================= */

function isDestructive({
    tool,
    params,
    element
}) {

    if (tool !== "click") {
        return false;
    }

    if (!element) {
        return false;
    }

    const label =
        element.label || "";

    return (
        label.includes("Delete") ||
        params?.element_id === "el_danger"
    );

}
const wss = new WebSocketServer({
    port: PORT
});

console.log(
    `WebSocket server running on ws://localhost:${PORT}`
);

wss.on("connection", (socket) => {
// =====================================
// SERVER HEARTBEAT
// =====================================

const heartbeatTimer = setInterval(() => {

    if (socket.readyState === 1) {

        try {

            socket.send(
                JSON.stringify({
                    type: "ping"
                })
            );

            console.log(
                "[SERVER → CLIENT] ping"
            );

        } catch (error) {

            console.error(
                "[SERVER] Heartbeat failed:",
                error
            );

        }

    }

}, 20000);
    console.log("[SERVER] Client connected");

    let currentScrollY = 0;
    socket.on("message", (data) => {

        console.log("\n[CLIENT → SERVER]");
        console.log(data.toString());
   
        try {

            const request = JSON.parse(data.toString());
            if (request.type === "ping") {

    socket.send(JSON.stringify({
        type: "pong"
    }));

    console.log("[SERVER → CLIENT] pong");

    return;
}
 /* =========================================================
ACTION CONFIRMATION
========================================================= */

if (
    request.type === "action_decision"
) {

    const {
        pending_id,
        decision
    } = request;


    const pending =
        pendingActions.get(
            pending_id
        );


    if (!pending) {

        socket.send(
            JSON.stringify({
                type:
                    "action_update",

                pending_id,

                status:
                    "timeout"
            })
        );

        return;
    }


    clearTimeout(
        pending.timeout
    );


    pendingActions.delete(
        pending_id
    );


    /* -----------------------------------------
       DENY
    ----------------------------------------- */

    if (
        decision === "deny"
    ) {

        const response = {

            type:
                "action_update",

            pending_id,

            status:
                "denied"

        };


        socket.send(
            JSON.stringify(response)
        );


        console.log(
            "[SERVER → CLIENT]"
        );

        console.log(response);


        return;
    }


    /* -----------------------------------------
       APPROVE
    ----------------------------------------- */

    if (
        decision === "approve"
    ) {

        const response = {

            type:
                "action_update",

            pending_id,

            status:
                "ok"

        };


        socket.send(
            JSON.stringify(response)
        );


        console.log(
            "[SERVER → CLIENT]"
        );

        console.log(response);


        return;
    }


    /* -----------------------------------------
       INVALID DECISION
    ----------------------------------------- */

    socket.send(
        JSON.stringify({

            type:
                "action_update",

            pending_id,

            status:
                "error",

            reason:
                "invalid_decision"

        })
    );


    return;
}
            console.log("[SERVER] Parsed request:");
            console.log(request);

            // -----------------------------------------
            // READ_PAGE TOOL
            // -----------------------------------------

            if (request.tool === "read_page") {

                const response = {
                    id: request.id,
                    status: "ok",
                    result: {
                       url: "about:blank",
                       title: "Browser Page",
                       summary: "Current browser page",
                       element_count: 1,
                       page_height: 0
                    }
                };

                socket.send(
                    JSON.stringify(response)
                );

                console.log("[SERVER → CLIENT]");
                console.log(response);

                return;
            }
            // -----------------------------------------
// LIST_INTERACTIVE_ELEMENTS TOOL
// -----------------------------------------

if (request.tool === "list_interactive_elements") {

    const response = {
        id: request.id,
        status: "ok",
        result: {
            elements: [
                {
                    id: "el_8",
                    type: "button",
                    label: "Delete Account",
                    value: null,
                    bbox: [620, 350, 180, 48],
                    page_height: 1240,
                    enabled: true
                }
            ]
        }
    };

    socket.send(
        JSON.stringify(response)
    );

    console.log("[SERVER → CLIENT]");
    console.log(response);

    return;
}
// -----------------------------------------
// TYPE TOOL
// -----------------------------------------

if (request.tool === "type") {

    const params = request.params;

    if (
        !params ||
        typeof params.element_id !== "string" ||
        typeof params.value !== "string"
    ) {
        const response = {
            id: request.id,
            status: "error",
            reason: "invalid_params"
        };

        socket.send(JSON.stringify(response));
        console.log("[SERVER → CLIENT]");
        console.log(response);

        return;
    }

    console.log(
        `[SERVER] Type requested for element: ${params.element_id}`
    );

    const response = {
        id: request.id,
        status: "ok",
        result: {
            typed: true,
            element_id: params.element_id,
            value: params.value
        }
    };

    socket.send(
        JSON.stringify(response)
    );

    console.log("[SERVER → CLIENT]");
    console.log(response);

    return;
}
// -----------------------------------------
// SUBMIT TOOL
// -----------------------------------------

if (request.tool === "submit") {

    const params = request.params;
     if (
        !params ||
        typeof params.element_id !== "string"
    ) {
    const response = {
        id: request.id,
        status: "error",
            reason: "invalid_params"
        };

        socket.send(JSON.stringify(response));
        console.log("[SERVER → CLIENT]");
        console.log(response);

        return;
    }
    console.log(
        `[SERVER] Submit requested for element: ${params.element_id}`
    );

    const response = {
        id: request.id,
        status: "ok",
        result: {
            submitted: true,
            element_id: params.element_id
        }
    };

    socket.send(
        JSON.stringify(response)
    );

    console.log("[SERVER → CLIENT]");
    console.log(response);

    return;
}
// -----------------------------------------
// SCROLL TOOL
// -----------------------------------------

if (request.tool === "scroll") {
    const params = request.params;
    if (
        !params ||
        (params.direction !== "up" &&
         params.direction !== "down") ||
        !(
            params.amount === "page" ||
            Number.isInteger(params.amount)
        )
    ) {
    const response = {
        id: request.id,
            status: "error",
            reason: "invalid_params"
        };

        socket.send(JSON.stringify(response));
        console.log("[SERVER → CLIENT]");
        console.log(response);

        return;
    }

    const pageAmount = 600;

    const amount =
        params.amount === "page"
            ? pageAmount
            : params.amount;

    if (params.direction === "down") {
        currentScrollY += amount;
    } else {
        currentScrollY -= amount;
    }

    currentScrollY = Math.max(
        0,
        currentScrollY
    );

    const response = {
        id: request.id,
        status: "ok",
        result: {
            scroll_y: currentScrollY
        }
    };

    socket.send(
        JSON.stringify(response)
    );

    console.log("[SERVER → CLIENT]");
    console.log(response);

    return;
}
// -----------------------------------------
// SELECT_OPTION TOOL
// -----------------------------------------

if (request.tool === "select_option") {

    const params = request.params;

    if (
        !params ||
        typeof params.element_id !== "string" ||
        typeof params.value !== "string"
    ) {
        const response = {
            id: request.id,
            status: "error",
            reason: "invalid_params"
        };

        socket.send(JSON.stringify(response));
        console.log("[SERVER → CLIENT]");
        console.log(response);

        return;
    }

    console.log(
        `[SERVER] Select option requested for element: ${params.element_id}`
    );

    const response = {
        id: request.id,
        status: "ok",
        result: {
            selected: true,
            element_id: params.element_id,
            value: params.value
        }
    };

    socket.send(
        JSON.stringify(response)
    );

    console.log("[SERVER → CLIENT]");
    console.log(response);

    return;
}
// -----------------------------------------
// CLICK TOOL
// -----------------------------------------

if (request.tool === "click") {

    const elementId = request.params?.element_id;

    console.log(
        `[SERVER] Click requested for element: ${elementId}`
    );


    // -----------------------------------------
    // Validate that the requested element exists
    // -----------------------------------------

    const allowedElements = {

    "el_8": {
        label: "Delete Account",
        type: "button"
    }

    };


    const element = allowedElements[elementId];


    // -----------------------------------------
    // Element does not exist
    // -----------------------------------------

    if (!element) {

        const response = {

            id: request.id,

            status: "error",

           reason: "stale_element"

        };


        socket.send(
            JSON.stringify(response)
        );


        console.log("[SERVER → CLIENT]");
        console.log(response);

        return;
    }

     /* -----------------------------------------
   DESTRUCTIVE ACTION → BLOCK
----------------------------------------- */

if (
    isDestructive({
        tool: request.tool,
        params: request.params,
        element
    })
) {

    const pending_id =
        `pend_${Date.now()}`;

    const timeout =
        setTimeout(() => {

            if (
                pendingActions.has(
                    pending_id
                )
            ) {

                pendingActions.delete(
                    pending_id
                );

                socket.send(
                    JSON.stringify({
                        type:
                            "action_update",

                        pending_id,

                        status:
                            "timeout"
                    })
                );

            }

        }, 60000);


    pendingActions.set(
        pending_id,
        {
            socket,
            tool: request.tool,
            params: request.params,
            timeout
        }
    );


    const response = {

        id: request.id,

        status:
            "blocked",

        reason:
            "destructive_action_unconfirmed",

        pending_id

    };


    socket.send(
        JSON.stringify(response)
    );


    console.log(
        "[SERVER → CLIENT]"
    );

    console.log(response);


    return;
}
    // -----------------------------------------
    // Element exists
    // -----------------------------------------

    const response = {

        id: request.id,

        status: "ok",
    };


    socket.send(
        JSON.stringify(response)
    );


    console.log("[SERVER → CLIENT]");
    console.log(response);

    return;
}
            // -----------------------------------------
            // UNKNOWN TOOL
            // -----------------------------------------

            const errorResponse = {
                id: request.id,
                status: "error",
                reason: "unknown_tool"
            };

            socket.send(
                JSON.stringify(errorResponse)
            );

            console.log("[SERVER → CLIENT]");
            console.log(errorResponse);

        } catch (error) {

            console.error(
                "[SERVER] Invalid JSON:",
                error.message
            );

            const errorResponse = {
                status: "error",
                reason: "invalid_json"
            };

            socket.send(
                JSON.stringify(errorResponse)
            );
        }
    });

    socket.on("close", () => {
        clearInterval(heartbeatTimer);
        console.log("[SERVER] Client disconnected");

    });

    socket.on("error", (error) => {

        console.error(
            "[SERVER] WebSocket error:",
            error.message
        );

    });
});