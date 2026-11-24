/**
 * IP-agnostic Content Registry Loader.
 * Works seamlessly in Browser (via Vite `/content_index.json` + `fetch`) and in Node/Vitest (via dynamic fs discovery).
 * Groups multi-form characters by `base_character_id` so UI Layer 2 displays distinct characters and Layer 3 displays forms.
 */

import type {
  AnimationDefinition,
  AssistBundle,
  AssistDefinition,
  CharacterGroup,
  CombatConfig,
  ContentRegistry,
  FighterBundle,
  FighterDefinition,
  FrameData,
  HurtboxProfile,
  IPDefinition,
  RosterManifest,
  SkillDefinition,
  SpriteSheetAtlas,
  StateTransitionsTable,
} from "./data_models";

interface ContentIndexCharacterEntry {
  dir: string;
  metadataFiles: string[];
  framedataFiles: string[];
  skillFiles: string[];
  spriteJsonFiles: string[];
}

interface ContentIndexAssistEntry {
  dir: string;
  metadataFiles: string[];
  framedataFiles: string[];
  spriteJsonFiles: string[];
}

interface ContentIndexIpEntry {
  id: string;
  hasManifest: boolean;
  characters: ContentIndexCharacterEntry[];
  assists: ContentIndexAssistEntry[];
}

interface ContentIndexPayload {
  ips: ContentIndexIpEntry[];
}

export interface JsonFetchAdapter {
  readJson<T>(urlPath: string): Promise<T>;
  buildIndex?(): Promise<ContentIndexPayload>;
}

const browserFetchAdapter: JsonFetchAdapter = {
  async readJson<T>(urlPath: string): Promise<T> {
    const res = await fetch(urlPath);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${urlPath}: HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  },
};

export interface LoadContentOptions {
  includeTestPacks?: boolean;
  includeLockedIps?: boolean;
  adapter?: JsonFetchAdapter;
}

