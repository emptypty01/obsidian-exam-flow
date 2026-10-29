import {sameJson} from '../core';
import {Repository} from './repository';
import {clone,now} from '../core';
import {validateQuestion} from '../domain/validation';
import type {ExamConfig,QuestionBank,KnowledgePoint,Paper,Attempt,ExamFlowSettings} from '../types/domain';
import type {LearningState} from './repository';
import {parseSettings} from '../settings';
import {validateExam} from './config';
import {bankSchema,knowledgeSchema,paperSchema,attemptSchema,progressSchema,wrongStatusSchema} from './schemas';
import {compactBankDocuments} from './compact-banks';
export interface Bundle {format:'examflow-backup';schemaVersion:1;exportedAt:string;exams:ExamConfig[];banks:QuestionBank[];knowledgePoints:KnowledgePoint[];papers:Paper[];attempts:Attempt[];deviceId:string;progress:LearningState['progress'];wrongStatus:LearningState['wrong'];appliedAttemptIds:string[];settings?:ExamFlowSettings}
export function exportBundle(repo:Repository,settings?:ExamFlowSettings):Bundle{return clone({format:'examflow-backup',schemaVersion:1,exportedAt:now(),exams:repo.exams,banks:repo.banks,knowledgePoints:repo.knowledge,papers:repo.papers,attempts:repo.attempts,deviceId:repo.storage.deviceId,progress:repo.state.progress,wrongStatus:repo.state.wrong,appliedAttemptIds:repo.state.appliedAttemptIds,...settings?{settings:parseSettings(settings)}:{}});}
export function parseBundle(raw:unknown):Bundle{
    const b=raw as Bundle;
    if(b?.format!=='examflow-backup'||b.schemaVersion!==1||![b.exams,b.banks,b.knowledgePoints,b.papers,b.attempts].every(Array.isArray)||!b.progress||!b.wrongStatus||!Array.isArray(b.appliedAttemptIds))throw new Error('备份格式或版本无效');
    b.exams=b.exams.map(validateExam);
    if(b.settings)b.settings=parseSettings(b.settings);
    b.banks=b.banks.map(bank=>bankSchema.parse(bank)) as QuestionBank[];
    b.knowledgePoints=b.knowledgePoints.map(k=>knowledgeSchema.parse(k)) as KnowledgePoint[];
    b.papers=b.papers.map(p=>paperSchema.parse(p)) as Paper[];
    b.attempts=b.attempts.map(a=>attemptSchema.parse(a)) as Attempt[];
    b.progress=progressSchema.parse(b.progress) as Bundle['progress'];b.wrongStatus=wrongStatusSchema.parse(b.wrongStatus) as Bundle['wrongStatus'];
    for(const list of [b.exams,b.banks,b.knowledgePoints,b.papers,b.attempts])for(const entity of list)if(!/^[\w-]+$/.test(entity.id)||entity.schemaVersion!==1)throw new Error('备份包含非法 ID 或版本');
    for(const paper of b.papers)for(const item of paper.items)validateQuestion(item.snapshot);
    return b;
}
export function previewBundle(repo:Repository,b:Bundle):string[]{
    const conflicts:string[]=[];
    for(const bank of b.banks)if(repo.banks.some(local=>local.subjectId===bank.subjectId&&local.id!==bank.id))conflicts.push(`科目题库:${bank.subjectId}`);
    if(new Set(b.banks.map(bank=>bank.subjectId)).size!==b.banks.length)conflicts.push('备份内科目题库重复');
    const pairs:[{id:string}[],{id:string}[]][]=[[repo.exams,b.exams],[repo.banks,b.banks],[repo.knowledge,b.knowledgePoints],[repo.papers,b.papers],[repo.attempts,b.attempts]];
    for(const [local,incoming]of pairs)for(const entity of incoming){const old=local.find(e=>e.id===entity.id);if(old&&!sameJson(old,entity))conflicts.push(entity.id);}
    for(const key of new Set([...Object.keys(repo.state.progress),...Object.keys(repo.state.wrong)]))if((b.progress[key]&&repo.state.progress[key]&&!sameJson(b.progress[key],repo.state.progress[key]))||(b.wrongStatus[key]&&repo.state.wrong[key]&&!sameJson(b.wrongStatus[key],repo.state.wrong[key])))conflicts.push(key);
    return conflicts;
}
export async function restoreBundle(repo:Repository,raw:unknown,policy:'reject'|'keep_local'|'use_backup'='reject'):Promise<void>{
    const b=parseBundle(raw), conflicts=previewBundle(repo,b);if(conflicts.length&&policy==='reject')throw new Error(`恢复包含冲突 ID：${conflicts.join('、')}；请人工处理后恢复`);
    const merge=<T extends {id:string}>(local:T[],incoming:T[])=>[...local.filter(e=>!incoming.some(i=>i.id===e.id)||policy!=='use_backup'),...incoming.filter(e=>!local.some(i=>i.id===e.id)||policy==='use_backup')];
    for(const paper of b.papers){const old=repo.papers.find(p=>p.id===paper.id);if(old&&!sameJson(old,paper)&&policy==='use_backup')throw new Error(`历史试卷快照冲突，不能替换：${paper.id}`);}
    for(const attempt of b.attempts){const old=repo.attempts.find(a=>a.id===attempt.id);if(old&&old.status!=='in_progress'&&policy==='use_backup'&&(!sameJson(old.answers,attempt.answers)||old.status!==attempt.status))throw new Error(`历史答卷已锁定，不能替换：${attempt.id}`);}
    await writeBackup(repo);
    await repo.saveExams(merge(repo.exams,b.exams));
    for(const bank of b.banks){const local=repo.banks.find(x=>x.subjectId===bank.subjectId);if(!local)await repo.saveBank(bank);else await repo.saveBank({...local,questions:merge(local.questions,bank.questions),updatedAt:now()});}
    for(const kp of b.knowledgePoints)if(policy==='use_backup'||!repo.knowledge.some(x=>x.id===kp.id))await repo.saveKnowledge(kp);
    for(const paper of b.papers)if(!repo.papers.some(x=>x.id===paper.id))await repo.savePaper(paper);
    for(const attempt of b.attempts)if(policy==='use_backup'||!repo.attempts.some(x=>x.id===attempt.id))await repo.saveAttempt(attempt);
    await repo.mutateState(state=>({...state,progress:policy==='use_backup'?{...state.progress,...b.progress}:{...b.progress,...state.progress},wrong:policy==='use_backup'?{...state.wrong,...b.wrongStatus}:{...b.wrongStatus,...state.wrong},appliedAttemptIds:[...new Set([...state.appliedAttemptIds,...b.appliedAttemptIds])]}));
}
export async function writeBackup(repo:Repository,settings?:ExamFlowSettings):Promise<string>{const path=repo.path(`_backup/${now().replace(/[:.]/g,'-')}/bundle.json`);await repo.storage.writeJson(path,exportBundle(repo,settings));return path;}
export async function recoverFile(repo:Repository,path:string):Promise<unknown|null>{
    const root=repo.path('_backup'),adapter=repo.storage.adapter;if(!await adapter.exists(root))return null;
    const folders=(await adapter.list(root)).folders.sort().reverse();
    const relative=path.slice(repo.root.length+1),entityId=relative.split('/').at(-1)?.replace(/\.json$/,'');
    for(const folder of folders){
        const file=`${folder}/bundle.json`;if(!await adapter.exists(file))continue;
        try{const b=parseBundle(JSON.parse(await adapter.read(file)));
            if(relative.startsWith('banks/')&&entityId!=='index')for(const bank of b.banks){
                const subject=b.exams.flatMap(e=>e.subjects).find(s=>s.id===bank.subjectId);if(!subject)continue;
                const documents=compactBankDocuments(bank,subject),document=documents[relative.split('/').at(-1)!];if(document)return document;
            }
            const recovered=relative==='config/exams.json'?{schemaVersion:1,exams:b.exams}:relative==='state/learning.json'?{schemaVersion:1,progress:b.progress,wrong:b.wrongStatus,appliedAttemptIds:b.appliedAttemptIds}:relative.startsWith('banks/')?b.banks.find(bank=>bank.subjectId===entityId):relative.startsWith('papers/')?b.papers.find(p=>p.id===entityId):relative.startsWith('attempts/')?b.attempts.find(a=>a.id===entityId):null;
            if(recovered)return recovered;
        }catch{continue;}
    }
    return null;
}
