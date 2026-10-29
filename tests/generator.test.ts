import {expect, test} from 'vitest';
import {generatePaper} from '../src/domain/generator';
import {sampleQuestions} from '../src/seed';
import type {PaperConfig} from '../src/types/domain';
import {seedKnowledge} from '../src/seed';
const config: PaperConfig = {examId:sampleQuestions[0]!.examId,subjectIds:['subj_comprehensive'],mode:'syllabus_mock',questionCounts:{single_choice:2},durationMinutes:10,excludeRecentPapers:0,allowRepeatWithinPaper:false,seed:42};
test('缺口不生成试卷，相同 seed 题目顺序一致，题库修改不改变快照', () => {
    expect(generatePaper({...config,questionCounts:{single_choice:8}},sampleQuestions).ok).toBe(false);
    const a = generatePaper(config,sampleQuestions).paper!;
    expect(a.items.map(i => i.questionId)).toEqual(generatePaper(config,sampleQuestions).paper!.items.map(i => i.questionId));
    const old = a.items[0]!.snapshot.stem;
    const original = sampleQuestions.find(q => q.id === a.items[0]!.questionId)!;
    original.stem = '已编辑'; expect(a.items[0]!.snapshot.stem).toBe(old); original.stem = old;
});
test('首次知识点尚无答题记录，也可生成今日到期复习卷',()=>{
    expect(generatePaper({...config,mode:'forgotten_kp_review'},sampleQuestions,{today:'2026-10-29'}).ok).toBe(true);
});
test('七模式约束、近期排除与联合难度配额',()=>{
    const pool=sampleQuestions.map((q,i)=>({...structuredClone(q),difficulty:(i<8?1:2) as 1|2,source:{...q.source,type:'real_exam' as const,examYear:2025}}));
    const context={today:'2026-10-29',wrong:Object.fromEntries(pool.map(q=>[q.id,2])),knowledge:seedKnowledge,risk:{kp_architecture:80}};
    for(const mode of ['syllabus_mock','chapter_drill','real_exam_mock','wrong_question_drill','forgotten_kp_review','important_kp_drill','adaptive'] as const){
        const generated=generatePaper({...config,mode,chapterIds:['chap_01'],examYears:[2025]},pool,context);expect(generated.ok,mode).toBe(true);
    }
    const mixed=generatePaper({...config,questionCounts:{single_choice:2,multiple_choice:2},difficultyCounts:{1:2,2:2}},pool);
    expect(mixed.ok).toBe(true);expect(mixed.paper!.items.filter(i=>i.snapshot.difficulty===1)).toHaveLength(2);
    const first=generatePaper(config,pool).paper!;
    const next=generatePaper({...config,excludeRecentPapers:1},pool,{papers:[first]}).paper!;
    expect(next.items.some(i=>first.items.some(j=>j.questionId===i.questionId))).toBe(false);
});
