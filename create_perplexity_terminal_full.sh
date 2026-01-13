#!/usr/bin/env bash
set -e

APP="perplexity-ops-terminal"
BASE="$HOME/$APP"
PORT_START=3000

echo "🚀 Installing Perplexity Terminal OPS Edition..."

# Port finder
find_port() {
  p=$PORT_START
  while ss -lnt | grep -q ":$p "; do
    p=$((p+1))
  done
  echo $p
}

PORT=$(find_port)

mkdir -p "$BASE"/{public,backend,.ssh}
cd "$BASE"

echo "PORT=$PORT" > .env
echo "AUTO_FIX=true" >> .env
echo "ALLOW_SUDO=true" >> .env

npm init -y >/dev/null

npm install express cors dotenv ssh2 openai uuid node-fetch@2

cat > backend/opsEngine.js <<'EOF'
export function buildOpsPrompt(context){
return `
You are an autonomous Linux DevOps AI.

Tasks:
- analyze server
- detect errors
- security audit
- performance check
- port safety
- suggest fixes

If AUTO_FIX=true output commands prefixed with: CMD:

Terminal:
${context}
`;
}
EOF

cat > server.js <<'EOF'
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Client } from "ssh2";
import fs from "fs";
import fetch from "node-fetch";
import { buildOpsPrompt } from "./backend/opsEngine.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

let sshConfig = null;
let history = [];

function findPort(start){
  const net = require("net");
  return new Promise(resolve=>{
    const srv = net.createServer();
    srv.listen(start,()=>{srv.close(()=>resolve(start))})
      .on("error",()=>resolve(findPort(start+1)));
  })
}

app.post("/api/setup", (req,res)=>{
  sshConfig = req.body;
  res.json({ok:true});
});

app.post("/api/ssh/test",(req,res)=>{
  const conn = new Client();
  conn.on("ready",()=>{
    conn.exec("echo OK",(e,s)=>{
      let out="";
      s.on("data",d=>out+=d);
      s.on("close",()=>{conn.end();res.json({ok:true,output:out});});
    });
  }).on("error",e=>res.json({ok:false,error:String(e)}))
    .connect({...sshConfig,password:req.body.password});
});

app.post("/api/ssh/exec",(req,res)=>{
  const cmd=req.body.command;
  history.push("$ "+cmd);

  const conn=new Client();
  conn.on("ready",()=>{
    conn.exec(cmd,(e,s)=>{
      let out="";
      s.on("data",d=>out+=d);
      s.stderr.on("data",d=>out+=d);
      s.on("close",()=>{
        history.push(out);
        conn.end();
        res.json({output:out});
      });
    });
  }).connect({...sshConfig,password:req.body.password});
});

app.post("/api/ai/analyze", async(req,res)=>{
  const context = history.slice(-30).join("\n");
  const prompt = buildOpsPrompt(context);

  const r = await fetch("https://api.perplexity.ai/chat/completions",{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+req.body.key,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:"sonar-pro",
      messages:[{role:"user",content:prompt}]
    })
  });

  const j = await r.json();
  res.json(j);
});

app.listen(process.env.PORT,()=>{
  console.log(`✅ OPS Terminal running on http://localhost:${process.env.PORT}`);
});
EOF

cat > public/index.html <<'EOF'
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Perplexity OPS Terminal</title>
<style>
body{margin:0;background:#000;color:#0f0;font-family:monospace}
#t{height:80vh;overflow:auto;padding:10px}
#cmd{width:100%;padding:10px;background:#111;color:#0f0;border:0}
#ai{height:20vh;background:#111;color:#0ff;padding:10px;overflow:auto}
button{margin:5px}
</style>
</head>
<body>
<div id="t"></div>
<input id="cmd" placeholder="command or question">
<button onclick="sendCmd()">Run</button>
<button onclick="sendAI()">An AI senden</button>
<div id="ai"></div>

<script>
let password=prompt("SSH Passwort:");
let apiKey=prompt("Perplexity API Key:");

fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
 host:prompt("Server IP"),
 port:22,
 username:prompt("Username")
})});

function print(x){t.innerHTML+=x+"<br>";t.scrollTop=999999}

async function sendCmd(){
 let c=cmd.value;
 print("$ "+c);
 let r=await fetch('/api/ssh/exec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:c,password})});
 let j=await r.json();
 print(j.output);
 cmd.value="";
}

async function sendAI(){
 let r=await fetch('/api/ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:apiKey})});
 let j=await r.json();
 ai.innerText=j.choices[0].message.content;
}
</script>
</body>
</html>
EOF

echo "🎉 Installation fertig!"
echo "Starten mit:"
echo "cd $BASE && node server.js"
echo "Browser: http://localhost:$PORT"
