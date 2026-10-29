import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 将插件相对路径映射到指定离线数据根；不访问任何其他目录。 */
export function nodeAdapter(root,onRead=()=>{}){
    const base=fs.realpathSync(root);
    const mapped=relative=>{
        if(relative==='Data')return base;
        if(!relative.startsWith('Data/'))throw new Error('数据路径越界');
        const file=path.resolve(base,...relative.slice(5).split('/')),rel=path.relative(base,file);
        if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('数据路径越界');return file;
    };
    return {
        exists:async relative=>fs.existsSync(mapped(relative)),
        read:async relative=>{const file=mapped(relative),bytes=fs.readFileSync(file);onRead(file,bytes);return bytes.toString('utf8').replace(/^\uFEFF/,'');},
        write:async(relative,value)=>{const file=mapped(relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);},
        mkdir:async relative=>{fs.mkdirSync(mapped(relative),{recursive:true});},
        remove:async relative=>{fs.unlinkSync(mapped(relative));},
        rename:async(from,to)=>{fs.renameSync(mapped(from),mapped(to));},
        list:async relative=>{const entries=fs.readdirSync(mapped(relative),{withFileTypes:true});return {files:entries.filter(e=>e.isFile()).map(e=>relative+'/'+e.name),folders:entries.filter(e=>e.isDirectory()).map(e=>relative+'/'+e.name)};},
        process:async(relative,change)=>{
            const file=mapped(relative),raw=fs.readFileSync(file,'utf8'),value=change(raw);if(raw===value)return raw;
            const temp=file+'.cli-'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,value,{flag:'wx'});
            try{if(fs.readFileSync(file,'utf8')!==raw)throw new Error('数据存在外部修改：'+file);fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}return value;
        }
    };
}
