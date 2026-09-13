/** Cheap silhouette/luminance descriptor: candidate evidence only, never an identity key. */
export async function visualFeatures(base64) {
  const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
  const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
  const c=document.createElement('canvas');c.width=32;c.height=32;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  // Stretch for candidate retrieval; detect transparency inside the image, not letterbox padding.
  ctx.drawImage(bitmap,0,0,32,32);
  const data=ctx.getImageData(0,0,32,32).data;
  let transparent=0;
  for(let i=3;i<data.length;i+=4)if(data[i]<240)transparent++;
  const values=[];
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const i=((y*2)*32+x*2)*4;
    values.push(transparent>128?data[i+3]:(data[i]*.2126+data[i+1]*.7152+data[i+2]*.0722));
  }
  const avg=values.reduce((a,b)=>a+b,0)/values.length;
  let hash='';for(let i=0;i<values.length;i+=4){let n=0;for(let j=0;j<4;j++)n=n*2+(values[i+j]>avg?1:0);hash+=n.toString(16);}
  bitmap.close();
  return /^0+$|^f+$/.test(hash)?undefined:'v1:'+hash;
}
