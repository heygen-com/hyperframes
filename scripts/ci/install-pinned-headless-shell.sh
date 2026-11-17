#!/usr/bin/env bash
# The headless shell the engine pins, in Puppeteer's cache, so tests start it through the engine's own checked lookup.
set -euo pipefail
version=$(bun -e 'import { managedChromeVersion } from "./packages/engine/src/services/chromeHostCeiling.ts"; console.log(managedChromeVersion())')
bunx @puppeteer/browsers@3.2.2 install "chrome-headless-shell@$version" --path "$HOME/.cache/puppeteer"
