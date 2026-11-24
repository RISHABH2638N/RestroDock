'use client';
import {useState} from 'react';

export function useBranchSelection(assignments:readonly {branchId:string}[], restaurantAccount?:string){
  const storageKey = restaurantAccount ? `restrodock:branch:${restaurantAccount}` : undefined;
  const [selected, setSelected] = useState(() => {
    if(storageKey){
      try {
        const saved = window.sessionStorage.getItem(storageKey);
        if(saved && assignments.some(assignment => assignment.branchId === saved))return saved;
      } catch { /* Branch selection is still usable when storage is unavailable. */ }
    }
    return assignments[0]?.branchId ?? '';
  });

  function selectBranch(branchId:string){
    setSelected(branchId);
    if(storageKey){
      try { window.sessionStorage.setItem(storageKey,branchId); }
      catch { /* Keep the current page usable with storage blocked. */ }
    }
  }

  return [selected,selectBranch] as const;
}
