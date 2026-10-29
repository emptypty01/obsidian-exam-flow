import {h,render} from 'preact';
import {TFile,TFolder} from './obsidian-mock';
import {AppView} from '../../src/ui/app';
import ExamFlowPlugin from '../../src/main';
import {Repository} from '../../src/data/repository';
import {Storage} from '../../src/data/storage';
import {ExamService} from '../../src/services';
import {memoryAdapter} from '../fixtures/memory';
import {clone} from '../../src/core';
import {defaults} from '../../src/settings';
import {newQuestion} from '../../src/seed';
import {MaterialIndex} from '../../src/ai/materials';

Object.assign(HTMLElement.prototype,{
    empty(this:HTMLElement){this.replaceChildren();},setText(this:HTMLElement,text:string){this.textContent=text;},addClass(this:HTMLElement,name:string){this.classList.add(name);},
    createEl(this:HTMLElement,tag:string,options:{text?:string;cls?:string;attr?:Record<string,string>}={}){const el=document.createElement(tag);el.textContent=options.text??'';el.className=options.cls??'';for(const[k,v]of Object.entries(options.attr??{}))el.setAttribute(k,v);this.append(el);return el;}
});
async function boot(){
    const repo=new Repository(new Storage(memoryAdapter(),'bank-browser'),'ExamFlow');await repo.load();
    const listeners=new Set<()=>void>(),notify=()=>listeners.forEach(callback=>callback());
    const service=new ExamService(repo,notify,error=>{throw error;});
    const folders=[new TFolder('资料'),new TFolder('资料/架构'),new TFolder('资料/数据库')];
    const files=[new TFile('资料/架构/缓存.md'),new TFile('资料/架构/架构.txt'),new TFile('资料/数据库/事务.md')];
    const savedSettings:unknown[]=[],opened:string[]=[];
    const plugin={repo,service,listeners,notify,route:'bank',settings:clone(defaults),activeExam:repo.exams[0],makeQuestion:newQuestion,index:new MaterialIndex(),cacheKey:'bank-browser',apiKey:'',
        app:{vault:{getAllLoadedFiles:()=>[...folders,...files],getFiles:()=>files,getAbstractFileByPath:(path:string)=>[...folders,...files].find(f=>f.path===path)},workspace:{openLinkText:async(path:string)=>{opened.push(path);}}},
        message:(error:Error)=>error.message,saveData:async(value:unknown)=>{savedSettings.push(clone(value));},run:(task:()=>Promise<unknown>)=>{void task().then(notify);}} as unknown as ExamFlowPlugin;
    Object.setPrototypeOf(plugin,ExamFlowPlugin.prototype);
    const template=repo.questions[0]!;
    repo.banks[0]!.questions=Array.from({length:60},(_,i)=>({...clone(template),id:`q_bank_ui_${i}`,stem:`第 ${i+1} 道：这是用于验证长列表编辑与分页筛选的独立题目。${'需要在当前题目旁看到编辑表单。'.repeat(4)}`,options:template.options?.map(o=>({...o,text:`${o.text}：实例${i}`})),source:i<3?{type:'real_exam',nature:'recall',...(i<2?{examYear:2026-i}:{})}:{type:'manual',nature:'unknown',examYear:2026}}));
    await repo.saveBank(repo.banks[0]!);
    render(h(AppView,{plugin}),document.getElementById('app')!);
    Object.assign(window,{testPlugin:plugin,testOpened:opened,testSavedSettings:savedSettings});
}
void boot();
