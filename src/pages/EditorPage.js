import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    useLocation,
    useNavigate,
    useParams,
} from "react-router-dom";

import { io } from "socket.io-client";

import toast from "react-hot-toast";

import * as Y from "yjs";

import { yCollab } from "y-codemirror.next";

import {
    EditorState,
} from "@codemirror/state";

import {
    EditorView,
    lineNumbers,
    highlightActiveLine,
    keymap,
} from "@codemirror/view";

import {
    defaultKeymap,
    history,
    historyKeymap,
} from "@codemirror/commands";

import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
} from "@codemirror/autocomplete";

import { javascript } from "@codemirror/lang-javascript";

import { oneDark } from "@codemirror/theme-one-dark";

import "./EditorPage.css";


/*
====================================================
SERVER URL
====================================================

If browser is:

localhost:3000
    ↓
localhost:5001

If phone is:

192.168.x.x:3000
    ↓
192.168.x.x:5001

So we don't need to manually change the IP.
====================================================
*/

const SERVER_URL =
    `${window.location.protocol}//${window.location.hostname}:5001`;


/*
====================================================
TIME FORMATTER
====================================================
*/

const formatTimeAgo = (timestamp) => {

    const seconds =
        Math.floor(
            (Date.now() - timestamp) / 1000
        );


    if (seconds < 5) {
        return "just now";
    }


    if (seconds < 60) {
        return `${seconds} sec ago`;
    }


    const minutes =
        Math.floor(seconds / 60);


    if (minutes < 60) {
        return `${minutes} min ago`;
    }


    const hours =
        Math.floor(minutes / 60);


    return `${hours} hr ago`;
};


/*
====================================================
CODE EDITOR
====================================================
*/

const CodeEditor = ({
    ytext,
    onLocalEdit,
}) => {

    const editorContainerRef =
        useRef(null);


    useEffect(() => {

        if (
            !editorContainerRef.current ||
            !ytext
        ) {
            return;
        }


        /*
        ============================================
        YJS UNDO MANAGER
        ============================================
        */

        const undoManager =
            new Y.UndoManager(
                ytext
            );


        /*
        ============================================
        CODEMIRROR
        ============================================
        */

        const state =
            EditorState.create({

                doc:
                    ytext.toString(),

                extensions: [

                    lineNumbers(),

                    highlightActiveLine(),

                    javascript(),

                    oneDark,

                    history(),

                    closeBrackets(),

                    autocompletion(),

                    EditorView.domEventHandlers({

                        input: () => {

                            onLocalEdit();

                        },

                    }),

                    keymap.of([
                        ...closeBracketsKeymap,
                        ...defaultKeymap,
                        ...historyKeymap,
                    ]),


                    /*
                    ==================================
                    YJS ↔ CODEMIRROR
                    ==================================

                    Yjs handles the synchronization.

                    IMPORTANT:

                    We are NOT detecting editing
                    using CodeMirror docChanged.

                    That was causing remote edits
                    to be mistaken as local edits.
                    */

                    yCollab(
                        ytext,
                        null,
                        {
                            undoManager,
                        }
                    ),


                    /*
                    ==================================
                    EDITOR STYLE
                    ==================================
                    */

                    EditorView.theme({

                        "&": {
                            height: "100%",
                        },

                        ".cm-scroller": {

                            overflow: "auto",

                            fontFamily:
                                '"SFMono-Regular", Consolas, "Liberation Mono", monospace',

                            fontSize: "14px",

                        },

                        ".cm-content": {

                            padding: "20px 0",

                        },

                        ".cm-line": {

                            padding: "0 20px",

                            textAlign: "left",

                        },

                        ".cm-gutters": {

                            backgroundColor:
                                "#08090f",

                            border: "none",

                            color:
                                "#3d3f4b",

                        },

                        ".cm-activeLine": {

                            backgroundColor:
                                "rgba(139, 92, 246, 0.04)",

                        },

                    }),

                ],

            });


        /*
        ============================================
        CREATE EDITOR
        ============================================
        */

        const view =
            new EditorView({

                state,

                parent:
                    editorContainerRef.current,

            });


        /*
        ============================================
        CLEANUP
        ============================================
        */

        return () => {

            view.destroy();

            undoManager.destroy();

        };

    }, [ytext]);


    return (

        <div
            ref={editorContainerRef}
            className="codeMirrorWrapper"
        />

    );
};


