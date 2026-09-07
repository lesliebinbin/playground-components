import { createRoot } from "react-dom/client";
import "./utils/embedFeatureFlags";
import { PlaygroundApp } from "./components/PlaygroundApp";
import { ProbeApp } from "./probe/ProbeApp";
import { ProbeFrame } from "./probe/ProbeFrame";

import "@humansignal/ui/src/styles.prefix.css";
import "@humansignal/ui/src/tailwind.css";

const root = createRoot(document.getElementById("root")!);
const probe = new URLSearchParams(location.search).get("component-probe");
root.render(probe === "frame" ? <ProbeFrame /> : probe === "1" ? <ProbeApp /> : <PlaygroundApp />);
