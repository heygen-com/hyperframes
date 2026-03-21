#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { VERSION } from "./version.js";

const main = defineCommand({
  meta: {
    name: "hyperframes",
    version: VERSION,
    description: "Create and render HTML video compositions",
  },
  subCommands: {
    init: () => import("./commands/init.js").then((m) => m.default),
    dev: () => import("./commands/dev.js").then((m) => m.default),
    render: () => import("./commands/render.js").then((m) => m.default),
    lint: () => import("./commands/lint.js").then((m) => m.default),
    info: () => import("./commands/info.js").then((m) => m.default),
    compositions: () => import("./commands/compositions.js").then((m) => m.default),
    benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
    browser: () => import("./commands/browser.js").then((m) => m.default),
    docs: () => import("./commands/docs.js").then((m) => m.default),
    doctor: () => import("./commands/doctor.js").then((m) => m.default),
    upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  },
});

runMain(main);
