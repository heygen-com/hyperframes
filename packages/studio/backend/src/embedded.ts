/**
 * Embedded studio server factory.
 *
 * Creates a Hono app with all studio backend routes mounted, suitable for
 * embedding in the CLI bundle. Uses the same Hono import as the route modules
 * to avoid class duplication when bundled by tsup.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { projects } from "./routes/projects";
import { projectRender, renderJobs } from "./routes/render";

export interface EmbeddedAppOptions {
  /** CORS origin (default: "*") */
  corsOrigin?: string;
}

/**
 * Create a fully configured Hono app with studio backend routes.
 * All imports use the same module scope, avoiding Hono class mismatches in bundles.
 */
export function createEmbeddedApp(options: EmbeddedAppOptions = {}): InstanceType<typeof Hono> {
  const app = new Hono();

  app.use(
    "/*",
    cors({
      origin: options.corsOrigin ?? "*",
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.get("/api/health", (ctx) => ctx.json({ status: "ok", service: "studio-embedded" }));

  app.route("/api/projects", projects);
  app.route("/api/projects", projectRender);
  app.route("/api/render", renderJobs);

  return app;
}
