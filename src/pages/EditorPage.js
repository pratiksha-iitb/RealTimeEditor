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
    StateEffect,
    StateField,
} from "@codemirror/state";

import {
    EditorView,
    Decoration,
    WidgetType,
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
*/

const SERVER_URL =
    process.env.REACT_APP_SERVER_URL ||
    `${window.location.protocol}//${window.location.hostname}:5001`;


/*
====================================================
CURSOR COLORS
====================================================
*/

const CURSOR_COLORS = [
    "#8b5cf6",
    "#06b6d4",
    "#f59e0b",
    "#ef4444",
    "#22c55e",
    "#ec4899",
    "#3b82f6",
];


function getCursorColor(id) {

    let hash = 0;

    for (
        let i = 0;
        i < id.length;
        i++
    ) {

        hash =
            (
                hash * 31 +
                id.charCodeAt(i)
            ) >>> 0;

    }


    return CURSOR_COLORS[
        hash %
        CURSOR_COLORS.length
    ];

}


/*
====================================================
REMOTE CURSOR WIDGET
====================================================
*/

class RemoteCursorWidget
    extends WidgetType {

    constructor(
        username,
        color
    ) {

        super();

        this.username =
            username;

        this.color =
            color;

    }


    eq(other) {

        return (
            other.username ===
                this.username &&
            other.color ===
                this.color
        );

    }


    toDOM() {

        const wrapper =
            document.createElement(
                "span"
            );


        wrapper.className =
            "remoteCursorWrapper";


        wrapper.style.setProperty(
            "--cursor-color",
            this.color
        );


        const cursor =
            document.createElement(
                "span"
            );


        cursor.className =
            "remoteCursorLine";


        const label =
            document.createElement(
                "span"
            );


        label.className =
            "remoteCursorLabel";


        label.textContent =
            this.username;


        wrapper.appendChild(
            cursor
        );


        wrapper.appendChild(
            label
        );


        return wrapper;

    }


    ignoreEvent() {

        return true;

    }

}


/*
====================================================
REMOTE CURSOR STATE EFFECT
====================================================
*/

const remoteCursorEffect =
    StateEffect.define();


/*
====================================================
REMOTE CURSOR STATE FIELD
====================================================
*/

const remoteCursorField =
    StateField.define({

        create() {

            return [];

        },


        update(
            cursors,
            transaction
        ) {

            /*
            ----------------------------------------
            Move existing remote cursors when
            document changes.
            ----------------------------------------
            */

            cursors =
                cursors.map(
                    (cursor) => ({

                        ...cursor,

                        position:
                            transaction
                                .changes
                                .mapPos(
                                    cursor.position
                                ),

                    })
                );


            /*
            ----------------------------------------
            Handle cursor effects.
            ----------------------------------------
            */

            for (
                const effect
                of transaction.effects
            ) {

                if (
                    effect.is(
                        remoteCursorEffect
                    )
                ) {

                    const data =
                        effect.value;


                    /*
                    Remove existing
                    cursor for this user.
                    */

                    cursors =
                        cursors.filter(
                            (cursor) =>
                                cursor.id !==
                                data.id
                        );


                    /*
                    Add new cursor.
                    */

                    if (
                        !data.remove
                    ) {

                        cursors.push(
                            data
                        );

                    }

                }

            }


            return cursors;

        },


        provide:
            (field) =>
                EditorView.decorations.from(
                    field,
                    (cursors) => {

                        const decorations =
                            cursors.map(
                                (cursor) => {

                                    return Decoration
                                        .widget({

                                            widget:
                                                new RemoteCursorWidget(
                                                    cursor.username,
                                                    cursor.color
                                                ),

                                            side:
                                                1,

                                        })
                                        .range(
                                            cursor.position
                                        );

                                }
                            );


                        return Decoration.set(
                            decorations,
                            true
                        );

                    }
                ),

    });


/*
====================================================
TIME FORMATTER
====================================================
*/

const formatTimeAgo = (
    timestamp
) => {

    const seconds =
        Math.floor(
            (
                Date.now() -
                timestamp
            ) / 1000
        );


    if (
        seconds < 5
    ) {

        return "just now";

    }


    if (
        seconds < 60
    ) {

        return `${seconds} sec ago`;

    }


    const minutes =
        Math.floor(
            seconds / 60
        );


    if (
        minutes < 60
    ) {

        return `${minutes} min ago`;

    }


    const hours =
        Math.floor(
            minutes / 60
        );


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
    onCursorChange,
    onEditorReady,
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
        UNDO MANAGER
        ============================================
        */

        const undoManager =
            new Y.UndoManager(
                ytext
            );


        /*
        ============================================
        CODEMIRROR STATE
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


                    keymap.of([
                        ...closeBracketsKeymap,
                        ...defaultKeymap,
                        ...historyKeymap,
                    ]),


                    /*
                    --------------------------------
                    YJS COLLABORATION
                    --------------------------------
                    */

                    yCollab(
                        ytext,
                        null,
                        {
                            undoManager,
                        }
                    ),


                    /*
                    --------------------------------
                    REMOTE CURSORS
                    --------------------------------
                    */

                    remoteCursorField,


                    /*
                    --------------------------------
                    LOCAL CURSOR MOVEMENT
                    --------------------------------

                    This does NOT change code.

                    It only sends cursor position.
                    --------------------------------
                    */

                    EditorView.updateListener.of(
                        (update) => {

                            if (
                                update.selectionSet &&
                                update.view.hasFocus
                            ) {

                                const position =
                                    update
                                        .state
                                        .selection
                                        .main
                                        .head;


                                onCursorChange(
                                    position
                                );

                            }

                        }
                    ),


                    /*
                    --------------------------------
                    LOCAL TYPING
                    --------------------------------

                    Browser input means THIS user
                    physically interacted with editor.

                    Remote Yjs updates do not trigger
                    this.
                    --------------------------------
                    */

                    EditorView.domEventHandlers({

                        input: () => {

                            onLocalEdit();

                        },

                    }),


                    /*
                    --------------------------------
                    EDITOR THEME
                    --------------------------------
                    */

                    EditorView.theme({

                        "&": {

                            height:
                                "100%",

                        },

                        ".cm-scroller": {

                            overflow:
                                "auto",

                            fontFamily:
                                '"SFMono-Regular", Consolas, "Liberation Mono", monospace',

                            fontSize:
                                "14px",

                        },

                        ".cm-content": {

                            padding:
                                "20px 0",

                        },

                        ".cm-line": {

                            padding:
                                "0 20px",

                            textAlign:
                                "left",

                        },

                        ".cm-gutters": {

                            backgroundColor:
                                "#08090f",

                            border:
                                "none",

                            color:
                                "#3d3f4b",

                        },

                        ".cm-activeLine": {

                            backgroundColor:
                                "rgba(139, 92, 246, 0.04)",

                        },


                        /*
                        ==================================
                        REMOTE CURSOR
                        ==================================
                        */

                        ".remoteCursorWrapper": {

                            position:
                                "relative",

                            display:
                                "inline-block",

                            width:
                                "0",

                            height:
                                "1.4em",

                            verticalAlign:
                                "text-bottom",

                            pointerEvents:
                                "none",

                            zIndex:
                                "10",

                        },


                        ".remoteCursorLine": {

                            position:
                                "absolute",

                            left:
                                "0",

                            top:
                                "-1px",

                            width:
                                "2px",

                            height:
                                "1.4em",

                            background:
                                "var(--cursor-color)",

                            borderRadius:
                                "1px",

                        },


                        ".remoteCursorLabel": {

                            position:
                                "absolute",

                            left:
                                "3px",

                            top:
                                "-20px",

                            background:
                                "var(--cursor-color)",

                            color:
                                "#ffffff",

                            fontSize:
                                "10px",

                            lineHeight:
                                "16px",

                            padding:
                                "1px 5px",

                            borderRadius:
                                "3px",

                            whiteSpace:
                                "nowrap",

                            fontFamily:
                                "system-ui, sans-serif",

                            fontWeight:
                                "600",

                        },

                    }),

                ],

            });


        /*
        ============================================
        CREATE VIEW
        ============================================
        */

        const view =
            new EditorView({

                state,

                parent:
                    editorContainerRef.current,

            });


        /*
        Give parent access to editor.
        */

        onEditorReady(
            view
        );


        /*
        Send initial cursor.
        */

        onCursorChange(
            view.state.selection.main.head
        );


        /*
        ============================================
        CLEANUP
        ============================================
        */

        return () => {

            onEditorReady(
                null
            );


            view.destroy();

            undoManager.destroy();

        };

    }, [
        ytext,
        onLocalEdit,
        onCursorChange,
        onEditorReady,
    ]);


    return (

        <div
            ref={
                editorContainerRef
            }
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
    EDITOR VIEW
    ================================================
    */

    const editorViewRef =
        useRef(null);


    /*
    ================================================
    YJS
    ================================================
    */

    const ydocRef =
        useRef(null);


    /*
    ================================================
    UI STATE
    ================================================
    */

    const [
        ytext,
        setYtext
    ] = useState(null);


    const [
        collaborators,
        setCollaborators
    ] = useState([]);


    const [
    ,
    setEditingUsers
] = useState({});


    const [
        activities,
        setActivities
    ] = useState([]);


    const [
        connectionStatus,
        setConnectionStatus
    ] = useState(
        "Connecting"
    );


    const [
        language,
        setLanguage
    ] = useState(
        "JavaScript"
    );


    /*
    ================================================
    LOCAL EDIT TIMER
    ================================================
    */

    const editingTimer =
        useRef(null);


    const localEditing =
        useRef(false);


    /*
    ================================================
    CURSOR THROTTLE
    ================================================
    */

    const cursorTimer =
        useRef(null);


    const pendingCursor =
        useRef(null);


    /*
    ================================================
    CURSOR SEND
    ================================================
    */

    const sendCursor =
        useCallback(
            (position) => {

                pendingCursor.current =
                    position;


                /*
                Don't send cursor updates
                50 times in one second.
                */

                if (
                    cursorTimer.current
                ) {

                    return;

                }


                cursorTimer.current =
                    setTimeout(() => {

                        cursorTimer.current =
                            null;


                        const socket =
                            socketRef.current;


                        const positionToSend =
                            pendingCursor.current;


                        if (
                            socket &&
                            socket.connected &&
                            positionToSend !==
                                null
                        ) {

                            socket.emit(
                                "cursor-update",
                                {

                                    roomId,

                                    position:
                                        positionToSend,

                                }
                            );

                        }

                    }, 50);

            },
            [roomId]
        );


    /*
    ================================================
    LOCAL EDIT
    ================================================
    */

    const handleLocalEdit =
        useCallback(() => {

            const socket =
                socketRef.current;


            if (!socket) {

                return;

            }


            if (
                !localEditing.current
            ) {

                localEditing.current =
                    true;


                socket.emit(
                    "edit-activity",
                    {
                        roomId,
                    }
                );

            }


            clearTimeout(
                editingTimer.current
            );


            editingTimer.current =
                setTimeout(() => {

                    localEditing.current =
                        false;

                }, 5000);

        }, [roomId]);


    /*
    ================================================
    EDITOR READY
    ================================================
    */

    const handleEditorReady =
        useCallback(
            (view) => {

                editorViewRef.current =
                    view;

            },
            []
        );


    /*
    ================================================
    MAIN EFFECT
    ================================================
    */

    useEffect(() => {

        /*
        ============================================
        SOCKET
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
        YJS DOCUMENT
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
        YJS UPDATE
        ============================================
        */

        const handleYUpdate =
            (
                update,
                origin
            ) => {

                /*
                Remote update.

                Don't send it back.
                Don't create activity.
                */

                if (
                    origin ===
                    "remote"
                ) {

                    return;

                }


                /*
                Local update.

                Send to server.
                */

                socket.emit(
                    "y-update",
                    {

                        roomId,

                        update,

                    }
                );

            };


        ydoc.on(
            "update",
            handleYUpdate
        );


        /*
        ============================================
        REMOTE YJS UPDATE
        ============================================
        */

        const handleRemoteUpdate =
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
        INITIAL YJS STATE
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
        CONNECT
        ============================================
        */

        socket.on("connect", () => {

    console.log(
        "CodeMesh connected:",
        socket.id
    );


    setConnectionStatus(
        "Connected"
    );


    /*
    ==========================================
    IMPORTANT

    Socket.IO gives us a NEW socket.id
    after reconnection.

    Therefore we MUST join the room again.
    ==========================================
    */

    socket.emit(
        "join-room",
        {
            roomId,
            username,
        }
    );


    /*
    ==========================================
    RESTORE LOCAL CURSOR
    ==========================================
    */

    const view =
        editorViewRef.current;


    if (view) {

        const position =
            view.state.selection.main.head;


        socket.emit(
            "cursor-update",
            {

                roomId,

                position,

            }
        );

    }


    /*
    ==========================================
    NEW CONNECTION = NOT EDITING
    ==========================================
    */

    localEditing.current =
        false;


    clearTimeout(
        editingTimer.current
    );

});


        /*
        ============================================
        DISCONNECT
        ============================================
        */

        socket.on("disconnect", (reason) => {

    console.log(
        "CodeMesh disconnected:",
        reason
    );


    setConnectionStatus(
        "Reconnecting"
    );


    /*
    User is no longer considered
    actively editing.
    */

    localEditing.current =
        false;


    clearTimeout(
        editingTimer.current
    );


    /*
    Clear remote editing states.

    This prevents ghost "editing"
    information while disconnected.
    */

    setEditingUsers(
        {}
    );

});


        /*
        ============================================
        CONNECTION ERROR
        ============================================
        */

        socket.on(
    "connect_error",
    (error) => {

        console.log(
            "CodeMesh connection error:",
            error.message
        );


        setConnectionStatus(
            "Reconnecting"
        );

    }
);
socket.on(
    "room-joined",
    ({ roomId: joinedRoom }) => {

        console.log(
            "Room restored:",
            joinedRoom
        );

    }
);


        /*
        ============================================
        COLLABORATORS
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
        EDITING USERS
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


                        if (
                            editing
                        ) {

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

                const map =
                    {};


                users.forEach(
                    (user) => {

                        map[
                            user.id
                        ] = true;

                    }
                );


                setEditingUsers(
                    map
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
        REMOTE CURSOR
        ============================================
        */

        const showRemoteCursor =
            (cursor) => {

                const view =
                    editorViewRef.current;


                if (!view) {

                    return;

                }


                /*
                Keep cursor inside document.
                */

                const position =
                    Math.min(
                        Math.max(
                            0,
                            cursor.position
                        ),
                        view.state.doc.length
                    );


                view.dispatch({

                    effects:
                        remoteCursorEffect.of({

                            id:
                                cursor.id,

                            username:
                                cursor.username,

                            position,

                            color:
                                getCursorColor(
                                    cursor.id
                                ),

                        }),

                });

            };


        socket.on(
            "cursor-update",
            showRemoteCursor
        );


        /*
        ============================================
        EXISTING CURSORS
        ============================================
        */

        const handleRoomCursors =
            ({ cursors }) => {

                /*
                Editor might not be mounted yet.

                If it isn't, wait a little and
                apply them after mount.
                */

                if (
                    !editorViewRef.current
                ) {

                    setTimeout(() => {

                        cursors.forEach(
                            showRemoteCursor
                        );

                    }, 100);

                    return;

                }


                cursors.forEach(
                    showRemoteCursor
                );

            };


        socket.on(
            "room-cursors",
            handleRoomCursors
        );


        /*
        ============================================
        REMOVE CURSOR
        ============================================
        */

        socket.on(
            "cursor-remove",
            ({ id }) => {

                const view =
                    editorViewRef.current;


                if (!view) {

                    return;

                }


                view.dispatch({

                    effects:
                        remoteCursorEffect.of({

                            id,

                            remove:
                                true,

                        }),

                });

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


            clearTimeout(
                cursorTimer.current
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


            editorViewRef.current =
                null;

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
    ]);


    /*
    ================================================
    COPY ROOM
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
                LAYOUT
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
                                                className="userOnline"
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
                    EDITOR
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
                                    ytext={
                                        ytext
                                    }

                                    onLocalEdit={
                                        handleLocalEdit
                                    }

                                    onCursorChange={
                                        sendCursor
                                    }

                                    onEditorReady={
                                        handleEditorReady
                                    }

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
                    RIGHT ACTIVITY
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