export async function loadContentRegistry(options: LoadContentOptions = {}): Promise<ContentRegistry> {
  const adapter = options.adapter ?? browserFetchAdapter;
  const includeTest = options.includeTestPacks ?? false;
  const includeLocked = options.includeLockedIps ?? false;

  const [combatConfig, stateTransitions, index] = await Promise.all([
    adapter.readJson<CombatConfig>("/combat/combat_config.json"),
    adapter.readJson<StateTransitionsTable>("/fighter/state_transitions.json"),
    adapter.buildIndex ? adapter.buildIndex() : adapter.readJson<ContentIndexPayload>("/content_index.json"),
  ]);

  const ips: IPDefinition[] = [];
  const fightersById: Record<string, FighterBundle> = {};
  const assistsById: Record<string, AssistBundle> = {};
  const groupsByIp: Record<string, CharacterGroup[]> = {};
  const assistsByIp: Record<string, AssistBundle[]> = {};
  const manifestsByIp: Record<string, RosterManifest> = {};

  for (const ipEntry of index.ips) {
    const ipDef = await adapter.readJson<IPDefinition>(`/ip_content/${ipEntry.id}/ip.json`);
    if (ipDef.status === "locked" && !includeLocked) {
      continue;
    }
    if (ipDef.test_only && !includeTest) {
      continue;
    }
    ips.push(ipDef);

    if (ipEntry.hasManifest) {
      manifestsByIp[ipDef.id] = await adapter.readJson<RosterManifest>(
        `/ip_content/${ipEntry.id}/roster_manifest.json`,
      );
    }

    const ipFighters: FighterBundle[] = [];
    for (const cEntry of ipEntry.characters) {
      const charBaseUrl = `/ip_content/${ipEntry.id}/characters/${cEntry.dir}`;
      const fighter = await adapter.readJson<FighterDefinition>(`${charBaseUrl}/character.json`);
      const hurtboxMap = await adapter.readJson<Record<string, HurtboxProfile>>(
        `${charBaseUrl}/framedata/hurtboxes.json`,
      );
      const hurtbox = hurtboxMap[fighter.hurtboxes];
      if (!hurtbox) {
        throw new Error(`Missing hurtbox profile '${fighter.hurtboxes}' for ${fighter.id}`);
      }

      const animations: Record<string, AnimationDefinition> = {};
      await Promise.all(
        cEntry.metadataFiles.map(async (mf) => {
          const anim = await adapter.readJson<AnimationDefinition>(`${charBaseUrl}/metadata/${mf}`);
          animations[anim.animation_id] = anim;
        }),
      );

      const spriteAtlases: Record<string, SpriteSheetAtlas> = {};
      await Promise.all(
        cEntry.spriteJsonFiles.map(async (sf) => {
          const atlas = await adapter.readJson<SpriteSheetAtlas>(`${charBaseUrl}/sprites/${sf}`);
          spriteAtlases[atlas.animation_id] = atlas;
        }),
      );

      const framedata: Record<string, FrameData> = {};
      await Promise.all(
        cEntry.framedataFiles.map(async (ff) => {
          const fd = await adapter.readJson<FrameData>(`${charBaseUrl}/framedata/${ff}`);
          framedata[fd.move_id] = fd;
        }),
      );

      const skills: SkillDefinition[] = [];
      for (const relSkill of fighter.skills) {
        const sk = await adapter.readJson<SkillDefinition>(`${charBaseUrl}/${relSkill}`);
        skills.push(sk);
      }

      const bundle: FighterBundle = {
        ip: ipDef,
        fighter,
        charDirUrl: charBaseUrl,
        hurtbox,
        animations,
        spriteAtlases,
        framedata,
        skills,
      };
      fightersById[fighter.id] = bundle;
      ipFighters.push(bundle);
    }

    // Group characters by base_character_id (preserving featured_characters priority order first)
    const baseBundles = ipFighters.filter((b) => !b.fighter.base_character_id);
    const featuredOrder = new Map<string, number>();
    ipDef.featured_characters.forEach((fid, idx) => featuredOrder.set(fid, idx));
    baseBundles.sort((a, b) => {
      const oa = featuredOrder.get(a.fighter.id) ?? 9999;
      const ob = featuredOrder.get(b.fighter.id) ?? 9999;
      if (oa !== ob) return oa - ob;
      return a.fighter.id.localeCompare(b.fighter.id);
    });

    const groups: CharacterGroup[] = [];
    for (const baseB of baseBundles) {
      const forms: FighterBundle[] = [baseB];
      const declaredForms = baseB.fighter.forms ?? [];
      for (const formId of declaredForms) {
        const fb = fightersById[formId];
        if (fb && !forms.includes(fb)) {
          forms.push(fb);
        }
      }
      for (const other of ipFighters) {
        if (other.fighter.base_character_id === baseB.fighter.id && !forms.includes(other)) {
          forms.push(other);
        }
      }
      groups.push({
        baseId: baseB.fighter.id,
        baseBundle: baseB,
        forms,
      });
    }
    groupsByIp[ipDef.id] = groups;

    // Load IP assists
    const ipAssists: AssistBundle[] = [];
    for (const aEntry of ipEntry.assists) {
      const assistDirUrl = `/ip_content/${ipEntry.id}/assists/${aEntry.dir}`;
      const assist = await adapter.readJson<AssistDefinition>(`${assistDirUrl}/assist.json`);
      const animation = await adapter.readJson<AnimationDefinition>(
        `${assistDirUrl}/metadata/${assist.move_id}.json`,
      );
      const framedata = await adapter.readJson<FrameData>(
        `${assistDirUrl}/framedata/${assist.move_id}.json`,
      );
      let spriteAtlas: SpriteSheetAtlas | undefined;
      if (aEntry.spriteJsonFiles.includes(`${assist.move_id}.json`)) {
        spriteAtlas = await adapter.readJson<SpriteSheetAtlas>(
          `${assistDirUrl}/sprites/${assist.move_id}.json`,
        );
      }
      const ab: AssistBundle = {
        ip: ipDef,
        assist,
        assistDirUrl,
        animation,
        spriteAtlas,
        framedata,
      };
      assistsById[assist.id] = ab;
      ipAssists.push(ab);
    }
    assistsByIp[ipDef.id] = ipAssists;
  }

  return {
    combatConfig,
    stateTransitions,
    ips,
    fightersById,
    assistsById,
    groupsByIp,
    assistsByIp,
    manifestsByIp,
  };
}
