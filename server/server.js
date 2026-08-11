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


function getRoomDocument(roomId) {

    if (!roomDocuments.has(roomId)) {

        const ydoc = new Y.Doc();

        const ytext =
            ydoc.getText("codemirror");


        /*
        Initial code for a brand-new room
        */

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
GET ONLINE USERS
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


/*
==================================================
SEND ONLINE USERS
==================================================
*/

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
SEND CURRENT EDITING USERS
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
SOCKET.IO
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
        ({ roomId, username }) => {

            socket.join(roomId);

            socket.roomId =
                roomId;

            socket.username =
                username;

            socket.isEditing =
                false;


            console.log(
                `${username} joined room ${roomId}`
            );


            /*
            ------------------------------------------
            Get/create Yjs document
            ------------------------------------------
            */

            const ydoc =
                getRoomDocument(
                    roomId
                );


            /*
            ------------------------------------------
            Send current document to this user
            ------------------------------------------
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
            ------------------------------------------
            Send collaborators
            ------------------------------------------
            */

            broadcastRoomUsers(
                roomId
            );


            /*
            ------------------------------------------
            Send current editing users
            ------------------------------------------
            */

            broadcastEditingUsers(
                roomId
            );


            /*
            ------------------------------------------
            Tell this user they joined
            ------------------------------------------
            */

            socket.emit(
                "room-joined",
                {
                    roomId,
                    username,
                }
            );


            /*
            ------------------------------------------
            JOIN ACTIVITY
            ------------------------------------------
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

        }
    );


    /*
    ==============================================
    YJS UPDATE
    ==============================================

    Local user:

    CodeMirror
        ↓
    Yjs
        ↓
    y-update
        ↓
    Server
        ↓
    Other users

    ==============================================
    */

    socket.on(
        "y-update",
        ({ roomId, update }) => {

            if (!roomId || !update) {
                return;
            }


            const ydoc =
                getRoomDocument(
                    roomId
                );


            try {

                /*
                Apply update to server
                document.

                Yjs handles conflict
                resolution.
                */

                Y.applyUpdate(
                    ydoc,
                    new Uint8Array(update),
                    socket
                );


                /*
                IMPORTANT:

                Send ONLY this update to
                the other users.

                We do NOT send a full
                document.
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
    YJS STATE
    ==============================================

    Used when a user reconnects.

    Their local Yjs document may contain
    edits that the server doesn't have yet.

    We merge that state into the server.
    ==============================================
    */

    socket.on(
        "y-state",
        ({ roomId, state }) => {

            if (!roomId || !state) {
                return;
            }


            const ydoc =
                getRoomDocument(
                    roomId
                );


            try {

                Y.applyUpdate(
                    ydoc,
                    new Uint8Array(state),
                    socket
                );


                /*
                Send the merged state to
                the other users.
                */

                socket
                    .to(roomId)
                    .emit(
                        "y-sync",
                        Y.encodeStateAsUpdate(
                            ydoc
                        )
                    );


            } catch (error) {

                console.error(
                    "Yjs state error:",
                    error
                );

            }

        }
    );


    /*
    ==============================================
    EDITING START
    ==============================================

    THIS EVENT ONLY comes from the user
    who actually typed.

    Remote Yjs updates NEVER trigger this.
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

            Don't create another activity.
            */

            if (!socket.isEditing) {

                socket.isEditing =
                    true;


                /*
                --------------------------------------
                LEFT PANEL
                --------------------------------------
                */

                io.to(roomId).emit(
                    "editing-state",
                    {
                        id: socket.id,

                        username:
                            socket.username,

                        editing:
                            true,
                    }
                );


                /*
                --------------------------------------
                RIGHT ACTIVITY PANEL
                --------------------------------------
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
            ------------------------------------------
            RESET 5 SECOND INACTIVITY TIMER
            ------------------------------------------
            */

            clearTimeout(
                socket.editingTimeout
            );


            socket.editingTimeout =
                setTimeout(() => {

                    socket.isEditing =
                        false;


                    /*
                    Tell everyone that
                    THIS user stopped editing.
                    */

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
            If this user was editing,
            explicitly remove their
            editing state.
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
            Update online users
            */

            broadcastRoomUsers(
                roomId
            );


            /*
            Update editing users
            */

            broadcastEditingUsers(
                roomId
            );


            /*
            ------------------------------------------
            LEAVE ACTIVITY
            ------------------------------------------
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