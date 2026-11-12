import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdmZip from "adm-zip";
import { buildPublishFileMap, createPublishArchive, stagePublishFiles } from "./publishProject.js";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-abs-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A project whose index.html is `html(external, project)`, beside a folder holding song.mp3. */
function stage(html: (external: string, project: string) => string) {
  const project = temp();
  const external = temp();
  writeFileSync(join(external, "song.mp3"), "audio");
  mkdirSync(join(project, "media"));
  writeFileSync(join(project, "media", "inside.mp3"), "audio");
  writeFileSync(join(project, "index.html"), html(external, project));
  const files = stagePublishFiles(project, Infinity);
  const index = files.get("index.html")!.toString("utf-8");
  return { files, index, external };
}

describe("a media file referenced by its filesystem path", () => {
  it("outside the project is archived under _ext and the reference points at it", () => {
    const { files, index, external } = stage(
      (ext) => `<html><audio id="music" src="${join(ext, "song.mp3")}"></audio></html>`,
    );
    expect([...files.keys()].filter((key) => key.startsWith("_ext/"))).toHaveLength(1);
    expect(index).toMatch(/src="_ext\/[^"]*song\.mp3"/);
    expect(index).not.toContain(external);
  });

  it("inside the project is rewritten to its path in the archive", () => {
    const { files, index } = stage(
      (_ext, project) =>
        `<html><audio id="music" src="${join(project, "media/inside.mp3")}"></audio></html>`,
    );
    expect(files.has("media/inside.mp3")).toBe(true);
    expect(index).toContain('src="media/inside.mp3"');
  });

  it("keeps its #fragment and ?query after the archive path", () => {
    const inside = stage(
      (_ext, project) =>
        `<html><audio id="a" src="${join(project, "media/inside.mp3")}#t=1"></audio></html>`,
    );
    expect(inside.index).toContain('src="media/inside.mp3#t=1"');
    const outside = stage(
      (ext) => `<html><audio id="a" src="${join(ext, "song.mp3")}?v=2"></audio></html>`,
    );
    expect(outside.index).toMatch(/src="_ext\/[^"]*song\.mp3\?v=2"/);
  });

  it("that does not exist is left as written, like any root-relative URL", () => {
    const { index } = stage(() => `<html><img src="/assets/none.png"></html>`);
    expect(index).toContain('src="/assets/none.png"');
  });
});

describe("an env file outside the project", () => {
  it("is not archived, whether named by its path or by a relative reference", () => {
    const project = temp();
    const external = temp();
    writeFileSync(join(external, ".env"), "SECRET=1");
    writeFileSync(join(external, ".env.production"), "SECRET=1");
    writeFileSync(join(external, "song.mp3"), "audio");
    const sibling = `../${basename(external)}`;
    writeFileSync(
      join(project, "index.html"),
      `<link href="${join(external, ".env")}"><link href="${sibling}/.env.production">` +
        `<audio src="${sibling}/song.mp3"></audio>`,
    );
    const keys = [...stagePublishFiles(project, Infinity).keys()];
    expect(keys.filter((key) => key.startsWith("_ext/"))).toEqual([
      expect.stringMatching(/song\.mp3$/),
    ]);
  });
});

