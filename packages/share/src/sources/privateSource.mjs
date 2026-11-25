// @ts-check
import {
  isCredentialOrToolStatePath,
  isVcsOrSecretPath,
  projectPathSegments,
} from "@hyperframes/parsers/private-path";

/** @param {string} path */
export const isPrivateSourcePath = (path) =>
  isVcsOrSecretPath(path) || isCredentialOrToolStatePath(path);

/** @param {string} path */
export const privateSourceSpelling = (path) => projectPathSegments(path).join("/");
