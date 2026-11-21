// A link the CLI prints to one of our sites says it came from the CLI; a link that already names a source keeps it.
const OUR_HOST = /(^|\.)(hyperframes\.studio|hyperframes\.heygen\.com|heygen\.com)$/;

export function cliSourced(url: string): string {
  if (!URL.canParse(url)) return url;
  const parsed = new URL(url);
  if (!OUR_HOST.test(parsed.hostname) || parsed.searchParams.has("utm_source")) return url;
  parsed.searchParams.set("utm_source", "cli");
  return parsed.toString();
}
