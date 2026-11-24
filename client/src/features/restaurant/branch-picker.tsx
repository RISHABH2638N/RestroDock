'use client';

type BranchOption = {branchId:string;label:string};

export function RestaurantBranchPicker({assignments,selected,onChange}:{
  assignments:readonly BranchOption[];
  selected:BranchOption;
  onChange:(branchId:string)=>void;
}){
  return <div className="restaurant-branch-picker">
    <p className="restaurant-branch-label">Restaurant and branch</p>
    <p className="restaurant-branch-name">{selected.label}</p>
    {assignments.length>1&&<label className="access-branch">
      <span className="sr-only">Switch branch</span>
      <select value={selected.branchId} onChange={event=>onChange(event.target.value)}>
        {assignments.map(branch=><option key={branch.branchId} value={branch.branchId}>{branch.label}</option>)}
      </select>
    </label>}
  </div>;
}
