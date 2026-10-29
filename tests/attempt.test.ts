import {expect,test} from 'vitest';
import {startAttempt,saveAnswer,submitAttempt,adjustScore} from '../src/domain/attempt';
import {generatePaper} from '../src/domain/generator';
import {sampleQuestions,newQuestion} from '../src/seed';
test('超时自动交卷且锁定答案，重复交卷保持原结果', () => {
    const p = generatePaper({examId:sampleQuestions[0]!.examId,subjectIds:['subj_comprehensive'],mode:'syllabus_mock',questionCounts:{true_false:1},durationMinutes:1,excludeRecentPapers:0,allowRepeatWithinPaper:false},sampleQuestions).paper!;
    const a = startAttempt(p,[],new Date('2026-10-29T01:00:00Z'));
    const b = saveAnswer(a,p.items[0]!.questionId,{kind:'true_false',value:true},new Date('2026-10-29T01:01:01Z'));
    expect(b.answers).toEqual({});
    const submitted = submitAttempt(p,b,new Date('2026-10-29T01:01:01Z'));
    expect(submitted.autoSubmitted).toBe(true); expect(submitted.score!.earnedPoints).toBe(0);
    expect(submitAttempt(p,submitted)).toEqual(submitted);
    expect(() => saveAnswer(submitted,p.items[0]!.questionId,{kind:'true_false',value:true})).toThrow();
});
test('主观题交卷后待人工确认，改分保留轨迹并拒绝越界',()=>{
    const q=newQuestion();q.type='case_analysis';q.reviewStatus='approved';q.answer={kind:'subjective',referenceAnswer:'参考解法',rubric:[{id:'rubric_1',description:'说明架构约束',points:1}]};
    const p=generatePaper({examId:q.examId,subjectIds:[q.subjectId],mode:'syllabus_mock',questionCounts:{case_analysis:1},durationMinutes:10,excludeRecentPapers:0,allowRepeatWithinPaper:false},[q]).paper!;
    const a=submitAttempt(p,startAttempt(p,[]));expect(a.status).toBe('submitted');
    expect(()=>adjustScore(p,a,q.id,2,'超分')).toThrow();
    const result=adjustScore(p,a,q.id,0.5,'人工核对');expect(result.status).toBe('graded');expect(result.score!.manualAdjustments).toHaveLength(1);expect(result.score!.earnedPoints).toBe(0.5);expect(a.score!.earnedPoints).toBe(0);
});
