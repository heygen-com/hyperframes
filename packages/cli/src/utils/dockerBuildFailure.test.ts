import { describe, expect, it } from "vitest";
import { describeDockerBuildFailure } from "./dockerBuildFailure.js";

function spawnError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("describeDockerBuildFailure", () => {
  it("says the build timed out and that a rerun continues from the cached layers", () => {
    const error = new Error("Failed to build Docker image: spawnSync docker ETIMEDOUT", {
      cause: spawnError("spawnSync docker ETIMEDOUT", "ETIMEDOUT"),
    });
    const failure = describeDockerBuildFailure(error);
    expect(failure.title).toBe("Docker image build timed out");
    expect(failure.message).toContain("longer than 10 minutes");
    expect(failure.hint).toContain("Run the same command again");
    expect(failure.hint).not.toContain("docker info");
  });

  it("keeps pointing at the Docker install when the binary is missing", () => {
    const error = new Error("Failed to build Docker image: spawnSync docker ENOENT", {
      cause: spawnError("spawnSync docker ENOENT", "ENOENT"),
    });
    expect(describeDockerBuildFailure(error)).toEqual({
      title: "Docker not available",
      message: "Failed to build Docker image: spawnSync docker ENOENT",
      hint: "Install Docker: https://docs.docker.com/get-docker/",
    });
  });

  it("keeps the docker info hint for any other build failure", () => {
    const error = new Error("Failed to build Docker image: Command failed: docker build", {
      cause: spawnError("Command failed: docker build", "1"),
    });
    expect(describeDockerBuildFailure(error)).toEqual({
      title: "Docker image build failed",
      message: "Failed to build Docker image: Command failed: docker build",
      hint: "Check Docker is running: docker info",
    });
  });
});
