const http = require("http");
const WebSocket = require("ws");
const Y = require("yjs");
const {
    setupWSConnection,
} = require("y-websocket/bin/utils.js");

const PORT = 1234;

const server = http.createServer();

const wss = new WebSocket.Server({
    server,
});

wss.on("connection", (conn, req) => {
    setupWSConnection(conn, req);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Yjs server running on ws://0.0.0.0:${PORT}`
    );
});