import WebSocket from "ws";

const socket = new WebSocket("ws://localhost:8080");

let counter = 0;

function send(tool, params) {
    return new Promise((resolve, reject) => {

        counter++;

        const id = `test_${counter}`;

        const request = {
            id,
            tool,
            params
        };

        const timeout = setTimeout(() => {
            reject(new Error(`Timeout: ${tool}`));
        }, 3000);

        const handler = (data) => {

            const response =
                JSON.parse(data.toString());

            if (response.id !== id) {
                return;
            }

            clearTimeout(timeout);
            socket.off("message", handler);

            console.log(`\n${tool}`);
            console.log("REQUEST:", request);
            console.log("RESPONSE:", response);

            resolve(response);
        };

        socket.on("message", handler);

        socket.send(
            JSON.stringify(request)
        );
    });
}

socket.on("open", async () => {

    try {

       await send(
    "type",
    {
        element_id: "el_8",
        value: "Test Value"
    }
);
await send(
    "type",
    {
        element_id: "el_8",
        text: "Old Text"
    }
);
const oldTypeResponse = await send(
    "type",
    {
        element_id: "el_8",
        text: "Old Text"
    }
);

if (
    oldTypeResponse.status !== "error" ||
    oldTypeResponse.reason !== "invalid_params"
) {
    throw new Error(
        "Old text parameter was not rejected"
    );
}
await send(
    "select_option",
    {
        element_id: "el_8",
        value: "Test Option"
    }
);

await send(
    "submit",
    {
        element_id: "el_8"
    }
);

await send(
    "scroll",
    {
        direction: "down",
        amount: 100
    }
);
const clickResponse = await send(
    "click",
    {
        element_id: "el_8"
    }
);

if (clickResponse.status !== "ok") {
    throw new Error(
        "Click schema test failed"
    );
}

        console.log("\nSCHEMA TEST PASSED");

        socket.close();

    } catch (error) {

        console.error(
            "\nSCHEMA TEST FAILED:",
            error.message
        );

        socket.close();
    }
});