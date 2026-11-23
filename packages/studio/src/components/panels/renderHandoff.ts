import { RENDER_VARIABLES_FILE } from "@hyperframes/core/project-folders";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";

// One literal word to sh, bash, zsh, fish, PowerShell and cmd.exe, also on cmd's second pass over npx.cmd's arguments.
// No one quoting is safe in all of them, so values go in a file and a path that is not such a word gets no command.
const SHELL_WORD = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

export function renderHandoffCommand(compPath: string): string | null {
  if (!SHELL_WORD.test(compPath)) return null;
  return `npx hyperframes render -c ${compPath} --variables-file ${RENDER_VARIABLES_FILE}`;
}

export async function saveRenderVariables(
  projectId: string,
  values: Record<string, unknown>,
): Promise<boolean> {
  try {
    const response = await studioApiFetch(buildProjectApiPath(projectId, "/render-variables"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    return response.ok;
  } catch {
    return false;
  }
}
