import {allowsClientOrigin} from './config.js';
import express from 'express';
import type {Logger} from 'pino';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import {z} from 'zod';
import type {Database} from './db.js';
import {createAccessRouter} from './modules/auth/router.js';
import {HttpError} from './modules/auth/session.js';
import {AuthBusyError} from './modules/auth/crypto.js';
import type {NotifyBranchOrders} from './realtime.js';
import { demo } from './fixtures.js';
export function createApp(config:Config, pingDatabase:() => Promise<void|'current'|'pending'> = async () => { throw new Error('Database unavailable'); }, database:Database|null=null,notify?:NotifyBranchOrders, logger?:Logger) {
  const app = express();
  app.disable('x-powered-by');
  // No blanket trust-proxy. TRUST_PROXY_HOPS is an exact hop count (default 0) for a topology the operator controls.
  if(config.TRUST_PROXY_HOPS>0)app.set('trust proxy',config.TRUST_PROXY_HOPS);
  app.use((_req,res,next) => { res.locals.requestId=randomUUID(); res.setHeader('X-Request-ID',res.locals.requestId); res.setHeader('Cache-Control','no-store'); next(); });
  app.use((req,res,next) => {
    const started=performance.now();
    const fields=()=>({requestId:res.locals.requestId,method:req.method,
      durationMs:Math.round(performance.now()-started)});
    res.once('finish',()=>{
      const event={...fields(),status:res.statusCode};
      if(res.statusCode>=500)logger?.error(event,'API request failed');
      else logger?.info(event,'API request completed');
    });
    res.once('close',()=>{if(!res.writableFinished)logger?.warn(fields(),'API connection closed before response');});
    next();
  });
  app.use(helmet());
  app.use((req,res,next) => {
    const origin = req.headers.origin;
    if (origin && !allowsClientOrigin(config,origin)) return res.status(403).json({error:{code:'ORIGIN_DENIED',message:'Origin is not allowed.',requestId:res.locals.requestId}});
    next();
  });
  app.use(cors({origin:(origin,done)=>done(null,allowsClientOrigin(config,origin)),credentials:true}));
  app.use(rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'RATE_LIMITED',message:'Too many requests. Retry shortly.'}}}));
  app.use(express.json({limit:'16kb',strict:true}));
  app.get('/api/health',(_req,res) => res.json({service:'restrodock-api',status:'ok',version:'0.16.4',requestId:res.locals.requestId}));
  app.get('/api/ready', async (_req,res) => {
    if (!config.DATABASE_URL) return res.status(503).json({status:'not_ready',database:'unconfigured',schema:'unchecked'});
    try { const schema=await pingDatabase()??'unchecked'; return res.status(schema==='pending'?503:200).json({status:schema==='pending'?'not_ready':'ready',database:'connected',schema}); }
    catch { return res.status(503).json({status:'not_ready',database:'unavailable',schema:'unchecked'}); }
  });
  app.get('/api/v1/foundation',(_req,res) => res.json({phase:'day-16.4',billingMode:'EXTERNAL_POS_MANUAL',orderingEnabled:false,staffAuthentication:'database_sessions',demoEnabled:config.DEMO_MODE}));
  app.get('/api/v1/demo/workspace',(_req,res) => {
    if (!config.DEMO_MODE) return res.status(404).json({error:{code:'NOT_FOUND',message:'Route not found.',requestId:res.locals.requestId}});
    return res.json(demo);
  });
  app.use('/api/v1',createAccessRouter(config,database,notify));
  // Fail closed. No demo login, header impersonation, guest join, or unguarded tenant data.
  for (const prefix of ['/api/v1/restaurant','/api/v1/super-admin','/api/v1/staff']) {
    app.use(prefix,(_req,res) => res.status(401).json({error:{code:'AUTH_REQUIRED',message:'Sign in to continue.',requestId:res.locals.requestId}}));
  }
  app.use((_req,res) => res.status(404).json({error:{code:'NOT_FOUND',message:'Route not found.',requestId:res.locals.requestId}}));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction) => {
    if(error instanceof HttpError)return res.status(error.status).json({error:{code:error.code,message:error.message,requestId:res.locals.requestId}});
    if(error instanceof AuthBusyError)return res.status(503).json({error:{code:'AUTH_BUSY',message:error.message,requestId:res.locals.requestId}});
    if(error instanceof z.ZodError)return res.status(400).json({error:{code:'VALIDATION_FAILED',message:'Check the highlighted fields and try again.',fields:error.issues.map(i=>({field:i.path.join('.'),message:i.message})),requestId:res.locals.requestId}});
    if(error&&typeof error==='object'&&'code' in error&&error.code==='P2002')return res.status(409).json({error:{code:'CONFLICT',message:'This record already exists. Choose a unique slug or refresh before retrying.',requestId:res.locals.requestId}});
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    const safeStatus = status === 413 ? 413 : status === 400 ? 400 : 500;
    // Unexpected failures are logged by class/code only: driver messages can contain connection strings or user data.
    if(safeStatus===500)logger?.error({requestId:res.locals.requestId,errorName:error instanceof Error?error.name:typeof error,errorCode:error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'?error.code:undefined},'Unhandled API error');
    res.status(safeStatus).json({error:{code:safeStatus === 500 ? 'INTERNAL_ERROR':'INVALID_REQUEST',message:safeStatus === 413 ? 'Request body is too large.' : safeStatus === 400 ? 'Invalid JSON request.' : 'Request failed.',requestId:res.locals.requestId}});
  });
  return app;
}
