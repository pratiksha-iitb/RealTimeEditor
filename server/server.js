const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const Y = require("yjs");

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

const PORT = 5001;


/*
==================================================
YJS ROOM DOCUMENTS
==================================================
*/

const roomDocuments = new Map();

function getRoomUsers(roomId) {
    const room = io.sockets.adapter.rooms.get(roomId);

    const users = [];

    if (room) {
        room.forEach((socketId) => {
            const userSocket =
                io.sockets.sockets.get(socketId);

            if (userSocket) {
                users.push({
                    id: socketId,
                    username: userSocket.username,
                });
            }
        });
    }

    return users;
}


function broadcastRoomUsers(roomId) {
    io.to(roomId).emit("room-users", {
        users: getRoomUsers(roomId),
    });
}
function getRoomDocument(roomId) {

    if (!roomDocuments.has(roomId)) {

        const ydoc = new Y.Doc();

        const ytext =
            ydoc.getText("codemirror");


        ydoc.transact(() => {

            ytext.insert(
                0,
`const workspace = {
    name: "CodeMesh",
    status: "connected"
};

function collaborate() {
    console.log("Building together...");
}

collaborate();
`
            );

        });


        roomDocuments.set(
            roomId,
            ydoc
        );
    }


    return roomDocuments.get(roomId);
}


/*
==================================================
ROOM CURSORS
==================================================

roomCursors:

roomId
   ↓
socketId
   ↓
{
    id,
    username,
    position
}

This is completely separate from
the code/Yjs synchronization.
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
ONLINE USERS
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

                id: socketId,

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


socket.on("join-room", ({ roomId, username }) => {

    socket.join(roomId);

    socket.roomId = roomId;
    socket.username = username;

    // Every connection/reconnection starts
    // as not editing.
    socket.isEditing = false;

    console.log(
        `${username} joined/rejoined room ${roomId}`
    );


    // -----------------------------------------
    // SEND COLLABORATORS
    // -----------------------------------------

    broadcastRoomUsers(roomId);


    // -----------------------------------------
    // TELL USER THEY JOINED
    // -----------------------------------------

    socket.emit("room-joined", {
        roomId,
        username,
    });


    // -----------------------------------------
    // SEND CURRENT YJS DOCUMENT
    // -----------------------------------------

    const ydoc =
        getRoomDocument(roomId);

    const currentState =
        Y.encodeStateAsUpdate(ydoc);

    socket.emit(
        "y-sync",
        currentState
    );


    // -----------------------------------------
    // SEND EXISTING CURSORS
    // -----------------------------------------

    const cursors =
        getRoomCursors(roomId);

    socket.emit(
        "room-cursors",
        {
            cursors:
                Array.from(
                    cursors.values()
                ),
        }
    );


    // -----------------------------------------
    // ACTIVITY
    // -----------------------------------------

    io.to(roomId).emit(
        "activity",
        {

            id:
                `join-${socket.id}-${Date.now()}`,

            username,

            type: "join",

            message:
                "joined the workspace",

            timestamp:
                Date.now(),

        }
    );

});


    /*
    ==============================================
    YJS UPDATE
    ==============================================
    */

    socket.on(
        "y-update",
        ({ roomId, update }) => {

            if (
                !roomId ||
                !update
            ) {
                return;
            }


            const ydoc =
                getRoomDocument(
                    roomId
                );


            try {

                Y.applyUpdate(
                    ydoc,
                    new Uint8Array(update),
                    socket
                );


                /*
                Send update to everyone
                EXCEPT sender.
                */

                socket
                    .to(roomId)
                    .emit(
                        "y-update",
                        update
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


            /*
            Already editing?

            Do nothing.
            */

            if (!socket.isEditing) {

                socket.isEditing =
                    true;


                /*
                IMPORTANT:

                This ONLY represents the
                person who actually typed.
                */

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

            }


            /*
            --------------------------------------
            5 SECOND INACTIVITY
            --------------------------------------
            */

            clearTimeout(
                socket.editingTimeout
            );


            socket.editingTimeout =
                setTimeout(() => {

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

                }, 5000);

        }
    );


    /*
    ==============================================
    CURSOR UPDATE
    ==============================================

    This is NOT code synchronization.

    It only tells other users:

    "My cursor is currently at position X."
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


            /*
            Save latest cursor.
            */

            cursors.set(
                socket.id,
                cursor
            );


            /*
            Send ONLY to other users.
            */

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
        () => {

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
            --------------------------------------
            REMOVE CURSOR
            --------------------------------------
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
            --------------------------------------
            EDITING STATE
            --------------------------------------
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
            --------------------------------------
            USERS
            --------------------------------------
            */

            broadcastRoomUsers(
                roomId
            );


            /*
            --------------------------------------
            EDITING USERS
            --------------------------------------
            */

            broadcastEditingUsers(
                roomId
            );


            /*
            --------------------------------------
            LEAVE ACTIVITY
            --------------------------------------
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