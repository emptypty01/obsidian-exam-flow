import {h,render} from 'preact';
import {AppView} from '../../src/ui/app';
import {Repository} from '../../src/data/repository';
import {Storage} from '../../src/data/storage';
import {ExamService} from '../../src/services';
import {memoryAdapter} from '../fixtures/memory';
import {clone} from '../../src/core';
import {defaults} from '../../src/settings';
import {newQuestion} from '../../src/seed';
import {MaterialIndex} from '../../src/ai/materials';
import type ExamFlowPlugin from '../../src/main';
import {indexPdf} from '../../src/data/pdf';
import {generatePaper} from '../../src/domain/generator';
Object.assign(HTMLElement.prototype,{
    empty(this:HTMLElement){this.replaceChildren();},setText(this:HTMLElement,text:string){this.textContent=text;},addClass(this:HTMLElement,name:string){this.classList.add(name);},
    createEl(this:HTMLElement,tag:string,options:{text?:string;cls?:string;attr?:Record<string,string>}={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const[k,v]of Object.entries(options.attr??{}))el.setAttribute(k,v);this.append(el);return el;}
});
async function boot(){
    const repo=new Repository(new Storage(memoryAdapter(),'browser'),'ExamFlow');await repo.load();
    const listeners=new Set<()=>void>(),notify=()=>listeners.forEach(callback=>callback());
    const service=new ExamService(repo,notify,error=>{throw error;});
    const plugin={repo,service,listeners,notify,route:'home',settings:clone(defaults),activeExam:repo.exams[0],makeQuestion:newQuestion,index:new MaterialIndex(),apiKey:'',app:{},message:(error:Error)=>error.message,generateWithSupplement:service.generate.bind(service),run:(task:()=>Promise<unknown>)=>{void task().then(notify);}} as unknown as ExamFlowPlugin;
    render(h(AppView,{plugin}),document.getElementById('app')!);
    Object.assign(window,{testPlugin:plugin,testIndexPdf:indexPdf,testGeneratePaper:generatePaper});
}
void boot();
