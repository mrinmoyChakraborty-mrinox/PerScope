import {
    demoState,
    addEvent,
    updatePage,
    updateTool,
    setNextAction,
    setLatency
} from "../demo/demo-state.js";
const SERVER_URL = "ws://localhost:8080";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 2000;

let socket;
let reconnectAttempts = 0;
let requestCounter = 0;


// -----------------------------------------
// CONNECT TO SERVER
// -----------------------------------------

function connect() {

    console.log(`[CLIENT] Connecting to ${SERVER_URL}...`);

    socket = new WebSocket(SERVER_URL);


    // -----------------------------------------
    // CONNECTION OPENED
    // -----------------------------------------

    socket.onopen = async () => {
    console.log("[CLIENT] Connected to server");
    reconnectAttempts = 0;

    addEvent("Connected to WebSocket server", "success");

    await runDemoSequence();
};

    // -----------------------------------------
    // RECEIVE RESPONSE
    // -----------------------------------------

    socket.onmessage = (event) => {

        console.log("[SERVER → CLIENT]");

        try {

            const response = JSON.parse(event.data);

            console.log(response);

        } catch (error) {

            console.error(
                "[CLIENT] Invalid JSON received:",
                error.message
            );

        }
    };


    // -----------------------------------------
    // CONNECTION CLOSED
    // -----------------------------------------

    socket.onclose = () => {

        console.log("[CLIENT] Connection closed");

        reconnect();

    };


    // -----------------------------------------
    // ERROR
    // -----------------------------------------

    socket.onerror = () => {

        console.error("[CLIENT] WebSocket error");

    };
}


// -----------------------------------------
// SEND TOOL REQUEST
// -----------------------------------------

function sendRequest(tool, params = {}) {

    return new Promise((resolve, reject) => {

        requestCounter++;

        const request = {

            id: `req_${String(requestCounter).padStart(3, "0")}`,

            tool: tool,

            params: params

        };


        console.log("[CLIENT → SERVER]");

        console.log(request);


        socket.send(
            JSON.stringify(request)
        );


        // Temporary response listener
        const handleResponse = (event) => {

            try {

                const response =
                    JSON.parse(event.data);


                if (response.id === request.id) {

                    socket.removeEventListener(
                        "message",
                        handleResponse
                    );

                    resolve(response);
                }

            } catch (error) {

                reject(error);

            }

        };


        socket.addEventListener(
            "message",
            handleResponse
        );

    });

}


// -----------------------------------------
// DEMO SEQUENCE
// -----------------------------------------

async function runDemoSequence() {

    console.log("");
    console.log("================================");
    console.log("PLAYGROUND DEMO STARTED");
    console.log("================================");
    

    // STEP 1
    console.log("");
    console.log("[AGENT] Calling read_page...");

    const pageResponse =
    await sendRequest("read_page");

updatePage(pageResponse.result);

addEvent("Page state received", "success");

updateTool(
    "read_page",
    null,
    pageResponse
);

console.log("[AGENT] read_page response:");
console.log(pageResponse);

    // Small delay so the sequence is easy to see
    await delay(1000);


    // STEP 2
    console.log("");
    console.log(
        "[AGENT] Calling list_interactive_elements..."
    );

    const elementsResponse =
    await sendRequest(
        "list_interactive_elements"
    );

updateTool(
    "list_interactive_elements",
    null,
    elementsResponse
);

addEvent(
    "Interactive elements received",
    "success"
);

await delay(1000);
// STEP 3
console.log("");
console.log("[AGENT] Calling type...");

const typeResponse =
    await sendRequest(
        "type",
        {
            element_id: "el_1",
            text: "Mumbai"
        }
    );

updateTool(
    "type",
    {
        element_id: "el_1",
        text: "Mumbai"
    },
    typeResponse
);

addEvent(
    "Text entered into Destination",
    "success"
);

console.log("[AGENT] type response:");
console.log(typeResponse);

await delay(1000);


// STEP 4
console.log("");
console.log("[AGENT] Calling click...");

const clickResponse =
    await sendRequest(
        "click",
        {
            element_id: "el_5"
        }
    );

updateTool(
    "click",
    {
        element_id: "el_5"
    },
    clickResponse
);

addEvent(
    "Search Hotels button clicked",
    "success"
);

console.log("[AGENT] click response:");
console.log(clickResponse);

// STEP 5
console.log("");
console.log("[AGENT] Calling submit...");

const submitResponse =
    await sendRequest(
        "submit"
    );

updateTool(
    "submit",
    {},
    submitResponse
);

addEvent(
    "Form submitted",
    "success"
);

console.log("[AGENT] submit response:");
console.log(submitResponse);

// STEP 6
console.log("");
console.log("[AGENT] Calling scroll...");

const scrollResponse =
    await sendRequest(
        "scroll",
        {
            direction: "down",
            amount: 1
        }
    );

updateTool(
    "scroll",
    {
        direction: "down",
        amount: 1
    },
    scrollResponse
);

addEvent(
    "Page scrolled down",
    "success"
);

console.log("[AGENT] scroll response:");
console.log(scrollResponse);
// STEP 7
console.log("");
console.log("[AGENT] Calling select_option...");

const selectResponse =
    await sendRequest(
        "select_option",
        {
            element_id: "el_4",
            option: "3 Adults"
        }
    );

updateTool(
    "select_option",
    {
        element_id: "el_4",
        option: "3 Adults"
    },
    selectResponse
);

addEvent(
    "Guest option selected",
    "success"
);

console.log("[AGENT] select_option response:");
console.log(selectResponse);

    console.log(
        "[AGENT] list_interactive_elements response:"
    );

    console.log(elementsResponse);


    console.log("");
    console.log("================================");
    console.log("PLAYGROUND DEMO COMPLETE");
    console.log("================================");
    console.log("");
    console.log("[DEMO STATE]");
    console.log(demoState);
}


// -----------------------------------------
// DELAY HELPER
// -----------------------------------------

function delay(ms) {

    return new Promise(
        resolve => setTimeout(resolve, ms)
    );

}


// -----------------------------------------
// RECONNECT
// -----------------------------------------

function reconnect() {

    if (
        reconnectAttempts >=
        MAX_RECONNECT_ATTEMPTS
    ) {

        console.error(
            "[CLIENT] Maximum reconnect attempts reached."
        );

        return;

    }


    reconnectAttempts++;


    console.log(
        `[CLIENT] Reconnect attempt ` +
        `${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} ` +
        `in ${RECONNECT_DELAY / 1000} seconds...`
    );


    setTimeout(() => {

        connect();

    }, RECONNECT_DELAY);

}


// -----------------------------------------
// START
// -----------------------------------------

connect();