// test-ssh.js — Simple SSH connectivity test
require('dotenv').config();
const fs = require('fs');
const { Client } = require('ssh2');

const host = process.env.TEST_HOST || 'localhost';
const user = process.env.TEST_USER || process.env.USER || 'root';
const keyPath = process.env.SSH_KEY || `${process.env.HOME}/.ssh/id_rsa`;

if (!fs.existsSync(keyPath)) {
  console.error('SSH key not found:', keyPath);
  process.exit(2);
}

const conn = new Client();
conn.on('ready', () => {
  console.log('SSH connection ready — running simple test command');
  conn.exec('echo ok', (err, stream) => {
    if (err) { console.error('exec error', err); conn.end(); process.exit(3); }
    let out='';
    stream.on('data', d => out += d.toString()).on('close', (code)=>{
      console.log('Output:', out.trim());
      conn.end();
      process.exit(out.trim() === 'ok' ? 0 : 4);
    });
  });
}).on('error', (e)=>{ console.error('SSH error', e.message); process.exit(3); })
.connect({ host, username: user, privateKey: fs.readFileSync(keyPath) });