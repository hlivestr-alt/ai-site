import type { AssetPurpose } from './media-validation';

export const referenceSlots=[
  {id:'FRONT',label:'Front',purpose:'FRONT',video:false},
  {id:'BACK',label:'Back',purpose:'BACK',video:false},
  {id:'SIDE',label:'Side',purpose:'LEFT_SIDE',video:false},
  {id:'PACKAGING',label:'Packaging',purpose:'PACKAGING',video:false},
  {id:'CAP_PUMP',label:'Cap / Pump',purpose:'CAP_PUMP',video:false},
  {id:'TEXTURE',label:'Texture',purpose:'TEXTURE',video:false},
  {id:'REAL_USAGE',label:'Real Usage',purpose:'USAGE_IMAGE',video:true},
  {id:'ADDITIONAL',label:'Additional Reference',purpose:'OTHER',video:true},
] as const;
export type ReferenceSlot=typeof referenceSlots[number]['id'];
export function referenceSlot(purpose:AssetPurpose):ReferenceSlot {
  if(purpose==='LEFT_SIDE'||purpose==='RIGHT_SIDE')return 'SIDE';
  if(purpose==='USAGE_IMAGE'||purpose==='USAGE_VIDEO')return 'REAL_USAGE';
  if(purpose==='PRODUCT_VIDEO'||purpose==='OTHER')return 'ADDITIONAL';
  return purpose;
}
