import type {Attempt,Paper,WrongQuestionStatus,WrongQuestionEntry,KnowledgePoint,KnowledgePointProgress} from '../types/domain';
import {answered} from './attempt';
import {localDate} from '../core';
import {risk} from './review';

export function wrongQuestions(attempts: Attempt[], papers: Paper[], statuses: Record<string,WrongQuestionStatus>): WrongQuestionEntry[] {
    const result = new Map<string,WrongQuestionEntry>();
    for (const attempt of [...attempts].filter(a => a.status === 'graded').sort((a,b) => (a.submittedAt??a.createdAt).localeCompare(b.submittedAt??b.createdAt))) {
        for (const s of attempt.score?.perQuestion ?? []) {
            const item = papers.find(p => p.id === attempt.paperId)?.items.find(i => i.questionId === s.questionId);
            const entry = result.get(s.questionId) ?? {questionId:s.questionId,question:item?.snapshot,wrongCount:0,lastWrongAt:'',lastResult:'unanswered' as const,attemptIds:[],errorReasons:[],mastered:statuses[s.questionId]?.mastered??false};
            entry.lastResult = s.correct === true ? 'correct' : answered(attempt.answers[s.questionId]?.answer) ? 'wrong' : 'unanswered';
            if (s.correct !== true) { entry.wrongCount++; entry.lastWrongAt=attempt.submittedAt!; entry.attemptIds.push(attempt.id); }
            entry.errorReasons = [...new Set([...entry.errorReasons,...attempt.answers[s.questionId]?.errorReasons??[],...statuses[s.questionId]?.errorReasons??[]])];
            result.set(s.questionId,entry);
        }
    }
    return [...result.values()].filter(e => e.wrongCount>0).sort((a,b) => b.lastWrongAt.localeCompare(a.lastWrongAt));
}
export function statistics(attempts: Attempt[], papers: Paper[], knowledge: KnowledgePoint[], progress: Record<string,KnowledgePointProgress>,statuses:Record<string,WrongQuestionStatus>={}) {
    const graded = attempts.filter(a => a.status === 'graded' && a.score).sort((a,b) => a.submittedAt!.localeCompare(b.submittedAt!));
    const trend = graded.slice(-20).map(a => ({id:a.id,date:a.submittedAt!,ratio:a.score!.earnedPoints/a.score!.totalPoints}));
    const subjects: Record<string,{earned:number;total:number;correct:number;count:number}> = {};
    const completed: Record<string,number> = {};
    for (const a of graded) {
        const day = localDate(new Date(a.submittedAt!));
        completed[day]=(completed[day]??0)+Object.values(a.answers).filter(r => answered(r.answer)).length;
        const paper = papers.find(p => p.id === a.paperId);
        for (const s of a.score!.perQuestion) {
            const subject = paper?.items.find(i => i.questionId === s.questionId)?.snapshot.subjectId;
            if (!subject) continue;
            const row = subjects[subject]??{earned:0,total:0,correct:0,count:0};
            row.earned+=s.earnedPoints; row.total+=s.points; row.correct+=Number(s.correct===true); row.count++; subjects[subject]=row;
        }
    }
    const buckets = (values:number[]) => [0,0,0,0,0].map((_,i) => values.filter(v => Math.max(0,Math.ceil(v/20)-1)===i).length);
    const distribution={chapter:{} as Record<string,number>,knowledge:{} as Record<string,number>,type:{} as Record<string,number>,reason:{} as Record<string,number>};
    for(const a of graded)for(const s of a.score!.perQuestion)if(s.correct!==true){const q=papers.find(p=>p.id===a.paperId)?.items.find(i=>i.questionId===s.questionId)?.snapshot;if(!q)continue;
        for(const id of q.chapterIds)distribution.chapter[id]=(distribution.chapter[id]??0)+1;
        for(const id of q.knowledgePointIds)distribution.knowledge[id]=(distribution.knowledge[id]??0)+1;
        distribution.type[q.type]=(distribution.type[q.type]??0)+1;
        for(const reason of new Set([...a.answers[q.id]?.errorReasons??[],...statuses[q.id]?.errorReasons??[]]))distribution.reason[reason]=(distribution.reason[reason]??0)+1;
    }
    const important=knowledge.filter(k=>k.importance>=4),today=localDate();
    return {trend,subjects,completed,distribution,importantMastery:important.length?important.reduce((n,k)=>n+(progress[k.id]?.mastery??0),0)/important.length:0,
        dailyReview:{due:knowledge.filter(k=>(progress[k.id]?.review.dueAt??today)<=today).length,completed:knowledge.filter(k=>progress[k.id]?.review.lastReviewedAt&&localDate(new Date(progress[k.id]!.review.lastReviewedAt!))===today).length},
        masteryDistribution:buckets(knowledge.map(k => progress[k.id]?.mastery??0)),riskDistribution:buckets(knowledge.map(k => progress[k.id] ? risk(progress[k.id]!.recentOutcomes,progress[k.id]!.review):50)),history:graded.slice().reverse()};
}
