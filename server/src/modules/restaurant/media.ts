import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {HttpError} from '../auth/session.js';
export const imageInputLimit=2*1024*1024;
export const imageOutputLimit=300*1024;
let active=0;
export async function sanitizeImage(input:Buffer,mime:string) {
 if(input.length>imageInputLimit)throw new HttpError(413,'IMAGE_TOO_LARGE','Choose a JPEG, PNG or WebP image no larger than 2 MiB.');
 const jpeg=input.subarray(0,3).equals(Buffer.from([255,216,255]));
 const png=input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const webp=input.subarray(0,4).toString()==='RIFF'&&input.subarray(8,12).toString()==='WEBP';
 const expected=jpeg?'image/jpeg':png?'image/png':webp?'image/webp':null;
 if(!expected||mime!==expected)throw new HttpError(415,'IMAGE_TYPE','Use an actual JPEG, PNG or WebP image with its matching content type. SVG and animated images are not accepted.');
 if(active>=2)throw new HttpError(503,'IMAGE_BUSY','Image processing is busy. Try again shortly.');
 active++;
 try{
  const image=sharp(input,{failOn:'warning',limitInputPixels:16000000,animated:false});
  const metadata=await image.metadata();
  if((metadata.pages??1)>1)throw new Error('Animated image');
  const {data,info}=await image.rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer({resolveWithObject:true});
  if(data.length>imageOutputLimit)throw new HttpError(422,'IMAGE_OUTPUT_TOO_LARGE','The processed image is too large. Choose a smaller or simpler image.');
  return {bytes:new Uint8Array(data),width:info.width,height:info.height,sha256:createHash('sha256').update(data).digest('hex')};
 }catch(error){if(error instanceof HttpError)throw error;throw new HttpError(415,'IMAGE_INVALID','The image could not be safely decoded. Use a still JPEG, PNG or WebP under 16 megapixels.');}
 finally{active--;}
}
