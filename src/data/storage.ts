import {FlowError,hash,id} from '../core';

export interface Adapter {
    exists(path:string):Promise<boolean>;
    read(path:string):Promise<string>;
    write(path:string,data:string):Promise<void>;
    process?(path:string,fn:(data:string)=>string):Promise<string>;
    rename(from:string,to:string):Promise<void>;
    remove(path:string):Promise<void>;
    mkdir(path:string):Promise<void>;
    list(path:string):Promise<{files:string[];folders:string[]}>;
}
export function safePath(path:string):string {
    const p=path.replace(/\\/g,'/').replace(/\/+$/,'');
    if (!p || p.startsWith('/') || p.includes(':') || p.split('/').some(s=>s==='..'||s==='.'||!s) || p.startsWith('.obsidian')) throw new FlowError('invalid_path','数据路径必须是 vault 内的普通相对路径');
    return p;
}
export class Storage {
    conflictRegistry?:string;
    recoverJson?:(path:string)=>Promise<unknown|null>;
    recovered?:(path:string)=>void;
    private baseline=new Map<string,string|null>();
    private queues=new Map<string,Promise<unknown>>();
    constructor(public adapter:Adapter,public deviceId:string) {}
    async mkdir(path:string):Promise<void> {
        const parts=safePath(path).split('/');
        for(let i=1;i<=parts.length;i++) {const p=parts.slice(0,i).join('/'); if(!await this.adapter.exists(p)) {try{await this.adapter.mkdir(p);}catch(e){if(!await this.adapter.exists(p)) throw e;}}}
    }
    async readText(path:string):Promise<string|null> {
        safePath(path); const value=await this.adapter.exists(path)?await this.adapter.read(path):null;
        this.baseline.set(path,value===null?null:hash(value)); return value;
    }
    async readJson<T>(path:string):Promise<T|null> {
        const raw=await this.readText(path); if(raw===null)return null;
        try{return JSON.parse(raw) as T;}catch{
            await this.adapter.write(`${path}.corrupt-${Date.now()}`,raw);
            const restored=await this.recoverJson?.(path);if(restored!==undefined&&restored!==null){this.recovered?.(path);return restored as T;}
            throw new FlowError('invalid_data','JSON 已损坏，已保留损坏副本；请从备份恢复');
        }
    }
    writeJson(path:string,value:unknown):Promise<void> {return this.writeText(path,JSON.stringify(value,null,2));}
    writeText(path:string,content:string):Promise<void> {
        safePath(path);
        const previous=this.queues.get(path)??Promise.resolve();
        const next=previous.catch(()=>{}).then(()=>this.write(path,content)); this.queues.set(path,next);
        return next;
    }
    private async write(path:string,content:string):Promise<void> {
        await this.mkdir(path.split('/').slice(0,-1).join('/'));
        const current=await this.adapter.exists(path)?await this.adapter.read(path):null;
        // Unread existing files must be loaded explicitly before overwriting.
        const base=this.baseline.has(path)?this.baseline.get(path):null;
        const currentHash=current===null?null:hash(current);
        const conflict=async()=>{
            const suffix=path.lastIndexOf('.'), copy=suffix>=0?`${path.slice(0,suffix)}.conflict-${this.deviceId}-${Date.now()}${path.slice(suffix)}`:`${path}.conflict-${this.deviceId}-${Date.now()}`;
            await this.adapter.write(copy,content);
            if(this.conflictRegistry){
                const registry=this.conflictRegistry;await this.mkdir(registry.split('/').slice(0,-1).join('/'));
                const entry={file:path,copy,deviceId:this.deviceId,createdAt:new Date().toISOString(),localSize:content.length,remoteSize:current?.length??0};
                if(await this.adapter.exists(registry)&&this.adapter.process)await this.adapter.process(registry,raw=>{const data=JSON.parse(raw) as {schemaVersion:number;entries:unknown[]};data.entries.push(entry);return JSON.stringify(data,null,2);});
                else if(!await this.adapter.exists(registry))await this.adapter.write(registry,JSON.stringify({schemaVersion:1,entries:[entry]},null,2));
            }
            throw new FlowError('conflict',`检测到外部修改，已保留冲突副本：${copy}`);
        };
        if(base!==currentHash) return conflict();
        const temp=`${path}.tmp-${id('write')}`;
        await this.adapter.write(temp,content);
        for(let attempt=0;attempt<2;attempt++) {
            try{
                if(current!==null && this.adapter.process) {
                    let changed=false;
                    await this.adapter.process(path,raw=>{if(hash(raw)!==base){changed=true;return raw;} return content;});
                    if(changed)return conflict();
                } else {
                    const latest=await this.adapter.exists(path)?await this.adapter.read(path):null;
                    if((latest===null?null:hash(latest))!==base)return conflict();
                    if(current===null)await this.adapter.rename(temp,path);
                    else throw new FlowError('write_failed',`当前适配器不支持原子更新；原文件未修改，内容保留于 ${temp}，请升级 Obsidian`);
                }
                this.baseline.set(path,hash(content));
                if(await this.adapter.exists(temp))await this.adapter.remove(temp);
                return;
            }catch(error){if(error instanceof FlowError)throw error; if(attempt===1)throw new FlowError('write_failed',`保存失败，临时文件已保留：${temp}；请重试或导出备份`);}
        }
    }
    async list(path:string):Promise<string[]> {
        if(!await this.adapter.exists(path)) return [];
        return (await this.adapter.list(path)).files;
    }
}
