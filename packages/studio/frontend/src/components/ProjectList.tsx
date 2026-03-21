import { Trash2, Play } from "lucide-react";
import type { ProjectMeta } from "../api/projects";

interface ProjectListProps {
  projects: ProjectMeta[];
  onDelete: (id: string) => void;
}

export function ProjectList({ projects, onDelete }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <p className="text-neutral-400 text-center py-8">
        No projects yet. Upload a ZIP to get started.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map((project) => (
        <div
          key={project.id}
          className="bg-white border border-neutral-200 rounded-xl overflow-hidden group hover:shadow-md transition-shadow"
        >
          {/* Thumbnail area */}
          <a
            href={`#/project/${project.id}`}
            className="block aspect-video bg-neutral-900 relative no-underline"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
              </div>
            </div>
          </a>
          {/* Info */}
          <div className="p-3 flex items-start gap-2">
            <a
              href={`#/project/${project.id}`}
              className="flex-1 no-underline min-w-0"
            >
              <h3 className="text-neutral-900 text-sm font-medium truncate">
                {project.name}
              </h3>
              <p className="text-neutral-400 text-xs mt-0.5">
                {new Date(project.createdAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(project.id);
              }}
              className="text-neutral-300 hover:text-red-500 transition-colors p-1 flex-shrink-0"
              title="Delete project"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
