import {identityHash} from './identity';
/** Appearance-specific stable keys. Names and file-local node IDs are not identities. */
export function rejectionKey(item:any):string|null {
  const f=item.features;
  if(f?.geometry&&f.complete)return 'shape:'+identityHash(JSON.stringify([f.geometry,[...(f.palette||[])].sort(),Math.round((f.stroke||0)*10000)/10000]));
  if(item.dataUrl)return 'image:'+identityHash(item.dataUrl);
  return null;
}
export function rejectedPair(a:any,b:any,rules:any[]):boolean {
  const x=rejectionKey(a),y=rejectionKey(b);if(!x||!y)return false;
  return rules.some(r=>(r.a===x&&r.b===y)||(r.a===y&&r.b===x));
}
