import {expect,test} from 'vitest';
import {statistics} from '../src/domain/stats';
import {sampleQuestions,seedKnowledge} from '../src/seed';
import {generatePaper} from '../src/domain/generator';
import {startAttempt,saveAnswer,submitAttempt} from '../src/domain/attempt';
test('统计只计算已评分答卷，未答题不计完成量',()=>{
    const p=generatePaper({examId:sampleQuestions[0]!.examId,subjectIds:['subj_comprehensive'],mode:'syllabus_mock',questionCounts:{true_false:2},durationMinutes:10,excludeRecentPapers:0,allowRepeatWithinPaper:false},sampleQuestions).paper!;
    const start=new Date('2026-10-29T01:00:00Z');
    const a=submitAttempt(p,saveAnswer(startAttempt(p,[],start),p.items[0]!.questionId,{kind:'true_false',value:true},start),start);
    const stats=statistics([a,startAttempt(p,[],start)],[p],seedKnowledge,{});
    expect(stats.trend[0]!.ratio).toBe(0.5);expect(stats.subjects['subj_comprehensive']).toEqual({earned:1,total:2,correct:1,count:2});
    expect(Object.values(stats.completed)).toEqual([1]);
});
