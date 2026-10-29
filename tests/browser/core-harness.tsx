import {h,render} from 'preact';
import {AppView} from '../../src/ui/app';
import ExamFlowPlugin from '../../src/main';
import {Repository} from '../../src/data/repository';
import {Storage} from '../../src/data/storage';
import {ExamService} from '../../src/services';
import {memoryAdapter} from '../fixtures/memory';
import {clone} from '../../src/core';
import {defaults} from '../../src/settings';
import type {ChatRequest,Question} from '../../src/types/domain';

Object.assign(HTMLElement.prototype,{
    empty(this:HTMLElement){this.replaceChildren();},setText(this:HTMLElement,text:string){this.textContent=text;},addClass(this:HTMLElement,name:string){this.classList.add(name);},
    createEl(this:HTMLElement,tag:string,options:{text?:string;cls?:string;attr?:Record<string,string>}={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const[k,v]of Object.entries(options.attr??{}))el.setAttribute(k,v);this.append(el);return el;}
});
async function boot(){
    const repo=new Repository(new Storage(memoryAdapter(),'core-browser'),'ExamFlow');await repo.load();
    const listeners=new Set<()=>void>(),notify=()=>listeners.forEach(callback=>callback()),requests:ChatRequest[]=[];
    const service=new ExamService(repo,notify,error=>{throw error;});
    const subjects=['数据库事务隔离级别','TLS 握手身份认证','云原生服务拆分','编译器移进归约','可靠性与冗余设计','面向对象设计原则'];let seq=0;
    const plugin={repo,service,listeners,notify,route:'bank',settings:clone(defaults),activeExam:repo.exams[0],apiKey:'',app:{},
        message:(error:Error)=>error.message,aiConsent:async()=>true,
        provider:{chat:async(request:ChatRequest)=>{requests.push(request);const payload=JSON.parse(request.messages.at(-1)!.content);return {content:JSON.stringify({questions:Array.from({length:payload.count},()=>{
            const at=seq++,type=payload.type;return {type,stem:`请说明${subjects[at%subjects.length]}的核心机制和适用条件，第 ${at} 组。`,options:type==='single_choice'?[{key:'A',text:`正确机制 ${at}`},{key:'B',text:`错误结论 ${at}`}]:undefined,
                answer:type==='single_choice'?{kind:type,optionKey:'A'}:{kind:'subjective',referenceAnswer:'应结合机制、条件与适用场景进行分析。',rubric:[{id:'r1',description:'机制说明',points:1}]},explanation:`本题考查${subjects[at%subjects.length]}。`};
        })})};}},
        run:(task:()=>Promise<unknown>)=>{void task().then(notify);}} as unknown as ExamFlowPlugin;
    Object.setPrototypeOf(plugin,ExamFlowPlugin.prototype);
    for(const bank of [...repo.banks]){
        const questions:Question[]=Array.from({length:bank.subjectId==='subj_comprehensive'?4:1},(_,i)=>{
            const q=plugin.makeQuestion(bank.subjectId);q.id=`q_core_${bank.subjectId}_${i}`;q.stem=`${bank.name} 的第 ${i+1} 道原始真题：请从所给条件判断正确结论。`;q.source={type:'real_exam',nature:'recall',examYear:2026,examSession:i%2?'下':'上',questionNo:String(i+1)};q.reviewStatus='approved';q.generationMethod='import';
            if(q.options)q.options=q.options.map(o=>({...o,text:`${o.text} ${bank.subjectId} ${i}`}));return q;
        });await repo.saveBank({...bank,questions});
    }
    render(h(AppView,{plugin}),document.getElementById('app')!);Object.assign(window,{testPlugin:plugin,testAiRequests:requests});
}
void boot();
