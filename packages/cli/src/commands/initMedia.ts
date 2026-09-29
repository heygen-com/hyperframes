// The one place `hyperframes init` (and the template-preview script) rewrites media placeholders.
// New templates: an audible <video data-has-audio="true"> on __VIDEO_SRC__ plus an audio-only slot on __AUDIO_SRC__.
// Legacy templates (muted <video> + <audio> both on __VIDEO_SRC__) still come from older remote registry examples.

export interface InitMediaOptions {
  video?: { filename: string; hasAudio: boolean };
  audio?: { filename: string };
  durationSeconds?: number;
}

const VIDEO_SRC = "__VIDEO_SRC__";
const AUDIO_SRC = "__AUDIO_SRC__";
const DURATION = "__VIDEO_DURATION__";

function openTag(tag: "video" | "audio", placeholder: string): string {
  return `<${tag}\\b[^>]*src="${placeholder}"[^>]*>`;
}

// Element with a closing tag first, then a bare open tag — two passes so a bare tag never swallows a later element.
function stripPlaceholder(html: string, tag: "video" | "audio", placeholder: string): string {
  const open = openTag(tag, placeholder);
  return html
    .replace(new RegExp(`${open}[\\s\\S]*?</${tag}>`, "g"), "")
    .replace(new RegExp(open, "g"), "");
}

function setVideoAudio(html: string, hasAudio: boolean): string {
  return html.replace(new RegExp(openTag("video", VIDEO_SRC), "g"), (tag) => {
    const cleaned = tag
      .replace(/\s+muted(?:="[^"]*")?(?=[\s>])/g, "")
      .replace(/\s+data-has-audio="[^"]*"/g, "");
    const attr = hasAudio ? ' data-has-audio="true"' : " muted";
    return cleaned.replace(/\s*>$/, `${attr}>`);
  });
}

export function patchMediaPlaceholders(html: string, opts: InitMediaOptions): string {
  const legacyAudioSlot = new RegExp(openTag("audio", VIDEO_SRC)).test(html);
  let out = html;
  if (opts.video) {
    out = stripPlaceholder(out, "audio", AUDIO_SRC);
    if (legacyAudioSlot) {
      // Legacy split: keep it for a file with sound; a silent file's <audio> fails the render preflight.
      if (!opts.video.hasAudio) out = stripPlaceholder(out, "audio", VIDEO_SRC);
    } else {
      out = setVideoAudio(out, opts.video.hasAudio);
    }
    out = out.replaceAll(VIDEO_SRC, opts.video.filename);
  } else if (opts.audio) {
    out = stripPlaceholder(out, "video", VIDEO_SRC);
    out = out.replaceAll(AUDIO_SRC, opts.audio.filename);
    // Legacy templates carry the audio slot on __VIDEO_SRC__.
    out = out.replaceAll(VIDEO_SRC, opts.audio.filename);
  } else {
    out = stripPlaceholder(out, "video", VIDEO_SRC);
    out = stripPlaceholder(out, "audio", VIDEO_SRC);
    out = stripPlaceholder(out, "audio", AUDIO_SRC);
  }
  const duration = opts.durationSeconds
    ? String(Math.round(opts.durationSeconds * 100) / 100)
    : "10";
  return out.replaceAll(DURATION, duration);
}
