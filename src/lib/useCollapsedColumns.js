"use client";

import { useCallback, useState } from "react";
import { idsToPersist, readCollapsedColumns, writeCollapsedColumns } from "@/lib/collapsedColumns";

// Which columns of one project's board are collapsed. State is held in
// React (so ordinary re-renders and refetches never expand a column) and
// mirrored to localStorage on every toggle. The initial value is read
// synchronously so a refresh renders straight into the saved layout with
// no expand-then-collapse flash; the board only renders after the project
// has loaded on the client, so there is no server markup to mismatch.
export function useCollapsedColumns(projectId) {
  const [state, setState] = useState(() => ({ projectId, ids: new Set(readCollapsedColumns(projectId)) }));

  // Same board component, different project: load that project's saved set.
  let current = state;
  if (state.projectId !== projectId) {
    current = { projectId, ids: new Set(readCollapsedColumns(projectId)) };
    setState(current);
  }

  const isCollapsed = useCallback((columnId) => current.ids.has(columnId), [current]);

  // `existingIds` is the board's current column ids; it is only used to
  // drop ids of deleted columns from what gets saved.
  const toggle = useCallback(
    (columnId, existingIds) => {
      const next = new Set(current.ids);
      const nowCollapsed = !next.has(columnId);
      if (nowCollapsed) next.add(columnId);
      else next.delete(columnId);
      setState({ projectId, ids: next });
      writeCollapsedColumns(projectId, idsToPersist(next, existingIds));
      return nowCollapsed;
    },
    [current, projectId]
  );

  return { isCollapsed, toggle };
}
