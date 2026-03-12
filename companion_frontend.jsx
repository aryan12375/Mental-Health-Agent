import { useState, useRef, useEffect, useCallback } from "react";

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════════
const API = "http://localhost:8000";

// Stable anonymous user ID — persists across refreshes, no login needed
function getUserId() {
  let id = localStorage.getItem("companion_uid");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("companion_uid", id); }
  return id;
}
const USER_ID = getUserId();

// ── API helpers ────────────────────────────────────────────────────────────────
async function apiPost(path, body) {
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`[API] ${path} failed:`, e);
    return null;
  }
}

async function apiGet(path) {
  try {
    const res = await fetch(`${API}${path}`);
    return await res.json();
  } catch (e) {
    console.error(`[API] ${path} failed:`, e);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: PASSIVE DIGITAL PHENOTYPING
// Tracks WPM + backspace ratio — fires BreathingOrb BEFORE send
// ══════════════════════════════════════════════════════════════════════════════
function useDigitalPhenotyping(onDistressSignal) {
  const ref = useRef({ lastKeyTime:null, intervals:[], backspaceCount:0, totalKeys:0, alreadyTriggered:false });
  const timerRef = useRef(null);

  const recordKey = useCallback((e) => {
    const b = ref.current;
    const now = Date.now();
    if (e.key === "Backspace") b.backspaceCount++;
    b.totalKeys++;
    if (b.lastKeyTime !== null) {
      const interval = now - b.lastKeyTime;
      if (interval < 8000) b.intervals.push(interval);
    }
    b.lastKeyTime = now;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { if (ref.current.totalKeys > 0) ref.current.longPauses = (ref.current.longPauses||0)+1; }, 4000);

    if (b.totalKeys > 15 && b.intervals.length > 10) {
      const recent = b.intervals.slice(-12);
      const avgMs = recent.reduce((a,v)=>a+v,0)/recent.length;
      const wpm = avgMs > 0 ? Math.round(60000/avgMs/5) : 0;
      const bsRatio = b.backspaceCount / b.totalKeys;
      const distress = (wpm<20?0.5:wpm<35?0.25:0) + (bsRatio>0.35?0.4:bsRatio>0.2?0.2:0);
      if (distress > 0.4 && !b.alreadyTriggered) {
        b.alreadyTriggered = true;
        onDistressSignal({ wpm, backspaceRatio: Math.round(bsRatio*100), distressScore: distress });
      }
    }
  }, [onDistressSignal]);

  const reset = useCallback(() => {
    ref.current = { lastKeyTime:null, intervals:[], backspaceCount:0, totalKeys:0, alreadyTriggered:false, longPauses:0 };
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const getBonus = useCallback(() => {
    const b = ref.current;
    return b.totalKeys < 10 ? 0 : Math.min((b.backspaceCount/Math.max(b.totalKeys,1))*0.4, 0.3);
  }, []);

  return { recordKey, resetPhenotyping: reset, getHesitationScore: getBonus };
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE: SEMANTIC DRIFT (frontend-side, feeds into gatekeeper)
// ══════════════════════════════════════════════════════════════════════════════
const DRIFT_POS = ["okay","fine","good","better","happy","hopeful","grateful","calm","peaceful"];
const DRIFT_NEG = ["tired","empty","lost","numb","hopeless","pointless","alone","worthless","broken","dark"];

function computeSemanticScore(text) {
  const l = text.toLowerCase();
  let s = 0.5;
  DRIFT_POS.forEach(w=>{ if(l.includes(w)) s-=0.06; });
  DRIFT_NEG.forEach(w=>{ if(l.includes(w)) s+=0.07; });
  return Math.max(0, Math.min(1, s));
}

function getDriftDelta(history, cur) {
  if (history.length < 3) return 0;
  return cur - history.reduce((a,b)=>a+b,0)/history.length;
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

function BreathingOrb({ active, phase, phenotyping }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5, opacity:active?1:0, transition:"opacity 1s ease" }}>
      <div style={{
        width:phenotyping?52:40, height:phenotyping?52:40, borderRadius:"50%",
        background:phenotyping
          ?"radial-gradient(circle,rgba(183,160,134,0.6) 0%,rgba(183,160,134,0.06) 70%)"
          :"radial-gradient(circle,rgba(134,183,168,0.55) 0%,rgba(134,183,168,0.06) 70%)",
        animation:active?"breathe 4s ease-in-out infinite":"none",
        boxShadow:phenotyping?"0 0 22px rgba(183,160,134,0.28)":"0 0 16px rgba(134,183,168,0.2)",
        transition:"all 0.8s ease",
      }}/>
      <span style={{ fontSize:10, color:phenotyping?"#b0906a":"#6a9088", letterSpacing:"0.1em", transition:"color 0.8s" }}>
        {phenotyping?"take a breath":phase==="in"?"breathe in":phase==="out"?"breathe out":"breathe"}
      </span>
      <style>{`@keyframes breathe{0%,100%{transform:scale(1);opacity:0.4}50%{transform:scale(1.65);opacity:1}}`}</style>
    </div>
  );
}

function SilenceAlert({ onDismiss }) {
  return (
    <div style={{ background:"rgba(120,100,70,0.09)", border:"1px solid rgba(180,150,100,0.2)", borderRadius:12, padding:"11px 16px", margin:"0 24px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
      <div>
        <div style={{ fontSize:11, color:"#c4956a", letterSpacing:"0.07em", marginBottom:2 }}>WE NOTICED YOUR ABSENCE</div>
        <div style={{ fontSize:12.5, color:"#8a9e96", fontFamily:"'Lora',Georgia,serif" }}>It's been a few days. How are you doing today?</div>
      </div>
      <button onClick={onDismiss} style={{ background:"transparent", border:"none", color:"#4a6b5e", cursor:"pointer", fontSize:20, lineHeight:1 }}>×</button>
    </div>
  );
}

function MicroValidation({ onRate }) {
  const [sel, setSel] = useState(null);
  const [vis, setVis] = useState(false);
  useEffect(()=>{setTimeout(()=>setVis(true),100);},[]);
  return (
    <div style={{ background:"rgba(100,130,120,0.07)", border:"1px solid rgba(134,183,168,0.14)", borderRadius:14, padding:"15px 17px", marginTop:8, maxWidth:460, opacity:vis?1:0, transform:vis?"translateY(0)":"translateY(8px)", transition:"all 0.6s ease" }}>
      <div style={{ fontSize:13, color:"#a8c8bc", fontFamily:"'Lora',Georgia,serif", marginBottom:11, lineHeight:1.65 }}>
        That sounds really heavy. On a scale of 1–5, how okay are you right now?
      </div>
      <div style={{ display:"flex", gap:8 }}>
        {[1,2,3,4,5].map(n=>(
          <button key={n} onClick={()=>{setSel(n);setTimeout(()=>onRate(n),400);}} style={{ width:38, height:38, borderRadius:"50%", background:sel===n?"rgba(134,183,168,0.22)":"rgba(255,255,255,0.03)", border:`1px solid ${sel===n?"rgba(134,183,168,0.5)":"rgba(255,255,255,0.07)"}`, color:sel===n?"#86b7a8":"#5a7a70", fontSize:13.5, cursor:"pointer", transition:"all 0.2s ease", fontFamily:"Georgia,serif" }}>{n}</button>
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:5 }}>
        <span style={{ fontSize:10, color:"#3a4e46" }}>not okay</span>
        <span style={{ fontSize:10, color:"#3a4e46" }}>doing okay</span>
      </div>
    </div>
  );
}

function CrisisPanel({ resources }) {
  const [vis, setVis] = useState(false);
  const [peerOpen, setPeerOpen] = useState(false);
  useEffect(()=>{setTimeout(()=>setVis(true),100);},[]);
  const res = resources || {
    primary:  { name:"NIMHANS Helpline",     number:"080-46110007",  available:"24/7", type:"Hospital"    },
    national: { name:"Tele-MANAS",           number:"14416",         available:"24/7", type:"National"    },
    local:    { name:"Vandrevala Foundation", number:"1860-2662-345", available:"24/7", type:"Counselling" },
  };
  return (
    <div style={{ background:"rgba(175,145,120,0.07)", border:"1px solid rgba(175,145,120,0.28)", borderRadius:16, padding:"19px 21px", marginTop:8, opacity:vis?1:0, transform:vis?"translateY(0)":"translateY(8px)", transition:"all 0.7s ease", maxWidth:490 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:13 }}>
        <div style={{ width:8, height:8, borderRadius:"50%", background:"#c4956a", boxShadow:"0 0 8px rgba(196,149,106,0.65)", animation:"pulse-dot 2s ease-in-out infinite" }}/>
        <span style={{ fontSize:13, color:"#c4956a", letterSpacing:"0.06em", fontFamily:"Georgia,serif" }}>You're not alone right now</span>
      </div>
      <p style={{ fontSize:13.5, color:"#b0beb8", lineHeight:1.75, marginBottom:15, fontFamily:"'Lora',Georgia,serif" }}>
        What you shared matters deeply. These people are trained to help — and they want to hear from you.
      </p>
      {Object.values(res).map((r,i)=>(
        <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 14px", background:"rgba(255,255,255,0.025)", borderRadius:10, marginBottom:8, border:"1px solid rgba(255,255,255,0.055)" }}>
          <div>
            <div style={{ fontSize:12.5, color:"#d0d8d4", fontFamily:"Georgia,serif" }}>{r.name}</div>
            <div style={{ fontSize:10, color:"#4a6a60", marginTop:2 }}>{r.type} · {r.available}</div>
          </div>
          <a href={`tel:${r.number.replace(/-/g,"")}`} style={{ fontSize:14, fontWeight:600, color:"#86b7a8", textDecoration:"none", letterSpacing:"0.04em", fontFamily:"Georgia,serif" }}>{r.number}</a>
        </div>
      ))}
      <div style={{ marginTop:13, borderTop:"1px solid rgba(255,255,255,0.05)", paddingTop:13 }}>
        <button onClick={()=>setPeerOpen(!peerOpen)} style={{ width:"100%", background:"transparent", border:"1px solid rgba(134,183,168,0.13)", borderRadius:10, padding:"10px 14px", color:"#6a9088", fontSize:12.5, fontFamily:"'Lora',Georgia,serif", cursor:"pointer", textAlign:"left", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span>Talk to someone who's been there</span>
          <span style={{ opacity:0.45 }}>{peerOpen?"−":"+"}</span>
        </button>
        {peerOpen && (
          <div style={{ marginTop:10, padding:"14px 15px", background:"rgba(100,140,120,0.06)", borderRadius:10, border:"1px solid rgba(134,183,168,0.09)" }}>
            <p style={{ fontSize:13, color:"#9ab0a8", lineHeight:1.75, marginBottom:11, fontFamily:"'Lora',Georgia,serif", fontStyle:"italic" }}>"I was where you are. I know what this silence feels like. And I'm still here."</p>
            <div style={{ fontSize:11.5, color:"#4a6058", marginBottom:10, lineHeight:1.6 }}>Peer support volunteers — not therapists, just humans who've been through it and want to listen.</div>
            <div style={{ padding:"10px 13px", background:"rgba(255,255,255,0.025)", borderRadius:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div><div style={{ fontSize:12.5, color:"#c8d8d2", fontFamily:"Georgia,serif" }}>iCall Peer Support</div><div style={{ fontSize:10, color:"#4a6058", marginTop:2 }}>TISS · Trained volunteers</div></div>
              <a href="tel:9152987821" style={{ fontSize:13, color:"#86b7a8", textDecoration:"none", fontFamily:"Georgia,serif" }}>9152987821</a>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes pulse-dot{0%,100%{opacity:0.6;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}`}</style>
    </div>
  );
}

function FutureSelfLetter({ onDismiss }) {
  const [open, setOpen] = useState(false);
  const [letter, setLetter] = useState("");
  const [sent, setSent] = useState(false);
  const d = new Date(Date.now()+30*24*60*60*1000).toLocaleDateString("en-IN",{day:"numeric",month:"long"});
  if (sent) return <div style={{ marginTop:8, padding:"13px 16px", background:"rgba(100,140,120,0.07)", borderRadius:12, border:"1px solid rgba(134,183,168,0.11)", maxWidth:460 }}><div style={{ fontSize:13, color:"#86b7a8", fontFamily:"'Lora',Georgia,serif", fontStyle:"italic" }}>Your letter is sealed. It will find you on {d}. ✦</div></div>;
  return (
    <div style={{ marginTop:8, maxWidth:460 }}>
      {!open ? (
        <button onClick={()=>setOpen(true)} style={{ background:"transparent", border:"1px solid rgba(134,183,168,0.14)", borderRadius:10, padding:"9px 15px", color:"#6a9088", fontSize:12.5, fontFamily:"'Lora',Georgia,serif", cursor:"pointer", display:"flex", alignItems:"center", gap:8 }}>
          <span>✦</span> Write a letter to your future self — delivered in 30 days
        </button>
      ) : (
        <div style={{ background:"rgba(255,255,255,0.02)", border:"1px solid rgba(134,183,168,0.13)", borderRadius:12, padding:"15px" }}>
          <div style={{ fontSize:11.5, color:"#4a6058", marginBottom:9, fontStyle:"italic" }}>Dear {d}-me...</div>
          <textarea value={letter} onChange={e=>setLetter(e.target.value)} placeholder="What would you want your future self to know?" rows={4} style={{ width:"100%", background:"transparent", border:"none", outline:"none", color:"#c8d8d2", fontSize:13, fontFamily:"'Lora',Georgia,serif", lineHeight:1.7, resize:"none", caretColor:"#86b7a8", boxSizing:"border-box" }}/>
          <div style={{ display:"flex", gap:8, marginTop:9 }}>
            <button onClick={()=>{if(letter.trim())setSent(true);}} disabled={!letter.trim()} style={{ flex:1, padding:"9px", borderRadius:8, border:"1px solid rgba(134,183,168,0.22)", background:letter.trim()?"rgba(134,183,168,0.09)":"transparent", color:letter.trim()?"#86b7a8":"#3d5049", fontSize:12, fontFamily:"'Lora',Georgia,serif", cursor:letter.trim()?"pointer":"default" }}>Seal & send</button>
            <button onClick={onDismiss} style={{ padding:"9px 13px", borderRadius:8, border:"1px solid rgba(255,255,255,0.05)", background:"transparent", color:"#3d5049", fontSize:12, fontFamily:"'Lora',Georgia,serif", cursor:"pointer" }}>Later</button>
          </div>
        </div>
      )}
    </div>
  );
}

function InlineSafetyContact({ onSave, onSkip }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vis, setVis] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(()=>{setTimeout(()=>setVis(true),200);},[]);
  if (saved) return <div style={{ marginTop:8, padding:"12px 16px", background:"rgba(100,140,120,0.07)", borderRadius:12, border:"1px solid rgba(134,183,168,0.12)", maxWidth:460, opacity:1 }}><div style={{ fontSize:13, color:"#86b7a8", fontFamily:"'Lora',Georgia,serif" }}>{name?`Got it. I'll keep ${name} in mind quietly.`:"Noted. I'll keep watch quietly."} ✦</div></div>;
  const inp = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(134,183,168,0.12)", borderRadius:8, padding:"9px 13px", color:"#c8d8d2", fontSize:13, fontFamily:"'Lora',Georgia,serif", outline:"none", width:"100%", boxSizing:"border-box" };
  return (
    <div style={{ marginTop:8, maxWidth:480, opacity:vis?1:0, transform:vis?"translateY(0)":"translateY(6px)", transition:"all 0.5s ease" }}>
      <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(134,183,168,0.12)", borderRadius:14, padding:"16px 18px" }}>
        <p style={{ fontSize:13.5, color:"#a8b8b2", lineHeight:1.75, marginBottom:14, fontFamily:"'Lora',Georgia,serif" }}>
          You've shared something real with me today. Is there one person in your life who knows you come here — someone I could quietly nudge if I ever felt you really needed support?
        </p>
        <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Their name (optional)" style={inp}/>
          <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Their number (optional)" type="tel" style={inp}/>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={()=>{setSaved(true);setTimeout(()=>onSave({name,phone}),600);}} style={{ flex:1, padding:"9px", borderRadius:8, border:"1px solid rgba(134,183,168,0.25)", background:"rgba(134,183,168,0.08)", color:"#86b7a8", fontSize:12.5, fontFamily:"'Lora',Georgia,serif", cursor:"pointer" }}>Yes, keep them in mind</button>
          <button onClick={onSkip} style={{ padding:"9px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.05)", background:"transparent", color:"#4a6058", fontSize:12.5, fontFamily:"'Lora',Georgia,serif", cursor:"pointer" }}>Not right now</button>
        </div>
      </div>
    </div>
  );
}

function TrendPanel({ data, onDismiss }) {
  const [vis, setVis] = useState(false);
  useEffect(()=>{setTimeout(()=>setVis(true),100);},[]);
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d=>d.avg), 0.6);
  return (
    <div style={{ background:"rgba(140,100,60,0.07)", border:"1px solid rgba(180,140,80,0.2)", borderRadius:14, padding:"16px 18px", margin:"0 24px 14px", opacity:vis?1:0, transform:vis?"translateY(0)":"translateY(6px)", transition:"all 0.5s ease" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
        <div>
          <div style={{ fontSize:11, color:"#c4956a", letterSpacing:"0.08em", marginBottom:3 }}>WELLBEING TREND — 7 DAYS</div>
          <div style={{ fontSize:12.5, color:"#8a9080", fontFamily:"'Lora',Georgia,serif" }}>A gentle upward pattern has been detected. We wanted you to know we noticed.</div>
        </div>
        <button onClick={onDismiss} style={{ background:"transparent", border:"none", color:"#4a5a50", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
      </div>
      <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:52, marginBottom:6 }}>
        {data.map((d,i)=>{
          const h = Math.round((d.avg/max)*44);
          const isLast = i===data.length-1;
          return <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}><div style={{ width:"100%", height:h, borderRadius:"3px 3px 0 0", background:isLast?"rgba(196,149,106,0.55)":"rgba(134,183,168,0.25)", minHeight:3 }}/><span style={{ fontSize:9, color:isLast?"#c4956a":"#3a5048" }}>{d.day}</span></div>;
        })}
      </div>
      <div style={{ fontSize:11.5, color:"#6a8878", fontFamily:"'Lora',Georgia,serif", marginTop:4, fontStyle:"italic" }}>Would you like to talk about what's been building up this week?</div>
    </div>
  );
}

const CBT_STEPS = [
  { sense:"SEE",   instruction:"Name 5 things you can see right now",       count:5, color:"rgba(134,183,168,0.7)" },
  { sense:"TOUCH", instruction:"Name 4 things you can physically feel",      count:4, color:"rgba(160,183,134,0.7)" },
  { sense:"HEAR",  instruction:"Name 3 sounds you can hear right now",       count:3, color:"rgba(134,160,183,0.7)" },
  { sense:"SMELL", instruction:"Name 2 things you can smell or love to",     count:2, color:"rgba(183,160,134,0.7)" },
  { sense:"TASTE", instruction:"Name 1 taste, or something comforting",      count:1, color:"rgba(183,134,160,0.7)" },
];

function CBTGrounding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState([]);
  const [done, setDone] = useState(false);
  const [vis, setVis] = useState(false);
  useEffect(()=>{setTimeout(()=>setVis(true),80);},[]);
  const s = CBT_STEPS[step];
  const allChecked = checked.length >= s.count;
  function next() {
    if (step < CBT_STEPS.length-1) { setStep(v=>v+1); setChecked([]); }
    else { setDone(true); setTimeout(onComplete,1200); }
  }
  if (done) return <div style={{ position:"fixed", inset:0, background:"rgba(5,12,9,0.92)", backdropFilter:"blur(12px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50 }}><div style={{ textAlign:"center", padding:"40px 32px" }}><div style={{ fontSize:32, marginBottom:16 }}>✦</div><div style={{ fontSize:18, color:"#a0c0b4", fontFamily:"'DM Serif Display',Georgia,serif", marginBottom:10 }}>Well done.</div><div style={{ fontSize:13.5, color:"#6a8880", fontFamily:"'Lora',Georgia,serif" }}>You just brought yourself back to the present moment.</div></div></div>;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(5,12,9,0.93)", backdropFilter:"blur(12px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:50, opacity:vis?1:0, transition:"opacity 0.5s ease" }}>
      <div style={{ background:"#0f1e18", border:"1px solid rgba(134,183,168,0.13)", borderRadius:22, padding:"32px 28px", maxWidth:420, width:"90%", boxShadow:"0 24px 70px rgba(0,0,0,0.6)" }}>
        <div style={{ display:"flex", gap:6, justifyContent:"center", marginBottom:24 }}>
          {CBT_STEPS.map((_,i)=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:i<=step?"rgba(134,183,168,0.6)":"rgba(255,255,255,0.08)", transition:"background 0.3s" }}/>)}
        </div>
        <div style={{ fontSize:11, color:"#3a6050", letterSpacing:"0.14em", marginBottom:8, textAlign:"center" }}>GROUNDING EXERCISE · {step+1} OF 5</div>
        <div style={{ fontSize:11, color:s.color, letterSpacing:"0.1em", marginBottom:6, textAlign:"center", fontFamily:"Georgia,serif" }}>{s.sense}</div>
        <div style={{ fontSize:15, color:"#a8c8bc", fontFamily:"'DM Serif Display',Georgia,serif", textAlign:"center", marginBottom:6, lineHeight:1.5 }}>{s.instruction}</div>
        <div style={{ fontSize:12, color:"#4a6858", fontFamily:"'Lora',Georgia,serif", textAlign:"center", marginBottom:24, fontStyle:"italic" }}>Tap each one as you notice it</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8, justifyContent:"center", marginBottom:24 }}>
          {Array.from({length:s.count}).map((_,i)=>(
            <button key={i} onClick={()=>{ if(!checked.includes(i)) setChecked(p=>[...p,i]); }} style={{ width:44, height:44, borderRadius:"50%", background:checked.includes(i)?"rgba(134,183,168,0.25)":"rgba(255,255,255,0.04)", border:`1px solid ${checked.includes(i)?"rgba(134,183,168,0.55)":"rgba(255,255,255,0.08)"}`, color:checked.includes(i)?"#86b7a8":"#4a6858", fontSize:18, cursor:"pointer", transition:"all 0.25s ease" }}>
              {checked.includes(i)?"✓":i+1}
            </button>
          ))}
        </div>
        <button onClick={next} disabled={!allChecked} style={{ width:"100%", padding:"13px", borderRadius:12, background:allChecked?"rgba(134,183,168,0.14)":"transparent", border:`1px solid ${allChecked?"rgba(134,183,168,0.32)":"rgba(255,255,255,0.06)"}`, color:allChecked?"#86b7a8":"#2e4038", fontSize:13.5, fontFamily:"'Lora',Georgia,serif", cursor:allChecked?"pointer":"default", transition:"all 0.3s ease" }}>
          {allChecked?(step<4?"Next →":"I'm grounded"):`${s.count-checked.length} more to notice`}
        </button>
        <div style={{ fontSize:11, color:"#2e4038", textAlign:"center", marginTop:12 }}>5-4-3-2-1 Grounding · CBT Technique</div>
      </div>
    </div>
  );
}

function DriftBar({ history }) {
  if (history.length < 5) return null;
  const baseline = history.slice(0,-3).reduce((a,b)=>a+b,0)/Math.max(history.length-3,1);
  const recent = history.slice(-3).reduce((a,b)=>a+b,0)/3;
  const drift = recent - baseline;
  if (Math.abs(drift) < 0.09) return null;
  const worse = drift > 0;
  return (
    <div style={{ margin:"0 24px 12px", padding:"10px 14px", background:worse?"rgba(180,120,80,0.06)":"rgba(80,150,120,0.06)", border:`1px solid ${worse?"rgba(180,120,80,0.16)":"rgba(80,150,120,0.16)"}`, borderRadius:10, display:"flex", alignItems:"center", gap:10 }}>
      <span>{worse?"↘":"↗"}</span>
      <div style={{ fontSize:12, color:worse?"#b08860":"#60a880", fontFamily:"'Lora',Georgia,serif" }}>
        {worse?"Your messages have felt heavier lately. That's okay — this is a safe place.":"You seem a little lighter than before. Glad you're here."}
      </div>
    </div>
  );
}

function PhenotypingNotice({ onDismiss }) {
  return (
    <div style={{ margin:"0 24px 12px", padding:"11px 15px", background:"rgba(183,160,100,0.06)", border:"1px solid rgba(183,160,100,0.18)", borderRadius:10, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
      <div style={{ fontSize:12.5, color:"#a09060", fontFamily:"'Lora',Georgia,serif" }}>You seem to be taking your time with this one. That's okay — there's no hurry here.</div>
      <button onClick={onDismiss} style={{ background:"transparent", border:"none", color:"#4a5040", cursor:"pointer", fontSize:18, lineHeight:1 }}>×</button>
    </div>
  );
}

function MessageBubble({ msg, index, onMicroRate, onSafetyContactSave, onSafetyContactSkip }) {
  const [vis, setVis] = useState(false);
  const [showLetter, setShowLetter] = useState(true);
  useEffect(()=>{setTimeout(()=>setVis(true),50*Math.min(index,8));},[]);
  const isUser = msg.role==="user";
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:isUser?"flex-end":"flex-start", marginBottom:20, opacity:vis?1:0, transform:vis?"translateY(0)":"translateY(10px)", transition:"all 0.45s ease" }}>
      {!isUser && <div style={{ fontSize:10, color:"#3a5448", marginBottom:4, marginLeft:2, letterSpacing:"0.13em" }}>COMPANION</div>}
      <div style={{ maxWidth:490, padding:"13px 18px", borderRadius:isUser?"18px 18px 4px 18px":"18px 18px 18px 4px", background:isUser?"rgba(134,183,168,0.09)":"rgba(255,255,255,0.032)", border:isUser?"1px solid rgba(134,183,168,0.17)":"1px solid rgba(255,255,255,0.055)", fontSize:14, lineHeight:1.78, color:"#c8d8d2", fontFamily:"'Lora',Georgia,serif" }}>
        {msg.text}
      </div>
      {msg.crisis && <CrisisPanel resources={msg.resources}/>}
      {msg.needsMicro && <MicroValidation onRate={onMicroRate}/>}
      {msg.offerLetter && showLetter && <FutureSelfLetter onDismiss={()=>setShowLetter(false)}/>}
      {msg.askSafetyContact && <InlineSafetyContact onSave={onSafetyContactSave} onSkip={onSafetyContactSkip}/>}
      <div style={{ fontSize:10, color:"#253830", marginTop:4, marginRight:isUser?2:0, marginLeft:isUser?0:2 }}>
        {msg.time}{msg.lateNight?" · late night":""}{msg.goodbye?" · gentle hold":""}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display:"flex", gap:5, padding:"13px 17px", alignItems:"center" }}>
      {[0,1,2].map(i=><div key={i} style={{ width:5.5, height:5.5, borderRadius:"50%", background:"#3a5a50", animation:`dot-bounce 1.2s ease-in-out ${i*0.2}s infinite` }}/>)}
      <style>{`@keyframes dot-bounce{0%,80%,100%{transform:translateY(0);opacity:0.35}40%{transform:translateY(-6px);opacity:1}}`}</style>
    </div>
  );
}

function MoodChip({ label, onClick }) {
  const [hov, setHov] = useState(false);
  return <button onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)} style={{ padding:"6px 13px", borderRadius:20, border:`1px solid ${hov?"rgba(134,183,168,0.32)":"rgba(255,255,255,0.07)"}`, background:hov?"rgba(134,183,168,0.07)":"transparent", color:hov?"#86b7a8":"#607870", fontSize:12.5, cursor:"pointer", transition:"all 0.22s ease", fontFamily:"'Lora',Georgia,serif" }}>{label}</button>;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [messages, setMessages] = useState([{
    role:"assistant", crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false,
    text:"Hello. This is a quiet space — no rush, no judgment. How are you feeling today?",
    time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
    lateNight:new Date().getHours()>=1&&new Date().getHours()<=5,
  }]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [breathe, setBreathe] = useState(false);
  const [breathePhase, setBreathePhase] = useState("breathe");
  const [riskLevel, setRiskLevel] = useState(0);
  const [semHistory, setSemHistory] = useState([]);
  const [microPending, setMicroPending] = useState(false);
  const [showSilence, setShowSilence] = useState(false);
  const [showCBT, setShowCBT] = useState(false);
  const [cbtTriggeredRef] = useState({triggered:false});
  const [showTrend, setShowTrend] = useState(false);
  const [trendData, setTrendData] = useState([]);
  const [phenotypingNotice, setPhenotypingNotice] = useState(false);
  const [phenotypingActive, setPhenotypingActive] = useState(false);
  const [safetyContact, setSafetyContact] = useState(null);
  const [safetyContactAsked, setSafetyContactAsked] = useState(false);
  const [locationResources, setLocationResources] = useState(null);
  // Conversation history for LLM context
  const historyRef = useRef([]);
  const bottomRef = useRef(null);

  const handlePhenotypingDistress = useCallback((data) => {
    setBreathe(true); setPhenotypingActive(true); setPhenotypingNotice(true);
  }, []);

  const { recordKey, resetPhenotyping, getHesitationScore } = useDigitalPhenotyping(handlePhenotypingDistress);

  // Load location resources on mount
  useEffect(()=>{
    apiGet("/location").then(d=>{ if(d?.resources) setLocationResources(d.resources); });
  },[]);

  // Silence detection: check if user hasn't been here in 5+ days
  // In production this comes from session DB; here we simulate after 3s
  useEffect(()=>{ setTimeout(()=>setShowSilence(true),3000); },[]);

  useEffect(()=>{
    if (!breathe) return;
    const id = setInterval(()=>setBreathePhase(p=>p==="in"?"out":"in"),2000);
    return ()=>clearInterval(id);
  },[breathe]);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); },[messages,typing]);

  function ftime(){ return new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); }

  async function processMessage(text) {
    if (!text.trim() || typing || microPending) return;
    const isLate = new Date().getHours()>=1&&new Date().getHours()<=5;

    const userMsg = { role:"user", text:text.trim(), time:ftime(), crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false, lateNight:isLate };
    setMessages(prev=>[...prev, userMsg]);
    setInput(""); resetPhenotyping(); setPhenotypingActive(false); setPhenotypingNotice(false);
    setTyping(true);

    // Semantic drift (frontend-side, feeds into gatekeeper)
    const sem = computeSemanticScore(text);
    const newSemHist = [...semHistory, sem];
    setSemHistory(newSemHist);
    const driftDelta = getDriftDelta(semHistory, sem);

    // ── STEP 1: GATEKEEPER ──────────────────────────────────────────────────
    const gk = await apiPost("/gatekeeper", {
      text,
      user_id: USER_ID,
      behavior_bonus: getHesitationScore(),
      drift_delta: driftDelta,
    });

    const score = gk?.risk_score ?? 0.1;
    const label = gk?.label ?? "safe";
    const isAbsolute = gk?.is_absolute_hopelessness ?? false;
    const isGoodbye = gk?.is_solo_goodbye ?? false;

    setRiskLevel(score);

    // Log score for longitudinal trend (fire-and-forget)
    apiPost("/session/score", { user_id: USER_ID, score });

    // ── STEP 2: BRANCHING LOGIC ─────────────────────────────────────────────
    await new Promise(r=>setTimeout(r, 400+Math.random()*400));
    setTyping(false);

    const isCrisis = score >= 0.85;
    const isHighAnxiety = score >= 0.75 && score < 0.85;
    const isModerate = score >= 0.65 && score < 0.75;

    // Update LLM history
    historyRef.current = [...historyRef.current, { role:"user", content:text }].slice(-16);

    // GOODBYE — immediate warm hold, no crisis panel
    if (isGoodbye && !isCrisis) {
      setBreathe(true);
      const GOODBYE_RESPONSES = [
        "Wait — please don't go just yet. Something made me want to stay a little longer with you. How are you really doing right now?",
        "Before you go — I'll still be here if you want to come back, even in five minutes. Is there anything you want to say?",
        "That word made me pause. If this is just goodnight, I'll see you tomorrow. But if it's something more — I'd really like to know.",
        "I noticed how you ended that. I'm not going to pretend I didn't. What's going on?",
      ];
      const reply = GOODBYE_RESPONSES[Math.floor(Math.random()*GOODBYE_RESPONSES.length)];
      historyRef.current.push({ role:"assistant", content:reply });
      setMessages(prev=>[...prev,{ role:"assistant", text:reply, time:ftime(), crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false, goodbye:true }]);
      return;
    }

    // CRISIS — hard override, LLM bypassed completely
    if (isCrisis) {
      setBreathe(true);
      // Fire safety contact ping (backend handles cooldown)
      apiPost("/contact/ping", { user_id: USER_ID });
      const crisisText = "I want to pause here for a moment. What you just shared matters deeply, and I want to make sure you have real support right now — not just a chatbot.";
      historyRef.current.push({ role:"assistant", content:crisisText });
      setMessages(prev=>[...prev,{
        role:"assistant", text:crisisText, time:ftime(),
        crisis:true, needsMicro:false, offerLetter:false, askSafetyContact:false,
        resources: locationResources,
      }]);

    // HIGH ANXIETY — CBT grounding exercise
    } else if (isHighAnxiety && !cbtTriggeredRef.triggered) {
      cbtTriggeredRef.triggered = true;
      setBreathe(true);
      const cbtIntro = "I can feel the weight in your words. Before we go further — I'd like to try something with you. It'll only take a minute, and it might help bring you back to yourself.";
      historyRef.current.push({ role:"assistant", content:cbtIntro });
      setMessages(prev=>[...prev,{ role:"assistant", text:cbtIntro, time:ftime(), crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false }]);
      setTimeout(()=>setShowCBT(true), 1000);

    // MODERATE — micro validation check-in
    } else if (isModerate && !microPending) {
      setMicroPending(true); setBreathe(true);
      // ── STEP 3: LLM CALL ──────────────────────────────────────────────────
      const chat = await apiPost("/chat", {
        text, user_id: USER_ID,
        history: historyRef.current.slice(-14),
        is_absolute_hopelessness: isAbsolute,
      });
      const reply = chat?.reply ?? "That sounds really heavy. Take your time.";
      historyRef.current.push({ role:"assistant", content:reply });
      setMessages(prev=>[...prev,{ role:"assistant", text:reply, time:ftime(), crisis:false, needsMicro:true, offerLetter:false, askSafetyContact:false }]);

    // SAFE / LOW — normal LLM response
    } else {
      setBreathe(score > 0.4);
      const offerLetter = score > 0.28 && score < 0.65 && messages.length > 5;
      const userMsgCount = messages.filter(m=>m.role==="user").length;
      const shouldAskContact = !safetyContactAsked && !safetyContact && messages.filter(m => m.role === "user").length >= 3;
      if (shouldAskContact) setSafetyContactAsked(true);

      // ── STEP 3: LLM CALL ──────────────────────────────────────────────────
      const chat = await apiPost("/chat", {
        text, user_id: USER_ID,
        history: historyRef.current.slice(-14),
        is_absolute_hopelessness: isAbsolute,
      });
      const reply = chat?.reply ?? "Thank you for sharing that with me.";
      historyRef.current.push({ role:"assistant", content:reply });
      setMessages(prev=>[...prev,{ role:"assistant", text:reply, time:ftime(), crisis:false, needsMicro:false, offerLetter, askSafetyContact:shouldAskContact }]);
    }

    // Check trend after each message
    const trend = await apiGet(`/session/trend?user_id=${USER_ID}`);
    if (trend?.trending && !showTrend) {
      setTrendData(trend.data || []);
      setTimeout(()=>setShowTrend(true), 1500);
    }
  }

  function handleMicroRate(n) {
    setMicroPending(false);
    if (n<=2) {
      apiPost("/contact/ping", { user_id: USER_ID });
      setMessages(prev=>[...prev,{ role:"assistant", text:"Thank you for being honest with me. A 1 or 2 means you're really struggling right now. I'm not going anywhere — but I also want to make sure you have more than just me.", time:ftime(), crisis:true, needsMicro:false, offerLetter:false, askSafetyContact:false, resources:locationResources }]);
      setRiskLevel(0.91);
    } else if (n===3) {
      setMessages(prev=>[...prev,{ role:"assistant", text:"A 3 — somewhere in the middle. That makes sense. You don't have to be in crisis to deserve care. Want to keep talking?", time:ftime(), crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false }]);
    } else {
      setMessages(prev=>[...prev,{ role:"assistant", text:"Good — a 4 or 5 gives me some relief. Let's keep going. What would feel helpful to talk through?", time:ftime(), crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false }]);
      setBreathe(false);
    }
  }

  async function handleSafetyContactSave(contact) {
    setSafetyContact(contact);
    setSafetyContactAsked(true);
    await apiPost("/contact/save", {
      user_id: USER_ID,
      contact_name: contact.name,
      contact_phone: contact.phone,
    });
  }

  const moodChips = ["I'm feeling overwhelmed","I just need to talk","I'm really anxious","I don't know how I feel","I had a really rough day"];
  const riskColor = riskLevel<0.4?"#2e5a4a":riskLevel<0.65?"#6a6a30":riskLevel<0.75?"#8a6020":riskLevel<0.85?"#8a4818":"#7a3020";
  const inputLocked = showCBT || microPending;

  return (
    <div style={{ minHeight:"100vh", background:"#0d1714", backgroundImage:"radial-gradient(ellipse at 15% 15%,rgba(32,62,48,0.42) 0%,transparent 55%),radial-gradient(ellipse at 85% 85%,rgba(22,44,38,0.3) 0%,transparent 55%)", display:"flex", flexDirection:"column", alignItems:"center", fontFamily:"Georgia,serif", color:"#c8d8d2" }}>
      <link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet"/>

      {showCBT && <CBTGrounding onComplete={()=>{ setShowCBT(false); cbtTriggeredRef.triggered=false; setMessages(prev=>[...prev,{ role:"assistant", text:"You came back. That took something. How do you feel right now, compared to a minute ago?", time:ftime(), crisis:false, needsMicro:false, offerLetter:false, askSafetyContact:false }]); }}/>}

      {/* HEADER */}
      <div style={{ width:"100%", maxWidth:640, padding:"25px 24px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:20, color:"#9abdb2", fontFamily:"'DM Serif Display',Georgia,serif", letterSpacing:"0.02em", marginBottom:3 }}>Companion</div>
          <div style={{ fontSize:10.5, color:"#3a5448", letterSpacing:"0.14em" }}>A QUIET SPACE TO BE HEARD</div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:5 }}>
          <BreathingOrb active={breathe} phase={breathePhase} phenotyping={phenotypingActive}/>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            {safetyContact?.name && <span style={{ fontSize:10, color:"#304840", letterSpacing:"0.06em" }}>✦ {safetyContact.name}</span>}
            <div style={{ width:6, height:6, borderRadius:"50%", background:riskColor, opacity:0.38, transition:"background 1.2s ease" }} title="system status"/>
          </div>
        </div>
      </div>

      <div style={{ width:"calc(100% - 48px)", maxWidth:592, height:1, background:"linear-gradient(90deg,transparent,rgba(134,183,168,0.1),transparent)", margin:"15px 0 0" }}/>

      {/* BANNERS */}
      <div style={{ width:"100%", maxWidth:640 }}>
        {showSilence && <div style={{ paddingTop:14 }}><SilenceAlert onDismiss={()=>setShowSilence(false)}/></div>}
        {showTrend && <TrendPanel data={trendData} onDismiss={()=>setShowTrend(false)}/>}
        {phenotypingNotice && <PhenotypingNotice onDismiss={()=>setPhenotypingNotice(false)}/>}
        <DriftBar history={semHistory}/>
      </div>

      {/* MESSAGES */}
      <div style={{ width:"100%", maxWidth:640, flex:1, overflowY:"auto", padding:"18px 24px 0", minHeight:300, maxHeight:"calc(100vh - 285px)", scrollbarWidth:"thin", scrollbarColor:"#172520 transparent" }}>
        {messages.map((msg,i)=>(
          <MessageBubble key={i} msg={msg} index={i} onMicroRate={handleMicroRate}
            onSafetyContactSave={handleSafetyContactSave}
            onSafetyContactSkip={()=>setSafetyContactAsked(true)}
          />
        ))}
        {typing && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", marginBottom:18 }}>
            <div style={{ fontSize:10, color:"#3a5448", marginBottom:4, marginLeft:2, letterSpacing:"0.13em" }}>COMPANION</div>
            <div style={{ background:"rgba(255,255,255,0.028)", border:"1px solid rgba(255,255,255,0.055)", borderRadius:"18px 18px 18px 4px" }}><TypingDots/></div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>

      {messages.length<=2 && (
        <div style={{ width:"100%", maxWidth:640, padding:"13px 24px 0", display:"flex", flexWrap:"wrap", gap:7 }}>
          {moodChips.map((c,i)=><MoodChip key={i} label={c} onClick={()=>processMessage(c)}/>)}
        </div>
      )}

      {/* INPUT */}
      <div style={{ width:"100%", maxWidth:640, padding:"13px 24px 22px", display:"flex", gap:10, alignItems:"flex-end" }}>
        <div style={{ flex:1, background:inputLocked?"rgba(255,255,255,0.01)":"rgba(255,255,255,0.022)", border:`1px solid ${inputLocked?"rgba(255,255,255,0.04)":"rgba(134,183,168,0.11)"}`, borderRadius:16, padding:"11px 15px", display:"flex", alignItems:"center", transition:"all 0.4s ease", position:"relative" }}>
          {inputLocked && (
            <div style={{ position:"absolute", inset:0, borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(13,23,20,0.5)", backdropFilter:"blur(2px)", zIndex:1 }}>
              <span style={{ fontSize:11.5, color:"#3a5448", letterSpacing:"0.08em", fontFamily:"Georgia,serif" }}>
                {showCBT?"complete the exercise to continue":"respond to continue"}
              </span>
            </div>
          )}
          <textarea
            value={input} disabled={inputLocked}
            onChange={e=>{ setInput(e.target.value); recordKey(e.nativeEvent||e); }}
            onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();processMessage(input);} }}
            placeholder={inputLocked?"":"Share what's on your mind…"}
            rows={1}
            style={{ width:"100%", background:"transparent", border:"none", outline:"none", color:"#c8d8d2", fontSize:14, fontFamily:"'Lora',Georgia,serif", lineHeight:1.6, resize:"none", minHeight:22, maxHeight:100, overflowY:"auto", caretColor:"#86b7a8", opacity:inputLocked?0:1 }}
            onInput={e=>{ e.target.style.height="auto"; e.target.style.height=e.target.scrollHeight+"px"; }}
          />
        </div>
        <button onClick={()=>processMessage(input)} disabled={!input.trim()||typing||inputLocked} style={{ width:42, height:42, borderRadius:"50%", flexShrink:0, background:input.trim()&&!typing&&!inputLocked?"rgba(134,183,168,0.16)":"rgba(255,255,255,0.018)", border:`1px solid ${input.trim()&&!typing&&!inputLocked?"rgba(134,183,168,0.32)":"rgba(255,255,255,0.045)"}`, color:input.trim()&&!typing&&!inputLocked?"#86b7a8":"#283e34", cursor:input.trim()&&!typing&&!inputLocked?"pointer":"default", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.25s ease" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>

      <div style={{ fontSize:10, color:"#1e3028", textAlign:"center", paddingBottom:13, letterSpacing:"0.08em" }}>
        NOT A SUBSTITUTE FOR PROFESSIONAL CARE · IN CRISIS? CALL 14416
      </div>
    </div>
  );
}
