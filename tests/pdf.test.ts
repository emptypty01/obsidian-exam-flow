import {expect,test} from 'vitest';
import {indexPdf} from '../src/data/pdf';
import {MaterialIndex} from '../src/ai/materials';
test('PDF 文本按页保留来源；扫描版明确拒绝且不写空索引',async()=>{
    const index=new MaterialIndex();
    await indexPdf({getDocument:()=>({promise:Promise.resolve({numPages:2,getPage:async n=>({getTextContent:async()=>({items:[{str:`质量属性场景第${n}页`}]})}),destroy:async()=>{}})})},new Uint8Array(),'sample.pdf',index);
    expect(index.search('质量属性')[0]!.chunk.page).toBe(1);
    await expect(indexPdf({getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[]})}),destroy:async()=>{}})})},new Uint8Array(),'scan.pdf',index)).rejects.toThrow('暂不支持 OCR');
    expect(index.chunks.some(c=>c.sourcePath==='scan.pdf')).toBe(false);
});
