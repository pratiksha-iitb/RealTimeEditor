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

    const filesMapRef =
        useRef(null);

    const fileTreeMapRef =
        useRef(null);

    const projectInputRef =
        useRef(null);

    const activeFileRef =
        useRef("index.js");


    /*
    ================================================
    UI STATE
    ================================================
    */

    const [
        files,
        setFiles
    ] = useState([]);

    const [
        ,
        setTreeVersion
    ] = useState(0);

    const [
        activeFile,
        setActiveFile
    ] = useState("index.js");

    const [
        ytext,
        setYtext
    ] = useState(null);


    const [
        collaborators,
        setCollaborators
    ] = useState([]);

    const [
        collapsedFolders,
        setCollapsedFolders
    ] = useState(
        () => new Set()
    );


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
                                    fileName:
                                        activeFileRef.current,
                                    position:
                                        positionToSend,
                                }
                            );

                        }

                    }, 50);

            },
            [
                roomId,
            ]
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
                        fileName:
                            activeFile,
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

        }, [
            roomId,
            activeFile,
        ]);


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


        const filesMap =
            ydoc.getMap("files");

        const fileTreeMap =
            ydoc.getMap("fileTree");

        filesMapRef.current =
            filesMap;

        fileTreeMapRef.current =
            fileTreeMap;

        ydocRef.current =
            ydoc;

        /*
        --------------------------------------------
        FILE TREE
        --------------------------------------------
        The file tree is itself part of the shared
        Yjs document, so every collaborator sees
        file creation/deletion immediately.
        */

        const syncFileList =
            () => {

                const names =
                    Array.from(
                        filesMap.keys()
                    ).sort(
                        (a, b) => {
                            if (
                                a === "index.js"
                            ) return -1;

                            if (
                                b === "index.js"
                            ) return 1;

                            return a.localeCompare(
                                b
                            );
                        }
                    );

                setFiles(
                    names
                );

                setActiveFile(
                    (current) => {

                        if (
                            current &&
                            names.includes(
                                current
                            )
                        ) {
                            return current;
                        }

                        return (
                            names[0] ||
                            null
                        );

                    }
                );

            };

        syncFileList();

        filesMap.observe(
            syncFileList
        );

        const syncFileTree =
            () => {
                setTreeVersion(
                    (version) =>
                        version + 1
                );
            };

        fileTreeMap.observe(
            syncFileTree
        );

        const ensureTreeFromFiles =
            () => {

                ydoc.transact(() => {

                    Array.from(
                        filesMap.keys()
                    ).forEach(
                        (filePath) => {

                            const parts =
                                String(filePath)
                                    .split("/")
                                    .filter(Boolean);

                            let currentPath = "";

                            parts.forEach(
                                (part, index) => {

                                    currentPath =
                                        currentPath
                                            ? `${currentPath}/${part}`
                                            : part;

                                    const isFile =
                                        index ===
                                        parts.length - 1;

                                    if (
                                        !fileTreeMap.has(
                                            currentPath
                                        )
                                    ) {

                                        fileTreeMap.set(
                                            currentPath,
                                            JSON.stringify({
                                                type:
                                                    isFile
                                                        ? "file"
                                                        : "folder",
                                            })
                                        );

                                    }

                                }
                            );

                        }
                    );

                });

            };

        ensureTreeFromFiles();

        filesMap.observe(
            ensureTreeFromFiles
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

                const localDoc =
                    ydocRef.current;

                if (
                    localDoc &&
                    joinedRoom === roomId
                ) {

                    const localState =
                        Y.encodeStateAsUpdate(
                            localDoc
                        );

                    socket.emit(
                        "sync-local-state",
                        {
                            roomId,
                            update: localState,
                        }
                    );

                }

                /*
                Send local cursor after room join.
                */

                const view =
                    editorViewRef.current;

                if (view) {

                    socket.emit(
                        "cursor-update",
                        {
                            roomId,
                            fileName:
                                activeFileRef.current,
                            position:
                                view.state.selection.main.head,
                        }
                    );

                }

                socket.emit(
                    "request-room-cursors",
                    {
                        roomId,
                        fileName:
                            activeFileRef.current,
                    }
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

                /*
                Cursors belong to a specific file.
                Do not render cursors from another file.
                */

                if (
                    cursor.fileName &&
                    cursor.fileName !==
                    activeFileRef.current
                ) {
                    return;
                }

                /*
                Never render my own cursor.
                This also protects against stale cursor data
                during reconnect.
                */

                if (
                    cursor.id ===
                    socketRef.current?.id
                ) {
                    return;
                }

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

                        cursors
                            .filter(
                                (cursor) =>
                                    cursor.id !==
                                    socketRef.current?.id
                            )
                            .forEach(
                                showRemoteCursor
                            );

                    }, 100);

                    return;

                }


                cursors
                    .filter(
                        (cursor) =>
                            cursor.id !==
                            socketRef.current?.id
                    )
                    .forEach(
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


            filesMap.unobserve(
                syncFileList
            );

            filesMap.unobserve(
                ensureTreeFromFiles
            );

            fileTreeMap.unobserve(
                syncFileTree
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

            filesMapRef.current =
                null;

            activeFileRef.current =
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
    ACTIVE FILE
    ================================================
    */

    useEffect(() => {

        activeFileRef.current =
            activeFile;

        const filesMap =
            filesMapRef.current;

        if (
            !filesMap ||
            !activeFile
        ) {
            setYtext(null);
            return;
        }

        const nextText =
            filesMap.get(
                activeFile
            );

        if (
            nextText instanceof Y.Text
        ) {
            setYtext(
                nextText
            );
        } else {
            setYtext(null);
        }

        /*
        Ask the server for the latest remote cursors
        for this file. Cursor positions are file-specific.
        */

        const socket =
            socketRef.current;

        if (
            socket &&
            socket.connected
        ) {
            socket.emit(
                "request-room-cursors",
                {
                    roomId,
                    fileName:
                        activeFile,
                }
            );
        }

    }, [
        activeFile,
        roomId,
        files,
    ]);


    /*
    ================================================
    FILE ACTIONS
    ================================================
    */

    const getInitialFileContent =
        (fileName) => {

            if (
                fileName.endsWith(".md")
            ) {
                return "# " +
                    fileName
                        .replace(
                            /\.md$/i,
                            ""
                        ) +
                    "\n";
            }

            if (
                fileName.endsWith(".json")
            ) {
                return "{}\n";
            }

            return "";
        };


    const addTreeEntry =
        (path, type) => {

            const treeMap =
                fileTreeMapRef.current;

            if (!treeMap || !path) {
                return;
            }

            const parts =
                String(path)
                    .split("/")
                    .filter(Boolean);

            let currentPath = "";

            parts.forEach(
                (part, index) => {

                    currentPath =
                        currentPath
                            ? `${currentPath}/${part}`
                            : part;

                    const isFile =
                        type === "file" &&
                        index ===
                        parts.length - 1;

                    if (
                        !treeMap.has(
                            currentPath
                        )
                    ) {

                        treeMap.set(
                            currentPath,
                            JSON.stringify({
                                type:
                                    isFile
                                        ? "file"
                                        : "folder",
                            })
                        );

                    }

                }
            );

        };


    const handleCreateFile =
        () => {

            const filesMap =
                filesMapRef.current;

            if (!filesMap) {
                return;
            }

            const name =
                window.prompt(
                    "New file path",
                    "src/newFile.js"
                );

            if (!name) {
                return;
            }

            const fileName =
                name
                    .trim()
                    .replace(
                        /^\/+|\/+$/g,
                        ""
                    );

            if (
                !fileName ||
                fileName.length > 180 ||
                fileName.includes("..") ||
                /[\\]/.test(fileName)
            ) {
                toast.error(
                    "Use a valid file path"
                );
                return;
            }

            if (
                filesMap.has(fileName)
            ) {
                toast.error(
                    "File already exists"
                );
                setActiveFile(
                    fileName
                );
                return;
            }

            const file =
                new Y.Text();

            file.insert(
                0,
                getInitialFileContent(
                    fileName
                )
            );

            ydocRef.current?.transact(
                () => {

                    filesMap.set(
                        fileName,
                        file
                    );

                    addTreeEntry(
                        fileName,
                        "file"
                    );

                }
            );

            setActiveFile(
                fileName
            );

            toast.success(
                `${fileName} created`
            );

        };


    const handleCreateFolder =
        () => {

            const treeMap =
                fileTreeMapRef.current;

            if (!treeMap) {
                return;
            }

            const name =
                window.prompt(
                    "New folder path",
                    "src/components"
                );

            if (!name) {
                return;
            }

            const folderPath =
                name
                    .trim()
                    .replace(
                        /^\/+|\/+$/g,
                        ""
                    );

            if (
                !folderPath ||
                folderPath.length > 180 ||
                folderPath.includes("..") ||
                /[\\]/.test(folderPath)
            ) {
                toast.error(
                    "Use a valid folder path"
                );
                return;
            }

            if (
                treeMap.has(
                    folderPath
                )
            ) {
                toast.error(
                    "Folder already exists"
                );
                return;
            }

            ydocRef.current?.transact(
                () => {
                    addTreeEntry(
                        folderPath,
                        "folder"
                    );
                }
            );

            toast.success(
                `${folderPath} created`
            );

        };


    const handleDeleteFolder =
        (folderPath) => {

            const filesMap =
                filesMapRef.current;

            const treeMap =
                fileTreeMapRef.current;

            if (
                !filesMap ||
                !treeMap ||
                !folderPath
            ) {
                return;
            }

            const prefix =
                `${folderPath}/`;

            const filesInside =
                Array.from(
                    filesMap.keys()
                ).filter(
                    (filePath) =>
                        filePath.startsWith(
                            prefix
                        )
                );

            if (
                !filesInside.length &&
                !treeMap.has(folderPath)
            ) {
                return;
            }

            if (
                !window.confirm(
                    `Delete folder "${folderPath}" and everything inside it?`
                )
            ) {
                return;
            }

            ydocRef.current?.transact(
                () => {

                    filesInside.forEach(
                        (filePath) => {
                            filesMap.delete(
                                filePath
                            );
                        }
                    );

                    Array.from(
                        treeMap.keys()
                    )
                        .filter(
                            (path) =>
                                path === folderPath ||
                                path.startsWith(
                                    prefix
                                )
                        )
                        .forEach(
                            (path) => {
                                treeMap.delete(
                                    path
                                );
                            }
                        );

                }
            );

            if (
                activeFile.startsWith(
                    prefix
                )
            ) {

                const remaining =
                    Array.from(
                        filesMap.keys()
                    );

                setActiveFile(
                    remaining[0] ||
                    "index.js"
                );

            }

            toast.success(
                `${folderPath} deleted`
            );

        };


    const importProjectFiles =
        async (event) => {

            const input =
                event.target;

            const selectedFiles =
                Array.from(
                    input.files || []
                );

            if (!selectedFiles.length) {
                return;
            }

            const filesMap =
                filesMapRef.current;

            const treeMap =
                fileTreeMapRef.current;

            if (!filesMap || !treeMap) {
                return;
            }

            const ignoredDirectories =
                new Set([
                    "node_modules",
                    ".git",
                    "dist",
                    "build",
                    ".next",
                    ".cache",
                    "coverage",
                ]);

            const imported = [];

            for (
                const browserFile
                of selectedFiles
            ) {

                const relativePath =
                    browserFile.webkitRelativePath ||
                    browserFile.name;

                const parts =
                    relativePath
                        .split("/")
                        .filter(Boolean);

                const cleanParts =
                    parts.filter(
                        (part) =>
                            !ignoredDirectories.has(
                                part
                            )
                    );

                if (!cleanParts.length) {
                    continue;
                }

                const filePath =
                    cleanParts.join("/");

                if (
                    filePath.length > 180 ||
                    filePath.includes("..")
                ) {
                    continue;
                }

                try {

                    const content =
                        await browserFile.text();

                    const ytext =
                        new Y.Text();

                    ytext.insert(
                        0,
                        content
                    );

                    ydocRef.current?.transact(
                        () => {

                            filesMap.set(
                                filePath,
                                ytext
                            );

                            addTreeEntry(
                                filePath,
                                "file"
                            );

                        }
                    );

                    imported.push(
                        filePath
                    );

                } catch (error) {

                    console.error(
                        "Failed to import file:",
                        filePath,
                        error
                    );

                }

            }

            if (imported.length) {

                setActiveFile(
                    imported[0]
                );

                toast.success(
                    `${imported.length} file${imported.length === 1 ? "" : "s"} imported`
                );

            } else {

                toast.error(
                    "No files could be imported"
                );

            }

            input.value = "";

        };


    const handleDeleteFile =
        (fileName) => {

            const filesMap =
                filesMapRef.current;

            if (
                !filesMap ||
                !filesMap.has(fileName)
            ) {
                return;
            }

            if (
                filesMap.size <= 1
            ) {
                toast.error(
                    "A workspace must keep one file"
                );
                return;
            }

            if (
                !window.confirm(
                    `Delete ${fileName}?`
                )
            ) {
                return;
            }

            ydocRef.current?.transact(
                () => {

                    filesMap.delete(
                        fileName
                    );

                    const treeMap =
                        fileTreeMapRef.current;

                    if (treeMap) {
                        treeMap.delete(
                            fileName
                        );
                    }

                }
            );

            toast.success(
                `${fileName} deleted`
            );

        };


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


    const getFileIcon =
        (fileName) => {

            const extension =
                fileName
                    .split(".")
                    .pop()
                    .toLowerCase();

            if (extension === "js" || extension === "jsx") {
                return {
                    label: "JS",
                    className: "js",
                };
            }

            if (extension === "ts" || extension === "tsx") {
                return {
                    label: "TS",
                    className: "js",
                };
            }

            if (extension === "md") {
                return {
                    label: "#",
                    className: "md",
                };
            }

            if (extension === "json") {
                return {
                    label: "{}",
                    className: "json",
                };
            }

            if (extension === "css") {
                return {
                    label: "CSS",
                    className: "css",
                };
            }

            if (extension === "html") {
                return {
                    label: "HTML",
                    className: "html",
                };
            }

            if (extension === "py") {
                return {
                    label: "PY",
                    className: "py",
                };
            }

            return {
                label: "•",
                className: "file",
            };

        };



    const toggleFolder =
        (folderPath) => {

            setCollapsedFolders(
                (previous) => {

                    const next =
                        new Set(previous);

                    if (
                        next.has(folderPath)
                    ) {
                        next.delete(folderPath);
                    } else {
                        next.add(folderPath);
                    }

                    return next;
                }
            );
        };


    const buildFileTree =
        () => {

            const treeMap =
                fileTreeMapRef.current;

            const root = {
                path: "",
                folders: new Map(),
                files: [],
            };

            if (!treeMap) {
                return root;
            }

            const getFolder =
                (node, name) => {

                    if (!node.folders.has(name)) {
                        node.folders.set(
                            name,
                            {
                                path: node.path
                                    ? `${node.path}/${name}`
                                    : name,
                                name,
                                folders: new Map(),
                                files: [],
                            }
                        );
                    }

                    return node.folders.get(name);
                };

            Array.from(treeMap.keys()).forEach(
                (path) => {

                    let metadata = {};

                    try {
                        metadata =
                            JSON.parse(
                                treeMap.get(path)
                            ) || {};
                    } catch {
                        metadata = {};
                    }

                    const type =
                        metadata.type ||
                        (files.includes(path)
                            ? "file"
                            : "folder");

                    const parts =
                        path
                            .split("/")
                            .filter(Boolean);

                    if (!parts.length) {
                        return;
                    }

                    if (type === "file") {

                        let node = root;

                        parts
                            .slice(0, -1)
                            .forEach((part) => {
                                node =
                                    getFolder(
                                        node,
                                        part
                                    );
                            });

                        if (
                            !node.files.some(
                                (file) =>
                                    file.path === path
                            )
                        ) {
                            node.files.push({
                                name:
                                    parts[
                                    parts.length - 1
                                    ],
                                path,
                            });
                        }

                    } else {

                        let node = root;

                        parts.forEach((part) => {
                            node =
                                getFolder(
                                    node,
                                    part
                                );
                        });
                    }
                }
            );

            const sortTree =
                (node) => {

                    node.folders =
                        new Map(
                            Array.from(
                                node.folders.entries()
                            ).sort(
                                ([a], [b]) =>
                                    a.localeCompare(b)
                            )
                        );

                    node.files.sort(
                        (a, b) =>
                            a.name.localeCompare(
                                b.name
                            )
                    );

                    node.folders.forEach(
                        sortTree
                    );

                    return node;
                };

            return sortTree(root);
        };


    const renderFileTree =
        (node, depth = 0) => {

            const output = [];

            node.folders.forEach(
                (folder) => {

                    output.push(
                        <div
                            key={`folder-${folder.path}`}
                            className="treeFolder"
                        >

                            <div
                                className="treeRow folderRow"
                                style={{
                                    paddingLeft:
                                        `${8 + depth * 14}px`,
                                }}
                            >

                                <button
                                    className="folderToggle"
                                    onClick={() =>
                                        toggleFolder(
                                            folder.path
                                        )
                                    }
                                    title={
                                        collapsedFolders.has(
                                            folder.path
                                        )
                                            ? "Expand"
                                            : "Collapse"
                                    }
                                >
                                    {
                                        collapsedFolders.has(
                                            folder.path
                                        )
                                            ? "▶"
                                            : "▼"
                                    }
                                </button>

                                <span className="folderIcon">
                                    📁
                                </span>

                                <span className="fileName">
                                    {folder.name}
                                </span>

                                <button
                                    className="treeDeleteButton"
                                    onClick={() =>
                                        handleDeleteFolder(
                                            folder.path
                                        )
                                    }
                                    title={`Delete ${folder.path}`}
                                >
                                    ×
                                </button>

                            </div>

                            {!collapsedFolders.has(
                                folder.path
                            ) &&
                                renderFileTree(
                                    folder,
                                    depth + 1
                                )}

                        </div>
                    );
                }
            );

            node.files.forEach(
                (file) => {

                    const icon =
                        getFileIcon(file.path);

                    const isActive =
                        file.path === activeFile;

                    output.push(
                        <div
                            key={`file-${file.path}`}
                            className={
                                "treeRow fileRow " +
                                (isActive
                                    ? "active"
                                    : "")
                            }
                            style={{
                                paddingLeft:
                                    `${24 + depth * 14}px`,
                            }}
                        >

                            <button
                                className={
                                    "fileItem " +
                                    (isActive
                                        ? "active"
                                        : "")
                                }
                                onClick={() =>
                                    setActiveFile(
                                        file.path
                                    )
                                }
                                title={file.path}
                            >

                                <span
                                    className={
                                        "fileIcon " +
                                        icon.className
                                    }
                                >
                                    {icon.label}
                                </span>

                                <span className="fileName">
                                    {file.name}
                                </span>

                            </button>

                            <button
                                className="deleteFileButton"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteFile(
                                        file.path
                                    );
                                }}
                                title={`Delete ${file.path}`}
                            >
                                ×
                            </button>

                        </div>
                    );
                }
            );

            return output;
        };


    /*
    ================================================
    RENDER
    ================================================
    */

    return (

        <div className="editorPage">

            <style>{`
                .fileTree {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    margin-top: 4px;
                    overflow-y: auto;
                }

                .treeFolder {
                    width: 100%;
                }

                .treeRow {
                    position: relative;
                    display: flex;
                    align-items: center;
                    width: 100%;
                    min-height: 28px;
                    box-sizing: border-box;
                }

                .folderRow {
                    color: #c7c9d3;
                    font-size: 12px;
                    font-weight: 600;
                    border-radius: 4px;
                }

                .folderRow:hover {
                    background: rgba(255,255,255,0.05);
                }

                .folderToggle {
                    width: 16px;
                    height: 24px;
                    padding: 0;
                    border: 0;
                    background: transparent;
                    color: #777b8c;
                    cursor: pointer;
                    font-size: 8px;
                    flex: 0 0 16px;
                }

                .folderToggle:hover {
                    color: #ffffff;
                }

                .folderIcon {
                    width: 22px;
                    flex: 0 0 22px;
                    font-size: 13px;
                }

                .treeDeleteButton {
                    position: absolute;
                    right: 5px;
                    width: 22px;
                    height: 22px;
                    border: 0;
                    border-radius: 4px;
                    background: transparent;
                    color: #777b8c;
                    cursor: pointer;
                    opacity: 0;
                    font-size: 16px;
                }

                .folderRow:hover .treeDeleteButton {
                    opacity: 1;
                }

                .treeDeleteButton:hover {
                    background: rgba(255,255,255,0.08);
                    color: #ff6b6b;
                }

                .treeRow.fileRow {
                    padding-right: 28px;
                }

                .explorerActions {
                    display: flex;
                    align-items: center;
                    gap: 2px;
                }

                .explorerActions button {
                    border: 0;
                    background: transparent;
                    color: #9b9eaa;
                    cursor: pointer;
                    padding: 3px 5px;
                    border-radius: 4px;
                    font-size: 12px;
                }

                .explorerActions button:hover {
                    background: rgba(255,255,255,0.08);
                    color: #ffffff;
                }

                .fileRow {
                    position: relative;
                    display: flex;
                    align-items: center;
                    width: 100%;
                    min-width: 0;
                }

                .fileRow .fileItem {
                    flex: 1;
                    min-width: 0;
                    padding-right: 28px;
                }

                .fileName {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }

                .deleteFileButton {
                    position: absolute;
                    right: 5px;
                    top: 50%;
                    transform: translateY(-50%);
                    width: 22px;
                    height: 22px;
                    border: 0;
                    border-radius: 4px;
                    background: transparent;
                    color: #777b8c;
                    cursor: pointer;
                    font-size: 16px;
                    line-height: 20px;
                    z-index: 2;
                }

                .deleteFileButton:hover {
                    background: rgba(255,255,255,0.08);
                    color: #ff6b6b;
                }

                .fileIcon.json,
                .fileIcon.css,
                .fileIcon.html,
                .fileIcon.py,
                .fileIcon.file {
                    font-size: 8px;
                }
            `}</style>


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

                            <div className="explorerActions">

                                <button
                                    onClick={
                                        handleCreateFile
                                    }
                                    title="New file"
                                >
                                    +📄
                                </button>

                                <button
                                    onClick={
                                        handleCreateFolder
                                    }
                                    title="New folder"
                                >
                                    +📁
                                </button>

                                <button
                                    onClick={() =>
                                        projectInputRef.current?.click()
                                    }
                                    title="Open project"
                                >
                                    📂
                                </button>

                                <input
                                    ref={projectInputRef}
                                    type="file"
                                    webkitdirectory=""
                                    directory=""
                                    multiple
                                    onChange={
                                        importProjectFiles
                                    }
                                    style={{
                                        display: "none",
                                    }}
                                />

                            </div>

                        </div>


                        <div className="workspaceName">
                            CODEMESH
                        </div>


                        <div className="fileTree">
                            {renderFileTree(buildFileTree())}
                        </div>

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

                            <span className={
                                "jsTab " +
                                (
                                    getFileIcon(
                                        activeFile ||
                                        "index.js"
                                    ).className
                                )
                            }>
                                {
                                    getFileIcon(
                                        activeFile ||
                                        "index.js"
                                    ).label
                                }
                            </span>

                            {
                                activeFile ||
                                "No file"
                            }

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