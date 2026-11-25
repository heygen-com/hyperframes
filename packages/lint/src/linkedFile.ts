import { readProjectFile, type ProjectFileRead } from "@hyperframes/parsers/asset-resolution";
import { isPrivateFileUnder, isStudioPrivatePath } from "@hyperframes/parsers/private-path";

export function readLinkedProjectFile(projectDir: string, path: string): ProjectFileRead {
  if (isPrivateFileUnder(projectDir, path, isStudioPrivatePath)) return { kind: "missing" };
  return readProjectFile(path);
}
