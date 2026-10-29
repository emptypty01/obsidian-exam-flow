import type {Attempt, Paper, UserAnswer, AttemptReport, QuestionScore} from '../types/domain';
import {clone,hash,meta,now,round,canonicalJson} from '../core';
import {gradeQuestion} from './scoring';

export function startAttempt(paper: Paper, existing: Attempt[], at = new Date()): Attempt {
    const active = existing.find(a => a.paperId === paper.id && a.status === 'in_progress');
    if (active) return active;
    return {...meta('attempt'),paperId:paper.id,paperTitle:paper.title,paperMode:paper.mode,paperHash:hash(canonicalJson(paper)),examId:paper.examId,subjectIds:paper.subjectIds,
        status:'in_progress',startedAt:at.toISOString(),deadlineAt:new Date(at.getTime() + paper.durationMinutes * 60000).toISOString(),answers:{},activeQuestionIndex:0};
}
export function saveAnswer(attempt: Attempt, questionId: string, answer: UserAnswer | null, at = new Date(), seconds = 0): Attempt {
    if (attempt.status !== 'in_progress') throw new Error('交卷后答案锁定');
    if (at.getTime() >= Date.parse(attempt.deadlineAt)) return attempt;
    const next = clone(attempt); next.updatedAt = at.toISOString();
    next.answers[questionId] = {...next.answers[questionId],questionId,answer,flagged:next.answers[questionId]?.flagged ?? false,updatedAt:next.updatedAt,timeSpentSeconds:(next.answers[questionId]?.timeSpentSeconds ?? 0) + seconds};
    return next;
}
export function answered(a: UserAnswer | null | undefined): boolean {
    if(a?.subAnswers)return Object.values(a.subAnswers).some(value=>value.trim());
    return !!a && (a.kind === 'true_false' ? typeof a.value === 'boolean' : a.kind === 'single_choice' ? !!a.optionKey : a.kind === 'multiple_choice' ? !!a.optionKeys?.length : a.kind === 'fill_blank' ? !!a.blanks?.some(v => v.trim()) : !!a.text?.trim());
}
export function buildReport(paper: Paper, attempt: Attempt): AttemptReport {
    const score = attempt.score!;
    const aggregate = (dimension: 'knowledgePointIds' | 'chapterIds') => {
        const groups = new Map<string,{knowledgePointId:string;questionCount:number;correctCount:number;earnedPoints:number;totalPoints:number}>();
        for (const item of paper.items) for (const id of item.snapshot[dimension]) {
            const group = groups.get(id) ?? {knowledgePointId:id,questionCount:0,correctCount:0,earnedPoints:0,totalPoints:0};
            const s = score.perQuestion.find(s => s.questionId === item.questionId)!;
            group.questionCount++; group.correctCount += Number(s.correct === true); group.earnedPoints += s.earnedPoints; group.totalPoints += item.points; groups.set(id,group);
        }
        return [...groups.values()];
    };
    const byKnowledgePoint = aggregate('knowledgePointIds');
    const weak = byKnowledgePoint.filter(g => g.earnedPoints / g.totalPoints < 0.6).map(g => g.knowledgePointId);
    const errorReasonCounts: AttemptReport['errorReasonCounts'] = {};
    for (const record of Object.values(attempt.answers)) for (const reason of record.errorReasons ?? []) errorReasonCounts[reason] = (errorReasonCounts[reason] ?? 0) + 1;
    return {score,byKnowledgePoint,byChapter:aggregate('chapterIds'),byType:[...new Set(paper.items.map(i => i.snapshot.type))].map(type => {
        const items = paper.items.filter(i => i.snapshot.type === type), scores = items.map(i => score.perQuestion.find(s => s.questionId === i.questionId)!);
        return {type,questionCount:items.length,correctCount:scores.filter(s => s.correct === true).length,earnedPoints:round(scores.reduce((n,s) => n+s.earnedPoints,0)),totalPoints:round(items.reduce((n,i) => n+i.points,0))};
    }),weakKnowledgePointIds:weak,errorReasonCounts,recommendations:weak.length ? weak.map(id => `复习知识点 ${id} 的关联笔记和错题`) : ['继续完成到期复习'],generatedAt:now()};
}
export function submitAttempt(paper: Paper, attempt: Attempt, at = new Date()): Attempt {
    if (attempt.status !== 'in_progress') return attempt;
    if (attempt.paperHash !== hash(canonicalJson(paper))) throw new Error('试卷快照发生变化，请检查冲突');
    const next = clone(attempt);
    next.status = paper.items.some(i => i.snapshot.answer.kind === 'subjective') ? 'submitted' : 'graded';
    next.submittedAt = at.toISOString(); next.updatedAt = at.toISOString(); next.autoSubmitted = at.getTime() >= Date.parse(next.deadlineAt);
    const perQuestion = paper.items.map((i,index) => gradeQuestion(i.snapshot,next.answers[i.questionId]?.answer ?? null,index));
    next.score = {totalPoints:paper.totalPoints,earnedPoints:round(perQuestion.reduce((n,s) => n+s.earnedPoints,0)),accuracy:perQuestion.filter(s => s.correct === true).length / (perQuestion.length || 1),perQuestion,manualAdjustments:[],gradedAt:at.toISOString()};
    next.report = buildReport(paper,next); return next;
}
export function adjustScore(paper: Paper, attempt: Attempt, questionId: string, points: number, reason: string): Attempt {
    if (!['submitted','graded'].includes(attempt.status) || !attempt.score) throw new Error('请先交卷');
    const item = paper.items.find(i => i.questionId === questionId);
    if (!item || !item.snapshot.scoringRule.manualOverrideAllowed || !Number.isFinite(points) || points < 0 || points > item.points || !reason.trim()) throw new Error('改分须在分值范围内并填写原因');
    const next = clone(attempt), score = next.score!;
    const s = score.perQuestion.find(s => s.questionId === questionId)!;
    score.manualAdjustments.push({...meta('adjustment'),questionId,originalPoints:s.earnedPoints,adjustedPoints:points,reason,adjustedAt:now()});
    s.earnedPoints = points; s.correct = points === s.points ? true : points > 0 ? 'partial' : false; s.manualAdjusted = true; s.detail = reason;
    score.earnedPoints = round(score.perQuestion.reduce((n,s) => n+s.earnedPoints,0)); score.accuracy = score.perQuestion.filter(s => s.correct === true).length / score.perQuestion.length;
    const allConfirmed = paper.items.every(i => i.snapshot.answer.kind !== 'subjective' || score.perQuestion.find(s => s.questionId === i.questionId)?.manualAdjusted);
    next.status = allConfirmed ? 'graded' : 'submitted'; next.updatedAt = now(); next.report = buildReport(paper,next); return next;
}
