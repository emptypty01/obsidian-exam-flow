import type {ChatRequest,ChatResponse,LLMProvider} from '../types/domain';

export interface ProviderConfig {baseUrl:string;model:string;timeoutMs:number;maxRetries:number;concurrency:number;streaming?:boolean;pricePerMillionInput?:number;pricePerMillionOutput?:number}
export type Transport=(url:string,headers:Record<string,string>,body:string,signal:AbortSignal,onDelta?:((text:string)=>void))=>Promise<{status:number;json:unknown}>;
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export class CompatibleProvider implements LLMProvider {
    readonly id='openai_compatible'; private active=0;
    defaultSignal?:()=>AbortSignal|undefined;
    onDelta?:(text:string)=>void;
    onFallback?:()=>void;
    onUsage?:()=>void;
    usage: {at:string;model:string;latencyMs:number;input:number;output:number;cost:number}[]=[];
    constructor(public settings:ProviderConfig,private key:()=>string,private transport:Transport,private delay=wait){}
    chat(request:ChatRequest,signal?:AbortSignal):Promise<ChatResponse>{
        signal=signal??this.defaultSignal?.();
        return this.settings.streaming?this.chatStream(request,signal??new AbortController().signal,this.onDelta??(()=>{})):this.execute(request,signal);
    }
    async chatStream(request:ChatRequest,signal:AbortSignal,onDelta:(text:string)=>void):Promise<ChatResponse>{
        try{return await this.execute(request,signal,onDelta);}catch(error){
            if(signal.aborted||(error instanceof Error&&error.message==='llm_auth'))throw error;
            this.onFallback?.();return this.execute(request,signal);
        }
    }
    private async execute(request:ChatRequest,signal?:AbortSignal,onDelta?:((text:string)=>void)):Promise<ChatResponse>{
        const aborted=()=>{if(signal?.aborted)throw new Error('llm_aborted：操作已取消');};
        aborted();
        while(this.active>=Math.max(1,this.settings.concurrency)){await this.delay(30);aborted();}
        this.active++;
        try{
            const url=new URL(this.settings.baseUrl);
            if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Base URL 无效');
            if(!this.key())throw new Error('llm_auth：请先输入 API Key');
            const retries=onDelta?0:this.settings.maxRetries;
            for(let attempt=0;attempt<=retries;attempt++){
                aborted(); const start=Date.now(), controller=new AbortController();
                const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
                let timer:ReturnType<typeof setTimeout>|undefined;
                try{
                    const task=this.transport(`${url.toString().replace(/\/$/,'')}/chat/completions`,{'Content-Type':'application/json',Authorization:`Bearer ${this.key()}`},JSON.stringify({model:request.model??this.settings.model,messages:request.messages,temperature:request.temperature??0.3,max_tokens:request.maxTokens??2048,stream:!!onDelta,...onDelta?{stream_options:{include_usage:true}}:{},...request.responseFormat==='json'?{response_format:{type:'json_object'}}:{}}),controller.signal,onDelta);
                    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('llm_timeout'));},this.settings.timeoutMs);});
                    const cancellation=new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(new Error(signal?.aborted?'llm_aborted':'llm_timeout')),{once:true});});
                    if(controller.signal.aborted)throw new Error(signal?.aborted?'llm_aborted':'llm_timeout');
                    const response=await Promise.race([task,timeout,cancellation]);
                    if(response.status===401||response.status===403)throw new Error('llm_auth');
                    if(response.status===429)throw new Error('llm_rate_limit');
                    if(response.status>=500)throw new Error('llm_server');
                    if(response.status>=400)throw new Error('llm_invalid_response');
                    const data=response.json as {choices?:{message?:{content?:unknown}}[];usage?:{prompt_tokens?:number;completion_tokens?:number;total_tokens?:number}};
                    const content=data.choices?.[0]?.message?.content;
                    if(typeof content!=='string')throw new Error('llm_invalid_response');
                    const usage={promptTokens:data.usage?.prompt_tokens??0,completionTokens:data.usage?.completion_tokens??0,totalTokens:data.usage?.total_tokens??0,estimatedCost:((data.usage?.prompt_tokens??0)*(this.settings.pricePerMillionInput??0)+(data.usage?.completion_tokens??0)*(this.settings.pricePerMillionOutput??0))/1000000};
                    this.usage.push({at:new Date().toISOString(),model:request.model??this.settings.model,latencyMs:Date.now()-start,input:usage.promptTokens,output:usage.completionTokens,cost:usage.estimatedCost});
                    try{this.onUsage?.();}catch{/* Usage metadata must not cause a paid request to retry. */}
                    return {content,model:request.model??this.settings.model,usage,latencyMs:Date.now()-start};
                }catch(error){
                    aborted(); const code=error instanceof Error&&error.message.startsWith('llm_')?error.message:'llm_network';
                    if(!['llm_rate_limit','llm_server','llm_network','llm_timeout'].includes(code)||attempt===retries)throw new Error(code);
                    await this.delay(Math.min(4000,500*2**attempt));
                }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);controller.abort();}
            }
            throw new Error('llm_network');
        }finally{this.active--;}
    }
}
