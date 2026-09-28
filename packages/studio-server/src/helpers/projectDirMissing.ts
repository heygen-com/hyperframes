export const projectDirMissing = (c: {
  json: (data: { error: string; why: string }, status: 404) => Response;
}) => c.json({ error: "not found", why: "project_dir_missing" }, 404);
