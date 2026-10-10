import { normalizeErrorMessage } from "./errorMessage.js";

export const DOCKER_BUILD_TIMEOUT_MINUTES = 10;

interface DockerBuildFailure {
  title: string;
  message: string;
  hint: string;
}

function isSpawnTimeout(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ETIMEDOUT";
}

export function describeDockerBuildFailure(error: unknown): DockerBuildFailure {
  if (error instanceof Error && isSpawnTimeout(error.cause)) {
    return {
      title: "Docker image build timed out",
      message: `Building the render image took longer than ${DOCKER_BUILD_TIMEOUT_MINUTES} minutes, so it was stopped.`,
      hint: "Run the same command again. Docker keeps the layers it already built, so the build picks up where it stopped.",
    };
  }
  const message = normalizeErrorMessage(error);
  if (/connect|not found|ENOENT/i.test(message)) {
    return {
      title: "Docker not available",
      message,
      hint: "Install Docker: https://docs.docker.com/get-docker/",
    };
  }
  return {
    title: "Docker image build failed",
    message,
    hint: "Check Docker is running: docker info",
  };
}
