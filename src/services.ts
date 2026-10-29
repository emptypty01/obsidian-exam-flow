import {Repository} from './data/repository';
import type {Attempt,Paper,PaperConfig,UserAnswer,Question,KnowledgePoint,ErrorReason} from './types/domain';
import {clone,localDate,meta,now} from './core';
import {generatePaper} from './domain/generator';
import {saveAnswer,startAttempt,submitAttempt,adjustScore} from './domain/attempt';
import {updateProgress,risk,sm2,initialReview,mastery} from './domain/review';
import {wrongQuestions} from './domain/stats';
import {buildCorePaper} from './domain/core-paper';

export class ExamService {
    private finishing?:Promise<void>;
    private checking?:Promise<void>;
    current?:Attempt;
    saveState:'saved'|'saving'|'failed'='saved';
    private timer?:ReturnType<typeof setTimeout>;
    private queue:Promise<void>=Promise.resolve();
    constructor(public repo:Repository,private changed:()=>void,private failure:(error:unknown)=>void){}
    get paper():Paper|undefined{return this.repo.papers.find(p=>p.id===this.current?.paperId);}
    get wrong(){return wrongQuestions(this.repo.attempts,this.repo.papers,this.repo.state.wrong);}
    async generateCore(config:PaperConfig,generated:Question[]=[]):Promise<Paper>{
        const exam=this.repo.exams.find(e=>e.id===config.examId);if(!exam)throw new Error('考试不存在');
        const paper=buildCorePaper(config,exam,this.repo.questions,generated);await this.repo.savePaper(paper);this.changed();return paper;
    }
    async deletePaper(paperId:string){await this.flush();await this.repo.deletePaper(paperId);if(this.current?.paperId===paperId)this.current=undefined;this.changed();}
    async generate(config:PaperConfig,manualIds?:string[]):Promise<Paper>{
        const wrong=Object.fromEntries(this.wrong.filter(w=>!w.mastered).map(w=>[w.questionId,w.wrongCount]));
        const riskMap=Object.fromEntries(Object.entries(this.repo.state.progress).map(([id,p])=>[id,risk(p.recentOutcomes,p.review)]));
        const result=generatePaper(config,manualIds?this.repo.questions.filter(q=>manualIds.includes(q.id)):this.repo.questions,{papers:this.repo.papers,wrong,knowledge:this.repo.knowledge,progress:this.repo.state.progress,risk:riskMap,today:localDate()});
        if(!result.paper)throw new Error(result.shortage.map(s=>s.message).join('\n'));
        await this.repo.savePaper(result.paper);return result.paper;
    }
    async begin(paper:Paper):Promise<void>{await this.flush();this.current=startAttempt(paper,this.repo.attempts);await this.repo.saveAttempt(this.current);await this.checkDeadline();this.changed();}
    async resume(attempt:Attempt):Promise<void>{await this.flush();this.current=clone(attempt);await this.checkDeadline();this.changed();}
    answer(questionId:string,answer:UserAnswer|null,seconds=0):void{
        if(!this.current)return;
        this.current=saveAnswer(this.current,questionId,answer,new Date(),seconds);this.saveState='saving';
        clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush().catch(this.failure);},800);this.changed();
    }
    async flush():Promise<void>{
        clearTimeout(this.timer);if(this.finishing||!this.current||this.current.status!=='in_progress')return this.queue;
        const snapshot=clone(this.current);this.saveState='saving';
        this.queue=this.queue.catch(()=>{}).then(async()=>{try{await this.repo.saveAttempt(snapshot);this.saveState='saved';}catch(e){this.saveState='failed';throw e;}finally{this.changed();}});
        return this.queue;
    }
    finish():Promise<void>{
        if(this.finishing)return this.finishing;
        this.finishing=this.finishOnce().finally(()=>{this.finishing=undefined;});return this.finishing;
    }
    private async finishOnce():Promise<void>{
        if(!this.current||!this.paper)return;
        await this.flush();const result=submitAttempt(this.paper,this.current);await this.repo.saveAttempt(result);this.current=result;
        await this.applyProgress(result);this.changed();
    }
    async applyProgress(attempt:Attempt):Promise<void>{
        if(attempt.status!=='graded'||this.repo.state.appliedAttemptIds.includes(attempt.id))return;
        const paper=this.repo.papers.find(p=>p.id===attempt.paperId)!;
        await this.repo.mutateState(state=>state.appliedAttemptIds.includes(attempt.id)?state:({...state,progress:updateProgress(paper,attempt,state.progress,this.repo.knowledge,this.repo.attempts,this.repo.papers),appliedAttemptIds:[...state.appliedAttemptIds,attempt.id]}));
    }
    checkDeadline():Promise<void>{
        if(this.checking)return this.checking;
        this.checking=this.checkAllDeadlines().finally(()=>{this.checking=undefined;});return this.checking;
    }
    private async checkAllDeadlines():Promise<void>{
        const expired=this.repo.attempts.filter(a=>a.status==='in_progress'&&Date.now()>=Date.parse(a.deadlineAt));
        for(const attempt of expired){
            if(this.current?.id===attempt.id)await this.finish();
            else{const paper=this.repo.papers.find(p=>p.id===attempt.paperId);if(!paper)continue;const result=submitAttempt(paper,attempt);await this.repo.saveAttempt(result);await this.applyProgress(result);}
        }
    }
    async recover():Promise<void>{
        for(const attempt of this.repo.attempts){
            if(attempt.status==='in_progress'&&Date.now()>=Date.parse(attempt.deadlineAt)){
                const paper=this.repo.papers.find(p=>p.id===attempt.paperId);if(!paper)continue;
                const result=submitAttempt(paper,attempt);await this.repo.saveAttempt(result);await this.applyProgress(result);
            }else await this.applyProgress(attempt);
        }
    }
    async abandon(attempt:Attempt):Promise<void>{await this.flush();await this.repo.saveAttempt({...attempt,status:'abandoned',updatedAt:now()});if(this.current?.id===attempt.id)this.current=undefined;this.changed();}
    async adjust(attempt:Attempt,questionId:string,points:number,reason:string):Promise<void>{
        const paper=this.repo.papers.find(p=>p.id===attempt.paperId)!;const result=adjustScore(paper,attempt,questionId,points,reason);await this.repo.saveAttempt(result);if(this.current?.id===attempt.id)this.current=result;
        let progress:typeof this.repo.state.progress={};const applied:string[]=[];
        for(const a of this.repo.attempts.filter(a=>a.status==='graded').sort((a,b)=>a.submittedAt!.localeCompare(b.submittedAt!))){const p=this.repo.papers.find(p=>p.id===a.paperId);if(p){progress=updateProgress(p,a,progress,this.repo.knowledge,this.repo.attempts,this.repo.papers);applied.push(a.id);}}
        await this.repo.mutateState(state=>({...state,progress:{...state.progress,...progress},appliedAttemptIds:applied}));this.changed();
    }
    async markMastered(questionId:string,mastered:boolean,note='',errorReasons?:ErrorReason[]):Promise<void>{await this.repo.mutateState(state=>({...state,wrong:{...state.wrong,[questionId]:{questionId,mastered,note,errorReasons:errorReasons??state.wrong[questionId]?.errorReasons,updatedAt:now(),masteredAt:mastered?now():undefined}}}));this.changed();}
    async selfReview(kpId:string,quality:number):Promise<void>{
        if(!Number.isInteger(quality)||quality<1||quality>5)throw new Error('自评质量分为 1–5');
        const kp=this.repo.knowledge.find(k=>k.id===kpId);if(!kp)throw new Error('知识点不存在');
        await this.repo.mutateState(state=>{const previous=state.progress[kpId];return {...state,progress:{...state.progress,[kpId]:{knowledgePointId:kpId,recentOutcomes:previous?.recentOutcomes??[],mastery:mastery(previous?.recentOutcomes??[],kp.selfRating),review:sm2(previous?.review??initialReview(),quality),updatedAt:now()}}};});this.changed();
    }
    async importNotes(notes:{path:string;text:string}[],examId:string,subjectId:string):Promise<void>{
        for(const note of notes){if(this.repo.knowledge.some(k=>k.relatedNotePaths.includes(note.path)))continue;
            const name=note.path.split('/').at(-1)!.replace(/\.md$/,'');
            const kp:KnowledgePoint={...meta('kp'),name,examId,subjectId,chapterIds:[],syllabusNodeIds:[],importance:3,definition:note.text,relatedNotePaths:[note.path],tags:[]};await this.repo.saveKnowledge(kp);
        }
        this.changed();
    }
}
