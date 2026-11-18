import { findStartTags } from "@hyperframes/core/compiler/html-document";
import { parseHTML } from "linkedom";

const OTHER_HOST = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

const isOtherHost = (el: Element) => OTHER_HOST.test(el.getAttribute("src")?.trim() ?? "");

const isProjectVideo = (video: Element) =>
  !video.hasAttribute("crossorigin") &&
  !isOtherHost(video) &&
  ![...video.querySelectorAll("source")].some(isOtherHost);

/** An opaque capture page reads a video's pixels (color grading, shader textures) only from a CORS load. */
export function corsProjectVideos(html: string): string {
  const tags = findStartTags(html, "video");
  if (tags.length === 0) return html;
  const videos = [...parseHTML(html).document.querySelectorAll("video")];
  if (tags.length !== videos.length) return html;
  const parts: string[] = [];
  let from = 0;
  videos.forEach((video, i) => {
    if (!isProjectVideo(video)) return;
    const at = (tags[i] ?? 0) + "<video".length;
    parts.push(html.slice(from, at), ' crossorigin="anonymous"');
    from = at;
  });
  parts.push(html.slice(from));
  return parts.join("");
}
