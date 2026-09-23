const demoState = {
    scenario: "normal",

    currentPage: {
        url: "",
        title: "",
        summary: ""
    },

    lastTool: null,

    lastRequest: null,

    lastResponse: null,

    nextAction: null,

    events: [],

    latency: null
};

function addEvent(message, status = "info", source = "Playground") {
    demoState.events.push({
    timestamp: new Date().toISOString(),
    message,
    status,
    source
});
}

function updatePage(page) {
    demoState.currentPage = page;
}

function updateTool(tool, request, response) {
    demoState.lastTool = tool;
    demoState.lastRequest = request;
    demoState.lastResponse = response;
}

function setNextAction(action) {
    demoState.nextAction = action;
}

function setLatency(ms) {
    demoState.latency = ms;
}

export {
    demoState,
    addEvent,
    updatePage,
    updateTool,
    setNextAction,
    setLatency
};