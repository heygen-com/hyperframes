import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { projects } from "./routes/projects";
import { projectRender, renderJobs } from "./routes/render";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: ["http://localhost:5175"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  })
);

app.get("/", (c) => c.json({ status: "ok", service: "studio" }));

app.route("/api/projects", projects);
app.route("/api/projects", projectRender);
app.route("/api/render", renderJobs);

const port = 3002;

console.log(`Studio backend running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});
