import { useState, useEffect, useCallback } from "react";
import { UploadZone } from "./UploadZone";
import { ProjectList } from "./ProjectList";
import {
  listProjects,
  deleteProject,
  type ProjectMeta,
} from "../api/projects";

export function HomePage() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold text-neutral-900 mb-1">
          Sandbox Studio
        </h1>
        <p className="text-neutral-500 text-sm mb-8">
          Upload a GSAP project ZIP and play it back with video controls.
        </p>

        <div className="mb-10">
          <UploadZone
            onUploadComplete={(projectId) => {
              window.location.hash = `#/project/${projectId}`;
            }}
          />
        </div>

        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider mb-4">
          Projects
        </h2>
        {loading ? (
          <p className="text-neutral-400 text-center py-8">Loading...</p>
        ) : (
          <ProjectList projects={projects} onDelete={handleDelete} />
        )}
      </div>
    </div>
  );
}
