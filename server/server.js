const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { createClient } = require("@libsql/client");
const Y = require("yjs");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const PORT = process.env.PORT || 5001;

/*
==================================================
SQLITE
==================================================
*/

const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

async function initializeDatabase() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS rooms (
            roomId TEXT PRIMARY KEY,
            yjsState BLOB,
            updatedAt TEXT
        )
    `);

    console.log("Turso database ready");
}

/*
==================================================
DEFAULT CODE
==================================================
*/

const DEFAULT_FILES = {
    "index.js": `const workspace = {
    name: "CodeMesh",
    status: "connected"
};

function collaborate() {
    console.log("Building together...");
}

collaborate();
`,
    "README.md": `# CodeMesh

A real-time collaborative code editor.

## Features

- Real-time collaboration
- Persistent rooms
- Multi-file workspace
- Remote cursors
`,
    "package.json": `{
  "name": "codemesh-workspace",
  "version": "1.0.0"
}
`
};


/*
==================================================
YJS ROOM DOCUMENTS
==================================================
*/

const roomDocuments = new Map();

/*
Prevent multiple users from loading
the same room from SQLite at the same time.
*/

const roomLoadingPromises = new Map();

/*
Debounced save timers.
*/

const roomSaveTimers = new Map();


/*
==================================================
GET / CREATE ROOM DOCUMENT
==================================================
*/

async function getRoomDocument(roomId) {

    if (roomDocuments.has(roomId)) {
        return roomDocuments.get(roomId);
    }

    if (roomLoadingPromises.has(roomId)) {
        return await roomLoadingPromises.get(roomId);
    }

    const loadingPromise = (async () => {

        console.log(
            `Loading room ${roomId} from Turso...`
        );

        const result = await db.execute({
            sql: `
                SELECT yjsState
                FROM rooms
                WHERE roomId = ?
            `,
            args: [roomId],
        });

        const row = result.rows[0];

        const ydoc = new Y.Doc();
        const files = ydoc.getMap("files");
        const fileTree = ydoc.getMap("fileTree");

        if (row && row.yjsState) {

            console.log(
                `Restoring saved Yjs document for room ${roomId}`
            );

            let state;

            if (row.yjsState instanceof Uint8Array) {
                state = row.yjsState;
            } else if (Buffer.isBuffer(row.yjsState)) {
                state = new Uint8Array(row.yjsState);
            } else {
                state = new Uint8Array(row.yjsState);
            }

            Y.applyUpdate(
                ydoc,
                state
            );

            /*
            ------------------------------------------
            MIGRATE OLD SINGLE-FILE ROOMS
            ------------------------------------------
            Older CodeMesh rooms stored their code in
            ydoc.getText("codemirror"). Move that content
            into index.js automatically.
            */

            if (
                files.size === 0 &&
                ydoc.getText("codemirror").length > 0
            ) {

                const oldCode =
                    ydoc.getText("codemirror").toString();

                ydoc.transact(() => {

                    const indexFile =
                        new Y.Text();

                    indexFile.insert(
                        0,
                        oldCode
                    );

                    files.set(
                        "index.js",
                        indexFile
                    );

                    files.set(
                        "README.md",
                        new Y.Text(
                            DEFAULT_FILES["README.md"]
                        )
                    );

                    files.set(
                        "package.json",
                        new Y.Text(
                            DEFAULT_FILES["package.json"]
                        )
                    );

                });

            }

        } else {

            console.log(
                `Creating new room ${roomId}`
            );

            ydoc.transact(() => {

                Object.entries(
                    DEFAULT_FILES
                ).forEach(
                    ([fileName, content]) => {

                        const file =
                            new Y.Text();

                        file.insert(
                            0,
                            content
                        );

                        files.set(
                            fileName,
                            file
                        );

                    }
                );

            });

        }


        /*
         * Keep the shared file tree in sync with existing files.
         * This is metadata only; file contents remain in `files`.
         */
        ydoc.transact(() => {
            Array.from(files.keys()).forEach((filePath) => {
                const parts = filePath.split("/").filter(Boolean);
                let current = "";

                parts.forEach((part, index) => {
                    current = current
                        ? `${current}/${part}`
                        : part;

                    if (!fileTree.has(current)) {
                        fileTree.set(
                            current,
                            JSON.stringify({
                                type:
                                    index === parts.length - 1
                                        ? "file"
                                        : "folder",
                                name: part,
                            })
                        );
                    }
                });
            });
        });

        roomDocuments.set(
            roomId,
            ydoc
        );

        return ydoc;

    })();

    roomLoadingPromises.set(
        roomId,
        loadingPromise
    );

    try {

        return await loadingPromise;

    } finally {

        roomLoadingPromises.delete(
            roomId
        );

    }
}


/*
==================================================
SAVE YJS DOCUMENT TO SQLITE
==================================================
*/

async function saveRoomDocument(roomId) {

    const ydoc =
        roomDocuments.get(roomId);

    if (!ydoc) {
        return;
    }

    try {

        const update =
            Y.encodeStateAsUpdate(ydoc);

        const buffer =
            Buffer.from(update);

        const updatedAt =
            new Date().toISOString();

        await db.execute({
            sql: `
                INSERT INTO rooms
                    (roomId, yjsState, updatedAt)

                VALUES
                    (?, ?, ?)

                ON CONFLICT(roomId)
                DO UPDATE SET
                    yjsState = excluded.yjsState,
                    updatedAt = excluded.updatedAt
            `,

            args: [
                roomId,
                buffer,
                updatedAt,
            ],
        });

        console.log(
            `Room ${roomId} saved to Turso`
        );

    } catch (error) {

        console.error(
            `Failed to save room ${roomId}:`,
            error
        );

    }
}

/*
==================================================
DEBOUNCED SAVE
==================================================

Don't save on every keystroke.

Typing
   ↓
Yjs update
   ↓
wait 500ms
   ↓
save latest document
==================================================
*/

function scheduleRoomSave(roomId) {

    clearTimeout(
        roomSaveTimers.get(roomId)
    );


    const timer =
        setTimeout(
            async () => {

                roomSaveTimers.delete(
                    roomId
                );


                await saveRoomDocument(
                    roomId
                );

            },
            500
        );


    roomSaveTimers.set(
        roomId,
        timer
    );
}


/*
==================================================
ROOM USERS
==================================================
*/

function getRoomUsers(roomId) {

    const room =
        io.sockets.adapter.rooms.get(
            roomId
        );


    const users = [];


    if (!room) {
        return users;
    }


    room.forEach((socketId) => {

        const userSocket =
            io.sockets.sockets.get(
                socketId
            );


        if (userSocket) {

            users.push({
                id: socketId,

                username:
                    userSocket.username,
            });

        }

    });


    return users;
}


function broadcastRoomUsers(roomId) {

    io.to(roomId).emit(
        "room-users",
        {
            users:
                getRoomUsers(roomId),
        }
    );

}


/*
==================================================
ROOM CURSORS
==================================================
*/

const roomCursors = new Map();


function getRoomCursors(roomId) {

    if (!roomCursors.has(roomId)) {

        roomCursors.set(
            roomId,
            new Map()
        );

    }


    return roomCursors.get(
        roomId
    );
}


/*
==================================================
ROOM CHAT
==================================================

Chat history lives in memory only, same as
cursors. It resets on server restart. If you
want it to survive restarts, persist it to
Turso the same way the Yjs document is saved.
==================================================
*/

const roomChatMessages = new Map();


function getRoomChatMessages(roomId) {

    if (!roomChatMessages.has(roomId)) {

        roomChatMessages.set(
            roomId,
            []
        );

    }


    return roomChatMessages.get(
        roomId
    );
}


/*
==================================================
EDITING USERS
==================================================
*/

function broadcastEditingUsers(roomId) {

    const room =
        io.sockets.adapter.rooms.get(
            roomId
        );


    const editingUsers = [];


    if (!room) {
        return;
    }


    room.forEach((socketId) => {

        const userSocket =
            io.sockets.sockets.get(
                socketId
            );


        if (
            userSocket &&
            userSocket.isEditing
        ) {

            editingUsers.push({

                id:
                    socketId,

                username:
                    userSocket.username,

            });

        }

    });


    io.to(roomId).emit(
        "editing-users",
        {
            users:
                editingUsers,
        }
    );

}


/*
==================================================
HOME
==================================================
*/

app.get("/", (req, res) => {

    res.send(
        "CodeMesh server is running!"
    );

});


/*
==================================================
SOCKET CONNECTION
==================================================
*/

io.on("connection", (socket) => {

    console.log(
        "User connected:",
        socket.id
    );


    socket.isEditing = false;


    /*
    ==============================================
    JOIN ROOM
    ==============================================
    */

    socket.on(
        "join-room",
        async ({ roomId, username }) => {

            try {

                socket.join(roomId);

                socket.roomId =
                    roomId;

                socket.username =
                    username;

                socket.isEditing =
                    false;


                console.log(
                    `${username} joined/rejoined room ${roomId}`
                );


                /*
                ----------------------------------
                LOAD ROOM FROM SQLITE
                ----------------------------------
                */

                const ydoc =
                    await getRoomDocument(
                        roomId
                    );


                /*
                ----------------------------------
                SEND COLLABORATORS
                ----------------------------------
                */

                broadcastRoomUsers(
                    roomId
                );


                /*
                ----------------------------------
                TELL USER THEY JOINED
                ----------------------------------
                */

                socket.emit(
                    "room-joined",
                    {
                        roomId,
                        username,
                    }
                );


                /*
                ----------------------------------
                SEND CURRENT YJS DOCUMENT
                ----------------------------------
                */

                const currentState =
                    Y.encodeStateAsUpdate(
                        ydoc
                    );


                socket.emit(
                    "y-sync",
                    currentState
                );


                /*
                ----------------------------------
                SEND EXISTING CURSORS
                ----------------------------------
                */

                const cursors =
                    getRoomCursors(
                        roomId
                    );


                socket.emit(
                    "room-cursors",
                    {
                        cursors:
                            Array.from(
                                cursors.values()
                            ),
                    }
                );


                /*
                ----------------------------------
                SEND CHAT HISTORY
                ----------------------------------
                */

                const chatMessages =
                    getRoomChatMessages(
                        roomId
                    );


                socket.emit(
                    "chat-history",
                    {
                        messages:
                            chatMessages,
                    }
                );


                /*
                ----------------------------------
                SEND EDITING USERS
                ----------------------------------
                */

                broadcastEditingUsers(
                    roomId
                );


                /*
                ----------------------------------
                ACTIVITY
                ----------------------------------
                */

                io.to(roomId).emit(
                    "activity",
                    {

                        id:
                            `join-${socket.id}-${Date.now()}`,

                        username,

                        type:
                            "join",

                        message:
                            "joined the workspace",

                        timestamp:
                            Date.now(),

                    }
                );


            } catch (error) {

                console.error(
                    "Error joining room:",
                    error
                );


                socket.emit(
                    "room-error",
                    {
                        message:
                            "Could not load workspace",
                    }
                );

            }

        }
    );


    /*
    ==============================================
    YJS UPDATE
    ==============================================
    */

    /*
    ==================================================
    RECONNECT / OFFLINE LOCAL STATE SYNC
    ==================================================
    */

    socket.on(
        "sync-local-state",
        async ({ roomId, update }) => {

            if (
                !roomId ||
                !update ||
                socket.roomId !== roomId
            ) {
                return;
            }

            try {

                const ydoc =
                    await getRoomDocument(
                        roomId
                    );

                /*
                Merge the client's local/offline Yjs state
                into the authoritative room document.
                */

                Y.applyUpdate(
                    ydoc,
                    new Uint8Array(update),
                    socket
                );

                /*
                Send the merged update to everyone else.
                The reconnecting client already has the changes.
                */

                socket
                    .to(roomId)
                    .emit(
                        "y-update",
                        update
                    );

                scheduleRoomSave(
                    roomId
                );

            } catch (error) {

                console.error(
                    "Local reconnect sync error:",
                    error
                );

            }

        }
    );


    socket.on(
        "y-update",
        async ({ roomId, update }) => {

            if (
                !roomId ||
                !update ||
                socket.roomId !== roomId
            ) {
                return;
            }


            try {

                const ydoc =
                    await getRoomDocument(
                        roomId
                    );


                /*
                ----------------------------------
                APPLY UPDATE TO SERVER YJS DOC
                ----------------------------------
                */

                Y.applyUpdate(
                    ydoc,
                    new Uint8Array(update),
                    socket
                );


                /*
                ----------------------------------
                SEND TO OTHER USERS
                ----------------------------------
                */

                socket
                    .to(roomId)
                    .emit(
                        "y-update",
                        update
                    );


                /*
                ----------------------------------
                SAVE TO SQLITE
                ----------------------------------
                */

                scheduleRoomSave(
                    roomId
                );


            } catch (error) {

                console.error(
                    "Yjs update error:",
                    error
                );

            }

        }
    );


    /*
    ==============================================
    EDIT ACTIVITY
    ==============================================
    */

    socket.on(
        "edit-activity",
        ({ roomId, fileName }) => {

            if (
                !roomId ||
                socket.roomId !== roomId
            ) {
                return;
            }


            if (!socket.isEditing) {

                socket.isEditing =
                    true;


                io.to(roomId).emit(
                    "activity",
                    {

                        id:
                            `edit-${socket.id}-${Date.now()}`,

                        username:
                            socket.username,

                        type:
                            "edit",

                        message:
                            `is editing ${fileName || "the workspace"}`,

                        timestamp:
                            Date.now(),

                    }
                );


                /*
                Update collaborator editing state
                */

                io.to(roomId).emit(
                    "editing-state",
                    {
                        id:
                            socket.id,

                        username:
                            socket.username,

                        editing:
                            true,
                    }
                );

            }


            /*
            Reset inactivity timer
            */

            clearTimeout(
                socket.editingTimeout
            );


            socket.editingTimeout =
                setTimeout(
                    () => {

                        socket.isEditing =
                            false;


                        io.to(roomId).emit(
                            "editing-state",
                            {

                                id:
                                    socket.id,

                                username:
                                    socket.username,

                                editing:
                                    false,

                            }
                        );

                    },
                    5000
                );

        }
    );


    /*
    ==============================================
    CURSOR UPDATE
    ==============================================
    */

    socket.on(
        "cursor-update",
        ({
            roomId,
            fileName,
            position,
        }) => {

            if (
                !roomId ||
                socket.roomId !== roomId
            ) {
                return;
            }


            const cursors =
                getRoomCursors(
                    roomId
                );


            const cursor = {

                id:
                    socket.id,

                username:
                    socket.username,

                fileName:
                    fileName || "index.js",

                position:
                    Math.max(
                        0,
                        Number(position) || 0
                    ),

            };


            cursors.set(
                socket.id,
                cursor
            );


            socket
                .to(roomId)
                .emit(
                    "cursor-update",
                    cursor
                );

        }
    );


    /*
    ==============================================
    REQUEST CURRENT FILE CURSORS
    ==============================================
    */

    socket.on(
        "request-room-cursors",
        ({ roomId, fileName }) => {

            if (
                !roomId ||
                socket.roomId !== roomId
            ) {
                return;
            }

            const cursors =
                getRoomCursors(roomId);

            const currentCursors =
                Array.from(
                    cursors.values()
                ).filter(
                    (cursor) =>
                        cursor.fileName ===
                        (fileName || "index.js")
                );

            socket.emit(
                "room-cursors",
                {
                    cursors:
                        currentCursors,
                }
            );

        }
    );


    /*
    ==============================================
    CHAT MESSAGE
    ==============================================
    */

    socket.on(
        "send-message",
        ({ roomId, text }) => {

            if (
                !roomId ||
                socket.roomId !== roomId
            ) {
                return;
            }


            const cleanText =
                String(text || "")
                    .trim()
                    .slice(0, 2000);


            if (!cleanText) {
                return;
            }


            const message = {

                id:
                    `msg-${socket.id}-${Date.now()}-${Math.random()
                        .toString(36)
                        .slice(2, 8)}`,

                username:
                    socket.username || "Guest",

                text:
                    cleanText,

                timestamp:
                    Date.now(),

            };


            const messages =
                getRoomChatMessages(
                    roomId
                );


            messages.push(
                message
            );


            /*
            Keep chat history bounded per room
            so memory doesn't grow forever.
            */

            if (messages.length > 200) {

                messages.splice(
                    0,
                    messages.length - 200
                );

            }


            io.to(roomId).emit(
                "chat-message",
                message
            );

        }
    );


    /*
    ==============================================
    DISCONNECT
    ==============================================
    */

    socket.on(
        "disconnect",
        async () => {

            console.log(
                `${socket.username || "User"} disconnected`
            );


            clearTimeout(
                socket.editingTimeout
            );


            if (!socket.roomId) {
                return;
            }


            const roomId =
                socket.roomId;


            /*
            ----------------------------------
            SAVE LATEST ROOM STATE
            ----------------------------------
            */

            await saveRoomDocument(
                roomId
            );


            /*
            ----------------------------------
            REMOVE CURSOR
            ----------------------------------
            */

            const cursors =
                getRoomCursors(
                    roomId
                );


            cursors.delete(
                socket.id
            );


            io.to(roomId).emit(
                "cursor-remove",
                {
                    id:
                        socket.id,
                }
            );


            /*
            ----------------------------------
            EDITING STATE
            ----------------------------------
            */

            if (socket.isEditing) {

                io.to(roomId).emit(
                    "editing-state",
                    {

                        id:
                            socket.id,

                        username:
                            socket.username,

                        editing:
                            false,

                    }
                );

            }


            /*
            ----------------------------------
            USERS
            ----------------------------------
            */

            broadcastRoomUsers(
                roomId
            );


            /*
            ----------------------------------
            EDITING USERS
            ----------------------------------
            */

            broadcastEditingUsers(
                roomId
            );


            /*
            ----------------------------------
            LEAVE ACTIVITY
            ----------------------------------
            */

            io.to(roomId).emit(
                "activity",
                {

                    id:
                        `leave-${socket.id}-${Date.now()}`,

                    username:
                        socket.username,

                    type:
                        "leave",

                    message:
                        "left the workspace",

                    timestamp:
                        Date.now(),

                }
            );

        }
    );

});


/*
==================================================
START SERVER
==================================================
*/

async function startServer() {
    try {
        await initializeDatabase();

        server.listen(PORT, "0.0.0.0", () => {
            console.log(
                `CodeMesh server running on port ${PORT}`
            );
        });

    } catch (error) {
        console.error(
            "Failed to start server:",
            error
        );
    }
}

startServer();

/*
==================================================
GRACEFUL SHUTDOWN
==================================================
*/

async function shutdown() {

    console.log("\nSaving rooms before shutdown...");

    const savePromises = [];

    for (const roomId of roomDocuments.keys()) {
        savePromises.push(
            saveRoomDocument(roomId)
        );
    }

    await Promise.all(savePromises);

    await db.close();

    console.log("Turso connection closed");

    process.exit(0);
}


process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);