import {sameJson} from '../core';
import type {Attempt,ExamConfig,KnowledgePoint,KnowledgePointProgress,Paper,Question,QuestionBank,WrongQuestionStatus} from '../types/domain';
import {Storage,safePath} from './storage';
import {meta,now,clone} from '../core';
import {seedExam,sampleQuestions,seedKnowledge} from '../seed';
import {validateQuestion,duplicateSimilarity,questionFingerprint} from '../domain/validation';
import {validateExam} from './config';
import {mastery} from '../domain/review';
import {bankSchema,knowledgeSchema,paperSchema,attemptSchema,learningSchema} from './schemas';
import {CompactBankStore,decodeCompactFile} from './compact-banks';

export interface LearningState {schemaVersion:1;progress:Record<string,KnowledgePointProgress>;wrong:Record<string,WrongQuestionStatus>;appliedAttemptIds:string[]}
export class Repository {
    private mutation:Promise<void>=Promise.resolve();
    private stateMutation:Promise<void>=Promise.resolve();
    private attemptMutations=new Map<string,Promise<void>>();
    exams:ExamConfig[]=[]; banks:QuestionBank[]=[]; papers:Paper[]=[]; attempts:Attempt[]=[]; knowledge:KnowledgePoint[]=[];
    state:LearningState={schemaVersion:1,progress:{},wrong:{},appliedAttemptIds:[]};
    constructor(public storage:Storage,public root:string,private yaml:{parse:(text:string)=>unknown;stringify:(value:unknown)=>string}={parse:JSON.parse,stringify:value=>JSON.stringify(value,null,2)}) {safePath(root);storage.conflictRegistry=this.path('state/conflicts.json');}
    path(relative:string):string {return `${this.root}/${safePath(relative)}`;}
    private get bankStore(){return new CompactBankStore(this.storage,this.root);}
    async load():Promise<void> {
        for(const dir of ['config','banks','papers','attempts','knowledge','state','_backup']) await this.storage.mkdir(this.path(dir));
        const config=await this.storage.readJson<{schemaVersion:number;exams:ExamConfig[]}>(this.path('config/exams.json'));
        if(!config) {
            this.exams=[clone(seedExam)]; await this.saveExams(this.exams);
            for(const subject of seedExam.subjects) {
                const bank:QuestionBank={...meta('bank'),name:subject.name,examId:seedExam.id,subjectId:subject.id,questions:subject.id==='subj_comprehensive'?clone(sampleQuestions):[]};
                await this.saveBank(bank);
            }
            for(const kp of seedKnowledge)await this.saveKnowledge(kp);
        } else {if(config.schemaVersion!==1)throw new Error('考试配置版本不支持，请先升级插件'); this.exams=config.exams;}
        this.banks=await this.bankStore.load();
        for(const bank of this.banks)for(const q of bank.questions)validateQuestion(q);
        this.papers=await this.loadFolder<Paper>('papers'); this.attempts=await this.loadFolder<Attempt>('attempts');
        this.knowledge=[];
        for(const path of await this.storage.list(this.path('knowledge'))) if(path.endsWith('.md')&&!path.includes('.conflict-')) {
            const text=await this.storage.readText(path);
            const match=text?.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if(!match)throw new Error(`知识点格式无效：${path}`);
            // JSON is a strict subset of YAML; write frontmatter without a YAML runtime dependency.
            const kp=this.yaml.parse(match[1]!) as KnowledgePoint; kp.definition=match[2]!.replace(/^# .*\r?\n\r?\n/,''); this.knowledge.push(kp);
        }
        this.state=await this.storage.readJson<LearningState>(this.path('state/learning.json'))??this.state;
        if(this.state.schemaVersion!==1)throw new Error('学习状态版本不支持');
        this.banks=this.banks.map(b=>bankSchema.parse(b)) as QuestionBank[];this.papers=this.papers.map(p=>paperSchema.parse(p)) as Paper[];this.attempts=this.attempts.map(a=>attemptSchema.parse(a)) as Attempt[];
        this.knowledge=this.knowledge.map(k=>knowledgeSchema.parse(k)) as KnowledgePoint[];this.state=learningSchema.parse(this.state) as LearningState;
    }
    private async loadFolder<T extends {schemaVersion:number}>(folder:string):Promise<T[]> {
        const result:T[]=[];
        for(const path of await this.storage.list(this.path(folder)))if(path.endsWith('.json')&&!path.includes('.conflict-')) {
            const value=await this.storage.readJson<T>(path); if(value){if(value.schemaVersion!==1)throw new Error(`不支持的数据版本：${path}`);result.push(value);}
        }
        return result;
    }
    get questions():Question[]{return this.banks.flatMap(b=>b.questions);}
    async saveExams(exams:ExamConfig[]):Promise<void> {
        exams.forEach(validateExam);
        const subjectIds=exams.flatMap(e=>e.subjects.map(s=>s.id));
        if(new Set(subjectIds).size!==subjectIds.length)throw new Error('科目 ID 必须跨考试唯一');
        for(const q of this.questions){const exam=exams.find(e=>e.id===q.examId);if(!exam)throw new Error('不能移除已被题目引用的考试');validateQuestion(q,exam);}
        await this.storage.writeJson(this.path('config/exams.json'),{schemaVersion:1,exams});this.exams=clone(exams);
    }
    saveBank(bank:QuestionBank):Promise<void> {
        const snapshot=clone(bank),next=this.mutation.catch(()=>{}).then(()=>this.persistBank(snapshot));this.mutation=next;return next;
    }
    private async persistBank(bank:QuestionBank):Promise<void> {
        bank=bankSchema.parse(bank) as QuestionBank;
        if(!/^[\w-]+$/.test(bank.subjectId))throw new Error('科目 ID 无效');
        const exam=this.exams.find(e=>e.id===bank.examId);if(!exam||!exam.subjects.some(s=>s.id===bank.subjectId))throw new Error('题库考试或科目不存在');
        if(new Set(bank.questions.map(q=>q.id)).size!==bank.questions.length||bank.questions.some(q=>q.examId!==bank.examId||q.subjectId!==bank.subjectId||this.banks.some(b=>b.id!==bank.id&&b.questions.some(old=>old.id===q.id))))throw new Error('题目 ID 重复或题库归属不一致');
        if(this.banks.some(b=>b.subjectId===bank.subjectId&&b.id!==bank.id))throw new Error('该科目已有另一题库 ID，请按题目合并后导入');
        const next=this.banks.some(b=>b.id===bank.id)?this.banks.map(b=>b.id===bank.id?clone(bank):b):[...this.banks,clone(bank)];
        await this.bankStore.save(next,this.exams.flatMap(e=>e.subjects));this.banks=next;
    }
    async migrateBanks(){
        if(!await this.storage.adapter.exists(this.path('banks/index.json')))await this.bankStore.save(this.banks,this.exams.flatMap(e=>e.subjects));
    }
    saveQuestion(q:Question):Promise<void> {
        const snapshot=clone(q),next=this.mutation.catch(()=>{}).then(()=>this.persistQuestion(snapshot));this.mutation=next;return next;
    }
    private async persistQuestion(q:Question):Promise<void> {
        const existing=this.questions.find(x=>x.id===q.id);
        if(existing&&(existing.examId!==q.examId||existing.subjectId!==q.subjectId))throw new Error('已有题目的考试与科目不可直接迁移；请创建新 ID 后移除旧题目');
        const exam=this.exams.find(e=>e.id===q.examId);if(!exam)throw new Error('考试不存在');
        validateQuestion(q,exam,this.knowledge.map(k=>k.id));
        let bank=this.banks.find(b=>b.examId===q.examId&&b.subjectId===q.subjectId);
        if(!bank)bank={...meta('bank'),name:q.subjectId,examId:q.examId,subjectId:q.subjectId,questions:[]};
        const next=clone(bank),old=next.questions.find(x=>x.id===q.id);
        const updated={...clone(q),version:old?old.version+1:q.version,updatedAt:now()};
        next.questions=old?next.questions.map(x=>x.id===q.id?updated:x):[...next.questions,updated];next.updatedAt=now();
        await this.persistBank(next);
    }
    removeQuestion(questionId:string):Promise<void> {
        const next=this.mutation.catch(()=>{}).then(async()=>{const bank=this.banks.find(b=>b.questions.some(q=>q.id===questionId));if(bank)await this.persistBank({...bank,questions:bank.questions.filter(q=>q.id!==questionId),updatedAt:now()});});this.mutation=next;return next;
    }
    parseImportedQuestions(raw:unknown):Question[]{
        const object=raw as {schemaVersion?:number;examId?:string;subjectId?:string;questions?:unknown[]};
        if(object.schemaVersion===2){
            const exam=this.exams.find(e=>e.id===object.examId),subject=exam?.subjects.find(s=>s.id===object.subjectId);if(!exam||!subject)throw new Error('导入文件的考试或科目不存在');
            const bank=this.banks.find(b=>b.subjectId===subject.id)??{...meta('bank'),name:subject.name,examId:exam.id,subjectId:subject.id};return decodeCompactFile(raw,bank);
        }
        if(object.schemaVersion!==1||!Array.isArray(object.questions))throw new Error('需要完整 v1 questions 数组或精简 v2 题库文件');
        return object.questions.map(q=>validateQuestion(q));
    }
    async importQuestions(raw:unknown,allowSimilar=false):Promise<{added:number;skipped:number}> {
        const questions=this.parseImportedQuestions(raw);
        const equivalent=(a:Question,b:Question)=>sameJson({...a,createdAt:'',updatedAt:'',extra:undefined},{...b,createdAt:'',updatedAt:'',extra:undefined});
        for(const q of questions)validateQuestion(q,this.exams.find(e=>e.id===q.examId),this.knowledge.map(k=>k.id));
        if(questions.some(q=>!this.exams.some(e=>e.id===q.examId)))throw new Error('考试不存在');
        const incoming=new Map<string,Question>();
        for(const q of questions){const same=this.questions.find(x=>x.id===q.id)??incoming.get(q.id);if(same&&!equivalent(same,q))throw new Error(`ID 冲突：${q.id}，请更换 ID 或通过编辑更新`);incoming.set(q.id,q);}
        let added=0,skipped=0;
        const fingerprints=new Set(await Promise.all(this.questions.map(questionFingerprint)));
        for(const q of questions) {
            const fingerprint=await questionFingerprint(q);
            if(fingerprints.has(fingerprint)){skipped++;continue;}
            const similar=this.questions.find(x=>x.id!==q.id&&duplicateSimilarity(x,q)>=0.9);
            if(similar&&!allowSimilar)throw new Error('存在疑似重复题，请预览后确认仍导入');
            const same=this.questions.find(x=>x.id===q.id);
            if(same&&!equivalent(same,q))throw new Error(`ID 冲突：${q.id}，请更换 ID 或通过编辑更新`);
            if(same){skipped++;continue;}
            await this.saveQuestion(q);fingerprints.add(fingerprint);added++;
        }
        return {added,skipped};
    }
    async savePaper(paper:Paper):Promise<void> {
        if(this.papers.some(p=>p.id===paper.id))throw new Error('试卷不可变');
        await this.storage.writeJson(this.path(`papers/${paper.id}.json`),paper);this.papers.push(clone(paper));
    }
    async deletePaper(paperId:string):Promise<void>{
        const paper=this.papers.find(p=>p.id===paperId);if(!paper)throw new Error('试卷不存在');
        const attempts=this.attempts.filter(a=>a.paperId===paperId);
        if(attempts.some(a=>a.status==='in_progress'))throw new Error('请先完成或放弃该试卷的进行中答卷，再删除');
        const files=[...attempts.map(a=>this.path(`attempts/${a.id}.json`)),this.path(`papers/${paperId}.json`)];
        const original=new Map<string,string>();
        for(const file of files){const raw=await this.storage.readText(file);if(raw===null)throw new Error('历史文件已变化，请重新加载');original.set(file,raw);}
        await this.storage.writeJson(this.path(`_backup/deleted-papers/${paperId}-${Date.now()}/records.json`),{paper,attempts,files:Object.fromEntries(original)});
        const removed:string[]=[];
        try{
            for(const [file,raw]of original){if(await this.storage.adapter.read(file)!==raw)throw new Error('历史文件存在外部修改，停止删除');await this.storage.adapter.remove(file);removed.push(file);}
        }catch(error){
            for(const file of removed.reverse()){if(await this.storage.readText(file)!==null)throw new Error('删除失败且出现外部修改，请从删除备份核对恢复');await this.storage.writeText(file,original.get(file)!);}
            throw error;
        }
        this.papers=this.papers.filter(p=>p.id!==paperId);this.attempts=this.attempts.filter(a=>a.paperId!==paperId);
    }
    saveAttempt(attempt:Attempt):Promise<void>{
        const snapshot=clone(attempt),previous=this.attemptMutations.get(attempt.id)??Promise.resolve();
        const next=previous.catch(()=>{}).then(()=>this.persistAttempt(snapshot));this.attemptMutations.set(attempt.id,next);return next;
    }
    private async persistAttempt(attempt:Attempt):Promise<void> {
        const old=this.attempts.find(a=>a.id===attempt.id);
        if(old&&old.status!=='in_progress'&&!sameJson(old.answers,attempt.answers))throw new Error('交卷后答案不可变');
        if(old&&old.status!=='in_progress'&&old.status!==attempt.status&&!(old.status==='submitted'&&attempt.status==='graded'))throw new Error('答卷状态不能回退或重新打开');
        await this.storage.writeJson(this.path(`attempts/${attempt.id}.json`),attempt);this.attempts=[...this.attempts.filter(a=>a.id!==attempt.id),clone(attempt)];
    }
    async saveKnowledge(kp:KnowledgePoint):Promise<void> {
        kp=knowledgeSchema.parse(kp) as KnowledgePoint;
        if(!/^kp_[\w-]+$/.test(kp.id))throw new Error('知识点 ID 无效');
        if(!kp.name?.trim()||!Number.isInteger(kp.importance)||kp.importance<1||kp.importance>5||(kp.selfRating!==undefined&&(!Number.isInteger(kp.selfRating)||kp.selfRating<1||kp.selfRating>5))||!this.exams.some(e=>e.id===kp.examId&&e.subjects.some(s=>s.id===kp.subjectId)))throw new Error('知识点名称、重要度、自评或考试科目无效');
        const {definition,...front}=kp;
        await this.storage.writeText(this.path(`knowledge/${kp.id}.md`),`---\n${this.yaml.stringify(front).trim()}\n---\n# ${kp.name}\n\n${definition??''}`);
        this.knowledge=[...this.knowledge.filter(k=>k.id!==kp.id),clone(kp)];
        if(this.state.progress[kp.id])await this.mutateState(state=>({...state,progress:{...state.progress,[kp.id]:{...state.progress[kp.id]!,mastery:mastery(state.progress[kp.id]!.recentOutcomes,kp.selfRating),updatedAt:now()}}}));
    }
    async removeKnowledge(kpId:string):Promise<void>{
        if(this.questions.some(q=>q.knowledgePointIds.includes(kpId)))throw new Error('知识点仍被题目引用，请先解除关联');
        const path=this.path(`knowledge/${kpId}.md`);await this.storage.adapter.remove(path);this.knowledge=this.knowledge.filter(k=>k.id!==kpId);
    }
    async saveState(state:LearningState):Promise<void> {await this.storage.writeJson(this.path('state/learning.json'),state);this.state=clone(state);}
    mutateState(update:(state:LearningState)=>LearningState):Promise<void>{const next=this.stateMutation.catch(()=>{}).then(()=>this.saveState(update(clone(this.state))));this.stateMutation=next;return next;}
}
