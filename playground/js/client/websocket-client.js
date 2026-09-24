import WebSocket from "ws";

const SERVER_URL = "ws://localhost:8080";

let socket = null;
let requestCounter = 0;

function createRequest(tool, params = {}) {
    requestCounter++;

    return {
        id: `smoke_${String(requestCounter).padStart(3, "0")}`,
        tool,
        params
    };
}

function connect() {
    return new Promise((resolve, reject) => {
        console.log(`[SMOKE TEST] Connecting to ${SERVER_URL}...`);

        socket = new WebSocket(SERVER_URL);

        socket.on("open", () => {
            console.log("[SMOKE TEST] Connected to WebSocket server");
            resolve();
        });

        socket.on("error", (error) => {
            reject(error);
        });

        socket.on("close", () => {
            console.log("[SMOKE TEST] Connection closed");
        });
    });
}

function sendRequest(request) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error("Request timed out"));
        }, 5000);

        const handleMessage = (data) => {
            try {
                const response = JSON.parse(data.toString());

                if (response.id !== request.id) {
                    return;
                }

                clearTimeout(timeout);
                socket.off("message", handleMessage);

                resolve(response);
            } catch (error) {
                clearTimeout(timeout);
                socket.off("message", handleMessage);
                reject(error);
            }
        };

        socket.on("message", handleMessage);

        console.log("[SMOKE TEST → SERVER]");
        console.log(request);

        socket.send(JSON.stringify(request));
    });
}

async function main() {
    try {
        // 1. Connect
        await connect();

        // 2. Send exactly one smoke-test request
        const request = createRequest("read_page");

        const response = await sendRequest(request);

        // 3. Print response
        console.log("[SMOKE TEST ← SERVER]");
        console.log(response);

        // 4. Exit successfully
        console.log("[SMOKE TEST] Passed");

        socket.close();

        process.exit(0);
    } catch (error) {
        console.error("[SMOKE TEST] Failed:", error.message);

        if (socket) {
            socket.close();
        }

        process.exit(1);
    }
}

main();