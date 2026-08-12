const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
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

const db = new sqlite3.Database("./codemesh.db", (error) => {
    if (error) {
        console.error("SQLite connection error:", error);
    } else {
        console.log("SQLite connected");
    }
});

db.run(
    `
    CREATE TABLE IF NOT EXISTS rooms (
        roomId TEXT PRIMARY KEY,
        yjsState BLOB,
        updatedAt TEXT
    )
    `,
    (error) => {
        if (error) {
            console.error("Failed to create rooms table:", error);
        } else {
            console.log("SQLite rooms table ready");
        }
    }
);


/*
==================================================
DEFAULT CODE
==================================================
*/

const DEFAULT_CODE = `const workspace = {
    name: "CodeMesh",
    status: "connected"
};

function collaborate() {
    console.log("Building together...");
}

collaborate();
`;


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

    /*
    Already loaded in memory
    */

    if (roomDocuments.has(roomId)) {
        return roomDocuments.get(roomId);
    }


    /*
    Someone else is already loading
    this room.
    */

    if (roomLoadingPromises.has(roomId)) {
        return await roomLoadingPromises.get(roomId);
    }


    const loadingPromise = new Promise((resolve, reject) => {

        console.log(
            `Loading room ${roomId} from SQLite...`
        );


        db.get(
            `
            SELECT yjsState
            FROM rooms
            WHERE roomId = ?
            `,
            [roomId],
            (error, row) => {

                if (error) {

                    console.error(
                        `Failed to load room ${roomId}:`,
                        error
                    );

                    reject(error);
                    return;
                }


                const ydoc = new Y.Doc();

                const ytext =
                    ydoc.getText("codemirror");


                /*
                ==========================================
                EXISTING ROOM
                ==========================================
                */

                if (
                    row &&
                    row.yjsState
                ) {

                    console.log(
                        `Restoring saved Yjs document for room ${roomId}`
                    );


                    Y.applyUpdate(
                        ydoc,
                        new Uint8Array(row.yjsState)
                    );

                }


                /*
                ==========================================
                NEW ROOM
                ==========================================
                */

                else {

                    console.log(
                        `Creating new room ${roomId}`
                    );


                    ydoc.transact(() => {

                        ytext.insert(
                            0,
                            DEFAULT_CODE
                        );

                    });

                }


                roomDocuments.set(
                    roomId,
                    ydoc
                );


                resolve(ydoc);

            }
        );

    });


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

        /*
        Convert complete Yjs document
        into binary state.
        */

        const update =
            Y.encodeStateAsUpdate(ydoc);


        const buffer =
            Buffer.from(update);


        const updatedAt =
            new Date().toISOString();


        await new Promise(
            (resolve, reject) => {

                db.run(
                    `
                    INSERT INTO rooms
                        (roomId, yjsState, updatedAt)

                    VALUES
                        (?, ?, ?)

                    ON CONFLICT(roomId)
                    DO UPDATE SET
                        yjsState = excluded.yjsState,
                        updatedAt = excluded.updatedAt
                    `,
                    [
                        roomId,
                        buffer,
                        updatedAt,
                    ],
                    (error) => {

                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }

                    }
                );

            }
        );


        console.log(
            `Room ${roomId} saved to SQLite`
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
        ({ roomId }) => {

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
                            "is editing index.js",

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

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `CodeMesh server running on http://localhost:${PORT}`
        );

    }
);


/*
==================================================
GRACEFUL SHUTDOWN
==================================================
*/

async function shutdown() {

    console.log(
        "\nSaving rooms before shutdown..."
    );


    /*
    Save every currently loaded room.
    */

    const savePromises = [];


    for (
        const roomId
        of roomDocuments.keys()
    ) {

        savePromises.push(
            saveRoomDocument(roomId)
        );

    }


    await Promise.all(
        savePromises
    );


    db.close(() => {

        console.log(
            "SQLite closed"
        );

        process.exit(0);

    });

}


process.on(
    "SIGINT",
    shutdown
);

process.on(
    "SIGTERM",
    shutdown
);