describe("a reference to a file outside the project in a private location", () => {
  /** Writes `files` under a fresh folder, stages `<root>/<projectPath>`, and collects the warnings. */
  function stageIn(projectPath: string, files: Record<string, string>) {
    const root = temp();
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), body.replaceAll("<root>", root));
    }
    const warnings: string[] = [];
    const staged = stagePublishFiles(join(root, projectPath), Infinity, (w) => warnings.push(w));
    const ext = [...staged.keys()].filter((key) => key.startsWith("_ext/"));
    return { root, warnings, ext };
  }

  it("leaves out a ../ reference into a hidden folder and names the file and reference", () => {
    const { warnings, ext } = stageIn("p", {
      ".ssh/id_ed25519": "KEY",
      "p/index.html": "<html></html>",
      "p/compositions/intro.html": `<img src="../../.ssh/id_ed25519"><img src="../../.ssh/id_ed25519">`,
    });
    expect(ext).toEqual([]);
    expect(warnings).toEqual([
      "compositions/intro.html references ../../.ssh/id_ed25519, which is outside the project in a private location; it was left out of the upload.",
    ]);
  });

  it("leaves out an absolute reference under a hidden folder", () => {
    const { root, warnings, ext } = stageIn("p", {
      ".aws/credentials": "KEY",
      "p/index.html": `<link href="<root>/.aws/credentials">`,
    });
    expect(ext).toEqual([]);
    expect(warnings).toEqual([
      `index.html references ${root}/.aws/credentials, which is outside the project in a private location; it was left out of the upload.`,
    ]);
  });

  it("leaves out an ordinary-looking outside file that links into a hidden folder", () => {
    const root = temp();
    mkdirSync(join(root, ".aws"));
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, ".aws", "credentials"), "KEY");
    symlinkSync(join(root, ".aws", "credentials"), join(root, "link.png"));
    writeFileSync(join(root, "p", "index.html"), `<img src="../link.png">`);
    const warnings: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (w) => warnings.push(w));
    expect([...staged.keys()].some((key) => key.startsWith("_ext/"))).toBe(false);
    expect(warnings).toEqual([expect.stringMatching(/^index\.html references \.\.\/link\.png,/)]);
  });

  it.skipIf(process.platform === "win32")("leaves out a file under /etc", () => {
    const { warnings, ext } = stageIn("p", { "p/index.html": `<link href="/etc/hosts">` });
    expect(ext).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("warns when it leaves out an env file outside the project", () => {
    const { warnings, ext } = stageIn("p", {
      "shared/.env.production": "SECRET=1",
      "p/index.html": `<link href="../shared/.env.production">`,
    });
    expect(ext).toEqual([]);
    expect(warnings).toEqual([
      expect.stringMatching(/^index\.html references \.\.\/shared\/\.env\.production,/),
    ]);
  });

  it("still copies an ordinary outside file, without a warning", () => {
    const { warnings, ext } = stageIn("p", {
      "shared/logo.png": "png",
      "p/index.html": `<img src="../shared/logo.png">`,
    });
    expect(ext).toEqual(["_ext/shared/logo.png"]);
    expect(warnings).toEqual([]);
  });

  it("does not count hidden folders the project itself sits in", () => {
    const { warnings, ext } = stageIn(".work/p", {
      ".work/shared/logo.png": "png",
      ".work/p/index.html": `<img src="../shared/logo.png">`,
    });
    expect(ext).toEqual(["_ext/shared/logo.png"]);
    expect(warnings).toEqual([]);
  });

  it("keeps a referenced file under a hidden folder inside the project, without a warning", () => {
    const root = temp();
    mkdirSync(join(root, ".media"));
    writeFileSync(join(root, ".media", "clip.mp4"), "v");
    writeFileSync(join(root, "index.html"), `<video src=".media/clip.mp4"></video>`);
    const warnings: string[] = [];
    const staged = stagePublishFiles(root, Infinity, (w) => warnings.push(w));
    expect(staged.has(".media/clip.mp4")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("leaves out a project file that links to a private file outside the project", () => {
    const root = temp();
    mkdirSync(join(root, ".ssh"));
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, ".ssh", "id_ed25519"), "KEY");
    symlinkSync(join(root, ".ssh", "id_ed25519"), join(root, "p", "logo.png"));
    writeFileSync(join(root, "p", "index.html"), "<html></html>");
    const warnings: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (w) => warnings.push(w));
    expect([...staged.keys()]).toEqual(["index.html"]);
    expect(warnings).toEqual([
      "logo.png links to a file outside the project in a private location; it was left out of the upload.",
    ]);
  });

  it("leaves out a referenced project file that links to a private file outside the project", () => {
    const root = temp();
    mkdirSync(join(root, ".ssh"));
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, ".ssh", "id_ed25519"), "KEY");
    symlinkSync(join(root, ".ssh", "id_ed25519"), join(root, "p", "logo.png"));
    writeFileSync(join(root, "p", "index.html"), `<img src="logo.png"><img src="./logo.png">`);
    const warnings: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (w) => warnings.push(w));
    expect([...staged.keys()]).toEqual(["index.html"]);
    expect(warnings).toEqual([
      "logo.png links to a file outside the project in a private location; it was left out of the upload.",
    ]);
  });

  it("still uploads a project file that links to an ordinary file outside the project", () => {
    const root = temp();
    mkdirSync(join(root, "shared"));
    mkdirSync(join(root, "p"));
    writeFileSync(join(root, "shared", "logo.png"), "png");
    symlinkSync(join(root, "shared", "logo.png"), join(root, "p", "logo.png"));
    writeFileSync(join(root, "p", "index.html"), "<html></html>");
    const warnings: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (w) => warnings.push(w));
    expect([...staged.keys()].sort()).toEqual(["index.html", "logo.png"]);
    expect(warnings).toEqual([]);
  });

  it("leaves out references into the home AppData and Library, but not iCloud Drive", () => {
    const home = temp();
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      const files = [
        "AppData/Roaming/token.json",
        "Library/Cookies/c.binarycookies",
        "Library/Mobile Documents/shared/logo.png",
      ];
      for (const file of files) {
        mkdirSync(dirname(join(home, file)), { recursive: true });
        writeFileSync(join(home, file), "x");
      }
      const project = temp();
      writeFileSync(
        join(project, "index.html"),
        files.map((file) => `<img src="${join(home, file)}">`).join(""),
      );
      const warnings: string[] = [];
      const staged = stagePublishFiles(project, Infinity, (w) => warnings.push(w));
      const ext = [...staged.keys()].filter((key) => key.startsWith("_ext/"));
      expect(ext).toEqual([expect.stringMatching(/Mobile Documents\/shared\/logo\.png$/)]);
      expect(warnings).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still copies outside assets for a project that itself sits in the home AppData", () => {
    const home = temp();
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      const temps = join(home, "AppData", "Local", "Temp");
      mkdirSync(join(temps, "shared"), { recursive: true });
      mkdirSync(join(temps, "p"));
      writeFileSync(join(temps, "shared", "logo.png"), "png");
      writeFileSync(join(temps, "p", "index.html"), `<img src="../shared/logo.png">`);
      const warnings: string[] = [];
      const staged = stagePublishFiles(join(temps, "p"), Infinity, (w) => warnings.push(w));
      expect([...staged.keys()].filter((key) => key.startsWith("_ext/"))).toEqual([
        "_ext/shared/logo.png",
      ]);
      expect(warnings).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("leaves out a Library file referenced by a project on iCloud Drive", () => {
    const home = temp();
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      const drive = join(home, "Library", "Mobile Documents", "com~apple~CloudDocs");
      const token = join(home, "Library", "Application Support", "app", "token.json");
      mkdirSync(join(drive, "p"), { recursive: true });
      mkdirSync(dirname(token), { recursive: true });
      writeFileSync(token, "KEY");
      writeFileSync(join(drive, "p", "index.html"), `<img src="${token}">`);
      const warnings: string[] = [];
      const staged = stagePublishFiles(join(drive, "p"), Infinity, (w) => warnings.push(w));
      expect([...staged.keys()].some((key) => key.startsWith("_ext/"))).toBe(false);
      expect(warnings).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("treats Library/CloudStorage like iCloud Drive, in both directions", () => {
    const home = temp();
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      const dropbox = join(home, "Library", "CloudStorage", "Dropbox");
      const token = join(home, "Library", "Application Support", "app", "token.json");
      const logo = join(dropbox, "shared", "logo.png");
      for (const file of [token, logo]) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "x");
      }
      mkdirSync(join(dropbox, "p"));
      writeFileSync(join(dropbox, "p", "index.html"), `<img src="${token}">`);
      const inDrive: string[] = [];
      const fromDrive = stagePublishFiles(join(dropbox, "p"), Infinity, (w) => inDrive.push(w));
      expect([...fromDrive.keys()].some((key) => key.startsWith("_ext/"))).toBe(false);
      expect(inDrive).toHaveLength(1);

      const project = temp();
      writeFileSync(join(project, "index.html"), `<img src="${logo}">`);
      const outside: string[] = [];
      const toDrive = stagePublishFiles(project, Infinity, (w) => outside.push(w));
      expect([...toDrive.keys()].filter((key) => key.startsWith("_ext/"))).toHaveLength(1);
      expect(outside).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("still copies a sibling asset folder named library or AppData outside the home folder", () => {
    const { ext, warnings } = stageIn("p", {
      "library/logo.png": "png",
      "AppData/clip.png": "png",
      "p/index.html": `<img src="../library/logo.png"><img src="../AppData/clip.png">`,
    });
    expect(ext.sort()).toEqual(["_ext/AppData/clip.png", "_ext/library/logo.png"]);
    expect(warnings).toEqual([]);
  });

  it("says nothing about a reference into a hidden folder that does not exist", () => {
    const { warnings } = stageIn("p", { "p/index.html": `<a href="../.nothing/here.png">x</a>` });
    expect(warnings).toEqual([]);
  });
});

describe("outside references in files that came in with an imported project", () => {
  /** A project `p` beside `shared/logo.png`; `received` lists project files as the desktop app records them. */
  function stageReceived(files: Record<string, string>, received: unknown) {
    const root = temp();
    mkdirSync(join(root, "shared"));
    writeFileSync(join(root, "shared", "logo.png"), "png");
    mkdirSync(join(root, "p", ".hyperframes"), { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, "p", name)), { recursive: true });
      writeFileSync(join(root, "p", name), body.replaceAll("<root>", root));
    }
    writeFileSync(
      join(root, "p", ".hyperframes", "received-files.json"),
      typeof received === "string" ? received : JSON.stringify(received),
    );
    const warnings: string[] = [];
    const staged = stagePublishFiles(join(root, "p"), Infinity, (w) => warnings.push(w));
    const ext = [...staged.keys()].filter((key) => key.startsWith("_ext/"));
    return { root, staged, warnings, ext };
  }

  it("leaves out ../, absolute and percent-encoded spellings, and names the file and reference", () => {
    const { root, warnings, ext } = stageReceived(
      {
        "index.html": `<img src="../shared/logo.png"><img src="<root>/shared/logo.png">`,
        "scenes/a.html": `<img srcset="%2e%2e/%2e%2e/shared/logo.png 1x">`,
        "style.css": `body { background: url("../shared/logo.png"); }`,
      },
      { files: ["index.html", "scenes/a.html", "style.css"] },
    );
    expect(ext).toEqual([]);
    expect(warnings.sort()).toEqual(
      [
        `index.html references ${root}/shared/logo.png, which leads outside the project and came in with an imported project; it was left out of the upload.`,
        "index.html references ../shared/logo.png, which leads outside the project and came in with an imported project; it was left out of the upload.",
        "scenes/a.html references %2e%2e/%2e%2e/shared/logo.png, which leads outside the project and came in with an imported project; it was left out of the upload.",
        "style.css references ../shared/logo.png, which leads outside the project and came in with an imported project; it was left out of the upload.",
      ].sort(),
    );
  });

  it("still copies the same reference from a file the person wrote", () => {
    const { ext, warnings } = stageReceived(
      {
        "index.html": `<img src="../shared/logo.png">`,
        "mine.html": `<img src="../shared/logo.png">`,
      },
      { files: ["index.html"] },
    );
    expect(ext).toEqual(["_ext/shared/logo.png"]);
    expect(warnings).toHaveLength(1);
  });

  it("is left out of publish's file map and feedback's repro archive, with the warning", () => {
    const { root } = stageReceived(
      { "index.html": `<img src="../shared/logo.png">` },
      { files: ["index.html"] },
    );
    const published: string[] = [];
    const map = buildPublishFileMap(join(root, "p"), (w) => published.push(w));
    const repro: string[] = [];
    const zip = new AdmZip(createPublishArchive(join(root, "p"), (w) => repro.push(w)).buffer);
    expect([...map.keys()]).toEqual(["index.html"]);
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual(["index.html"]);
    expect(published).toEqual([
      expect.stringMatching(/^index\.html references \.\.\/shared\/logo\.png,/),
    ]);
    expect(repro).toEqual(published);
  });

  it("never reads a file: URL", () => {
    const { staged, ext } = stageReceived(
      { "index.html": `<img src="file://<root>/shared/logo.png">` },
      { files: ["index.html"] },
    );
    expect(ext).toEqual([]);
    expect(staged.get("index.html")!.toString()).toContain("file://");
  });

  it("treats every file as received when the record cannot be read", () => {
    const { ext, warnings } = stageReceived(
      { "index.html": `<img src="../shared/logo.png">` },
      "{not json",
    );
    expect(ext).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")(
    "leaves out a received link that leads outside, and a reference through a linked folder",
    () => {
      const root = temp();
      mkdirSync(join(root, "shared"));
      writeFileSync(join(root, "shared", "logo.png"), "png");
      mkdirSync(join(root, "p", ".hyperframes"), { recursive: true });
      symlinkSync(join(root, "shared", "logo.png"), join(root, "p", "logo.png"));
      symlinkSync(join(root, "shared"), join(root, "p", "linked"));
      writeFileSync(join(root, "p", "index.html"), `<img src="linked/logo.png">`);
      writeFileSync(
        join(root, "p", ".hyperframes", "received-files.json"),
        JSON.stringify({ files: ["index.html", "logo.png"] }),
      );
      const warnings: string[] = [];
      const staged = stagePublishFiles(join(root, "p"), Infinity, (w) => warnings.push(w));
      expect([...staged.keys()]).toEqual(["index.html"]);
      expect(warnings.sort()).toEqual([
        "index.html references linked/logo.png, which leads outside the project and came in with an imported project; it was left out of the upload.",
        "logo.png links to a file outside the project and came in with an imported project; it was left out of the upload.",
      ]);
    },
  );
});

describe("a project inside a hidden or app-data folder", () => {
  /** Stages `<home>/<project>` whose index.html refers to `<home>/<secret>` by `spell(secret, project)`. */
  function reach(project: string, secret: string, spell: (abs: string, rel: string) => string) {
    const home = temp();
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    try {
      const projectDir = join(home, project);
      const secretPath = join(home, secret);
      mkdirSync(projectDir, { recursive: true });
      mkdirSync(dirname(secretPath), { recursive: true });
      writeFileSync(secretPath, "KEY");
      symlinkSync(dirname(secretPath), join(home, "alias"));
      const rel = relative(projectDir, secretPath).replaceAll("\\", "/");
      writeFileSync(
        join(projectDir, "index.html"),
        `<link href="${spell(secretPath, rel).replace("<alias>", join(home, "alias"))}">`,
      );
      const warnings: string[] = [];
      const staged = stagePublishFiles(projectDir, Infinity, (w) => warnings.push(w));
      return { ext: [...staged.keys()].filter((key) => key.startsWith("_ext/")), warnings };
    } finally {
      vi.unstubAllEnvs();
    }
  }

  const cases: [string, string][] = [
    [".tool/worktrees/x/p", ".tool/auth.json"],
    ["AppData/Local/Temp/p", "AppData/Roaming/app/token.json"],
    ["Library/Application Support/app/p", "Library/Cookies/Cookies.binarycookies"],
  ];
  const spellings: [string, (abs: string, rel: string) => string][] = [
    ["a ../ chain", (_abs, rel) => rel],
    ["an absolute path", (abs) => abs],
    ["a percent-encoded chain", (_abs, rel) => rel.replaceAll(".", "%2e").replaceAll(" ", "%20")],
    ["a linked spelling", (abs) => `<alias>/${basename(abs)}`],
  ];
  for (const [project, secret] of cases) {
    for (const [name, spell] of spellings) {
      it.skipIf(process.platform === "win32")(
        `leaves out ${secret} from ${project}, written as ${name}`,
        () => {
          const { ext, warnings } = reach(project, secret, spell);
          expect(ext).toEqual([]);
          expect(warnings).toHaveLength(1);
        },
      );
    }
  }
});
