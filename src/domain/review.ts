import type {ReviewState,OutcomeSample,KnowledgePointProgress,KnowledgePoint,Attempt,Paper} from '../types/domain';
import {clamp,localDate,now} from '../core';
import {answered} from './attempt';

export const initialReview = (at = new Date()): ReviewState => ({ease:2.5,intervalDays:0,repetitions:0,lapses:0,dueAt:localDate(at)});
export function sm2(state: ReviewState, quality: number, at = new Date()): ReviewState {
    const q = Math.round(clamp(quality,0,5)) as 0|1|2|3|4|5;
    const ease = Math.max(1.3,state.ease + 0.1 - (5-q)*(0.08+(5-q)*0.02));
    const intervalDays = q < 3 ? 1 : state.repetitions === 0 ? 1 : state.repetitions === 1 ? 6 : Math.round(state.intervalDays*ease);
    const due = new Date(at); due.setDate(due.getDate()+intervalDays);
    return {ease,intervalDays,repetitions:q<3?0:state.repetitions+1,lapses:state.lapses+Number(q<3),dueAt:localDate(due),lastReviewedAt:at.toISOString(),lastQuality:q};
}
export function weightedRatio(samples: OutcomeSample[], at = new Date()): number | undefined {
    if (!samples.length) return undefined;
    let sum = 0, weights = 0;
    for (const s of samples.slice(-20)) {
        const age = Math.max(0,(at.getTime()-Date.parse(s.at))/86400000);
        const weight = Math.pow(0.5,age/30);
        sum += s.scoreRatio*weight; weights += weight;
    }
    return weights ? sum/weights : 0;
}
export function mastery(samples: OutcomeSample[], selfRating?: number, at = new Date()): number {
    const ratio = weightedRatio(samples,at), self = selfRating === undefined ? undefined : selfRating/5;
    return Math.round(100*(ratio === undefined ? self ?? 0 : self === undefined ? ratio : 0.7*ratio+0.3*self));
}
export function risk(samples: OutcomeSample[], state: ReviewState, at = new Date()): number {
    const last = state.lastReviewedAt ?? samples.at(-1)?.at;
    if (!last) return 50;
    const urgency = clamp((at.getTime()-Date.parse(last))/86400000/Math.max(1,state.intervalDays),0,1.5)/1.5;
    return Math.round(100*(0.6*urgency+0.4*(1-(weightedRatio(samples,at)??0.5))));
}
export function updateProgress(paper: Paper, attempt: Attempt, previous: Record<string,KnowledgePointProgress>, knowledge: KnowledgePoint[], history:Attempt[]=[],papers:Paper[]=[]): Record<string,KnowledgePointProgress> {
    if (attempt.status !== 'graded') return previous;
    const result = {...previous};
    for (const kp of knowledge) {
        const items = paper.items.filter(i => i.snapshot.knowledgePointIds.includes(kp.id));
        if (!items.length) continue;
        const old = previous[kp.id], samples = [...old?.recentOutcomes ?? []];
        let qualities = 0, points = 0;
        for (const item of items) {
            const s = attempt.score!.perQuestion.find(s => s.questionId === item.questionId)!;
            const ratio = s.earnedPoints/item.points, record = attempt.answers[item.questionId];
            samples.push({at:attempt.submittedAt!,scoreRatio:ratio,difficulty:item.snapshot.difficulty,timeSpentSeconds:record?.timeSpentSeconds});
            const historical=history.filter(a=>a.id!==attempt.id&&a.status==='graded'&&a.submittedAt!<attempt.submittedAt!).flatMap(a=>Object.values(a.answers).filter(r=>answered(r.answer)&&r.timeSpentSeconds>0).map(r=>({id:r.questionId,seconds:r.timeSpentSeconds,type:papers.find(p=>p.id===a.paperId)?.items.find(i=>i.questionId===r.questionId)?.snapshot.type})));
            const same=historical.filter(r=>r.id===item.questionId),byType=historical.filter(r=>r.type===item.snapshot.type);
            const times=(same.length?same:byType).map(r=>r.seconds).sort((a,b)=>a-b),middle=Math.floor(times.length/2);
            const median=times.length?(times.length%2?times[middle]!:(times[middle-1]!+times[middle]!)/2):120;
            const quality = !answered(record?.answer) ? 0 : ratio === 1 ? ((record?.timeSpentSeconds ?? 0)>median*1.5 ? 4 : 5) : ratio >= 0.6 ? 3 : 2;
            qualities += quality*item.points; points += item.points;
        }
        const recentOutcomes = samples.slice(-20), at = new Date(attempt.submittedAt!);
        result[kp.id] = {knowledgePointId:kp.id,recentOutcomes,mastery:mastery(recentOutcomes,kp.selfRating,at),review:sm2(old?.review??initialReview(at),qualities/points,at),updatedAt:now()};
    }
    return result;
}
