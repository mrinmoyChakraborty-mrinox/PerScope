const demoState = {
    scenario: "normal",

    goal: "Find a hotel in Mumbai",

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

function addEvent(message, status = "info") {
    demoState.events.push({
        message,
        status,
        timestamp: new Date().toISOString()
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