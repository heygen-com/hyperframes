import { promisify } from "node:util";
import { execFile as nodeExecFile } from "node:child_process";
import { signedInRequest as defaultRequest } from "./signedInRequest.mjs";
// @ts-check
/** @typedef {import("./hosts.js").ShareHost} ShareHost */
/** @type {Partial<ShareHost>} */
const host = { execFile: nodeExecFile, signedInRequest: defaultRequest };
/** Bind the host services used by the sharing runtime. @param {Partial<ShareHost>} part */
export const bindShareHost = (part) => void Object.assign(host, part);
/** @template {keyof ShareHost} K @param {K} name @returns {ShareHost[K]} */
const bound = (name) => {
  const part = host[name];
  if (part === undefined) throw new Error(`No host is bound to share projects (${name}).`);
  return /** @type {ShareHost[K]} */ (part);
};

/** @type {ShareHost["normalize"]} */
export const normalize = (path) => bound("normalize")(path);
/** @type {ShareHost["assertOpenProject"]} */
export const assertOpenProject = (path) => bound("assertOpenProject")(path);
/** @type {ShareHost["resolveOpenProjectByPath"]} */
export const resolveOpenProjectByPath = (path) => bound("resolveOpenProjectByPath")(path);
/** @type {ShareHost["listOpenProjects"]} */
export const listOpenProjects = () => bound("listOpenProjects")();
/** @type {ShareHost["homeName"]} */
export const homeName = (path, folder) => bound("homeName")(path, folder);
/** @type {ShareHost["uploadWithProgress"]} */
export const uploadWithProgress = (url, headers, archive, onSent) =>
  bound("uploadWithProgress")(url, headers, archive, onSent);
/** @type {ShareHost["signedInRequest"]} */
export const signedInRequest = (deps) => bound("signedInRequest")(deps);
/** @type {ShareHost["latestExportFile"]} */
export const latestExportFile = (dir) => bound("latestExportFile")(dir);
export const reviewUploadOrigins = () =>
  host.reviewUploadOrigins ??
  (process.env.HYPERFRAMES_REVIEW_UPLOAD_ORIGINS ?? "").split(",").map((origin) => origin.trim());
/** @type {ShareHost["projectFingerprint"]} */
export const projectFingerprint = (dir) => bound("projectFingerprint")(dir);
/** @type {ShareHost["ffBinary"]} */
export const ffBinary = (name) => bound("ffBinary")(name);
export const channelSite = () => bound("channelSite");
export const signinSites = () => bound("signinSites");

/** @param {string} file @param {string[]} args */
export const runFile = (file, args) =>
  promisify(bound("execFile"))(file, args, { windowsHide: true });
