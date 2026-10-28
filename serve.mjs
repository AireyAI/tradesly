// Local design preview only: API responses are simulated and never persisted.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3088);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.mp4':'video/mp4','.xml':'application/xml','.txt':'text/plain'};
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  if(req.method!=='POST')return json(res,405,{ok:false,error:'preview_post_only'});
  if(!['/api/lead','/api/buyer-apply'].includes(url.pathname))return json(res,404,{ok:false,error:'not_found'});
  let body='';
  try{for await(const chunk of req){body+=chunk;if(body.length>65536)return json(res,413,{ok:false});}JSON.parse(body);}catch{return json(res,400,{ok:false,error:'invalid_json'});}
  return json(res,200,{ok:true,preview:true,[url.pathname==='/api/lead'?'lead_id':'buyer_id']:'preview-only-no-record-created'});
 }
 if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{ok:false});
 let relative;
 try{relative=decodeURIComponent(url.pathname);}catch{return json(res,400,{ok:false});}
 if(relative.startsWith('/admin')||relative.split('/').some(p=>p.startsWith('.')))return json(res,403,{ok:false,error:'not_in_public_preview'});
 if(relative==='/')relative='/index.html';
 if(!path.extname(relative))relative+='.html';
 const target=path.resolve(root,'.'+relative);
 if(!target.startsWith(root+path.sep))return json(res,403,{ok:false});
 try{const body=await fs.readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?null:body);}catch{res.writeHead(404,{'Content-Type':'text/html'});res.end(await fs.readFile(path.join(root,'404.html')));}
}).listen(port,'127.0.0.1',()=>console.log(`Tradesly local design preview: http://127.0.0.1:${port} (API simulated; no records or messages created)`));
