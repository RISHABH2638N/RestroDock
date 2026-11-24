import {Router,raw,type Response} from 'express';
import {z} from 'zod';
import {profileInput,hoursInput,safetyInput,posInput,flagsInput,categoryInput,itemInput,importInput,revisionInput,setupVersion,staffRoleInput,menuAvailabilityInput} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import type {Identity} from '../auth/session.js';
import {HttpError} from '../auth/session.js';
import {resolveSetupScope} from './scope.js';
import {managementRepository} from './repository.js';
import {sanitizeImage,imageInputLimit} from './media.js';
export function createManagementRouter(db:Database) {
 const router=Router();
 router.use(async(req,res,next)=>{const identity=res.locals.identity as Identity;const query={...req.query};
  if(req.method==='GET'&&req.path==='/audit')delete query.cursor;
  const scope=await resolveSetupScope(db,identity.user.id,query);res.locals.management=managementRepository(db,scope);next();});
 const repository=(res:Response)=>res.locals.management as ReturnType<typeof managementRepository>;
 router.get('/audit',async(req,res)=>{
  const cursor=z.uuid().optional().parse(req.query.cursor);
  res.set('Cache-Control','private, no-store').json(await repository(res).auditPage(cursor));
 });
 router.put('/staff/:id/role',async(req,res)=>res.json(await repository(res).changeStaffRole(z.uuid().parse(req.params.id),staffRoleInput.parse(req.body))));
 router.put('/items/availability',async(req,res)=>res.json(await repository(res).bulkAvailability(menuAvailabilityInput.parse(req.body))));
 router.get('/settings',async(_req,res)=>res.json(await repository(res).setup()));
 router.put('/profile',async(req,res)=>res.json(await repository(res).saveProfile(profileInput.parse(req.body))));
 router.put('/hours',async(req,res)=>res.json(await repository(res).saveHours(hoursInput.parse(req.body))));
 router.put('/safety',async(req,res)=>res.json(await repository(res).saveSafety(safetyInput.parse(req.body))));
 router.put('/pos',async(req,res)=>res.json(await repository(res).savePos(posInput.parse(req.body))));
 router.put('/flags',async(req,res)=>res.json(await repository(res).saveFlags(flagsInput.parse(req.body))));
 router.post('/submit',async(req,res)=>res.json(await repository(res).submit(z.object({version:setupVersion}).strict().parse(req.body).version)));
 router.delete('/staff/:id',async(req,res)=>res.json(await repository(res).removeStaff(z.uuid().parse(req.params.id),z.object({version:setupVersion}).strict().parse(req.body).version)));
 router.get('/menu',async(_req,res)=>res.json(await repository(res).catalogue()));
 router.get('/preview',async(_req,res)=>res.json(await repository(res).catalogue(true)));
 router.post('/categories',async(req,res)=>res.status(201).json(await repository(res).saveCategory(categoryInput.parse(req.body))));
 router.put('/categories/:id',async(req,res)=>res.json(await repository(res).saveCategory(categoryInput.parse(req.body),z.uuid().parse(req.params.id))));
 router.post('/items',async(req,res)=>res.status(201).json(await repository(res).saveItem(itemInput.parse(req.body))));
 router.put('/items/:id',async(req,res)=>res.json(await repository(res).saveItem(itemInput.parse(req.body),z.uuid().parse(req.params.id))));
 router.delete('/items/:id',async(req,res)=>res.json(await repository(res).archiveItem(z.uuid().parse(req.params.id),revisionInput.parse(req.body).revision)));
 router.post('/items/:id/review',async(req,res)=>res.json(await repository(res).reviewItem(z.uuid().parse(req.params.id),z.object({revision:setupVersion,confirmed:z.literal(true)}).strict().parse(req.body).revision)));
 router.post('/imports',async(req,res)=>res.status(201).json(await repository(res).importDrafts(importInput.parse(req.body))));
 function sendImage(res:Response,row:{bytes:Uint8Array}|null){if(!row)throw new HttpError(404,'NOT_FOUND','Image not found in this branch.');res.type('image/webp').set('Content-Disposition','inline; filename="restrodock-image.webp"').set('Content-Security-Policy',"default-src 'none'; sandbox").send(Buffer.from(row.bytes));}
 router.get('/logo',async(_req,res)=>sendImage(res,await repository(res).logo()));
 router.get('/items/:id/photo',async(req,res)=>sendImage(res,await repository(res).photo(z.uuid().parse(req.params.id))));
 const imageBody=raw({type:['image/jpeg','image/png','image/webp'],limit:imageInputLimit});
 const revision=(value:unknown)=>z.coerce.number().int().positive().parse(value);
 router.put('/logo',imageBody,async(req,res)=>{const version=revision(req.query.v);if(!Buffer.isBuffer(req.body))throw new HttpError(415,'IMAGE_TYPE','Upload a JPEG, PNG or WebP binary image.');res.json(await repository(res).saveLogo(version,await sanitizeImage(req.body,req.get('Content-Type')??'')));});
 router.delete('/logo',async(req,res)=>res.json(await repository(res).removeLogo(z.object({version:setupVersion}).strict().parse(req.body).version)));
 router.put('/items/:id/photo',imageBody,async(req,res)=>{const id=z.uuid().parse(req.params.id),version=revision(req.query.v);await repository(res).photo(id);if(!Buffer.isBuffer(req.body))throw new HttpError(415,'IMAGE_TYPE','Upload a JPEG, PNG or WebP binary image.');res.json(await repository(res).savePhoto(id,version,await sanitizeImage(req.body,req.get('Content-Type')??'')));});
 router.delete('/items/:id/photo',async(req,res)=>res.json(await repository(res).removePhoto(z.uuid().parse(req.params.id),revisionInput.parse(req.body).revision)));
 return router;
}
