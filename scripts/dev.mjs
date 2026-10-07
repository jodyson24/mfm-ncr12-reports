import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const node=process.execPath;
const vite=fileURLToPath(new URL('../node_modules/vite/bin/vite.js',import.meta.url));
const clientDir=fileURLToPath(new URL('../client',import.meta.url));
const children=[
  spawn(node,['--import','tsx','server/src/index.ts'],{stdio:'inherit',env:{...process.env,PORT:'4880'}}),
  spawn(node,[vite],{stdio:'inherit',cwd:clientDir,env:{...process.env,VITE_BACKEND_URL:'http://localhost:4880'}})
];
let shuttingDown=false;
const stop=()=>{if(shuttingDown)return;shuttingDown=true;for(const child of children)child.kill('SIGTERM');};
for(const child of children)child.on('exit',(code)=>{if(!shuttingDown&&code!==0){console.error(`Development process exited with code ${code??'unknown'}`);stop();process.exitCode=code??1;}});
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
