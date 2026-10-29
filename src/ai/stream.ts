export async function readStream(response:Response,onDelta:(text:string)=>void):Promise<unknown>{
    if(!response.body)throw new Error('llm_network');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',content='',usage:unknown,finished=false;
    const parse=(line:string)=>{
        if(!line.startsWith('data:'))return;
        const data=line.slice(5).trim();if(!data)return;if(data==='[DONE]'){finished=true;return;}
        const chunk=JSON.parse(data) as {choices?:{delta?:{content?:string};finish_reason?:string}[];usage?:unknown};
        const delta=chunk.choices?.[0]?.delta?.content;if(delta){content+=delta;onDelta(delta);}if(chunk.usage)usage=chunk.usage;
    };
    try{while(true){const next=await reader.read();buffer+=decoder.decode(next.value,{stream:!next.done});const lines=buffer.split(/\r?\n/);buffer=lines.pop()??'';for(const line of lines)parse(line);if(next.done)break;}if(buffer)parse(buffer);
        if(!finished)throw new Error('llm_invalid_response');return {choices:[{message:{content}}],usage};
    }finally{try{await reader.cancel();}catch{}reader.releaseLock();}
}
