import { describe, expect, it } from "vitest";
import { isMissingPackageError, missingPackageMessage } from "./missingPackage.js";

const notFound = (message: string) =>
  Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });

describe("isMissingPackageError", () => {
  it("is true when the package itself is absent", () => {
    const err = notFound("Cannot find package '@hyperframes/aws-lambda' imported from /app/cli.js");
    expect(isMissingPackageError(err, "@hyperframes/aws-lambda")).toBe(true);
  });

  it("is false when an installed package is missing one of its own dependencies", () => {
    const err = notFound(
      "Cannot find package 'google-auth-library' imported from /app/node_modules/@hyperframes/gcp-cloud-run/dist/sdk.js",
    );
    expect(isMissingPackageError(err, "@hyperframes/gcp-cloud-run")).toBe(false);
  });

  it("is false for other error codes", () => {
    const err = Object.assign(new Error("Cannot find package '@hyperframes/aws-lambda'"), {
      code: "ERR_UNKNOWN_FILE_EXTENSION",
    });
    expect(isMissingPackageError(err, "@hyperframes/aws-lambda")).toBe(false);
  });
});

describe("missingPackageMessage", () => {
  it("names the command and both install commands", () => {
    const message = missingPackageMessage("@hyperframes/aws-lambda", "hyperframes lambda deploy");
    expect(message).toContain("hyperframes lambda deploy");
    expect(message).toContain("npm install -g @hyperframes/aws-lambda");
    expect(message).toContain("npm install @hyperframes/aws-lambda");
  });
});
