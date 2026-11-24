import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

export interface ContentIndexCharacterEntry {
  dir: string;
  metadataFiles: string[];
  framedataFiles: string[];
  skillFiles: string[];
  spriteJsonFiles: string[];
}

export interface ContentIndexAssistEntry {
  dir: string;
  metadataFiles: string[];
  framedataFiles: string[];
  spriteJsonFiles: string[];
}

export interface ContentIndex {
  ips: Array<{
    id: string;
    hasManifest: boolean;
    characters: ContentIndexCharacterEntry[];
    assists: ContentIndexAssistEntry[];
  }>;
}

function listJsonFiles(dirPath: string, exclude: Set<string>): string[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((f) => f.isFile() && f.name.endsWith(".json") && !exclude.has(f.name))
    .map((f) => f.name)
    .sort();
}

export function scanContentIndex(rootDir: string, publicReleaseOnly: boolean): ContentIndex {
  const ipRoot = path.join(rootDir, "ip_content");
  const ips: ContentIndex["ips"] = [];
  if (!fs.existsSync(ipRoot)) return { ips };

  const ipDirs = fs
    .readdirSync(ipRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();

  for (const ipName of ipDirs) {
    const ipDir = path.join(ipRoot, ipName);
    const ipJson = path.join(ipDir, "ip.json");
    if (!fs.existsSync(ipJson)) continue;
    if (publicReleaseOnly && !isEntityRedistributable(ipDir)) continue;

    const charsDir = path.join(ipDir, "characters");
    const characters: ContentIndexCharacterEntry[] = [];
    if (fs.existsSync(charsDir)) {
      const cNames = fs
        .readdirSync(charsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
      for (const cName of cNames) {
        const cDir = path.join(charsDir, cName);
        if (!fs.existsSync(path.join(cDir, "character.json"))) continue;
        if (publicReleaseOnly && !isEntityRedistributable(cDir)) continue;
        characters.push({
          dir: cName,
          metadataFiles: listJsonFiles(path.join(cDir, "metadata"), new Set(["sources.json"])),
          framedataFiles: listJsonFiles(path.join(cDir, "framedata"), new Set(["hurtboxes.json"])),
          skillFiles: listJsonFiles(path.join(cDir, "skills"), new Set()),
          spriteJsonFiles: listJsonFiles(path.join(cDir, "sprites"), new Set()),
        });
      }
    }

    const assistsDir = path.join(ipDir, "assists");
    const assists: ContentIndexAssistEntry[] = [];
    if (fs.existsSync(assistsDir)) {
      const aNames = fs
        .readdirSync(assistsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => d.name)
        .sort();
      for (const aName of aNames) {
        const aDir = path.join(assistsDir, aName);
        if (!fs.existsSync(path.join(aDir, "assist.json"))) continue;
        if (publicReleaseOnly && !isEntityRedistributable(aDir)) continue;
        assists.push({
          dir: aName,
          metadataFiles: listJsonFiles(path.join(aDir, "metadata"), new Set(["sources.json"])),
          framedataFiles: listJsonFiles(path.join(aDir, "framedata"), new Set()),
          spriteJsonFiles: listJsonFiles(path.join(aDir, "sprites"), new Set()),
        });
      }
    }

    ips.push({
      id: ipName,
      characters,
      assists,
      hasManifest: fs.existsSync(path.join(ipDir, "roster_manifest.json")),
    });
  }
  return { ips };
}

function isEntityRedistributable(entityDir: string): boolean {
  const metaSources = path.join(entityDir, "metadata", "sources.json");
  const rootSources = path.join(entityDir, "sources.json");
  const target = fs.existsSync(metaSources) ? metaSources : rootSources;
  if (!fs.existsSync(target)) return true;
  try {
    const parsed = JSON.parse(fs.readFileSync(target, "utf-8"));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.every((e: { redistributable?: boolean }) => e.redistributable === true);
  } catch {
    return false;
  }
}

function copyDirFiltered(srcDir: string, destDir: string, skipRawFramesIfSheetExists: boolean): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "__pycache__") continue;
    const sp = path.join(srcDir, entry.name);
    const dp = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (
        skipRawFramesIfSheetExists &&
        entry.name === "animations" &&
        fs.existsSync(path.join(srcDir, "sprites"))
      ) {
        continue;
      }
      copyDirFiltered(sp, dp, false);
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".md")) continue;
      fs.copyFileSync(sp, dp);
    }
  }
}

function crossArenaContentPlugin(): Plugin {
  const rootDir = __dirname;
  const publicReleaseOnly = process.env.PUBLIC_RELEASE === "1";

  const mimeMap: Record<string, string> = {
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
  };

  const serveMiddleware = (
    req: { url?: string },
    res: { setHeader: (k: string, v: string) => void; end: (b?: Buffer | string) => void; statusCode: number },
    next: () => void
  ) => {
    const rawUrl = (req.url ?? "/").split("?")[0];
    if (rawUrl === "/content_index.json") {
      const idx = scanContentIndex(rootDir, publicReleaseOnly);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(idx, null, 2));
      return;
    }
    if (
      rawUrl.startsWith("/ip_content/") ||
      rawUrl === "/combat/combat_config.json" ||
      rawUrl === "/fighter/state_transitions.json"
    ) {
      const safeRel = path.normalize(decodeURIComponent(rawUrl)).replace(/^(\.\.(\/|\\|$))+/, "");
      const filePath = path.join(rootDir, safeRel);
      if (filePath.startsWith(rootDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", mimeMap[ext] ?? "application/octet-stream");
        res.end(fs.readFileSync(filePath));
        return;
      }
    }
    next();
  };

  return {
    name: "cross-arena-content",
    configureServer(server) {
      server.middlewares.use(serveMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveMiddleware);
    },
    closeBundle() {
      const outDir = path.join(rootDir, "dist");
      if (!fs.existsSync(outDir)) return;
      const idx = scanContentIndex(rootDir, publicReleaseOnly);
      fs.writeFileSync(path.join(outDir, "content_index.json"), JSON.stringify(idx, null, 2), "utf-8");

      for (const rel of ["combat/combat_config.json", "fighter/state_transitions.json"]) {
        const sp = path.join(rootDir, rel);
        const dp = path.join(outDir, rel);
        if (fs.existsSync(sp)) {
          fs.mkdirSync(path.dirname(dp), { recursive: true });
          fs.copyFileSync(sp, dp);
        }
      }

      for (const ip of idx.ips) {
        const ipSrc = path.join(rootDir, "ip_content", ip.id);
        const ipDst = path.join(outDir, "ip_content", ip.id);
        fs.mkdirSync(ipDst, { recursive: true });
        for (const rootFile of ["ip.json", "sources.json", "cover.png", "roster_manifest.json"]) {
          const rf = path.join(ipSrc, rootFile);
          if (fs.existsSync(rf)) fs.copyFileSync(rf, path.join(ipDst, rootFile));
        }
        for (const sub of ["effects", "stages", "audio"]) {
          copyDirFiltered(path.join(ipSrc, sub), path.join(ipDst, sub), false);
        }
        for (const cEntry of ip.characters) {
          copyDirFiltered(
            path.join(ipSrc, "characters", cEntry.dir),
            path.join(ipDst, "characters", cEntry.dir),
            true
          );
        }
        for (const aEntry of ip.assists) {
          copyDirFiltered(
            path.join(ipSrc, "assists", aEntry.dir),
            path.join(ipDst, "assists", aEntry.dir),
            true
          );
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [crossArenaContentPlugin()],
  server: {
    host: "127.0.0.1",
    port: 5179,
    strictPort: false,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