/*
====================================================
EDITOR PAGE
====================================================
*/

const EditorPage = () => {

    const {
        roomId,
    } = useParams();


    const location =
        useLocation();


    const navigate =
        useNavigate();


    /*
    ================================================
    USERNAME
    ================================================
    */

    const username =
        location.state?.username ||
        "Guest";


    /*
    ================================================
    SOCKET
    ================================================
    */

    const socketRef =
        useRef(null);


    /*
    ================================================
    YJS DOCUMENT
    ================================================
    */

    const ydocRef =
        useRef(null);


    /*
    ================================================
    SHARED TEXT
    ================================================
    */

    const [
        ytext,
        setYtext
    ] = useState(null);


    /*
    ================================================
    COLLABORATORS
    ================================================
    */

    const [
        collaborators,
        setCollaborators
    ] = useState([]);


    /*
    ================================================
    WHO IS ACTUALLY EDITING
    ================================================
    */

    const [
        editingUsers,
        setEditingUsers
    ] = useState({});


    /*
    ================================================
    LIVE ACTIVITY
    ================================================
    */

    const [
        activities,
        setActivities
    ] = useState([]);


    /*
    ================================================
    CONNECTION STATUS
    ================================================
    */

    const [
        connectionStatus,
        setConnectionStatus
    ] = useState(
        "Connecting"
    );


    /*
    ================================================
    LANGUAGE
    ================================================
    */

    const [
        language,
        setLanguage
    ] = useState(
        "JavaScript"
    );


    /*
    ================================================
    LOCAL EDITING TIMER
    ================================================
    */

    const editingTimer =
        useRef(null);


    const localEditing =
        useRef(false);


    /*
    ================================================
    LOCAL EDIT HANDLER
    ================================================

    This is called ONLY when the current user's
    Yjs document produces a LOCAL update.

    It is NOT called for remote updates.
    ================================================
    */

    const handleLocalEdit =
        useCallback(() => {

            const socket =
                socketRef.current;


            if (!socket) {
                return;
            }


            /*
            ----------------------------------------
            START EDITING SESSION
            ----------------------------------------
            */

            if (
                !localEditing.current
            ) {

                localEditing.current =
                    true;


                /*
                Tell server:

                THIS user is actually typing.
                */

                socket.emit(
                    "edit-activity",
                    {
                        roomId,
                    }
                );

            }


            /*
            ----------------------------------------
            RESET LOCAL TIMER
            ----------------------------------------
            */

            clearTimeout(
                editingTimer.current
            );


            /*
            If no local typing for 5 seconds,
            this user's editing session ends.
            */

            editingTimer.current =
                setTimeout(() => {

                    localEditing.current =
                        false;

                }, 5000);

        }, [roomId]);


    /*
    ================================================
    MAIN SOCKET + YJS EFFECT
    ================================================
    */

    useEffect(() => {

        /*
        ============================================
        CREATE SOCKET
        ============================================
        */

        const socket =
            io(
                SERVER_URL,
                {

                    transports: [
                        "websocket",
                        "polling",
                    ],

                    reconnection:
                        true,

                    reconnectionAttempts:
                        Infinity,

                    reconnectionDelay:
                        1000,

                    reconnectionDelayMax:
                        5000,

                }
            );


        socketRef.current =
            socket;


        /*
        ============================================
        CREATE YJS DOCUMENT
        ============================================
        */

        const ydoc =
            new Y.Doc();


        const sharedText =
            ydoc.getText(
                "codemirror"
            );


        ydocRef.current =
            ydoc;


        setYtext(
            sharedText
        );


        /*
        ============================================
        LOCAL YJS UPDATE
        ============================================

        THIS is the important part.

        When THIS user types:

        CodeMirror
             ↓
        Yjs
             ↓
        ydoc "update"
             ↓
        origin is local
             ↓
        send to server
             ↓
        activity for THIS user
        ============================================
        */

        const handleYUpdate =
            (
                update,
                origin
            ) => {

                /*
                ====================================
                REMOTE UPDATE
                ====================================

                Another user typed.

                We apply the update to our
                document, but we MUST NOT:

                ❌ send it again
                ❌ mark ourselves editing
                ❌ create activity
                */

                if (
                    origin === "remote"
                ) {

                    return;

                }


                /*
                ====================================
                LOCAL UPDATE
                ====================================

                This update came from THIS user's
                editor.

                Therefore:

                ✅ send update
                ✅ mark THIS user editing
                ====================================
                */

                socket.emit(
                    "y-update",
                    {

                        roomId,

                        update,

                    }
                );


                /*
                IMPORTANT:

                Only the actual local editor
                reaches this line.
                */

                handleLocalEdit();

            };


        /*
        Listen for Yjs changes.
        */

        ydoc.on(
            "update",
            handleYUpdate
        );


        /*
        ============================================
        RECEIVE REMOTE YJS UPDATE
        ============================================
        */

        const handleRemoteUpdate =
            (update) => {

                try {

                    /*
                    IMPORTANT:

                    origin = "remote"

                    Therefore when Yjs fires
                    its update event, our
                    handleYUpdate() sees:

                    origin === "remote"

                    and returns.

                    So the receiving user is
                    NOT marked as editing.
                    */

                    Y.applyUpdate(
                        ydoc,

                        new Uint8Array(
                            update
                        ),

                        "remote"
                    );

                } catch (error) {

                    console.error(
                        "Remote Yjs update error:",
                        error
                    );

                }

            };


        socket.on(
            "y-update",
            handleRemoteUpdate
        );


        /*
        ============================================
        RECEIVE INITIAL ROOM STATE
        ============================================
        */

        const handleYSync =
            (update) => {

                try {

                    Y.applyUpdate(
                        ydoc,

                        new Uint8Array(
                            update
                        ),

                        "remote"
                    );

                } catch (error) {

                    console.error(
                        "Yjs sync error:",
                        error
                    );

                }

            };


        socket.on(
            "y-sync",
            handleYSync
        );


        /*
        ============================================
        SOCKET CONNECTED
        ============================================
        */

        socket.on(
            "connect",
            () => {

                console.log(
                    "Connected to CodeMesh:",
                    socket.id
                );


                setConnectionStatus(
                    "Connected"
                );


                /*
                Join room.
                */

                socket.emit(
                    "join-room",
                    {

                        roomId,

                        username,

                    }
                );

            }
        );


        /*
        ============================================
        SOCKET DISCONNECTED
        ============================================
        */

        socket.on(
            "disconnect",
            () => {

                console.log(
                    "Disconnected from CodeMesh"
                );


                setConnectionStatus(
                    "Reconnecting"
                );


                /*
                Local editing session must reset.
                */

                localEditing.current =
                    false;

            }
        );


        /*
        ============================================
        CONNECTION ERROR
        ============================================
        */

        socket.on(
            "connect_error",
            (error) => {

                console.error(
                    "Connection error:",
                    error.message
                );


                setConnectionStatus(
                    "Reconnecting"
                );

            }
        );


        /*
        ============================================
        ROOM USERS
        ============================================
        */

        socket.on(
            "room-users",
            ({ users }) => {

                setCollaborators(
                    users
                );

            }
        );


        /*
        ============================================
        EDITING STATE
        ============================================

        Server tells us EXACTLY which socket
        is currently editing.

        Example:

        {
            "abc123": true
        }

        means only abc123 is editing.
        ============================================
        */

        socket.on(
            "editing-state",
            ({
                id,
                editing,
            }) => {

                setEditingUsers(
                    (previous) => {

                        const next = {
                            ...previous,
                        };


                        if (editing) {

                            next[id] =
                                true;

                        } else {

                            delete next[id];

                        }


                        return next;

                    }
                );

            }
        );


        /*
        ============================================
        INITIAL EDITING USERS
        ============================================
        */

        socket.on(
            "editing-users",
            ({ users }) => {

                const editingMap =
                    {};


                users.forEach(
                    (user) => {

                        editingMap[
                            user.id
                        ] = true;

                    }
                );


                setEditingUsers(
                    editingMap
                );

            }
        );


        /*
        ============================================
        ACTIVITY
        ============================================
        */

        socket.on(
            "activity",
            (activity) => {

                setActivities(
                    (previous) => {

                        /*
                        Prevent duplicate events.
                        */

                        if (
                            previous.some(
                                (item) =>
                                    item.id ===
                                    activity.id
                            )
                        ) {

                            return previous;

                        }


                        return [
                            activity,
                            ...previous,
                        ].slice(
                            0,
                            8
                        );

                    }
                );

            }
        );


        /*
        ============================================
        CLEANUP
        ============================================
        */

        return () => {

            clearTimeout(
                editingTimer.current
            );


            ydoc.off(
                "update",
                handleYUpdate
            );


            socket.off(
                "y-update",
                handleRemoteUpdate
            );


            socket.off(
                "y-sync",
                handleYSync
            );


            socket.disconnect();


            ydoc.destroy();


            socketRef.current =
                null;


            ydocRef.current =
                null;


            setYtext(
                null
            );

        };

    }, [
        roomId,
        username,
        handleLocalEdit,
    ]);


    /*
    ================================================
    COPY ROOM ID
    ================================================
    */

    const handleCopyRoom =
        async () => {

            try {

                await navigator
                    .clipboard
                    .writeText(
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


    /*
    ================================================
    LEAVE
    ================================================
    */

    const handleLeave =
        () => {

            navigate("/");

        };


    /*
    ================================================
    RUN
    ================================================
    */

    const handleRun =
        () => {

            toast.success(
                "Code execution coming soon"
            );

        };


    /*
    ================================================
    RENDER
    ================================================
    */

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
                        onClick={
                            handleCopyRoom
                        }
                    >

                        {roomId}

                        <span>
                            ⧉
                        </span>

                    </button>

                </div>


                <div className="editorNavRight">

                    <div
                        className={
                            "connectionStatus " +
                            (
                                connectionStatus ===
                                    "Connected"
                                    ? "connected"
                                    : "reconnecting"
                            )
                        }
                    >

                        <span />

                        {connectionStatus}

                    </div>


                    <button
                        className="leaveButton"
                        onClick={
                            handleLeave
                        }
                    >

                        Leave

                    </button>

                </div>

            </header>


            {/* =====================================
                MAIN
            ===================================== */}

            <div className="editorLayout">


                {/* =================================
                    LEFT SIDEBAR
                ================================= */}

                <aside className="editorSidebar">


                    {/* EXPLORER */}

                    <div className="sidebarSection">

                        <div className="sidebarTitle">

                            <span>
                                EXPLORER
                            </span>

                            <button>
                                +
                            </button>

                        </div>


                        <div className="workspaceName">
                            CODEMESH
                        </div>


                        <button
                            className="fileItem active"
                        >

                            <span
                                className="fileIcon js"
                            >
                                JS
                            </span>

                            index.js

                        </button>


                        <button
                            className="fileItem"
                            disabled
                        >

                            <span
                                className="fileIcon md"
                            >
                                #
                            </span>

                            README.md

                        </button>

                    </div>


                    {/* COLLABORATORS */}

                    <div className="sidebarSection">

                        <div className="sidebarTitle">

                            <span>
                                COLLABORATORS
                            </span>


                            <span className="onlineCount">

                                {
                                    collaborators.length
                                }

                            </span>

                        </div>


                        {
                            collaborators.map(
                                (user) => {

                                    const isEditing =
                                        Boolean(
                                            editingUsers[
                                            user.id
                                            ]
                                        );


                                    const isMe =
                                        user.id ===
                                        socketRef
                                            .current
                                            ?.id;


                                    return (

                                        <div
                                            className="userItem"
                                            key={
                                                user.id
                                            }
                                        >

                                            <div
                                                className={
                                                    "userAvatar " +
                                                    (
                                                        isMe
                                                            ? "purpleAvatar"
                                                            : "blueAvatar"
                                                    )
                                                }
                                            >

                                                {
                                                    user.username
                                                        ?.charAt(0)
                                                        .toUpperCase()
                                                }

                                            </div>


                                            <div className="userDetails">

                                                <span>

                                                    {
                                                        user.username
                                                    }

                                                </span>


                                                <small>

                                                    {
                                                        isMe
                                                            ? "You"
                                                            : "Online"
                                                    }

                                                </small>

                                            </div>


                                            <span
                                                className={
                                                    "userOnline " +
                                                    (
                                                        isEditing
                                                            ? "editingDot"
                                                            : ""
                                                    )
                                                }
                                            />

                                        </div>

                                    );

                                }
                            )
                        }

                    </div>


                    {/* WORKSPACE */}

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


                {/* =================================
                    MAIN EDITOR
                ================================= */}

                <main className="editorMain">


                    {/* TOOLBAR */}

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
                                value={
                                    language
                                }
                                onChange={
                                    (event) =>
                                        setLanguage(
                                            event.target.value
                                        )
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
                                onClick={
                                    handleRun
                                }
                            >

                                ▶ Run

                            </button>

                        </div>

                    </div>


                    {/* CODE */}

                    <div className="codeEditor">

                        {
                            ytext && (

                                <CodeEditor
                                    ytext={ytext}
                                    onLocalEdit={handleLocalEdit}
                                />

                            )
                        }

                    </div>


                    {/* STATUS BAR */}

                    <div className="editorStatusBar">

                        <div className="statusLeft">

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

                                <span />

                                {
                                    connectionStatus ===
                                        "Connected"
                                        ? "Synced"
                                        : connectionStatus
                                }

                            </span>

                        </div>

                    </div>

                </main>


                {/* =================================
                    RIGHT ACTIVITY PANEL
                ================================= */}

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

                        {
                            activities.length === 0
                                ? (

                                    <div className="emptyActivity">

                                        <span>
                                            No activity yet
                                        </span>

                                        <small>
                                            Activity will appear here
                                        </small>

                                    </div>

                                )
                                : (

                                    activities.map(
                                        (activity) => (

                                            <div
                                                className="activityItem"
                                                key={
                                                    activity.id
                                                }
                                            >

                                                <div
                                                    className={
                                                        "activityAvatar " +
                                                        (
                                                            activity.type ===
                                                                "leave"
                                                                ? "leaveAvatar"
                                                                : activity.username ===
                                                                    username
                                                                    ? "purpleAvatar"
                                                                    : "blueAvatar"
                                                        )
                                                    }
                                                >

                                                    {
                                                        activity.username
                                                            ?.charAt(0)
                                                            .toUpperCase()
                                                    }

                                                </div>


                                                <div className="activityContent">

                                                    <strong>

                                                        {
                                                            activity.username ===
                                                                username
                                                                ? "You"
                                                                : activity.username
                                                        }

                                                    </strong>


                                                    <p>
                                                        {
                                                            activity.message
                                                        }
                                                    </p>


                                                    <small>
                                                        {
                                                            formatTimeAgo(
                                                                activity.timestamp
                                                            )
                                                        }
                                                    </small>

                                                </div>

                                            </div>

                                        )
                                    )

                                )
                        }

                    </div>


                    <div className="panelDivider" />


                    <div className="panelInfo">

                        <span className="infoLabel">
                            WORKSPACE
                        </span>


                        <h3>
                            Real-time collaboration
                        </h3>


                        <p>
                            Changes are synchronized
                            using a CRDT-based
                            shared document.
                        </p>

                    </div>

                </aside>

            </div>

        </div>

    );
};


export default EditorPage;