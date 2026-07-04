import { useGenerateVideo } from "../lib/hooks";

export function GenerateVideoButton({
  postId,
  onGenerated,
}: {
  postId: number;
  onGenerated: () => void;
}) {
  const { isGenerating, result, handleGenerateVideo } = useGenerateVideo(postId, onGenerated);

  return (
    <>
      <button type="button" onClick={handleGenerateVideo} disabled={isGenerating}>
        {isGenerating ? "生成中…" : "立即生成视频"}
      </button>
      {result && (
        <div style={{ color: result.ok ? "#16a34a" : "crimson", fontSize: "13px", width: "100%" }}>
          {result.message}
        </div>
      )}
    </>
  );
}
