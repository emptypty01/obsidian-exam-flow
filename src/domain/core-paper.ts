import type {ExamConfig,Paper,PaperConfig,Question} from '../types/domain';
import {generatePaper} from './generator';
import {subjectType,examSession} from '../data/compact-banks';
import {clone} from '../core';

export function paperRequirements(config:PaperConfig,exam:ExamConfig,questions:Question[]){
    if(!['real','ai','mixed'].includes(config.mode)||config.examId!==exam.id||config.subjectIds.length!==1)throw new Error('请选择真题、AI 出题或真题+AI，以及一个有效科目');
    const subject=exam.subjects.find(s=>s.id===config.subjectIds[0]);if(!subject)throw new Error('科目不存在');
    const type=subjectType(subject.name,subject.questionTypes),count=Object.values(config.questionCounts).reduce((n,c)=>n+(c??0),0);
    if(!Number.isInteger(count)||count<1||count>100||Object.entries(config.questionCounts).some(([key,value])=>value&&key!==type))throw new Error('题量为 1–100 的整数，题型必须与科目一致');
    if(!Number.isFinite(config.durationMinutes)||config.durationMinutes<=0)throw new Error('时长必须大于零');
    const aiCount=config.mode==='ai'?count:config.mode==='real'?0:config.aiQuestionCount??Math.floor(count/2);
    if(!Number.isInteger(aiCount)||aiCount<0||aiCount>count||(config.mode==='mixed'&&(aiCount===0||aiCount===count)))throw new Error('真题+AI 必须同时包含真题和 AI 题，AI 题量应小于总题量且至少为 1');
    const normalize=(q:Question)=>type==='short_answer'&&q.type==='case_analysis'?{...clone(q),type:'short_answer' as const}:q;
    const pool=questions.filter(q=>q.examId===exam.id&&q.subjectId===subject.id&&q.reviewStatus==='approved'&&!q.duplicateOf).map(normalize).filter(q=>q.type===type);
    const real=pool.filter(q=>q.source.type==='real_exam'&&(!config.examYears?.length||config.examYears.includes(q.source.examYear??-1))&&(!config.examSessions?.length||config.examSessions.includes(examSession(q.source))));
    if(real.length<count-aiCount)throw new Error(`真题需要 ${count-aiCount} 道，当前范围可用 ${real.length} 道`);
    return {subject,type,count,aiCount,real};
}
export function buildCorePaper(config:PaperConfig,exam:ExamConfig,questions:Question[],generated:Question[]=[]):Paper {
    const req=paperRequirements(config,exam,questions),seed=config.seed??crypto.getRandomValues(new Uint32Array(1))[0]!;
    if(generated.length!==req.aiCount||new Set(generated.map(q=>q.id)).size!==generated.length||generated.some(q=>q.examId!==exam.id||q.subjectId!==req.subject.id||q.type!==req.type||q.source.type!=='ai_generated'||q.reviewStatus!=='approved'))throw new Error('AI 题量、题型、来源或审核状态与配置不一致');
    const base={...config,mode:'syllabus_mock' as const,seed,questionCounts:{[req.type]:req.count-req.aiCount},excludeRecentPapers:0};
    const real=req.count>req.aiCount?generatePaper(base,req.real).paper!.items.map(i=>i.snapshot):[];
    const paper=generatePaper({...base,questionCounts:{[req.type]:req.count}},[...real,...generated]).paper;
    if(!paper)throw new Error('组卷配额未满足');
    const names={real:'真题',ai:'AI出题',mixed:'真题+AI'};
    paper.mode=config.mode;paper.config=clone(config);paper.title=`${req.subject.name} · ${names[config.mode as keyof typeof names]} · ${new Date().toLocaleString()}`;
    paper.generationMethod=req.aiCount?'ai':'rule';return paper;
}
