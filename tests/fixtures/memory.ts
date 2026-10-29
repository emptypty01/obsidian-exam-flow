import type {Adapter} from '../../src/data/storage';
export function memoryAdapter(): Adapter {
    const files = new Map<string,string>(),folders=new Set<string>();
    return {exists:async p=>files.has(p)||folders.has(p),read:async p=>{if (!files.has(p)) throw new Error('not found'); return files.get(p)!;},write:async(p,v)=>{files.set(p,v);},
        rename:async(a,b)=>{files.set(b,files.get(a)!); files.delete(a);},remove:async p=>{files.delete(p);},mkdir:async p=>{folders.add(p);},list:async p=>({files:[...files.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')),folders:[...folders].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/'))}),
        process:async(p,f)=>{const v=f(files.get(p)!); files.set(p,v); return v;}};
}
