import { type Dispatch, type SetStateAction, useCallback, useState } from 'react';

type PanelState<T> = { mode: 'new' | 'edit'; row?: T } | null;

interface UseAdminListPanelReturn<T extends { id: string }> {
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  panel: PanelState<T>;
  draft: Partial<T>;
  setDraft: (patch: Partial<T>) => void;
  patchDraft: (patch: Partial<T>) => void;
  deleteTarget: T | null;

  openNew: (defaults: Partial<T>) => void;
  openEdit: (row: T) => void;
  closePanel: () => void;

  saveNew: (item: T) => void;
  saveEdit: (id: string, patch: Partial<T>) => void;

  requestDelete: (row: T) => void;
  confirmDelete: () => void;
  cancelDelete: () => void;
}

/**
 * Admin liste sayfaları için generic panel/taslak/silme durumu (UA kalıbı).
 * Yerel dizi üzerinde ekleme/düzenleme/silme yapar; API çağrısı çağıranın işidir.
 */
export function useAdminListPanel<T extends { id: string }>(initialItems: T[]): UseAdminListPanelReturn<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [panel, setPanel] = useState<PanelState<T>>(null);
  const [draft, setDraftState] = useState<Partial<T>>({});
  const [deleteTarget, setDeleteTarget] = useState<T | null>(null);

  const setDraft = useCallback((patch: Partial<T>) => {
    setDraftState(patch);
  }, []);

  const patchDraft = useCallback((patch: Partial<T>) => {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }, []);

  const openNew = useCallback((defaults: Partial<T>) => {
    setDraftState(defaults);
    setPanel({ mode: 'new' });
  }, []);

  const openEdit = useCallback((row: T) => {
    setDraftState({ ...row });
    setPanel({ mode: 'edit', row });
  }, []);

  const closePanel = useCallback(() => {
    setPanel(null);
    setDraftState({});
  }, []);

  const saveNew = useCallback((item: T) => {
    setItems((prev) => [item, ...prev]);
    setPanel(null);
    setDraftState({});
  }, []);

  const saveEdit = useCallback((id: string, patch: Partial<T>) => {
    setItems((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setPanel(null);
    setDraftState({});
  }, []);

  const requestDelete = useCallback((row: T) => {
    setDeleteTarget(row);
  }, []);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    setItems((prev) => prev.filter((row) => row.id !== deleteTarget.id));
    setDeleteTarget(null);
    setPanel((prev) => {
      if (prev?.row && prev.row.id === deleteTarget.id) return null;
      return prev;
    });
  }, [deleteTarget]);

  const cancelDelete = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  return {
    items,
    setItems,
    panel,
    draft,
    setDraft,
    patchDraft,
    deleteTarget,
    openNew,
    openEdit,
    closePanel,
    saveNew,
    saveEdit,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
