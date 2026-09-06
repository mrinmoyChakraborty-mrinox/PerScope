import { WebSocketServer } from "ws";

const PORT = 8080;

const wss = new WebSocketServer({
    port: PORT
});

console.log(
    `WebSocket server running on ws://localhost:${PORT}`
);

wss.on("connection", (socket) => {

    console.log("[SERVER] Client connected");

    socket.on("message", (data) => {

        console.log("\n[CLIENT → SERVER]");
        console.log(data.toString());

        try {

            const request = JSON.parse(data.toString());

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
                        url: "https://www.travelease.com/hotels",
                        title: "TravelEase - Hotels",
                        summary: "Hotel search page",
                        element_count: 7,
                        page_height: 1240
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
                    id: "el_1",
                    type: "input",
                    input_type: "text",
                    label: "Destination",
                    value: "Mumbai",
                    bbox: [120, 220, 300, 40],
                    page_height: 1240,
                    enabled: true
                },
                {
                    id: "el_2",
                    type: "input",
                    input_type: "date",
                    label: "Check-in",
                    value: "12/06/2025",
                    bbox: [120, 280, 200, 40],
                    page_height: 1240,
                    enabled: true
                },
                {
                    id: "el_3",
                    type: "input",
                    input_type: "date",
                    label: "Check-out",
                    value: "14/06/2025",
                    bbox: [340, 280, 200, 40],
                    page_height: 1240,
                    enabled: true
                },
                {
                    id: "el_4",
                    type: "select",
                    label: "Guests",
                    value: "2 Adults",
                    bbox: [560, 280, 150, 40],
                    page_height: 1240,
                    enabled: true
                },
                {
                    id: "el_5",
                    type: "button",
                    label: "Search Hotels",
                    value: null,
                    bbox: [120, 350, 320, 48],
                    page_height: 1240,
                    enabled: true
                },
                {
                    id: "el_6",
                    type: "link",
                    label: "My Trips",
                    value: null,
                    bbox: [420, 80, 80, 24],
                    page_height: 1240,
                    enabled: true
                },
                {
                    id: "el_7",
                    type: "link",
                    label: "Support",
                    value: null,
                    bbox: [520, 80, 80, 24],
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

    console.log(
        `[SERVER] Type requested for element: ${request.params.element_id}`
    );

    const response = {
        id: request.id,
        status: "ok",
        result: {
            typed: true,
            element_id: request.params.element_id,
            text: request.params.text
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

    console.log("[SERVER] Submit requested");

    const response = {
        id: request.id,
        status: "ok",
        result: {
            submitted: true,
            message: "Form submitted successfully"
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

    console.log("[SERVER] Scroll requested");

    const response = {
        id: request.id,
        status: "ok",
        result: {
            scrolled: true,
            direction: request.params.direction || "down",
            amount: request.params.amount || 1
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

    console.log(
        `[SERVER] Select option requested for element: ${request.params.element_id}`
    );

    const response = {
        id: request.id,
        status: "ok",
        result: {
            selected: true,
            element_id: request.params.element_id,
            option: request.params.option
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

        "el_5": {
            label: "Search Hotels",
            type: "button"
        },

        "el_6": {
            label: "My Trips",
            type: "link"
        },

        "el_7": {
            label: "Support",
            type: "link"
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

            reason: "element_not_found"

        };


        socket.send(
            JSON.stringify(response)
        );


        console.log("[SERVER → CLIENT]");
        console.log(response);

        return;
    }


    // -----------------------------------------
    // Element exists
    // -----------------------------------------

    const response = {

        id: request.id,

        status: "ok",

        result: {

            clicked: true,

            element_id: elementId,

            label: element.label

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

        console.log("[SERVER] Client disconnected");

    });

    socket.on("error", (error) => {

        console.error(
            "[SERVER] WebSocket error:",
            error.message
        );

    });
});