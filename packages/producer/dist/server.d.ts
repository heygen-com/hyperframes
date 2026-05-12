#!/usr/bin/env node
/**
 * @hyperframes/producer — Public Server
 *
 * Clean HTTP API for rendering HTML compositions to video.
 *
 * Routes:
 *   POST /render         — blocking render, returns JSON
 *   POST /render/stream  — SSE streaming render with progress
 *   GET  /render/queue   — current render queue status
 *   POST /lint           — blocking Hyperframe lint
 *   GET  /health         — health check
 *   GET  /outputs/:token — download rendered MP4
 */
import { Hono, type Context } from "hono";
import { type ProducerLogger } from "./logger.js";
export interface HandlerOptions {
    /** Custom logger. Defaults to console-based defaultLogger. */
    logger?: ProducerLogger;
    /** Extract or generate a request ID. Defaults to x-request-id header or random UUID. */
    getRequestId?: (c: Context) => string;
    /** Directory for rendered output files. Defaults to PRODUCER_RENDERS_DIR or /tmp. */
    rendersDir?: string;
    /** Prefix for output URLs in responses. Default: "/outputs". */
    outputUrlPrefix?: string;
    /** TTL for output artifact download tokens (ms). Default: 15 minutes. */
    artifactTtlMs?: number;
    /** Max renders that execute simultaneously. Queued requests wait FIFO. Default: 2. */
    maxConcurrentRenders?: number;
}
export interface ServerOptions extends HandlerOptions {
    /** Port to listen on. Default: 9847. */
    port?: number;
}
export interface RenderHandlers {
    render: (c: Context) => Promise<Response>;
    renderStream: (c: Context) => Response | Promise<Response>;
    lint: (c: Context) => Promise<Response>;
    health: (c: Context) => Response;
    outputs: (c: Context) => Response;
    queue: (c: Context) => Response;
}
/**
 * Create route handler functions for the producer server.
 *
 * These can be mounted on any Hono app at any path prefix.
 */
export declare function createRenderHandlers(options?: HandlerOptions): RenderHandlers;
/**
 * Create a Hono app with clean public routes for OSS use.
 */
export declare function createProducerApp(options?: HandlerOptions): Hono;
/**
 * Start the producer HTTP server with graceful shutdown.
 */
export declare function startServer(options?: ServerOptions): import("@hono/node-server").ServerType;
//# sourceMappingURL=server.d.ts.map