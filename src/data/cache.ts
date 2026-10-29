import type {MaterialChunk} from '../types/domain';
export async function materialCache(key:string,value?:MaterialChunk[]):Promise<MaterialChunk[]>{
    return new Promise((resolve,reject)=>{
        const request=indexedDB.open('ExamFlow-local-index',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('materials');
        request.onerror=()=>reject(new Error('本地索引缓存不可用，请重建索引'));
        request.onsuccess=()=>{
            const db=request.result,tx=db.transaction('materials',value?'readwrite':'readonly'),store=tx.objectStore('materials');
            const operation=value?store.put(value,key):store.get(key);
            operation.onsuccess=()=>{tx.oncomplete=()=>{resolve(value??operation.result??[]);db.close();};};
            tx.onerror=()=>{db.close();reject(new Error('本地索引缓存保存失败'));};
        };
    });
}
