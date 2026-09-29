/**
 * The agent's voice and its corrections, from the server rather than the browser.
 *
 * Both of these lived in the mock store until now, and the consequence was
 * concrete: editing the persona here changed what a staff member drafted on
 * this page and did not change one word of what the bot said unattended at 2am,
 * because the worker has no browser and could not see it. Now both read the
 * same rows the worker reads, so what you set here is what customers get.
 *
 * Loaded once and refreshed after a write. There is no polling: unlike the
 * inbox, nothing arrives on its own — a persona only changes when somebody on
 * this page changes it.
 */

import { useCallback, useEffect, useState } from "react";
import {
  activatePersona,
  createPersona,
  listCorrections,
  listPersonas,
  saveCorrection,
  updatePersona,
  type Persona,
  type StoredCorrection,
} from "../lib/chatApi.js";

export interface AgentConfig {
  readonly personas: Persona[];
  readonly corrections: StoredCorrection[];
  /** The live voice. `undefined` until loaded, or if the shop has none yet. */
  readonly active: Persona | undefined;
  readonly loading: boolean;
  /** True when the server could not be reached. The page says so rather than showing an empty list. */
  readonly failed: boolean;
  reload(): Promise<void>;
  save(
    id: string | null,
    body: { name: string; blurb?: string; prompt: string },
  ): Promise<void>;
  activate(id: string): Promise<void>;
  correct(body: {
    messageId?: string;
    original: string;
    corrected: string;
    note?: string;
  }): Promise<void>;
}

export function useAgentConfig(): AgentConfig {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [corrections, setCorrections] = useState<StoredCorrection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([listPersonas(), listCorrections()]);
      setPersonas(p.personas);
      setCorrections(c.corrections);
      setFailed(false);
    } catch {
      // Never blank the list on a failed refresh: a staff member mid-edit
      // should not watch their persona disappear because one request timed out.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (
      id: string | null,
      body: { name: string; blurb?: string; prompt: string },
    ) => {
      if (id) await updatePersona(id, body);
      else await createPersona(body);
      await reload();
    },
    [reload],
  );

  const activate = useCallback(
    async (id: string) => {
      await activatePersona(id);
      await reload();
    },
    [reload],
  );

  const correct = useCallback(
    async (body: {
      messageId?: string;
      original: string;
      corrected: string;
      note?: string;
    }) => {
      await saveCorrection(body);
      await reload();
    },
    [reload],
  );

  return {
    personas,
    corrections,
    active: personas.find((p) => p.active),
    loading,
    failed,
    reload,
    save,
    activate,
    correct,
  };
}
