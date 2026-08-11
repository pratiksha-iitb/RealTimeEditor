import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./Home.css";
import { v4 as uuid } from "uuid";
import toast from "react-hot-toast";

const Home = () => {
    const [roomId, setRoomId] = useState("");
    const [username, setUsername] = useState("");

    const navigate = useNavigate();

    const handleJoinRoom = (e) => {
        e.preventDefault();

        if (!roomId.trim() || !username.trim()) {
            alert("Please enter Room ID and Username");
            return;
        }

        navigate(`/editor/${roomId}`, {
            state: {
                username: username.trim(),
            },
        });
    };

    const createRoom = () => {
        const newRoomId = uuid();

        setRoomId(newRoomId);

        toast.success("Created a new room");
    };

    return (
        <div className="homePage">

            {/* Navbar */}
            <nav className="navbar">
                <div className="brand">
                    <img
                        src="/codemesh-icon.png"
                        alt="CodeMesh"
                        className="brandLogo"
                    />

                    <span className="brandName">
                        CodeMesh
                    </span>
                </div>

                <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    className="githubButton"
                >
                    GitHub
                </a>
            </nav>

            {/* Main */}
            <main className="homeMain">

                <section className="hero">

                    <div className="status">
                        <span className="statusDot"></span>
                        Real-time collaboration
                    </div>

                    <h1>
                        Code together.
                        <br />
                        <span>Build together.</span>
                    </h1>

                    <p className="description">
                        A real-time collaborative code editor
                        built for developers who work together.
                    </p>

                    {/* Join Card */}
                    <div className="roomCard">

                        <h2>
                            Join a workspace
                        </h2>

                        <p className="cardDescription">
                            Enter your details to start coding.
                        </p>

                        <form onSubmit={handleJoinRoom}>

                            <div className="inputGroup">
                                <label>ROOM ID</label>

                                <input
                                    type="text"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value)}
                                    placeholder="Enter room ID"
                                />
                            </div>

                            <div className="inputGroup">
                                <label>USERNAME</label>

                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Enter your name"
                                />
                            </div>

                            <button
                                type="submit"
                                className="joinButton"
                            >
                                Join Workspace
                                <span>→</span>
                            </button>

                        </form>

                        <div className="divider">
                            <span>OR</span>
                        </div>

                        <button
                            type="button"
                            className="createButton"
                            onClick={createRoom}
                        >
                            Create a new workspace
                        </button>

                    </div>

                </section>

                {/* Simple Code Preview */}
                <section className="editorPreview">

                    <div className="editorHeader">

                        <div className="windowDots">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>

                        <span className="fileName">
                            collaboration.js
                        </span>

                        <span className="live">
                            <span></span>
                            LIVE
                        </span>

                    </div>

                    <div className="code">

                        <div>
                            <span className="lineNumber">01</span>
                            <span className="purple">const</span>{" "}
                            <span className="blue">workspace</span> = {"{"}
                        </div>

                        <div>
                            <span className="lineNumber">02</span>
                            &nbsp;&nbsp;&nbsp;&nbsp;
                            <span className="blue">users</span>: [
                        </div>

                        <div>
                            <span className="lineNumber">03</span>
                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                            <span className="green">"Pratiksha"</span>,
                        </div>

                        <div>
                            <span className="lineNumber">04</span>
                            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                            <span className="green">"Alex"</span>
                        </div>

                        <div>
                            <span className="lineNumber">05</span>
                            &nbsp;&nbsp;&nbsp;&nbsp;],
                        </div>

                        <div>
                            <span className="lineNumber">06</span>
                            &nbsp;&nbsp;&nbsp;&nbsp;
                            <span className="blue">status</span>:{" "}
                            <span className="green">"connected"</span>
                        </div>

                        <div>
                            <span className="lineNumber">07</span>
                            {"};"}
                        </div>

                    </div>

                    <div className="onlineUsers">
                        <span className="avatar">P</span>
                        <span className="avatar second">A</span>
                        <span>2 developers online</span>
                    </div>

                </section>

            </main>

            <footer>
                <span>CodeMesh</span>
                <span>Collaborate. Code. Create.</span>
            </footer>

        </div>
    );
};

export default Home;