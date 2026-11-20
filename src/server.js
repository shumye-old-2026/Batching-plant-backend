import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { z } from 'zod';

const {Pool}=pg;
if(!process.env.DATABASE_URL || !process.env.JWT_SECRET || process.env.JWT_SECRET.length<48) throw new Error('Configure DATABASE_URL and a 48+ character JWT_SECRET');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:true}:undefined});
const app=express();
app.get('/order-console.html', (req, res) => {
  res.sendFile('C:/Users/LENOVO/Downloads/Batching_Plant_ERP_Enterprise_Backend_Starter(1)/bperp_enterprise_starter/public/order-console.html');
});



app.disable('x-powered-by'); app.use(helmet());
app.use(cors({origin:(process.env.CORS_ORIGIN||'').split(',').filter(Boolean),credentials:true}));
app.use(express.json({limit:'256kb'}));app.use(cookieParser());
app.use((req,res,next)=>{req.requestId=crypto.randomUUID();res.setHeader('X-Request-Id',req.requestId);next();});
const limiter=rateLimit({windowMs:15*60*1000,limit:100,standardHeaders:true,legacyHeaders:false});app.use('/api/',limiter);
const cookieOptions={httpOnly:true,secure:process.env.COOKIE_SECURE==='true',sameSite:'strict',path:'/api'};
async function audit(client,req,action,entityType,entityId=null,details={}){
 await client.query(`INSERT INTO audit_events(actor_id,actor_username,action,entity_type,entity_id,plant,request_id,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[req.user?.id||null,req.user?.username||null,action,entityType,entityId,req.user?.plant||null,req.requestId,JSON.stringify(details)]);
}
async function auth(req,res,next){try{const token=req.cookies.bperp_session;if(!token)return res.status(401).json({error:'Authentication required'});const claims=jwt.verify(token,process.env.JWT_SECRET,{issuer:'bperp',audience:'bperp-web'});const hash=crypto.createHash('sha256').update(token).digest('hex');const check=await pool.query(`SELECT u.id,u.username,u.role,u.plant FROM user_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=true`,[hash]);if(!check.rowCount)return res.status(401).json({error:'Session revoked or expired'});const u=check.rows[0];if(u.id!==claims.sub)return res.status(401).json({error:'Session invalid'});req.user={id:u.id,username:u.username,role:u.role,plant:u.plant};next();}catch{return res.status(401).json({error:'Session invalid or expired'});}}
const roles=(...allowed)=>(req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({error:'Permission denied'});
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.get('/api/health',asyncRoute(async(req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',database:'connected'});}));
app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false}),asyncRoute(async(req,res)=>{
 const schema=z.object({username:z.string().min(1).max(120),password:z.string().min(1).max(300)});const parsed=schema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'Invalid input'});
 const result=await pool.query('SELECT id,username,display_name,password_hash,role,plant,active,must_change_password FROM app_users WHERE username=$1',[parsed.data.username]);const u=result.rows[0];
 if(!u||!u.active||!(await argon2.verify(u.password_hash,parsed.data.password)))return res.status(401).json({error:'Incorrect credentials'});
 
console.log('JWT_SECRET =', process.env.JWT_SECRET);
console.log('USER ID =', u.id); token=jwt.sign({username:u.username,role:u.role,plant:u.plant},process.env.JWT_SECRET,{subject:u.id,expiresIn:'8h',issuer:'bperp',audience:'bperp-web'});
 const tokenHash=crypto.createHash('sha256').update(token).digest('hex');await pool.query('INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval \'8 hours\')',[u.id,tokenHash]);
 res.cookie('bperp_session',token,{...cookieOptions,maxAge:8*60*60*1000});res.json({user:{id:u.id,username:u.username,displayName:u.display_name,role:u.role,plant:u.plant,mustChangePassword:u.must_change_password}});
}));

app.post('/api/auth/logout',auth,asyncRoute(async(req,res)=>{const token=req.cookies.bperp_session;const hash=crypto.createHash('sha256').update(token).digest('hex');await pool.query('UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1',[hash]);res.clearCookie('bperp_session',cookieOptions);res.status(204).end();}));
app.get('/api/auth/me',auth,(req,res)=>res.json({user:req.user}));
const orderSchema=z.object({orderNo:z.string().trim().min(2).max(48),plant:z.enum(['BOLE','SARIS','GERJI']),customerId:z.string().uuid(),productGrade:z.string().trim().min(1).max(50),quantityM3:z.number().positive().max(100000),unitPrice:z.number().nonnegative().max(100000000),requestedDeliveryAt:z.string().datetime().optional(),notes:z.string().max(2000).optional()});
app.post('/api/orders',auth,roles('SYS_ADMIN','HEAD_OFFICE','SALES_OFFICER'),asyncRoute(async(req,res)=>{
 const p=orderSchema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid order',issues:p.error.issues});if(req.user.role!=='SYS_ADMIN'&&req.user.role!=='HEAD_OFFICE'&&req.user.plant!==p.data.plant)return res.status(403).json({error:'Cannot create order for another plant'});
 const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query(`INSERT INTO sales_orders(order_no,plant,customer_id,created_by,status,product_grade,quantity_m3,unit_price,requested_delivery_at,notes) VALUES($1,$2,$3,$4,'PENDING_MARKETING_MANAGER_APPROVAL',$5,$6,$7,$8,$9) RETURNING *`,[p.data.orderNo,p.data.plant,p.data.customerId,req.user.id,p.data.productGrade,p.data.quantityM3,p.data.unitPrice,p.data.requestedDeliveryAt||null,p.data.notes||null]);await audit(client,req,'ORDER_CREATED','sales_order',r.rows[0].id,{orderNo:p.data.orderNo,initialStatus:'PENDING_MARKETING_MANAGER_APPROVAL'});await client.query('COMMIT');res.status(201).json({order:r.rows[0]});}catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'Order number already exists'});throw e;}finally{client.release();}
}));
app.get('/api/orders',auth,asyncRoute(async(req,res)=>{const isWide=['SYS_ADMIN','HEAD_OFFICE'].includes(req.user.role);const r=isWide?await pool.query('SELECT * FROM sales_orders ORDER BY created_at DESC LIMIT 500'):await pool.query('SELECT * FROM sales_orders WHERE plant=$1 ORDER BY created_at DESC LIMIT 500',[req.user.plant]);res.json({orders:r.rows});}));
app.post('/api/orders/:id/marketing-decision',auth,roles('SYS_ADMIN','MARKETING_MANAGER'),asyncRoute(async(req,res)=>{
 const schema=z.object({decision:z.enum(['APPROVED','REJECTED']),note:z.string().max(1000).optional()});const p=schema.safeParse(req.body);if(!p.success)return res.status(400).json({error:'Invalid decision'});
 const client=await pool.connect();try{await client.query('BEGIN');const q=await client.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[req.params.id]);const o=q.rows[0];if(!o){await client.query('ROLLBACK');return res.status(404).json({error:'Order not found'});}if(o.status!=='PENDING_MARKETING_MANAGER_APPROVAL'){await client.query('ROLLBACK');return res.status(409).json({error:'Order is not awaiting marketing approval'});}if(req.user.role!=='SYS_ADMIN'&&req.user.plant!=='HEAD_OFFICE'&&req.user.plant!==o.plant){await client.query('ROLLBACK');return res.status(403).json({error:'Plant scope denied'});}
 const next=p.data.decision==='APPROVED'?'PENDING_LAB_APPROVAL':'MARKETING_REJECTED';await client.query('UPDATE sales_orders SET status=$1,updated_at=now() WHERE id=$2',[next,o.id]);await client.query('INSERT INTO approval_events(order_id,stage,decision,actor_id,note) VALUES($1,\'MARKETING\',$2,$3,$4)',[o.id,p.data.decision,req.user.id,p.data.note||null]);await audit(client,req,'MARKETING_DECISION','sales_order',o.id,{decision:p.data.decision,status:next});await client.query('COMMIT');res.json({id:o.id,status:next});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/reports/summary',auth,roles('SYS_ADMIN','HEAD_OFFICE','FINANCE'),asyncRoute(async(req,res)=>{const plant=['BOLE','SARIS','GERJI'].includes(req.query.plant)?req.query.plant:null;const wide=['SYS_ADMIN','HEAD_OFFICE'].includes(req.user.role);if(!wide&&plant&&plant!==req.user.plant)return res.status(403).json({error:'Plant scope denied'});const selected=wide?plant:req.user.plant;const r=selected?await pool.query(`SELECT plant,count(*)::int AS orders,coalesce(sum(quantity_m3),0)::numeric AS volume_m3,coalesce(sum(quantity_m3*unit_price),0)::numeric AS order_value FROM sales_orders WHERE plant=$1 GROUP BY plant`,[selected]):await pool.query(`SELECT plant,count(*)::int AS orders,coalesce(sum(quantity_m3),0)::numeric AS volume_m3,coalesce(sum(quantity_m3*unit_price),0)::numeric AS order_value FROM sales_orders GROUP BY plant ORDER BY plant`);res.json({summary:r.rows,disclaimer:'Order value is not recognized revenue, paid cash, or profit.'});}));
app.use((err,req,res,next)=>{console.error({requestId:req.requestId,error:err.message});if(res.headersSent)return next(err);res.status(500).json({error:'Unexpected server error',requestId:req.requestId});});
const port=Number(process.env.PORT||4000);app.listen(port,()=>console.log(`BPERP API listening on ${port}`));
