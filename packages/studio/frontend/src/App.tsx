import { useState, useEffect } from "react";
import { HomePage } from "./components/HomePage";
import { ProjectPage } from "./components/ProjectPage";

function parseHash(): { page: "home" | "project"; projectId?: string } {
  const hash = window.location.hash || "#/";
  const match = hash.match(/^#\/project\/(.+)$/);
  if (match) return { page: "project", projectId: match[1] };
  return { page: "home" };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (route.page === "project" && route.projectId) {
    return <ProjectPage projectId={route.projectId} />;
  }

  return <HomePage />;
}
