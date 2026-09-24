"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getProject, saveProject, storageError } from "@/lib/storage/projects";
import type { Project } from "@/types/project";

export function useProject(id: string) {
  const [project, setProject] = useState<Project>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const current = useRef<Project | undefined>(undefined);
  const persisted = useRef<Project | undefined>(undefined);
  const pending = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    let active = true;
    getProject(id)
      .then((value) => {
        if (!active) return;
        current.current = persisted.current = value;
        setProject(value);
        setLoading(false);
      })
      .catch((err) => {
        if (active) {
          setError(storageError(err));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  const flush = useCallback((): Promise<boolean> => {
    if (pending.current) return pending.current;
    const operation = async () => {
      try {
        while (current.current && current.current !== persisted.current) {
          setStatus("saving");
          const snapshot = current.current;
          const saved = await saveProject(
            snapshot,
            persisted.current?.revision ?? null,
          );
          persisted.current = saved;
          if (current.current === snapshot) {
            current.current = saved;
            setProject(saved);
          }
        }
        setError("");
        setStatus("saved");
        return true;
      } catch (err) {
        setError(storageError(err));
        setStatus("error");
        return false;
      }
    };
    pending.current = operation().finally(() => {
      pending.current = null;
    });
    return pending.current;
  }, []);

  const update = useCallback(
    (change: (value: Project) => Project) => {
      if (!current.current) return;
      const next = {
        ...change(current.current),
        updatedAt: new Date().toISOString(),
      };
      // Input edits invalidate both the derived records and previous confirmation.
      if (
        next.sources !== current.current.sources ||
        next.ownBrandName !== current.current.ownBrandName ||
        next.name !== current.current.name ||
        next.researchGoal !== current.current.researchGoal ||
        next.customGoal !== current.current.customGoal
      ) {
        delete next.preview;
      }
      current.current = next;
      setProject(next);
      void flush();
    },
    [flush],
  );

  useEffect(() => {
    const onLeave = (event: BeforeUnloadEvent) => {
      if (current.current !== persisted.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  return { project, loading, error, status, update, flush };
}
