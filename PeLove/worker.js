const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" };
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const uid = () => crypto.randomUUID();
const hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const hash = async s => hex(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)));
async function passwordHash(password, salt=crypto.getRandomValues(new Uint8Array(16))) {
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:180000,hash:"SHA-256"},key,256);
  return hex(salt)+":"+hex(bits);
}
async function verifyPassword(password,stored) {
  const [s,v]=stored.split(":"); const salt=new Uint8Array(s.match(/.{2}/g).map(x=>parseInt(x,16)));
  const next=await passwordHash(password,salt); return next===stored;
}
const clean = s => String(s??"").trim();
const validPhoto = s => !s || (/^https:\/\//i.test(s) && s.length<1500);
async function auth(req,env) {
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token) return null;
  const row=await env.DB.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?").bind(await hash(token),Math.floor(Date.now()/1000)).first();
  return row?.user_id || null;
}
async function issueSession(userId,env) {
  const token=hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").bind(await hash(token),userId,Math.floor(Date.now()/1000)+60*60*24*30).run();
  return token;
}
export default {
 async fetch(req,env) {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  const url=new URL(req.url), path=url.pathname;
  try {
   if(path==="/api/health") return json({ok:true,service:"PeLove API",version:"1.0.0"});
   if(path==="/api/register" && req.method==="POST") {
    const b=await req.json(), email=clean(b.email).toLowerCase(), name=clean(b.name), age=Number(b.age), password=String(b.password||"");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({error:"Informe um e-mail válido."},400);
    if(name.length<2||name.length>40) return json({error:"O nome deve ter de 2 a 40 caracteres."},400);
    if(!Number.isInteger(age)||age<18||age>99) return json({error:"O PeLove é exclusivo para maiores de 18 anos."},400);
    if(password.length<10||password.length>100) return json({error:"A senha precisa ter pelo menos 10 caracteres."},400);
    const id=uid(), ph=await passwordHash(password);
    await env.DB.prepare("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)").bind(id,email,ph).run();
    await env.DB.prepare("INSERT INTO profiles(user_id,name,age,gender,seeking,city,bio,photo_url) VALUES(?,?,?,?,?,?,?,?)").bind(id,name,age,clean(b.gender).slice(0,30),clean(b.seeking).slice(0,30),clean(b.city).slice(0,80),clean(b.bio).slice(0,400),validPhoto(b.photo_url)?clean(b.photo_url):"").run();
    return json({token:await issueSession(id,env),user:{id,name,age}},201);
   }
   if(path==="/api/login" && req.method==="POST") {
    const b=await req.json(), email=clean(b.email).toLowerCase(), password=String(b.password||"");
    const u=await env.DB.prepare("SELECT id,password_hash,disabled FROM users WHERE email=?").bind(email).first();
    if(!u||u.disabled||!(await verifyPassword(password,u.password_hash))) return json({error:"E-mail ou senha incorretos."},401);
    return json({token:await issueSession(u.id,env)});
   }
   const me=await auth(req,env);
   if(!me) return json({error:"Faça login para continuar."},401);
   if(path==="/api/logout" && req.method==="POST") {
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await hash(token)).run(); return json({ok:true});
   }
   if(path==="/api/me" && req.method==="GET") {
    const p=await env.DB.prepare("SELECT u.email,p.* FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=?").bind(me).first();
    return p?json({profile:p}):json({error:"Perfil não encontrado."},404);
   }
   if(path==="/api/profile" && req.method==="PATCH") {
    const b=await req.json(), name=clean(b.name), age=Number(b.age), photo=clean(b.photo_url);
    if(name.length<2||name.length>40||!Number.isInteger(age)||age<18||age>99||!validPhoto(photo)) return json({error:"Confira nome, idade (18+) e link da foto HTTPS."},400);
    await env.DB.prepare("UPDATE profiles SET name=?,age=?,gender=?,seeking=?,city=?,bio=?,photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(name,age,clean(b.gender).slice(0,30),clean(b.seeking).slice(0,30),clean(b.city).slice(0,80),clean(b.bio).slice(0,400),photo,me).run();
    return json({ok:true});
   }
   if(path==="/api/discover" && req.method==="GET") {
    const rows=await env.DB.prepare(`SELECT p.user_id AS id,p.name,p.age,p.gender,p.seeking,p.city,p.bio,p.photo_url FROM profiles p
      WHERE p.user_id<>? AND NOT EXISTS(SELECT 1 FROM likes l WHERE l.from_user=? AND l.to_user=p.user_id)
      AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.blocker_id=? AND b.blocked_id=p.user_id) OR (b.blocker_id=p.user_id AND b.blocked_id=?))
      AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.disabled=1)
      ORDER BY p.updated_at DESC LIMIT 40`).bind(me,me,me,me).all();
    return json({profiles:rows.results||[]});
   }
   if(path==="/api/like" && req.method==="POST") {
    const b=await req.json(), target=clean(b.user_id);
    if(!target||target===me) return json({error:"Perfil inválido."},400);
    const exists=await env.DB.prepare("SELECT user_id FROM profiles WHERE user_id=?").bind(target).first();
    if(!exists) return json({error:"Perfil não encontrado."},404);
    const blocked=await env.DB.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").bind(me,target,target,me).first();
    if(blocked) return json({error:"Não é possível interagir com este perfil."},403);
    await env.DB.prepare("INSERT OR IGNORE INTO likes(from_user,to_user) VALUES(?,?)").bind(me,target).run();
    const mutual=await env.DB.prepare("SELECT 1 FROM likes WHERE from_user=? AND to_user=?").bind(target,me).first();
    if(mutual) {
     const a=[me,target].sort(), id=uid();
     await env.DB.prepare("INSERT OR IGNORE INTO matches(id,user_a,user_b) VALUES(?,?,?)").bind(id,a[0],a[1]).run();
     const m=await env.DB.prepare("SELECT id FROM matches WHERE user_a=? AND user_b=?").bind(a[0],a[1]).first();
     return json({matched:true,match_id:m.id});
    }
    return json({matched:false});
   }
   if(path==="/api/matches" && req.method==="GET") {
    const rows=await env.DB.prepare(`SELECT m.id,p.user_id AS user_id,p.name,p.age,p.city,p.photo_url,
      (SELECT body FROM messages x WHERE x.match_id=m.id ORDER BY x.created_at DESC LIMIT 1) AS last_message
      FROM matches m JOIN profiles p ON p.user_id=CASE WHEN m.user_a=? THEN m.user_b ELSE m.user_a END
      WHERE m.user_a=? OR m.user_b=? ORDER BY m.created_at DESC`).bind(me,me,me).all();
    const safe=[]; for(const x of (rows.results||[])){const bl=await env.DB.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").bind(me,x.user_id,x.user_id,me).first();if(!bl)safe.push(x);}
    return json({matches:safe});
   }
   if(path==="/api/messages" && req.method==="GET") {
    const mid=clean(url.searchParams.get("match_id"));
    const m=await env.DB.prepare("SELECT id FROM matches WHERE id=? AND (user_a=? OR user_b=?)").bind(mid,me,me).first();
    if(!m)return json({error:"Conversa não encontrada."},404);
    const rows=await env.DB.prepare("SELECT id,sender_id,body,created_at FROM messages WHERE match_id=? ORDER BY created_at ASC LIMIT 200").bind(mid).all();
    return json({messages:rows.results||[]});
   }
   if(path==="/api/messages" && req.method==="POST") {
    const b=await req.json(), mid=clean(b.match_id), body=clean(b.body);
    if(!body||body.length>2000)return json({error:"A mensagem deve ter de 1 a 2.000 caracteres."},400);
    const m=await env.DB.prepare("SELECT id,user_a,user_b FROM matches WHERE id=? AND (user_a=? OR user_b=?)").bind(mid,me,me).first();
    if(!m)return json({error:"Conversa não encontrada."},404);
    const other=m.user_a===me?m.user_b:m.user_a;
    const bl=await env.DB.prepare("SELECT 1 FROM blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)").bind(me,other,other,me).first();
    if(bl)return json({error:"Esta conversa está indisponível."},403);
    const id=uid(); await env.DB.prepare("INSERT INTO messages(id,match_id,sender_id,body) VALUES(?,?,?,?)").bind(id,mid,me,body).run();
    return json({id},201);
   }
   if(path==="/api/block" && req.method==="POST") {
    const b=await req.json(), target=clean(b.user_id); if(!target||target===me)return json({error:"Perfil inválido."},400);
    await env.DB.prepare("INSERT OR IGNORE INTO blocks(blocker_id,blocked_id) VALUES(?,?)").bind(me,target).run();
    const a=[me,target].sort(); await env.DB.prepare("DELETE FROM matches WHERE user_a=? AND user_b=?").bind(a[0],a[1]).run();
    return json({ok:true});
   }
   if(path==="/api/report" && req.method==="POST") {
    const b=await req.json(), target=clean(b.user_id), reason=clean(b.reason), details=clean(b.details);
    if(!target||target===me||reason.length<3)return json({error:"Informe o perfil e o motivo da denúncia."},400);
    await env.DB.prepare("INSERT INTO reports(id,reporter_id,reported_id,reason,details) VALUES(?,?,?,?,?)").bind(uid(),me,target,reason.slice(0,100),details.slice(0,1000)).run();
    return json({ok:true},201);
   }
   return json({error:"Rota não encontrada."},404);
  } catch(e) {
   if(String(e).includes("UNIQUE constraint failed: users.email")) return json({error:"Este e-mail já está cadastrado."},409);
   return json({error:"Erro interno. Tente novamente."},500);
  }
 }
};