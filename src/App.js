import "./App.css";

import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom";

import Home from "./pages/Home";
import EditorPage from "./pages/EditorPage";

import { Toaster } from "react-hot-toast";

function App() {
  return (
    <BrowserRouter>

      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,

          success: {
            iconTheme: {
              primary: "#8b5cf6",
              secondary: "#ffffff",
            },
          },

          error: {
            iconTheme: {
              primary: "#ef4444",
              secondary: "#ffffff",
            },
          },
        }}
      />

      <div className="App">
        <Routes>

          <Route
            path="/"
            element={<Home />}
          />

          <Route
            path="/editor/:roomId"
            element={<EditorPage />}
          />

        </Routes>
      </div>

    </BrowserRouter>
  );
}

export default App;