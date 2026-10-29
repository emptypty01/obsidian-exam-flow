import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {nodeAdapter} from './node-adapter.mjs';

const args={};for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--apply')args.apply=true;else if(['--root','--out','--metadata-from'].includes(process.argv[i]))args[process.argv[i].slice(2)]=process.argv[++i];else throw new Error('未知参数');}
if(!args.root||!args.out)throw new Error('用法：node scripts/migrate-banks.mjs --root 数据目录 --out 日志目录 [--apply]');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=fs.realpathSync(args.root),out=path.resolve(args.out);
const relative=path.relative(root,out);if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('日志必须放在数据目录之外');
fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(path.join(out,'report.json')))throw new Error('请使用新的输出目录');
if(fs.existsSync(path.join(root,'banks/.transaction.json')))throw new Error('存在未完成保存，请先恢复');
if(args.apply){
    if(process.platform!=='win32'||execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"if(Get-Process -Name Obsidian -ErrorAction SilentlyContinue){'OPEN'}else{'CLOSED'}"],{encoding:'utf8',windowsHide:true}).trim()!=='CLOSED')throw new Error('请先关闭 Obsidian 再迁移');
}
const result=await build({stdin:{contents:"export {Storage} from './src/data/storage';export {CompactBankStore,compactBankDocuments} from './src/data/compact-banks';export {validateExam} from './src/data/config';",resolveDir:repo,loader:'ts'},bundle:true,platform:'node',format:'cjs',write:false});
const bundle=path.join(out,'runtime.cjs');fs.writeFileSync(bundle,result.outputFiles[0].contents);
const require=createRequire(import.meta.url),{Storage,CompactBankStore,compactBankDocuments,validateExam}=require(bundle);
const store=new CompactBankStore(new Storage(nodeAdapter(root),'migration'),'Data'),banks=await store.load();
if(args['metadata-from']){
    const originals=JSON.parse(fs.readFileSync(args['metadata-from'],'utf8')).banks.flatMap(bank=>bank.questions);
    for(const q of banks.flatMap(bank=>bank.questions)){
        const original=originals.find(old=>old.id===q.id);if(!original||original.stem!==q.stem||JSON.stringify(original.answer)!==JSON.stringify(q.answer))throw new Error('原始审计与当前题目不匹配，停止合并');
        q.extra=original.extra;
    }
}
const exams=JSON.parse(fs.readFileSync(path.join(root,'config/exams.json'),'utf8')).exams.map(validateExam),subjects=exams.flatMap(e=>e.subjects);
const files=fs.readdirSync(path.join(root,'banks')).filter(n=>n.endsWith('.json')&&!n.includes('.conflict-')&&!n.startsWith('.'));
const beforeBytes=files.reduce((sum,name)=>sum+fs.statSync(path.join(root,'banks',name)).size,0);
const report={applied:false,questionCount:banks.reduce((n,b)=>n+b.questions.length,0),beforeBytes,planned:banks.flatMap(bank=>Object.keys(compactBankDocuments(bank,subjects.find(s=>s.id===bank.subjectId)))),verified:false};
if(args.apply){
    const lock=path.join(root,'.examflow-import.lock'),fd=fs.openSync(lock,'wx');
    try{
        fs.writeFileSync(path.join(out,'backup.json'),JSON.stringify({files:Object.fromEntries(files.map(name=>[name,fs.readFileSync(path.join(root,'banks',name),'utf8')])),banks},null,2),{flag:'wx'});
        await store.save(banks,subjects);report.applied=true;
        const after=await store.load();
        const semantic=q=>JSON.stringify({id:q.id,stem:q.stem,options:q.options,answer:q.answer,explanation:q.explanation,source:q.source});
        if(after.reduce((n,b)=>n+b.questions.length,0)!==report.questionCount||banks.flatMap(b=>b.questions).some(q=>!after.flatMap(b=>b.questions).some(other=>other.id===q.id&&semantic(other)===semantic(q))))throw new Error('迁移后题目内容不一致，备份已保留');
        report.verified=true;report.afterBytes=fs.readdirSync(path.join(root,'banks')).filter(n=>n.endsWith('.json')&&!n.startsWith('.')).reduce((sum,name)=>sum+fs.statSync(path.join(root,'banks',name)).size,0);
    }finally{fs.closeSync(fd);fs.unlinkSync(lock);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));}
}else fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
