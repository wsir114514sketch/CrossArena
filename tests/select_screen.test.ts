import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { SpriteAssetCache } from "../animation/fighter_renderer";
import { type JsonFetchAdapter, loadContentRegistry } from "../core/data_loader";
import type { ContentRegistry } from "../core/data_models";
import { AudioEngine } from "../ui/audio_engine";
import { type ConfirmedMatchParticipants, SelectScreen } from "../ui/select_screen";
import { scanContentIndex } from "../vite.config";

const ROOT_DIR = path.resolve(__dirname, "..");

const nodeFsAdapter: JsonFetchAdapter = {
  async readJson<T>(urlPath: string): Promise<T> {
    const rel = urlPath.replace(/^\/+/, "");
    return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, rel), "utf-8")) as T;
  },
  async buildIndex() {
    return scanContentIndex(ROOT_DIR, false);
  },
};

let registry: ContentRegistry;

beforeAll(async () => {
  registry = await loadContentRegistry({
    includeTestPacks: false,
    includeLockedIps: false,
    adapter: nodeFsAdapter,
  });
});

describe("Unified Portrait & Assist SelectScreen", () => {
  it("combines regular characters and assists into the same unified grid per IP with distinct kinds", () => {
    const screen = new SelectScreen(registry, new SpriteAssetCache(), new AudioEngine());
    for (const ip of registry.ips) {
      const allTiles = screen.tilesOf(ip.id, "all");
      const charTiles = screen.tilesOf(ip.id, "char");
      const assistTiles = screen.tilesOf(ip.id, "assist");
      expect(charTiles.length).toBeGreaterThan(0);
      expect(assistTiles.length).toBeGreaterThan(0);
      expect(allTiles.length).toBe(charTiles.length + assistTiles.length);
      expect(allTiles.every((t) => t.portraitUrl.endsWith(".png"))).toBe(true);
    }
  });

  it("distinguishes idle -> selected -> confirmed -> reset states and launches match with preserved roles", () => {
    const audio = new AudioEngine();
    audio.muted = true;
    const screen = new SelectScreen(registry, new SpriteAssetCache(), audio);

    let confirmedPayload: ConfirmedMatchParticipants | null = null;
    screen.open(
      "TRAINING",
      (res) => {
        confirmedPayload = res;
      },
      () => {},
    );

    const ip0Tiles = screen.tilesOf(registry.ips[0]!.id, "all");
    const ip1Tiles = screen.tilesOf(registry.ips[1]!.id, "all");
    const p1Char = ip0Tiles.find((t) => t.kind === "char")!;
    const p1Assist = ip0Tiles.find((t) => t.kind === "assist")!;
    const p2Char = ip1Tiles.find((t) => t.kind === "char")!;
    const p2Assist = ip1Tiles.find((t) => t.kind === "assist")!;

    // 1st tap = selected (NOT confirmed)
    expect(screen.tapTile(p1Char, 100)).toBe("selected");
    expect(screen.slots[0].selectedCharId).toBe(p1Char.id);
    expect(screen.slots[0].confirmedCharId).toBeNull();

    // 2nd tap = confirmed
    expect(screen.tapTile(p1Char, 280)).toBe("confirmed");
    expect(screen.slots[0].confirmedCharId).toBe(p1Char.id);

    // Assist: 1st tap = selected, 2nd tap = confirmed -> auto-advances activeSlot to P2 (1)
    expect(screen.tapTile(p1Assist, 400)).toBe("selected");
    expect(screen.slots[0].confirmedAssistId).toBeNull();
    expect(screen.tapTile(p1Assist, 650)).toBe("confirmed");
    expect(screen.slots[0].confirmedAssistId).toBe(p1Assist.id);
    expect(screen.activeSlot).toBe(1);

    // Cancel / reset check on P2 before final confirmation
    screen.tapTile(p2Char, 800);
    screen.resetSlot(1);
    expect(screen.slots[1].selectedCharId).toBeNull();
    expect(screen.slots[1].confirmedCharId).toBeNull();

    // Confirm P2 char + assist -> launches match with distinct fighter vs assist IDs
    screen.tapTile(p2Char, 1000);
    screen.tapTile(p2Char, 1180);
    screen.tapTile(p2Assist, 1300);
    screen.tapTile(p2Assist, 1480);

    expect(confirmedPayload).not.toBeNull();
    expect(confirmedPayload!.p1FighterId).toBe(p1Char.id);
    expect(confirmedPayload!.p1AssistId).toBe(p1Assist.id);
    expect(confirmedPayload!.p2FighterId).toBe(p2Char.id);
    expect(confirmedPayload!.p2AssistId).toBe(p2Assist.id);
  });
});
