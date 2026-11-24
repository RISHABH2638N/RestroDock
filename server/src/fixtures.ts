import type { DemoWorkspace } from '@restrodock/contracts';
export const demo:DemoWorkspace = {
  source:'synthetic_fixture', tenant:{name:'Salimar Darbar',slug:'salimar-darbar'}, branch:{name:'Pilot branch'},
  menu:[{name:'Paneer tikka',priceMinor:24000,category:'Starters'},{name:'Dal tadka',priceMinor:16000,category:'Main course'},{name:'Butter naan',priceMinor:4500,category:'Breads'}],
  tables:[{label:'Table 01',seats:4},{label:'Table 02',seats:4},{label:'Table 03',seats:6}]
};
