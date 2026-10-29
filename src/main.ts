import {sameJson} from './core';
import {Plugin,ItemView,WorkspaceLeaf,Notice,requestUrl,PluginSettingTab,Setting,parseYaml,stringifyYaml} from 'obsidian';
import {h,render} from 'preact';
import {Storage} from './data/storage';
import {Repository} from './data/repository';
import {ExamService} from './services';
import {defaults,parseSettings} from './settings';
import type {ExamFlowSettings,ChatRequest,PaperConfig,Paper} from './types/domain';
import {id,clone,now,errorMessage} from './core';
import {CompatibleProvider} from './ai/provider';
import {confirm,choose,editJson,pickFile,download} from './ui/dialogs';
import {AppView} from './ui/app';
import {parseBundle,previewBundle,restoreBundle,writeBackup,recoverFile} from './data/backup';
import {validateExam} from './data/config';
import {newQuestion} from './seed';
import {paperRequirements} from './domain/core-paper';
import {subjectType} from './data/compact-banks';
import {generatePaperQuestions} from './ai/paper-questions';
import {readStream} from './ai/stream';
import {validateQuestion,duplicateSimilarity,normalizeStem} from './domain/validation';

export const VIEW='examflow-main';
export default class ExamFlowPlugin extends Plugin {
    settings:ExamFlowSettings=clone(defaults);
    repo!:Repository; service!:ExamService; provider!:CompatibleProvider;
    apiKey=''; route='home'; listeners=new Set<()=>void>();cacheKey='';
    operationController?:AbortController;
    aiProgress='';
    loadDevice(key:string):unknown{return typeof this.app.loadLocalStorage==='function'?this.app.loadLocalStorage(key):null;}
    saveDevice(key:string,value:unknown){if(typeof this.app.saveLocalStorage==='function')this.app.saveLocalStorage(key,value);}
    get activeExam(){return this.repo.exams.find(e=>e.id===this.settings.activeExamId)??this.repo.exams[0]!;}
    makeQuestion(subjectId=this.activeExam.subjects[0]!.id){
        const subject=this.activeExam.subjects.find(s=>s.id===subjectId);if(!subject)throw new Error('科目不存在');
        const q=newQuestion();q.examId=this.activeExam.id;q.subjectId=subject.id;q.chapterIds=[];q.knowledgePointIds=[];
        q.type=subjectType(subject.name,subject.questionTypes);
        if(q.type!=='single_choice'){q.options=undefined;q.answer={kind:'subjective',referenceAnswer:'请填写参考答案',rubric:q.type==='essay'?[{id:'r1',description:'内容与论证',points:1}]:[]};}
        return q;
    }
    notify=()=>{for(const callback of this.listeners)callback();};
    message=(error:unknown)=>{const message=errorMessage(error);return this.apiKey?message.replaceAll(this.apiKey,'[已脱敏]'):message;};
    error=(error:unknown)=>{new Notice(this.message(error),8000);};
    run=(task:()=>Promise<unknown>)=>{void task().then(this.notify).catch(this.error);};
    async onload(){
        const raw=await this.loadData() as Partial<ExamFlowSettings>|null;
        this.settings={...clone(defaults),...raw,ui:{...defaults.ui,...raw?.ui},review:{...defaults.review,...raw?.review},privacy:{...defaults.privacy,...raw?.privacy},llm:{...defaults.llm,...raw?.llm},backup:{...defaults.backup,...raw?.backup}};
        this.settings=parseSettings(this.settings);
        if(this.settings.llm.apiKeyMode==='device')this.apiKey=String(this.loadDevice('examflow.apiKey')??'');
        const device=String(this.loadDevice('examflow.deviceId')??id('device'));this.saveDevice('examflow.deviceId',device);
        this.cacheKey=String(this.loadDevice('examflow.cacheNamespace')??id('cache'));this.saveDevice('examflow.cacheNamespace',this.cacheKey);
        this.repo=new Repository(new Storage(this.app.vault.adapter,device),this.settings.dataFolder,{parse:parseYaml,stringify:stringifyYaml});
        this.repo.storage.recoverJson=path=>recoverFile(this.repo,path);
        this.repo.storage.recovered=path=>new Notice(`已从最近有效备份加载 ${path}，原损坏文件与副本保留；请核对后保存。`,10000);
        try{await this.repo.load();await this.repo.migrateBanks();}catch(error){this.error(error);throw error;}
        this.service=new ExamService(this.repo,this.notify,this.error);await this.service.recover();
        this.createProvider();
        this.registerView(VIEW,leaf=>new ExamFlowView(leaf,this));
        this.addRibbonIcon('graduation-cap','打开 ExamFlow',()=>this.run(()=>this.open()));
        const commands=[['open','打开 ExamFlow','home'],['generate','开始组卷','generate'],['wrong','打开错题中心','wrong'],['history','打开试卷历史','history']] as const;
        for(const [key,name,route]of commands)this.addCommand({id:key,name,callback:()=>this.run(async()=>{this.route=route;await this.open();})});
        this.addCommand({id:'import-bank',name:'导入题库',callback:()=>this.run(()=>this.importBank())});
        this.addCommand({id:'backup',name:'导出备份',callback:()=>this.run(()=>this.backup())});
        this.addSettingTab(new SettingsTab(this));
        this.registerInterval(window.setInterval(()=>this.run(()=>this.service.checkDeadline()),1000));
        this.registerDomEvent(document,'visibilitychange',()=>{this.run(()=>this.service.flush());});
        this.registerDomEvent(window,'blur',()=>{this.run(()=>this.service.flush());});
        this.registerDomEvent(window,'beforeunload',()=>{void this.service.flush().catch(this.error);});
    }
    onunload(){void this.service?.flush().catch(this.error);this.apiKey='';}
    async saveSettings(){await this.saveData(parseSettings(this.settings));}
    createProvider(){
        this.provider=new CompatibleProvider(this.settings.llm,()=>this.apiKey,async(url,headers,body,signal,onDelta)=>{
            if(signal.aborted)throw new Error('llm_aborted');
            if(onDelta){const response=await fetch(url,{method:'POST',headers,body,signal});return {status:response.status,json:response.ok?await readStream(response,onDelta):{}};}
            try{const response=await fetch(url,{method:'POST',headers,body,signal});return {status:response.status,json:await response.json()};}catch(error){if(signal.aborted)throw new Error('llm_aborted');if(!(error instanceof TypeError))throw error;}
            const response=await requestUrl({url,method:'POST',headers,body,throw:false});
            if(signal.aborted)throw new Error('llm_aborted');
            return {status:response.status,json:response.json};
        });
        this.provider.defaultSignal=()=>this.operationController?.signal;
        this.provider.onDelta=text=>{this.aiProgress+=text;this.notify();};
        this.provider.onFallback=()=>{this.aiProgress='';new Notice('流式请求失败，已回退非流式请求');};
        const usage=this.loadDevice('examflow.usage');this.provider.usage=Array.isArray(usage)?usage:[];
        this.provider.onUsage=()=>{this.provider.usage=this.provider.usage.slice(-500);this.saveDevice('examflow.usage',this.provider.usage);this.notify();};
    }
    async open(){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}this.app.workspace.revealLeaf(leaf);this.notify();}
    async aiConsent(title:string,payload:unknown):Promise<boolean>{
        if(!this.settings.privacy.aiEnabled)throw new Error('请先在设置启用 AI 数据发送');
        if(!this.settings.privacy.consentAcknowledgedAt){if(!await confirm(this.app,'首次数据发送授权','AI 操作会将预览中的资料和作答发送到配置的模型服务。资料可能包含个人内容；确认后仍需逐次预览。'))return false;this.settings.privacy.consentAcknowledgedAt=now();await this.saveSettings();}
        return confirm(this.app,title,JSON.stringify(payload,null,2));
    }
    async aiChat(request:ChatRequest,signal?:AbortSignal){
        if(!await this.aiConsent('发送内容预览',request))return null;
        const own=!this.operationController;if(own)this.operationController=new AbortController();
        try{return await this.provider.chat(request,signal??this.operationController?.signal);}finally{if(own)this.operationController=undefined;}
    }
    async backup(){await this.service.flush();const path=await writeBackup(this.repo,this.settings);this.settings.backup.lastBackupAt=now();await this.saveSettings();new Notice(`备份已保存：${path}`);}
    async restore(){
        const file=await pickFile('.json');if(!file)return;
        const bundle=parseBundle(JSON.parse(await file.text())),conflicts=previewBundle(this.repo,bundle);
        const action=await choose(this.app,'恢复预览',`题库 ${bundle.banks.length}，知识点 ${bundle.knowledgePoints.length}，答卷 ${bundle.attempts.length}；冲突：${conflicts.join('、')||'无'}。先备份现有数据；历史试卷与已交卷答案保持锁定。`,['合并并保留本地冲突项','合并并使用备份冲突项','取消']);if(!action||action==='取消')return;
        await this.service.flush();await restoreBundle(this.repo,bundle,action==='合并并使用备份冲突项'?'use_backup':'keep_local');if(bundle.settings&&action==='合并并使用备份冲突项'){this.settings=parseSettings({...bundle.settings,dataFolder:this.settings.dataFolder});this.apiKey='';this.saveDevice('examflow.apiKey',null);await this.saveSettings();this.createProvider();}if(this.service.current){const restored=this.repo.attempts.find(a=>a.id===this.service.current!.id);this.service.current=restored?clone(restored):undefined;}this.notify();new Notice('恢复完成');
    }
    async importBank(){
        const file=await pickFile('.json');if(!file)return;const raw=JSON.parse(await file.text());
        const questions=this.repo.parseImportedQuestions(raw);
        if(!await confirm(this.app,'导入题库预览',`${questions.length} 道题；完全重复跳过，ID 冲突拒绝。确认仍导入疑似重复题？`))return;
        const approved=[];
        for(const value of questions){const q=validateQuestion(value),similar=[...this.repo.questions,...approved].find(x=>x.id!==q.id&&duplicateSimilarity(x,q)>=0.9&&normalizeStem(x.stem)!==normalizeStem(q.stem));
            if(similar){const action=await choose(this.app,'疑似重复题处理',`新题：${q.stem}\n已有题 ${similar.id}：${similar.stem}`,['跳过','仍导入','标记为重复','取消全部']);if(!action||action==='取消全部')return;if(action==='跳过')continue;if(action==='标记为重复')q.duplicateOf=similar.id;}
            approved.push(q);
        }
        const result=await this.repo.importQuestions({schemaVersion:1,questions:approved},true);new Notice(`导入 ${result.added}，跳过 ${result.skipped+questions.length-approved.length}`);this.notify();
    }
    async generateExamPaper(config:PaperConfig):Promise<Paper>{
        const exam=this.repo.exams.find(e=>e.id===config.examId);if(!exam)throw new Error('考试不存在');
        const req=paperRequirements(config,exam,this.repo.questions);
        let generated:import('./types/domain').Question[]=[];
        if(req.aiCount){
            if(!await this.aiConsent('AI 出题内容预览',{exam:exam.name,subject:req.subject.name,type:req.type,count:req.aiCount,instruction:config.instruction??''}))throw new Error('已取消 AI 出题');
            generated=await generatePaperQuestions(this.provider,config,exam,this.repo.questions,this.operationController?.signal);
            if(!await confirm(this.app,'采用 AI 题目',`以下题目为 AI 创作，不是真题。请核对后确认采用：\n${JSON.stringify(generated.map(q=>({stem:q.stem,options:q.options,answer:q.answer,explanation:q.explanation})),null,2)}`))throw new Error('未采用 AI 题，未保存试卷');
        }
        return this.service.generateCore(config,generated);
    }
    exportBank(markdown=false){const questions=this.repo.questions;download(markdown?'ExamFlow-题库.md':'ExamFlow-题库.json',markdown?questions.map((q,i)=>`## ${i+1}. ${q.stem}\n\n${q.options?.map(o=>`${o.key}. ${o.text}`).join('\n')??''}\n\n来源：${q.source.type} / ${q.source.nature}\n\n答案：${JSON.stringify(q.answer)}\n\n${q.explanation??''}`).join('\n\n'):JSON.stringify({format:'examflow-bank',schemaVersion:1,questions},null,2));}
    async importExam(){
        const file=await pickFile('.json,.md');if(!file)return;
        let text=await file.text();
        if(file.name.endsWith('.md')){const match=text.match(/```json\s*([\s\S]*?)```/);if(!match)throw new Error('Markdown 中需要包含完整考试配置的 JSON 代码块');text=match[1]!;}
        const exam=validateExam(JSON.parse(text));
        if(!await confirm(this.app,'导入考试配置',`${exam.name}，${exam.subjects.length} 科目，${exam.chapters.length} 章节。相同考试 ID 将替换配置。`))return;
        const referenced=this.repo.questions.filter(q=>q.examId===exam.id);
        for(const q of referenced)if(!exam.subjects.some(s=>s.id===q.subjectId)||q.chapterIds.some(c=>!exam.chapters.some(n=>n.id===c)))throw new Error('新配置会使已有题目引用失效');
        await this.repo.saveExams([...this.repo.exams.filter(e=>e.id!==exam.id),exam]);this.settings.activeExamId=exam.id;await this.saveSettings();this.notify();
    }
    async resolveConflict(file:string,choice:'local'|'remote'){
        if(!file.startsWith(this.repo.root+'/')||!file.includes('.conflict-'))throw new Error('冲突文件路径无效');
        const original=file.replace(/\.conflict-[^.]+(?=\.[^.]+$)/,'');
        const local=await this.repo.storage.readText(file),remote=await this.repo.storage.readText(original);
        if(local===null)throw new Error('冲突副本不存在，请刷新');
        if(!await confirm(this.app,choice==='local'?'保留本地冲突版本':'保留当前远端版本',`文件：${original}\n本地长度：${local.length}，远端长度：${remote?.length??0}。处理前会保留两份原文备份。`))return;
        if(choice==='local'&&original.includes('/attempts/')&&remote){const existing=JSON.parse(remote);const incoming=JSON.parse(local);if(existing.status!=='in_progress'&&!sameJson(existing.answers,incoming.answers))throw new Error('远端答卷已交卷，不能替换锁定答案；请另存冲突副本人工核查');}
        const backup=this.repo.path(`_backup/conflict-${Date.now()}`);
        await this.repo.storage.writeText(`${backup}/local.txt`,local);
        if(remote!==null)await this.repo.storage.writeText(`${backup}/remote.txt`,remote);
        if(choice==='local')await this.repo.storage.writeText(original,local);
        await this.repo.storage.adapter.remove(file);
        await this.repo.load();
        if(this.service.current)this.service.current=this.repo.attempts.find(a=>a.id===this.service.current!.id);
        this.notify();new Notice('冲突已处理，原文已备份');
    }
}
class ExamFlowView extends ItemView {
    private refresh=()=>{};
    constructor(leaf:WorkspaceLeaf,private plugin:ExamFlowPlugin){super(leaf);}
    getViewType(){return VIEW;}getDisplayText(){return 'ExamFlow';}getIcon(){return 'graduation-cap';}
    async onOpen(){this.contentEl.addClass('examflow');this.refresh=()=>render(h(AppView,{plugin:this.plugin,revision:Date.now()}),this.contentEl);this.plugin.listeners.add(this.refresh);this.refresh();}
    async onClose(){await this.plugin.service.flush();this.plugin.listeners.delete(this.refresh);render(null,this.contentEl);}
}
class SettingsTab extends PluginSettingTab {
    constructor(private plugin:ExamFlowPlugin){super(plugin.app,plugin);}
    display(){
        const p=this.plugin,s=p.settings,c=this.containerEl;c.empty();c.createEl('h2',{text:'ExamFlow 设置'});
        new Setting(c).setName('当前考试').addDropdown(d=>{for(const e of p.repo.exams)d.addOption(e.id,e.name);d.setValue(p.activeExam.id).onChange(v=>{s.activeExamId=v;p.run(()=>p.saveSettings());p.notify();});});
        new Setting(c).setName('数据目录').setDesc(`${s.dataFolder}；更改目录需先备份并重启插件。`).addText(t=>t.setValue(s.dataFolder).onChange(v=>{s.dataFolder=v;p.run(()=>p.saveSettings());}));
        new Setting(c).setName('AI 数据发送').setDesc('默认关闭；每次发送均预览并确认。').addToggle(t=>t.setValue(s.privacy.aiEnabled).onChange(v=>{s.privacy.aiEnabled=v;p.run(()=>p.saveSettings());}));
        for(const [key,name]of [['baseUrl','Base URL'],['model','模型']]as const)new Setting(c).setName(name).addText(t=>t.setValue(s.llm[key]).onChange(v=>{s.llm[key]=v;p.createProvider();p.run(()=>p.saveSettings());}));
        new Setting(c).setName('API Key').setDesc('默认仅在本次会话使用，不写入 vault。').addText(t=>{t.inputEl.type='password';t.setValue(p.apiKey).onChange(v=>{p.apiKey=v;if(s.llm.apiKeyMode==='device')p.saveDevice('examflow.apiKey',v);});});
        new Setting(c).setName('在此设备记住密钥').setDesc('设备本地为明文存储，并非加密保险箱；不随 vault 同步。').addToggle(t=>t.setValue(s.llm.apiKeyMode==='device').onChange(v=>{if(v&&typeof p.app.saveLocalStorage!=='function'){new Notice('当前宿主不支持设备存储，密钥仍仅保存在会话');return;}s.llm.apiKeyMode=v?'device':'session';p.saveDevice('examflow.apiKey',v?p.apiKey:null);p.run(()=>p.saveSettings());}));
        new Setting(c).setName('清除本地密钥').addButton(b=>b.setButtonText('清除').onClick(()=>{p.apiKey='';p.saveDevice('examflow.apiKey',null);this.display();}));
        new Setting(c).setName('连接测试').addButton(b=>b.setButtonText('预览并测试').onClick(()=>p.run(async()=>{const result=await p.aiChat({messages:[{role:'user',content:'Reply OK'}]});if(result)new Notice('模型响应成功');}))).addButton(b=>b.setButtonText('取消请求').onClick(()=>p.operationController?.abort()));
        new Setting(c).setName('高级配置').setDesc('超时、重试、并发与价格；流式失败时回退非流式请求。').addButton(b=>b.setButtonText('编辑').onClick(()=>editJson(p.app,'高级配置',{llm:s.llm},async value=>{
            if(value.llm.timeoutMs<1000||value.llm.maxRetries<0||value.llm.maxRetries>2||value.llm.concurrency<1||value.llm.concurrency>5)throw new Error('超时至少 1000ms；重试 0–2；并发 1–5');
            s.llm=value.llm;await p.saveSettings();p.createProvider();
        })));
        new Setting(c).setName('备份与恢复').setDesc(`上次备份：${s.backup.lastBackupAt??'尚无'}`).addButton(b=>b.setButtonText('备份').onClick(()=>p.run(()=>p.backup()))).addButton(b=>b.setButtonText('恢复').onClick(()=>p.run(()=>p.restore())));
        new Setting(c).setName('考试配置').setDesc('JSON 或含 JSON 代码块的 Markdown；科目、章节与考纲骨架可编辑。').addButton(b=>b.setButtonText('导入').onClick(()=>p.run(()=>p.importExam()))).addButton(b=>b.setButtonText('编辑').onClick(()=>editJson(p.app,'考试配置',p.repo.exams,async values=>{await p.repo.saveExams(values.map(validateExam));p.notify();})));
        new Setting(c).setName('同步冲突').addButton(b=>b.setButtonText('查看冲突').onClick(()=>p.run(async()=>{p.route='conflicts';await p.open();})));
        c.createEl('p',{text:'题库格式 v2；历史试卷兼容 v1。日志和导出不包含 API Key。AI 评分仅供参考。'});
    }
}
