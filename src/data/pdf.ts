import type {MaterialIndex} from '../ai/materials';
export interface PdfPage {getTextContent():Promise<{items:({str:string}|object)[]}>}
export interface PdfDocument {numPages:number;getPage(page:number):Promise<PdfPage>;destroy?():Promise<void>}
export interface PdfResources {cMapUrl?:string;cMapPacked?:boolean;standardFontDataUrl?:string;wasmUrl?:string}
export interface PdfEngine {getDocument(options:{data:Uint8Array;isEvalSupported:boolean}&PdfResources):{promise:Promise<PdfDocument>;destroy?:()=>Promise<void>}}
export async function indexPdf(engine:PdfEngine,bytes:Uint8Array,path:string,index:MaterialIndex,signal?:AbortSignal,resources:PdfResources={}):Promise<{pages:number;text:string}>{
    const task=engine.getDocument({data:bytes,isEvalSupported:false,...resources});const pdf=await task.promise;
    const pages:{page:number;text:string}[]=[];
    try{
        for(let page=1;page<=pdf.numPages;page++){
            if(signal?.aborted)throw new Error('PDF 导入已取消');
            const content=await(await pdf.getPage(page)).getTextContent();
            const text=content.items.map(item=>'str'in item?String(item.str):'').join(' ').trim();
            if(text)pages.push({page,text});await new Promise(r=>setTimeout(r,0));
        }
        if(!pages.length)throw new Error('无法提取文本，暂不支持 OCR；扫描版 PDF 未导入');
        index.chunks=index.chunks.filter(c=>c.sourcePath!==path);
        for(const page of pages)index.upsert(path,page.text,page.page);
        return {pages:pages.length,text:pages.map(p=>`## 第 ${p.page} 页\n\n${p.text}`).join('\n\n')};
    }finally{if(task.destroy)await task.destroy();else if(pdf.destroy)await pdf.destroy();}
}
