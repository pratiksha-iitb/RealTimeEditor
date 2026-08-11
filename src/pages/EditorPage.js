import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { io } from "socket.io-client";

import { EditorState } from "@codemirror/state";
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
} from "@codemirror/view";
import {
    defaultKeymap,
    history,
    historyKeymap,
} from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
} from "@codemirror/autocomplete";

import "./EditorPage.css";

const formatTimeAgo = (timestamp) => {

    const seconds = Math.floor(
        (Date.now() - timestamp) / 1000
    );


    if (seconds < 5) {
        return "just now";
    }


    if (seconds < 60) {
        return `${seconds} sec ago`;
    }


    const minutes = Math.floor(
        seconds / 60
    );


    if (minutes < 60) {
        return `${minutes} min ago`;
    }


    const hours = Math.floor(
        minutes / 60
    );


    if (hours < 24) {
        return `${hours} hr ago`;
    }


    const days = Math.floor(
        hours / 24
    );


    return `${days} day${days > 1 ? "s" : ""} ago`;
};


/* =========================================
   CODEMIRROR EDITOR
========================================= */

const CodeEditor = ({
    value,
    onChange,
    socket,
    roomId,
}) => {
    const editorRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);

    const isRemoteUpdate = useRef(false);


    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);


    /* =========================================
       CREATE CODEMIRROR
    ========================================= */

    useEffect(() => {
        if (!editorRef.current) return;

        const startState = EditorState.create({
            doc: value,

            extensions: [
                lineNumbers(),

                highlightActiveLine(),

                history(),

                javascript(),

                oneDark,

                closeBrackets(),

                autocompletion(),

                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                ]),


                /* ==============================
                   CODE CHANGE
                ============================== */

                EditorView.updateListener.of((update) => {

                    if (!update.docChanged) {
                        return;
                    }


                    // =========================================
                    // REMOTE CHANGE
                    // =========================================

                    if (isRemoteUpdate.current) {

                        isRemoteUpdate.current = false;

                        return;
                    }


                    // =========================================
                    // LOCAL CHANGE
                    // =========================================

                    const newCode =
                        update.state.doc.toString();


                    // Update React state
                    onChangeRef.current(newCode);


                    // Send only LOCAL changes
                    if (socket && roomId) {

                        socket.emit("code-change", {
                            roomId,
                            code: newCode,
                        });

                    }

                }),


                /* ==============================
                   EDITOR THEME
                ============================== */

                EditorView.theme({

                    "&": {
                        height: "100%",
                    },

                    ".cm-scroller": {
                        overflow: "auto",

                        fontFamily:
                            '"SFMono-Regular", Consolas, "Liberation Mono", monospace',

                        fontSize: "13px",
                    },

                    ".cm-content": {
                        padding: "20px 0",
                    },

                    ".cm-line": {
                        padding: "0 20px",
                        textAlign: "left",
                    },

                    ".cm-gutters": {
                        backgroundColor: "#08090f",
                        border: "none",
                        color: "#3d3f4b",
                    },

                    ".cm-activeLineGutter": {
                        backgroundColor: "transparent",
                    },

                    ".cm-activeLine": {
                        backgroundColor:
                            "rgba(139, 92, 246, 0.04)",
                    },

                }),

            ],
        });


        const view = new EditorView({
            state: startState,
            parent: editorRef.current,
        });


        viewRef.current = view;


        return () => {
            view.destroy();
            viewRef.current = null;
        };

    }, [socket, roomId]);


    /* =========================================
       UPDATE EDITOR WHEN OTHER USER TYPES
    ========================================= */

    useEffect(() => {

        const view = viewRef.current;

        if (!view) return;


        const currentValue =
            view.state.doc.toString();


        if (value !== currentValue) {

            // Tell CodeMirror:
            // "This change came from another user."

            isRemoteUpdate.current = true;


            view.dispatch({

                changes: {
                    from: 0,
                    to: currentValue.length,
                    insert: value,
                },

            });

        }

    }, [value]);


    return (
        <div
            ref={editorRef}
            className="codeMirrorWrapper"
        />
    );
};


/* =========================================
   EDITOR PAGE
========================================= */

