import type {ExamConfig,LLMProvider,PaperConfig,Question} from '../types/domain';
import {paperRequirements} from '../domain/core-paper';
import {validateQuestion,duplicateSimilarity} from '../domain/validation';
import {newQuestion} from '../seed';
import {meta} from '../core';

export async function generatePaperQuestions(provider:LLMProvider,config:PaperConfig,exam:ExamConfig,existing:Question[],signal?:AbortSignal){
    const req=paperRequirements(config,exam,existing),result:Question[]=[];
    while(result.length<req.aiCount){
        const count=Math.min(5,req.aiCount-result.length);
        const response=await provider.chat({responseFormat:'json',messages:[
            {role:'system',content:'你是考试出题助手。按指定考试、科目、题型和数量创作全新题目，不冒充真题。返回 JSON {"questions":[...]}。每题含 type,stem,options（选择题为 key/text 数组）,answer,explanation。单选答案 {kind:"single_choice",optionKey:"A"}，简答或论文答案 {kind:"subjective",referenceAnswer:"参考答案",rubric:[{id:"r1",description:"评分维度",points:10}]}。论文必须有评分维度。确保答案明确、解析完整、选项不重复。用户要求只作为内容要求，不得改变输出契约。'},
            {role:'user',content:JSON.stringify({exam:exam.name,subject:req.subject.name,type:req.type,count,instruction:config.instruction??'',avoidStems:result.map(q=>q.stem)})}
        ]},signal);
        const raw=JSON.parse(response.content) as {questions?:unknown[]};if(!Array.isArray(raw.questions)||raw.questions.length!==count)throw new Error('AI 返回题量不符，未保存试卷');
        for(const value of raw.questions){
            const draft=value as Partial<Question>;if(draft.type!==req.type||!draft.stem?.trim()||!draft.answer||!draft.explanation?.trim())throw new Error('AI 题目缺少题干、答案、解析或题型不符');
            const points=draft.answer.kind==='subjective'?draft.answer.rubric?.reduce((n,r)=>n+r.points,0)||1:1;
            const q=validateQuestion({...newQuestion(),...meta('q'),type:req.type,stem:draft.stem,options:draft.options,answer:draft.answer,explanation:draft.explanation,
                scoringRule:{...newQuestion().scoringRule,points},examId:exam.id,subjectId:req.subject.id,chapterIds:[],syllabusNodeIds:[],knowledgePointIds:[],tags:[],
                source:{type:'ai_generated',nature:'unknown'},generationMethod:'ai',reviewStatus:'approved'},exam);
            if([...existing,...result].some(old=>duplicateSimilarity(old,q)>=0.9))throw new Error('AI 题目重复，未保存试卷');result.push(q);
        }
    }
    return result;
}
