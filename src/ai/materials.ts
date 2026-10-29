import type {MaterialChunk,RetrievalResult} from '../types/domain';
import {hash,now} from '../core';
const tokens=(text:string)=>{
    const normalized=text.toLowerCase(), words=normalized.match(/[a-z0-9_]+/g)??[];
    const chinese=normalized.match(/[\u4e00-\u9fff]+/g)??[];
    return [...words,...chinese.flatMap(s=>s.length===1?[s]:Array.from({length:s.length-1},(_,i)=>s.slice(i,i+2)))];
};
export class MaterialIndex {
    chunks:MaterialChunk[]=[];
    upsert(path:string,text:string,page?:number):void {
        this.chunks=this.chunks.filter(c=>c.sourcePath!==path||c.page!==page);
        for(let start=0;start<text.length;start+=700){const part=text.slice(start,start+900).trim();if(part)this.chunks.push({id:`chunk_${hash(`${path}:${page}:${start}:${part}`)}`,sourcePath:path,page,text:part,approxTokens:Math.ceil(part.length/2),updatedAt:now()});}
    }
    search(query:string,limit=5):RetrievalResult[]{
        const terms=[...new Set(tokens(query))],docs=this.chunks.map(c=>tokens(c.text)),average=docs.reduce((n,d)=>n+d.length,0)/(docs.length||1);
        const frequencies=docs.map(doc=>{const map=new Map<string,number>();for(const term of doc)map.set(term,(map.get(term)??0)+1);return map;});
        const documentFrequency=new Map(terms.map(term=>[term,frequencies.filter(f=>f.has(term)).length]));
        return this.chunks.map((chunk,i)=>{
            const doc=docs[i]!;
            const score=terms.reduce((sum,t)=>{const tf=frequencies[i]!.get(t)??0,df=documentFrequency.get(t)??0;return sum+Math.log(1+(docs.length-df+0.5)/(df+0.5))*tf*2.2/(tf+1.2*(0.25+0.75*doc.length/(average||1)));},0);
            return {chunk,score};
        }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
    }
}