const EditorPage = () => {

    const { roomId } = useParams();

    const location = useLocation();

    const navigate = useNavigate();

    const [, setCurrentTime] = useState(Date.now());

    useEffect(() => {

        const timer = setInterval(() => {

            setCurrentTime(Date.now());

        }, 1000);


        return () => {
            clearInterval(timer);
        };

    }, []);

    const username =
        location.state?.username || "Guest";


    /* =========================================
       SOCKET STATE
    ========================================= */

    const [socket, setSocket] = useState(null);

    const [collaborators, setCollaborators] = useState([]);

    const [activities, setActivities] = useState([]);


    /* =========================================
       CODE STATE
    ========================================= */

    const [code, setCode] = useState(
        `const workspace = {
  name: "CodeMesh",
  status: "connected"
};

function collaborate() {
  console.log("Building together...");
}

collaborate();`
    );


    const [language, setLanguage] =
        useState("JavaScript");


    /* =========================================
       SOCKET.IO CONNECTION
    ========================================= */

    useEffect(() => {

        console.log(
            "Connecting to CodeMesh server..."
        );


        const newSocket =
            io("http://localhost:5001");


        setSocket(newSocket);


        /* ==============================
           CONNECTED
        ============================== */

        newSocket.on("connect", () => {

            console.log(
                "Connected to CodeMesh server:",
                newSocket.id
            );


            /* Join room */

            newSocket.emit("join-room", {
                roomId,
                username,
            });

        });


        /* ==============================
           ROOM JOINED
        ============================== */

        newSocket.on(
            "room-joined",
            (data) => {

                console.log(
                    "Successfully joined room:",
                    data.roomId
                );

                toast.success(
                    "Joined workspace"
                );

            }
        );
        newSocket.on("room-users", (data) => {

            console.log(
                "Users in room:",
                data.users
            );

            setCollaborators(data.users);

        });


        /* ==============================
           RECEIVE CODE
        ============================== */

        newSocket.on(
            "code-update",
            (data) => {

                console.log(
                    "Received code update"
                );


                setCode(data.code);

            }
        );

        newSocket.on("activity", (activity) => {

            setActivities((prev) => {

                // Prevent duplicate activities
                if (
                    prev.some(
                        (item) => item.id === activity.id
                    )
                ) {
                    return prev;
                }

                return [
                    activity,
                    ...prev,
                ].slice(0, 8);

            });

        });


        /* ==============================
           CONNECTION ERROR
        ============================== */

        newSocket.on(
            "connect_error",
            (error) => {

                console.error(
                    "Socket connection error:",
                    error
                );

                toast.error(
                    "Could not connect to server"
                );

            }
        );


        /* ==============================
           CLEANUP
        ============================== */

        return () => {

            console.log(
                "Disconnecting from server..."
            );


            newSocket.disconnect();

            setSocket(null);

        };

    }, [roomId, username]);


    /* =========================================
       COPY ROOM ID
    ========================================= */

    const handleCopyRoom = async () => {

        try {

            await navigator.clipboard.writeText(
                roomId
            );

            toast.success(
                "Room ID copied"
            );

        } catch {

            toast.error(
                "Unable to copy room ID"
            );

        }

    };


    /* =========================================
       LEAVE ROOM
    ========================================= */

    const handleLeave = () => {

        navigate("/");

    };


    /* =========================================
       RUN CODE
    ========================================= */

    const handleRun = () => {

        toast.success(
            "Code execution coming soon"
        );

    };


    /* =========================================
       UI
    ========================================= */

    return (

        <div className="editorPage">


            {/* =====================================
          NAVBAR
      ===================================== */}

            <header className="editorNavbar">

                <div className="editorBrand">

                    <img
                        src="/codemesh-icon.png"
                        alt="CodeMesh"
                        className="editorBrandLogo"
                    />

                    <span className="editorBrandName">
                        CodeMesh
                    </span>

                </div>


                <div className="roomInfo">

                    <span className="roomLabel">
                        ROOM
                    </span>

                    <button
                        className="roomIdButton"
                        onClick={handleCopyRoom}
                        title="Copy room ID"
                    >

                        {roomId}

                        <span>
                            ⧉
                        </span>

                    </button>

                </div>


                <div className="editorNavRight">

                    <div className="connectionStatus">

                        <span></span>

                        Connected

                    </div>


                    <button
                        className="leaveButton"
                        onClick={handleLeave}
                    >
                        Leave
                    </button>

                </div>

            </header>


            {/* =====================================
          MAIN EDITOR LAYOUT
      ===================================== */}

            <div className="editorLayout">


                {/* =====================================
            LEFT SIDEBAR
        ===================================== */}

                <aside className="editorSidebar">


                    {/* Explorer */}

                    <div className="sidebarSection">

                        <div className="sidebarTitle">

                            <span>
                                EXPLORER
                            </span>

                            <button title="New file">
                                +
                            </button>

                        </div>


                        <div className="workspaceName">
                            CODEMESH
                        </div>


                        <button
                            className="fileItem active"
                        >

                            <span className="fileIcon js">
                                JS
                            </span>

                            index.js

                        </button>


                        <button className="fileItem">

                            <span className="fileIcon md">
                                #
                            </span>

                            README.md

                        </button>

                    </div>


                    {/* Collaborators */}

                    <div className="sidebarSection">

                        <div className="sidebarTitle">

                            <span>
                                COLLABORATORS
                            </span>

                            <span className="onlineCount">
                                {collaborators.length}
                            </span>

                        </div>


                        {collaborators.map((user) => (

                            <div
                                className="userItem"
                                key={user.id}
                            >

                                <div
                                    className={
                                        "userAvatar " +
                                        (user.id === socket?.id
                                            ? "purpleAvatar"
                                            : "blueAvatar")
                                    }
                                >
                                    {user.username
                                        ?.charAt(0)
                                        .toUpperCase()}
                                </div>


                                <div className="userDetails">

                                    <span>
                                        {user.username}
                                    </span>

                                    <small>
                                        {user.id === socket?.id
                                            ? "You"
                                            : "Editing"}
                                    </small>

                                </div>


                                <span className="userOnline"></span>

                            </div>

                        ))}

                    </div>

                    {/* Workspace */}

                    <div className="sidebarBottom">

                        <div className="roomCardSmall">

                            <span className="smallLabel">
                                WORKSPACE
                            </span>

                            <strong>
                                CodeMesh Room
                            </strong>

                            <span className="smallRoomId">
                                {roomId}
                            </span>

                        </div>

                    </div>

                </aside>


                {/* =====================================
            MAIN EDITOR
        ===================================== */}

                <main className="editorMain">


                    {/* Toolbar */}

                    <div className="editorToolbar">


                        <div className="activeTab">

                            <span className="jsTab">
                                JS
                            </span>

                            index.js

                            <span className="unsaved">
                                ●
                            </span>

                        </div>


                        <div className="toolbarRight">


                            <select
                                value={language}
                                onChange={(e) =>
                                    setLanguage(e.target.value)
                                }
                                className="languageSelect"
                            >

                                <option>
                                    JavaScript
                                </option>

                                <option>
                                    TypeScript
                                </option>

                                <option>
                                    Python
                                </option>

                                <option>
                                    Java
                                </option>

                                <option>
                                    C++
                                </option>

                            </select>


                            <button
                                className="runButton"
                                onClick={handleRun}
                            >
                                ▶ Run
                            </button>

                        </div>

                    </div>


                    {/* =================================
              CODEMIRROR
          ================================= */}

                    <div className="codeEditor">

                        <CodeEditor
                            value={code}
                            onChange={setCode}
                            socket={socket}
                            roomId={roomId}
                        />

                    </div>


                    {/* Status bar */}

                    <div className="editorStatusBar">


                        <div className="statusLeft">

                            <span>
                                Ln 1, Col 1
                            </span>

                            <span>
                                UTF-8
                            </span>

                            <span>
                                LF
                            </span>

                        </div>


                        <div className="statusRight">

                            <span>
                                {language}
                            </span>


                            <span className="syncStatus">

                                <span></span>

                                Synced

                            </span>

                        </div>

                    </div>

                </main>


                {/* =====================================
            RIGHT PANEL
        ===================================== */}

                <aside className="rightPanel">

                    <div className="panelHeader">

                        <span>
                            LIVE ACTIVITY
                        </span>

                        <span className="liveBadge">
                            LIVE
                        </span>

                    </div>


                    <div className="activityList">

                        {activities.length === 0 ? (

                            <div className="emptyActivity">

                                <span>
                                    No activity yet
                                </span>

                                <small>
                                    Activity will appear here
                                </small>

                            </div>

                        ) : (

                            activities.map((activity) => (

                                <div
                                    className="activityItem"
                                    key={activity.id}
                                >

                                    <div
                                        className={
                                            "activityAvatar " +
                                            (
                                                activity.type === "leave"
                                                    ? "leaveAvatar"
                                                    : activity.username === username
                                                        ? "purpleAvatar"
                                                        : "blueAvatar"
                                            )
                                        }
                                    >

                                        {activity.username
                                            ?.charAt(0)
                                            .toUpperCase()}

                                    </div>


                                    <div className="activityContent">

                                        <strong>
                                            {activity.username === username
                                                ? "You"
                                                : activity.username}
                                        </strong>


                                        <p>
                                            {activity.message}
                                        </p>


                                        <small>
                                            {formatTimeAgo(activity.timestamp)}
                                        </small>

                                    </div>

                                </div>

                            ))

                        )}

                    </div>


                    <div className="panelDivider"></div>


                    <div className="panelInfo">

                        <span className="infoLabel">
                            WORKSPACE
                        </span>


                        <h3>
                            Real-time collaboration
                        </h3>


                        <p>
                            Changes made in this editor
                            synchronize with everyone
                            in the same room.
                        </p>

                    </div>

                </aside>

            </div>

        </div>

    );

};


export default EditorPage;