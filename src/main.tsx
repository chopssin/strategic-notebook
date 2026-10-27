import React from "react";
import { createRoot } from "react-dom/client";
import { Atlas } from "./Atlas";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Atlas />
  </React.StrictMode>,
);
