import { useState, useRef, useCallback } from "react";
import { Upload } from "lucide-react";
import { uploadProject } from "../api/projects";

interface UploadZoneProps {
  onUploadComplete: (projectId: string) => void;
}

export function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".zip")) {
        setError("Please upload a .zip file");
        return;
      }

      setIsUploading(true);
      setError(null);

      try {
        const name = file.name.replace(/\.zip$/i, "");
        const project = await uploadProject(file, name);
        onUploadComplete(project.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadComplete],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleClick = () => inputRef.current?.click();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={`
        border-2 border-dashed rounded-xl p-12 text-center cursor-pointer
        transition-all duration-200
        ${
          isDragging
            ? "border-blue-400 bg-blue-50"
            : "border-neutral-300 hover:border-neutral-400 bg-white"
        }
        ${isUploading ? "pointer-events-none opacity-60" : ""}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        onChange={handleInputChange}
        className="hidden"
      />
      <Upload className="w-10 h-10 mx-auto mb-4 text-neutral-400" />
      {isUploading ? (
        <p className="text-neutral-600">Uploading...</p>
      ) : (
        <>
          <p className="text-neutral-700 mb-1">
            Drop a ZIP file here, or click to browse
          </p>
          <p className="text-neutral-400 text-sm">
            ZIP must contain an index.html with a GSAP timeline
          </p>
        </>
      )}
      {error && <p className="text-red-500 text-sm mt-3">{error}</p>}
    </div>
  );
}
