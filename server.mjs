import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_KEY);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'realitycheck.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ideas (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, audience TEXT NOT NULL, stage TEXT NOT NULL, budget TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, score INTEGER, verdict TEXT, data TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS monthly_usage (user_id TEXT NOT NULL, period TEXT NOT NULL, reports_used INTEGER NOT NULL DEFAULT 0, advisor_used INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,period));
CREATE INDEX IF NOT EXISTS idx_ideas_user ON ideas(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id, created_at DESC);
`);
const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const rateBuckets = new Map();
function rateLimited(req, key, limit, windowMs) {
 const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
 const bucketKey = `${ip}:${key}`; const current = Date.now(); const old = rateBuckets.get(bucketKey);
 if (!old || current - old.start >= windowMs) { rateBuckets.set(bucketKey, {start:current,count:1}); return false; }
 old.count++; return old.count > limit;
}
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
const verifyPassword = (password, value) => { const [salt, hash] = (value || '').split(':'); if (!salt || !hash) return false; const actual = crypto.scryptSync(password, salt, 64); return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex')); };
const secret = process.env.SESSION_SECRET || 'dev-only-change-this-secret-before-deploying-realitycheck';
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) throw new Error('Set SESSION_SECRET to a random value of at least 32 characters in production.');
const sign = value => crypto.createHmac('sha256', secret).update(value).digest('base64url');
function setSession(res, userId) { const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + 7*24*60*60*1000 })).toString('base64url'); const token = `${payload}.${sign(payload)}`; res.setHeader('Set-Cookie', `rc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
function clearSession(res) { res.setHeader('Set-Cookie', 'rc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); }
async function auth(req) {
 if (SUPABASE_ENABLED) {
  const token=req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]||req.headers['x-realitycheck-session']; if(!token)return null;
  try { const r=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}});if(!r.ok)return null;const u=await r.json();return {id:u.id,name:u.user_metadata?.name||u.email?.split('@')[0]||'Founder',email:u.email,accessToken:token}; } catch { throw new Error('Supabase Auth is temporarily unavailable.'); }
 }
 const raw = req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('rc_session='))?.slice(11); if (!raw) return null; const [payload, sig] = raw.split('.'); if (!payload || !sig) return null; const expected=Buffer.from(sign(payload)), supplied=Buffer.from(sig); if (expected.length!==supplied.length || !crypto.timingSafeEqual(expected,supplied)) return null; try { const p=JSON.parse(Buffer.from(payload,'base64url').toString()); return p.exp > Date.now() ? db.prepare('SELECT id,name,email FROM users WHERE id=?').get(p.sub) : null; } catch { return null; }
}
async function supabaseRest(user, resource, options={}) {
 const r=await fetch(`${SUPABASE_URL}/rest/v1/${resource}`,{method:options.method||'GET',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${user.accessToken}`,'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})},body:options.body===undefined?undefined:JSON.stringify(options.body)});
 const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data={message:text}}
 return {ok:r.ok,status:r.status,data};
}
const REPORT_MONTHLY_LIMIT=5, ADVISOR_MONTHLY_LIMIT=20;
function currentUsagePeriod(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit'}).formatToParts(new Date());const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${m.year}-${m.month}`;}
function usageResetDate(period){const [y,m]=period.split('-').map(Number);return new Date(Date.UTC(y,m,1)).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric'});}
function formatUsage(row={},period=currentUsagePeriod()){return{period,reportsUsed:Number(row.reports_used||0),reportLimit:REPORT_MONTHLY_LIMIT,advisorUsed:Number(row.advisor_used||0),advisorLimit:ADVISOR_MONTHLY_LIMIT,resetDate:usageResetDate(period)};}
async function getMonthlyUsage(user){const period=currentUsagePeriod();if(SUPABASE_ENABLED){const r=await supabaseRest(user,`monthly_usage?select=reports_used,advisor_used&user_id=eq.${encodeURIComponent(user.id)}&period=eq.${period}`);if(!r.ok)throw new Error('Could not load monthly credits.');return formatUsage(r.data?.[0]||{},period);}const row=db.prepare('SELECT reports_used,advisor_used FROM monthly_usage WHERE user_id=? AND period=?').get(user.id,period);return formatUsage(row||{},period);}
async function consumeMonthlyUsage(user,kind){const period=currentUsagePeriod(),limit=kind==='report'?REPORT_MONTHLY_LIMIT:ADVISOR_MONTHLY_LIMIT;if(!['report','advisor'].includes(kind))throw new Error('Invalid usage type.');if(SUPABASE_ENABLED){const r=await supabaseRest(user,'rpc/consume_monthly_usage',{method:'POST',body:{p_period:period,p_kind:kind}});if(!r.ok)throw new Error(`Credit reservation failed (${r.status}).`);const row=Array.isArray(r.data)?r.data[0]:r.data;return{allowed:Boolean(row?.allowed),used:Number(row?.used||0),limit:Number(row?.limit_value||limit),period,resetDate:usageResetDate(period)};}const field=kind==='report'?'reports_used':'advisor_used',values=kind==='report'?'1,0':'0,1';const row=db.prepare(`INSERT INTO monthly_usage(user_id,period,reports_used,advisor_used,updated_at) VALUES(?,?,${values},?) ON CONFLICT(user_id,period) DO UPDATE SET ${field}=monthly_usage.${field}+1,updated_at=excluded.updated_at WHERE monthly_usage.${field}<? RETURNING ${field} AS used`).get(user.id,period,now(),limit);if(row)return{allowed:true,used:row.used,limit,period,resetDate:usageResetDate(period)};const current=db.prepare(`SELECT ${field} AS used FROM monthly_usage WHERE user_id=? AND period=?`).get(user.id,period);return{allowed:false,used:Number(current?.used||0),limit,period,resetDate:usageResetDate(period)};}
async function supabaseAuth(path, payload, method='POST') {
 const r=await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{method,headers:{apikey:SUPABASE_KEY,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});
 const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
 return {ok:r.ok,status:r.status,data};
}
const agents = [
 {id:'customer',name:'Customer Agent',role:'The voice of the customer',icon:'◉',color:'#a78bfa'},
 {id:'market',name:'Market Agent',role:'Opportunity & demand',icon:'◈',color:'#61a8ff'},
 {id:'competitor',name:'Competitor Agent',role:'Landscape & differentiation',icon:'⌘',color:'#43d9c3'},
 {id:'finance',name:'Finance Agent',role:'Unit economics & revenue',icon:'⌁',color:'#ffbd69'},
 {id:'devil',name:"Devil’s Advocate",role:'Risks & failure modes',icon:'⚡',color:'#ff7f9c'},
 {id:'ceo',name:'CEO Agent',role:'The final call',icon:'✳',color:'#c6a0ff'}
];
function makeFallback(idea, agent) {
 const name=String(idea.name||'This idea'), audience=String(idea.audience||'the proposed customer'), problem=String(idea.description||'the stated problem').replace(/\s+/g,' ').slice(0,180);
 const data = {
 customer:{summary:`The brief identifies ${audience} and says ${problem}. Neither establishes that this group experiences the problem urgently or will change current behavior; treat the customer-pain claim as unverified.`,findings:[`Interview 12 qualified ${audience} about their last real attempt to solve this problem; record existing workaround and frequency.`,`Offer a specific paid pilot to at least 3 prospects; verbal enthusiasm is not willingness-to-pay evidence.`,`Stop or narrow the segment if fewer than 5 of 15 interviewees independently describe recent, costly pain.`],confidence:28},
 market:{summary:`There is not enough verified information in this brief to conclude that a reachable market exists for ${name}. No demand, channel, market-size, or repeat-use evidence was supplied; market attractiveness remains unknown.`,findings:[`Choose one geography and acquisition channel, then estimate reachable buyers from observable channel data—not a top-down TAM.`,`Run a landing-page or concierge test and report qualified visits, conversion, and the denominator.`,`Do not expand to adjacent segments until one narrow segment shows repeat demand.`],confidence:24},
 competitor:{summary:`The brief does not show what ${audience} currently uses instead of ${name}. The strongest competitor may be a workaround or doing nothing, so differentiation is unproven.`,findings:[`Ask 10 target customers to demonstrate their current workaround and name tools they already pay for.`,`Compare the proposed outcome against the top 3 alternatives using the same task and time/cost measure.`,`Do not claim a moat or novelty without a documented competitor and substitute review.`],confidence:23},
 finance:{summary:`Unit economics cannot be established from the brief: pricing, delivery cost, support load, and acquisition cost are unknown. Any budget figure here would be a planning assumption, not a forecast.`,findings:[`Before building, test a paid pilot and record price accepted, delivery hours, and direct costs.`,`Calculate contribution margin including payment fees, support, refunds, and founder delivery time.`,`Do not scale paid acquisition until observed customer acquisition cost is below contribution margin with a credible payback period.`],confidence:22},
 devil:{summary:`The central failure mode for ${name} is that the stated pain may be real but not urgent enough to change behavior or pay. The brief provides no independent evidence to rule that out.`,findings:[`Try to disprove urgency first: ask for a recent example, what it cost, and what they did—not whether they like the idea.`,`Predefine a stop rule before interviews; pause if fewer than 5 of 15 qualified people show recent costly pain.`,`Require a deposit, paid pilot, or repeated use before treating interest as traction.`],confidence:20},
 ceo:{summary:`Verdict: unproven. The brief is a hypothesis, not validation; it supplies no independent customer, payment, retention, or acquisition evidence. Do not build or scale yet.`,findings:[`Run 15 interviews with one narrowly defined segment and document actual recent behavior.`,`Ask 3 qualified prospects to pay for a manually delivered pilot before product investment.`,`Proceed only if a predeclared threshold is met; otherwise change the segment or problem and retest.`],confidence:25}
 };
 const out=data[agent.id]||data.devil;
 return {...out,source:'structured_fallback',fallbackReason:geminiQuotaUntil>Date.now()?'Gemini quota/rate limit cooldown is active':'AI provider unavailable'};
}
let geminiQuotaUntil=0;
let geminiFailureReason='';
async function callGemini(prompt, system, jsonMode=false) {
 if(geminiQuotaUntil>Date.now())throw new Error(geminiFailureReason||'Gemini quota cooldown is active');
 const model=process.env.GEMINI_MODEL||'gemini-2.5-flash';
 const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
 const generationConfig={temperature:0.35};if(jsonMode)generationConfig.responseMimeType='application/json';
 const contents=Array.isArray(prompt)?prompt.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:String(m.text||'')}] })): [{role:'user',parts:[{text:prompt}]}];
 const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig})});
 if(!r.ok){const body=await r.text();if(r.status===429){const quota=/quota|limit:\s*0|resource_exhausted/i.test(body);geminiQuotaUntil=Date.now()+(quota?60*60*1000:60*1000);geminiFailureReason=quota?'Gemini usage quota is exhausted; structured fallback is active':'Gemini rate limit reached; structured fallback is active';}throw new Error(`Gemini returned ${r.status}${r.status===429?`: ${geminiFailureReason}`:''}`)}
 const j=await r.json();return j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'';
}
async function askAI(idea, agent) {
 if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) return {...makeFallback(idea,agent),fallbackReason:'No AI provider key is configured'};
 if(process.env.GEMINI_API_KEY&&geminiQuotaUntil>Date.now())return makeFallback(idea,agent);
 const focus={customer:'Identify a precise initial customer, job-to-be-done, pain intensity, and interview questions.',market:'Assess demand signals and opportunity qualitatively; do not fabricate TAM or market statistics.',competitor:'Name categories of direct and indirect alternatives and suggest a differentiation test; do not invent competitor research.',finance:'Give a clearly labeled directional 30–90 day validation cost range, state assumptions, and offer 2–3 plausible revenue models or pricing tests. Avoid false precision.',devil:'Prioritize the most dangerous failure modes and propose cheap disconfirming experiments.',ceo:'Synthesize the trade-offs into a clear verdict and a prioritized next decision.'}[agent.id]||'Provide a practical specialist perspective.';
 const prompt=`You are the ${agent.name} on a strict, evidence-first startup review panel. Do not encourage the founder by default. Treat founder-provided claims as unverified claims, not proof. The brief contains no independently verified customer interviews, paid commitments, retention data, market research, or competitor audit unless explicitly stated below. Do not infer evidence from the selected stage; stage is self-reported. Make uncertainty count against the score. Your specialist brief: ${focus}\nIdea: ${idea.name}\nDescription: ${idea.description}\nTarget audience: ${idea.audience}\nSelf-reported stage: ${idea.stage}\nBudget: ${idea.budget}\nFor confidence, report how well-supported your assessment is—not how attractive the idea sounds. Be skeptical, identify the key assumption that could invalidate the idea, and give one falsifiable, low-cost test. Return ONLY valid JSON with keys summary (2-3 candid sentences), findings (exactly 3 concise evidence-oriented actions/risks), confidence (integer 0-100). Never invent precise market statistics or claim external research you did not perform. Label hypotheses as assumptions.`;
 try {
  let output='';
  if(process.env.GEMINI_API_KEY) output=await callGemini(prompt,'You are a skeptical startup diligence reviewer. Default to unproven, demand behavioral evidence for positive claims, and never award confidence for persuasive wording alone.',true);
  else {
   const r=await fetch(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0.55,response_format:{type:'json_object'},messages:[{role:'system',content:'You are a skeptical startup diligence reviewer. Default to unproven, demand behavioral evidence for positive claims, and never award confidence for persuasive wording alone.'},{role:'user',content:prompt}]})});
   if(!r.ok) throw new Error(`AI provider returned ${r.status}`);const j=await r.json();output=j.choices?.[0]?.message?.content||'{}';
  }
  const parsed=JSON.parse(output);return {summary:String(parsed.summary||'Analysis unavailable.'),findings:Array.isArray(parsed.findings)?parsed.findings.slice(0,3):[],confidence:Math.max(0,Math.min(100,Number(parsed.confidence)||30)),source:'ai'};
 } catch(e) { console.error('AI agent fallback:',e.message); return {...makeFallback(idea,agent),fallbackReason:e.message}; }
}
async function analyzePanel(idea) {
 if(process.env.GEMINI_API_KEY){
  try{
   const roles=agents.map(a=>`${a.id}: ${a.name} — ${a.role}`).join('\n');
   const prompt=`Review this startup brief through six skeptical specialist lenses. Do not invent evidence or metrics. Treat claims as hypotheses; no interviews, payment, retention, market research, or competitor audit are verified unless explicitly evidenced in this brief. For every lens, give a candid 2–3 sentence summary, exactly three concise falsifiable findings/actions, and confidence as a 0–100 estimate of evidence quality (not idea attractiveness). Return JSON only: {"results":[{"id":"customer|market|competitor|finance|devil|ceo","summary":"...","findings":["...","...","..."],"confidence":25}]}. Specialist lenses:\n${roles}\nIdea: ${idea.name}\nDescription: ${idea.description}\nTarget audience: ${idea.audience}\nSelf-reported stage: ${idea.stage}\nBudget: ${idea.budget}\nBe explicit when evidence is absent. Do not praise by default; name the assumption most likely to fail and the cheapest test to disprove it.`;
   const raw=await callGemini(prompt,'You are a strict startup diligence panel. Be skeptical, evidence-first, and calibrated. Persuasive wording is not evidence.',true);
   const parsed=JSON.parse(raw),byId=new Map((parsed.results||[]).map(x=>[x.id,x]));
   const results=agents.map(agent=>{const x=byId.get(agent.id);if(!x)throw new Error(`Gemini omitted ${agent.id}`);return{agent,summary:String(x.summary||'No summary returned.'),findings:Array.isArray(x.findings)?x.findings.slice(0,3):[],confidence:Math.max(0,Math.min(100,Number(x.confidence)||25)),source:'ai'};});
   return results;
  }catch(e){console.error('Gemini panel fallback:',e.message);return agents.map(agent=>({...{agent},...makeFallback(idea,agent),fallbackReason:e.message}));}
 }
 return Promise.all(agents.map(async agent=>({agent,...await askAI(idea,agent)})));
}
function scoreReport(idea, results) {
 const base=results.length?results.reduce((s,x)=>s+x.confidence,0)/results.length:0;
 // The brief has no structured fields for independently verified interviews, payments, retention, or acquisition. Cap idea-only reviews below 50; stage is self-reported and never earns points.
 const score=Math.max(20,Math.min(49,Math.round(base*0.55+18)));
 const verdict=score>=42?'Potential worth testing — still unvalidated':score>=30?'Unproven — evidence required':'High risk — evidence required';
 const headline=score>=42?'Some parts of the brief merit a cheap test, but the evidence does not justify building or scaling.':score>=30?'This is a hypothesis, not validation. Demand and willingness to pay remain unproven.':'The brief does not yet support investment. Test whether the problem is urgent before building.';
 const fallbackReasons=[...new Set(results.map(x=>x.fallbackReason).filter(Boolean))].join('; ');
 const fallbackNote=/429|quota|rate limit/i.test(fallbackReasons)?'Google Gemini returned a 429 usage/rate-limit response. I reduced panel analysis from six simultaneous requests to one; if the limit is account quota, only Google can restore it. This report uses a strict template, not live AI reasoning.':/503|unavailable/i.test(fallbackReasons)?'Google Gemini is temporarily unavailable (503) in the latest attempt; that is a provider outage response, not proof that your account quota is exhausted. This report uses a strict template, not live AI reasoning.':'The configured AI provider is unavailable. This report uses a strict template, not live AI reasoning.';
 return {score,verdict,headline,scoreNote:'Strict screening score, not a success probability. No independently verified customer, payment, retention, or acquisition evidence was submitted; self-reported stage does not increase this score.',analysisMode:results.some(x=>x.source==='ai')?'AI assisted':'Structured strict fallback',analysisNote:results.some(x=>x.source==='ai')?'AI reasoning was available, but claims remain unverified until supported by customer behavior.':fallbackNote,
 evidence:['Customer pain and willingness to pay have not yet been independently verified.','Current assessment is based on founder-provided context plus structured agent reasoning.','No live market database or competitor crawl is used unless explicitly configured.'],
 assumptions:['A reachable first customer segment can be defined within the next 2 weeks.','A low-cost prototype or concierge pilot can test the core promise.','Initial acquisition is founder-led until a repeatable channel is demonstrated.'],
 risks:['Demand may be weaker than stated; validate with behavior and payment.','Customer acquisition cost and retention are currently unknown.','Incumbent substitutes may already solve enough of the problem.'],
 recommendations:['Interview 15 people in one specific target segment.','Ask 3 prospects to pay for a pilot before building more.','Write a one-page experiment plan with success and stop criteria.','Revisit the score after collecting customer and pricing evidence.'],
 results};
}
const demoUser = db.prepare('SELECT id FROM users WHERE email=?').get('demo@realitycheck.ai');
if (!demoUser) {
 const id=uid(), created=now(); db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,'Alex Morgan','demo@realitycheck.ai',hashPassword('RealityCheck2026!'),created);
 const ideaId=uid(); db.prepare('INSERT INTO ideas(id,user_id,name,description,audience,stage,budget,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(ideaId,id,'StudyBuddy AI','An AI study companion that turns course materials into personalized study plans and quizzes.','University students in STEM courses','Validating','Under $1k',created,created);
 const results=agents.map(a=>({agent:a,...makeFallback({name:'StudyBuddy AI',description:'AI study companion',audience:'University students',stage:'Validating',budget:'Under $1k'},a)}));
 const report=scoreReport({budget:'Under $1k'},results); db.prepare('INSERT INTO reports(id,idea_id,user_id,status,score,verdict,data,created_at) VALUES(?,?,?,?,?,?,?,?)').run(uid(),ideaId,id,'complete',report.score,report.verdict,JSON.stringify(report),created);
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm','.jpg':'image/jpeg'};
function send(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>1e6)throw new Error('Request too large');}return s?JSON.parse(s):{};}
function safeReport(row){return {...row,data:typeof row.data==='string'?JSON.parse(row.data):row.data||null};}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 try{
  const url=new URL(req.url,'http://localhost'); const p=url.pathname;
  if(req.method==='POST'&&['/api/auth/login','/api/auth/signup'].includes(p)&&rateLimited(req,'auth',12,15*60*1000)){res.setHeader('Retry-After','900');return send(res,429,{error:'Too many sign-in attempts. Please try again in a few minutes.'});}
  if(req.method==='POST'&&p==='/api/advisor'&&rateLimited(req,'advisor',60,15*60*1000)){res.setHeader('Retry-After','900');return send(res,429,{error:'Advisor rate limit reached. Please try again shortly.'});}
  if(req.method==='GET'&&p.startsWith('/api/')){
   if(p==='/api/health')return send(res,200,{ok:true,aiConfigured:Boolean(process.env.GEMINI_API_KEY||process.env.OPENAI_API_KEY),authProvider:SUPABASE_ENABLED?'supabase':'local'});
   if(p==='/api/auth/me'){const u=await auth(req);return send(res,200,{user:u?{id:u.id,name:u.name,email:u.email}:null});}
   const user=await auth(req); if(!user)return send(res,401,{error:'Please sign in to continue.'});
   if(p==='/api/usage'){try{return send(res,200,{usage:await getMonthlyUsage(user)});}catch(e){console.error('Usage fetch failed:',e.message);return send(res,502,{error:'Could not load monthly credits.'});}}
   if(p==='/api/reports'){ 
    if(SUPABASE_ENABLED){const r=await supabaseRest(user,'reports?select=*,ideas(name)&order=created_at.desc');if(!r.ok)return send(res,502,{error:'Could not load report history.'});return send(res,200,{reports:(r.data||[]).map(x=>({...safeReport(x),idea_name:x.ideas?.name||'Startup idea'}))});}
    const rows=db.prepare(`SELECT r.id,r.idea_id,r.status,r.score,r.verdict,r.data,r.created_at,i.name AS idea_name FROM reports r JOIN ideas i ON i.id=r.idea_id WHERE r.user_id=? ORDER BY r.created_at DESC`).all(user.id);return send(res,200,{reports:rows.map(safeReport)});
   }
   if(p==='/api/ideas'){
    if(SUPABASE_ENABLED){const r=await supabaseRest(user,'ideas?select=*&order=updated_at.desc');if(!r.ok)return send(res,502,{error:'Could not load your ideas.'});return send(res,200,{ideas:r.data||[]});}
    const ideas=db.prepare('SELECT * FROM ideas WHERE user_id=? ORDER BY updated_at DESC').all(user.id);return send(res,200,{ideas});
   }
   const reportMatch=p.match(/^\/api\/reports\/([\w-]+)$/); if(reportMatch){
    if(SUPABASE_ENABLED){const r=await supabaseRest(user,`reports?select=*,ideas(name)&id=eq.${encodeURIComponent(reportMatch[1])}`);if(!r.ok||!r.data?.length)return send(res,404,{error:'Report not found.'});return send(res,200,{report:{...safeReport(r.data[0]),idea_name:r.data[0].ideas?.name||'Startup idea'}});}
    const row=db.prepare('SELECT * FROM reports WHERE id=? AND user_id=?').get(reportMatch[1],user.id);return row?send(res,200,{report:safeReport(row)}):send(res,404,{error:'Report not found.'});
   }
   return send(res,404,{error:'Not found.'});
  }
  if(req.method==='POST'&&p.startsWith('/api/')){
   const data=await body(req);
   if(p==='/api/auth/signup'){
    const name=String(data.name||'').trim(),email=String(data.email||'').trim().toLowerCase(),password=String(data.password||'');
    if(name.length<2||name.length>80)return send(res,400,{error:'Name must be 2–80 characters.'});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)return send(res,400,{error:'Enter a valid email address.'});
    if(password.length<10||password.length>200)return send(res,400,{error:'Password must be at least 10 characters.'});
    if(SUPABASE_ENABLED){const result=await supabaseAuth('signup',{email,password,data:{name}});if(!result.ok)return send(res,result.status===422?409:400,{error:result.data.msg||result.data.message||'Could not create the account.'});const session=result.data.session||result.data;if(!session?.access_token)return send(res,200,{needsConfirmation:true,message:'Account created. Check your email to finish signing up.'});return send(res,201,{user:{id:result.data.user.id,name:result.data.user.user_metadata?.name||name,email:result.data.user.email},session:{access_token:session.access_token,refresh_token:session.refresh_token}});}
    try{const id=uid();db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,name,email,hashPassword(password),now());setSession(res,id);return send(res,201,{user:{id,name,email}});}catch{return send(res,409,{error:'An account with that email already exists.'});}
   }
   if(p==='/api/auth/login'){
    const email=String(data.email||'').trim().toLowerCase(),password=String(data.password||'');
    if(SUPABASE_ENABLED){const result=await supabaseAuth('token?grant_type=password',{email,password});if(!result.ok)return send(res,401,{error:'Email or password is incorrect.'});return send(res,200,{user:{id:result.data.user.id,name:result.data.user.user_metadata?.name||result.data.user.email?.split('@')[0]||'Founder',email:result.data.user.email},session:{access_token:result.data.access_token,refresh_token:result.data.refresh_token}});}
    const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u||!verifyPassword(password,u.password_hash))return send(res,401,{error:'Email or password is incorrect.'});setSession(res,u.id);return send(res,200,{user:{id:u.id,name:u.name,email:u.email}});
   }
   if(p==='/api/auth/refresh'&&SUPABASE_ENABLED){const result=await supabaseAuth('token?grant_type=refresh_token',{refresh_token:data.refresh_token});if(!result.ok)return send(res,401,{error:'Your session expired. Please sign in again.'});return send(res,200,{session:{access_token:result.data.access_token,refresh_token:result.data.refresh_token},user:{id:result.data.user.id,name:result.data.user.user_metadata?.name||result.data.user.email?.split('@')[0]||'Founder',email:result.data.user.email}});}
   if(p==='/api/auth/logout'){if(SUPABASE_ENABLED){const token=req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1]||req.headers['x-realitycheck-session'];if(token)await fetch(`${SUPABASE_URL}/auth/v1/logout`,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}});}clearSession(res);return send(res,200,{ok:true});}
   const user=await auth(req);if(!user)return send(res,401,{error:'Please sign in to continue.'});
   if(p==='/api/ideas'){
    const name=String(data.name||'').trim(),description=String(data.description||'').trim(),audience=String(data.audience||'').trim(),stage=String(data.stage||'Idea'),budget=String(data.budget||'Under $1k');
    if(name.length<3||name.length>100)return send(res,400,{error:'Idea name must be 3–100 characters.'});if(description.length<30||description.length>2500)return send(res,400,{error:'Description must be 30–2,500 characters.'});if(audience.length<3||audience.length>250)return send(res,400,{error:'Add a target customer (3–250 characters).'});
    if(SUPABASE_ENABLED){const r=await supabaseRest(user,'ideas',{method:'POST',body:{user_id:user.id,name,description,audience,stage,budget}});if(!r.ok)return send(res,502,{error:'Could not save the idea. Check your Supabase connection.'});return send(res,201,{idea:r.data?.[0]});}
    const id=uid(),time=now();db.prepare('INSERT INTO ideas VALUES(?,?,?,?,?,?,?,?,?)').run(id,user.id,name,description,audience,stage,budget,time,time);return send(res,201,{idea:{id,name,description,audience,stage,budget,created_at:time}});
   }
   const analyze=p.match(/^\/api\/ideas\/([\w-]+)\/analyze$/);if(analyze){
    let idea,reportId,created=now();
    if(SUPABASE_ENABLED){const found=await supabaseRest(user,`ideas?id=eq.${encodeURIComponent(analyze[1])}&select=*`);idea=found.ok?found.data?.[0]:null;if(!idea)return send(res,404,{error:'Idea not found.'});}
    else{idea=db.prepare('SELECT * FROM ideas WHERE id=? AND user_id=?').get(analyze[1],user.id);if(!idea)return send(res,404,{error:'Idea not found.'});}
    let credit;try{credit=await consumeMonthlyUsage(user,'report')}catch(e){console.error('Report credit check failed:',e.message);return send(res,502,{error:'Could not check your report credits. Please try again.'})}
    if(!credit.allowed)return send(res,429,{error:`You’ve used all ${credit.limit} report credits for this month. They reset on ${credit.resetDate}. See Plans & usage for details.`,usage:credit});
    if(SUPABASE_ENABLED){const inserted=await supabaseRest(user,'reports',{method:'POST',body:{idea_id:idea.id,user_id:user.id,status:'running'}});if(!inserted.ok)return send(res,502,{error:'Could not start the analysis.'});reportId=inserted.data?.[0]?.id;created=inserted.data?.[0]?.created_at||created;}
    else{reportId=uid();db.prepare('INSERT INTO reports(id,idea_id,user_id,status,created_at) VALUES(?,?,?,?,?)').run(reportId,idea.id,user.id,'running',created);}
    try{const results=await analyzePanel(idea);const report=scoreReport(idea,results);if(SUPABASE_ENABLED){const updated=await supabaseRest(user,`reports?id=eq.${reportId}`,{method:'PATCH',body:{status:'complete',score:report.score,verdict:report.verdict,data:report}});if(!updated.ok)throw new Error('Could not save report');await supabaseRest(user,`ideas?id=eq.${idea.id}`,{method:'PATCH',body:{updated_at:now()}});}else{db.prepare('UPDATE reports SET status=?,score=?,verdict=?,data=? WHERE id=?').run('complete',report.score,report.verdict,JSON.stringify(report),reportId);db.prepare('UPDATE ideas SET updated_at=? WHERE id=?').run(now(),idea.id);}return send(res,200,{report:{id:reportId,idea_id:idea.id,idea_name:idea.name,status:'complete',score:report.score,verdict:report.verdict,data:report,created_at:created}});}catch(e){console.error('Report save failed:',e.message);if(SUPABASE_ENABLED)await supabaseRest(user,`reports?id=eq.${reportId}`,{method:'PATCH',body:{status:'failed'}});else db.prepare('UPDATE reports SET status=? WHERE id=?').run('failed',reportId);return send(res,500,{error:'Analysis failed. Please try again.'});}
   }
   if(p==='/api/advisor'){
    const question=String(data.message||'').trim();if(question.length<2||question.length>1500)return send(res,400,{error:'Message must be 2–1,500 characters.'});
    const history=Array.isArray(data.history)?data.history.slice(-12).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string').map(m=>({role:m.role,text:m.text.slice(0,1500)})):[];
    const turns=history.length?history:[];if(!turns.length||turns.at(-1).role!=='user'||turns.at(-1).text!==question)turns.push({role:'user',text:question});
    const lower=question.toLowerCase().trim();const hi=/^(hi+|hello+|hey+|hiya|howdy|good morning|good afternoon|good evening|namaste|नमस्ते|हाय)[!.?\s]*$/i.test(lower);
    const thanks=/^(thanks?|thank you|thx|ty|shukriya|धन्यवाद)[!.?\s]*$/i.test(lower);
    if(hi)return send(res,200,{reply:/namaste|नमस्ते|हाय/.test(lower)?'Namaste! 😊 Kya haal hai? Startup idea par baat karni hai, ya bas kuch poochna hai?':'Hey! 😊 What’s on your mind? We can talk through your startup idea, a customer problem, or anything you’re figuring out.'});
    if(thanks)return send(res,200,{reply:'You’re welcome! 😊 What else are you thinking through?'});
    let advisorCredit;try{advisorCredit=await consumeMonthlyUsage(user,'advisor')}catch(e){console.error('Advisor credit check failed:',e.message);return send(res,502,{error:'Could not check your Advisor replies. Please try again.'})}
    if(!advisorCredit.allowed)return send(res,429,{error:`You’ve used all ${advisorCredit.limit} Advisor replies for this month. They reset on ${advisorCredit.resetDate}. See Plans & usage for details.`,usage:advisorCredit});
    const system='You are RealityCheck Advisor, a warm, sharp, genuinely conversational startup coach. Respond to the whole conversation, remembering relevant earlier details. For greetings and ordinary small talk, reply naturally and briefly—do not force startup frameworks into every exchange. Match the user’s language and casual/formal tone; if they use Hinglish, you may answer naturally in Hinglish. For startup questions, be specific, practical, candid, and concise: explain reasoning, distinguish known facts from assumptions, and suggest a concrete next step. Ask one useful follow-up only when needed. Never invent research or statistics. Usually answer in 2–5 short sentences.';let aiUnavailable=false;
    if(process.env.GEMINI_API_KEY){try{const reply=await callGemini(turns,system,false);if(reply)return send(res,200,{reply});aiUnavailable=true}catch(e){aiUnavailable=true;console.error('Gemini advisor fallback:',e.message);}}else aiUnavailable=true;
    if(process.env.OPENAI_API_KEY){try{const messages=[{role:'system',content:system},...turns.map(m=>({role:m.role,content:m.text}))];const r=await fetch(process.env.OPENAI_BASE_URL||'https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',temperature:0.75,messages})});if(r.ok){const j=await r.json();const reply=j.choices?.[0]?.message?.content;if(reply)return send(res,200,{reply});}aiUnavailable=true}catch(e){aiUnavailable=true;console.error('Advisor error',e.message);}}
    const l=lower;let reply='Tell me a little more about what you’re working through, and I’ll help you find a practical next step.';
    if(/\b(price|pricing|revenue|charge|pay)\b/.test(l))reply='Start with a real customer and a real buying decision. Offer two or three clearly different price points, then ask qualified prospects to choose or commit to a paid pilot—not just say what sounds reasonable. What are you selling, and who would pay for it?';
    else if(/\b(customer|interview|audience|users?)\b/.test(l))reply='Pick one narrow customer group and ask about the last time they faced this problem: what they did, what it cost them, and what they tried before. Avoid pitching until you understand their current workaround. Who is the first group you have access to?';
    else if(/\b(competitor|competition|different|stand out)\b/.test(l))reply='Compare your idea not only with direct competitors, but also spreadsheets, manual workarounds, and doing nothing. The useful question is what measurable outcome would make a specific customer switch. What does your idea help them do better?';
    else if(/\b(risk|fail|uncertain|assumption)\b/.test(l))reply='Name the assumption that would hurt most if it were wrong, then test it cheaply before building more. For example, ask a qualified customer for a concrete commitment rather than positive feedback. Which assumption feels riskiest to you?';
    else if(/\b(build|mvp|prototype|start)\b/.test(l))reply='Before building the full product, test the core outcome manually or with a simple prototype. Find a few people who have the problem, walk them through the smallest useful version, and watch what they actually do. What is the main thing your first version needs to prove?';
    return send(res,200,{reply,degraded:aiUnavailable});
   }
   return send(res,404,{error:'Not found.'});
  }
  if(p.startsWith('/api/'))return send(res,405,{error:'Method not allowed.'});
  let file=p==='/'?'index.html':decodeURIComponent(p.slice(1));if(file.includes('..'))return send(res,400,{error:'Invalid path'});const target=path.join(__dirname,'public',file);
  try{const content=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(content);}catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
 }catch(e){console.error(e);send(res,500,{error:'Unexpected server error.'});}
});
server.listen(PORT,HOST,()=>console.log(`RealityCheck AI running at http://${HOST}:${PORT}`));
