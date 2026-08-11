const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"],
    },
});

app.get("/", (req, res) => {
    res.send("CodeMesh server is running!");
});


io.on("connection", (socket) => {

    console.log("User connected:", socket.id);


    // =========================================
    // JOIN ROOM
    // =========================================

    socket.on("join-room", ({ roomId, username }) => {

        socket.join(roomId);

        socket.roomId = roomId;
        socket.username = username;


        console.log(
            `${username} joined room ${roomId}`
        );


        // Get current users
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


        // Send collaborator list
        io.to(roomId).emit("room-users", {
            users,
        });


        // Tell this user they joined
        socket.emit("room-joined", {
            roomId,
            username,
        });


        // =======================================
        // ACTIVITY: USER JOINED
        // =======================================

        io.to(roomId).emit("activity", {

            id: `${Date.now()}-${socket.id}`,

            username,

            type: "join",

            message: "joined the workspace",

            timestamp: Date.now(),

        });

    });


    // =========================================
    // CODE CHANGE
    // =========================================

// =========================================
// CODE CHANGE
// =========================================

// =========================================
// CODE CHANGE
// =========================================

socket.on("code-change", ({ roomId, code }) => {

    // Send code to everyone else in the room
    socket.to(roomId).emit("code-update", {
        code,
    });


    // =======================================
    // EDIT ACTIVITY
    // =======================================

    /*
      One activity is created for one editing
      session.

      As long as the user keeps typing,
      no new activity is created.

      If the user stops typing for 5 seconds,
      the editing session ends.

      The next edit creates a new activity.
    */

    if (!socket.isEditing) {

        socket.isEditing = true;

        const now = Date.now();


        io.to(roomId).emit("activity", {

            // IMPORTANT:
            // Every editing session gets a
            // completely unique ID.

            id: `edit-${socket.id}-${now}`,

            username: socket.username,

            type: "edit",

            message: "is editing index.js",

            timestamp: now,

        });

    }


    // =======================================
    // RESET INACTIVITY TIMER
    // =======================================

    clearTimeout(socket.editingTimeout);


    socket.editingTimeout = setTimeout(() => {

        socket.isEditing = false;

    }, 15000);

});


    // =========================================
    // DISCONNECT
    // =========================================

    socket.on("disconnect", () => {

        console.log(
            `${socket.username || "User"} disconnected`
        );


        if (!socket.roomId) {
            return;
        }


        // Update collaborators
        const room =
            io.sockets.adapter.rooms.get(
                socket.roomId
            );

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


        io.to(socket.roomId).emit(
            "room-users",
            {
                users,
            }
        );


        // =======================================
        // ACTIVITY: USER LEFT
        // =======================================

        io.to(socket.roomId).emit("activity", {

            id: `${Date.now()}-${socket.id}`,

            username: socket.username,

            type: "leave",

            message: "left the workspace",

            timestamp: Date.now(),

        });

    });

});


const PORT = 5001;

server.listen(PORT, () => {

    console.log(
        `CodeMesh server running on http://localhost:${PORT}`
    );

});