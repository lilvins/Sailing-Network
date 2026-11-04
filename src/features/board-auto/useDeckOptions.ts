import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { getCardsById } from "./autoStore";
import { buildDemoDecks, metaDeckChoices, userDeckChoices, type DeckChoice, type MetaDeckFile } from "./decks";
import { presetDeckChoices } from "./presetDecks";

/** Every deck a seat can pick: presets, meta lists, demo lists, the user's own. */
export function useDeckOptions(): { options: DeckChoice[]; meta: DeckChoice[] } {
  const cards = getCardsById()!;
  const presets = useMemo(() => presetDeckChoices(), []);
  const demoDecks = useMemo(() => buildDemoDecks(cards), [cards]);
  const [mine, setMine] = useState<DeckChoice[]>([]);
  const [meta, setMeta] = useState<DeckChoice[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/data/meta-decks.json")
      .then((r) => (r.ok ? (r.json() as Promise<MetaDeckFile>) : Promise.reject(new Error(String(r.status)))))
      .then((file) => { if (alive) setMeta(metaDeckChoices(file)); })
      .catch(() => {});
    api
      .myDecks()
      .then((r) => { if (alive) setMine(userDeckChoices(r.decks)); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return { options: [...presets, ...meta, ...demoDecks, ...mine], meta };
}
