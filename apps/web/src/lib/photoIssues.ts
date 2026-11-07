/**
 * Photos that were picked and did not go in, kept until somebody deals with
 * them (client report 2026-11-07: of ten photos picked, nine were saved, and
 * the only word of the tenth was a toast gone in four seconds).
 *
 * Held OUTSIDE the photo component, by the unit it was meant for, because the
 * bench closes the photo dialog and moves on to the next unit: the row in the
 * Units list keeps a red count (`PhotoStackButton`'s `issues`) after the
 * dialog that showed the red tile has gone. Memory only — a refresh starts
 * clean, and a photo that never left this device is not something the server
 * could have kept anyway.
 */
import { useSyncExternalStore } from "react";
import type { PhotoProblem } from "./photoShrink.js";

/** Why a photo is not on the unit: it could not be read, or not saved. */
export type PhotoIssueReason = PhotoProblem | "not-saved";

export interface PhotoIssue {
  readonly id: string;
  /** The picked file's name — what the person can find again. */
  readonly name: string;
  readonly reason: PhotoIssueReason;
  /** The photo, ready to save again — only for `not-saved`. */
  readonly url?: string;
}

const NONE: readonly PhotoIssue[] = [];
let issues = new Map<string, readonly PhotoIssue[]>();
const listeners = new Set<() => void>();
let seq = 0;

function emit(next: Map<string, readonly PhotoIssue[]>): void {
  issues = next;
  for (const l of listeners) l();
}

/** The photos still owed to a unit (or a draft row), oldest first. */
export function photoIssuesOf(key: string): readonly PhotoIssue[] {
  return issues.get(key) ?? NONE;
}

export function addPhotoIssues(
  key: string,
  add: readonly Omit<PhotoIssue, "id">[],
): void {
  if (add.length === 0) return;
  const next = new Map(issues);
  next.set(key, [
    ...photoIssuesOf(key),
    ...add.map((a) => ({ ...a, id: `pi_${++seq}` })),
  ]);
  emit(next);
}

export function dropPhotoIssue(key: string, id: string): void {
  const left = photoIssuesOf(key).filter((i) => i.id !== id);
  if (left.length === photoIssuesOf(key).length) return;
  const next = new Map(issues);
  if (left.length === 0) next.delete(key);
  else next.set(key, left);
  emit(next);
}

/** Forget everything — for tests. */
export function __clearPhotoIssues(): void {
  emit(new Map());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The issues of one unit, re-rendering when they change. */
export function usePhotoIssues(key: string): readonly PhotoIssue[] {
  return useSyncExternalStore(
    subscribe,
    () => photoIssuesOf(key),
    () => NONE,
  );
}
