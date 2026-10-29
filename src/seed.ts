import type { ExamConfig, Question, KnowledgePoint } from './types/domain';
import { meta } from './core';

const chapters = ['绪论','计算机系统基础知识','信息系统基础知识','信息安全技术基础知识','软件工程基础知识','数据库设计基础知识','系统架构设计基础知识','系统质量属性与架构评估','软件可靠性基础知识','软件架构的演化和维护','未来信息综合技术','信息系统架构设计理论与实践','层次式架构设计理论与实践','云原生架构设计理论与实践','面向服务架构设计理论与实践','嵌入式系统架构设计理论与实践','通信系统架构设计理论与实践','安全架构设计理论与实践','大数据架构设计理论与实践','系统架构设计师论文写作要点','大纲补充：AI 与大模型应用','大纲补充：区块链共识与智能合约','大纲补充：数字孪生与 CPS 架构','大纲补充：边缘计算与云边协同','大纲补充：国产化适配与迁移设计','大纲补充：标准化与知识产权','大纲补充：应用数学与运筹','大纲补充：专业英语与架构术语','大纲补充：系统计划与可行性分析'];
export const seedExam: ExamConfig = {...meta('exam'), id: 'exam_ruankao_senior_architect', name: '软考高级系统架构设计师',
    subjects: [
        {id:'subj_comprehensive',name:'综合知识',questionTypes:['single_choice','multiple_choice','true_false','fill_blank'],defaultDurationMinutes:150,defaultTotalPoints:75,order:1},
        {id:'subj_case',name:'案例分析',questionTypes:['case_analysis'],defaultDurationMinutes:90,defaultTotalPoints:75,order:2},
        {id:'subj_essay',name:'论文',questionTypes:['essay'],defaultDurationMinutes:120,defaultTotalPoints:75,order:3}
    ], chapters: chapters.map((name,i) => ({id:`chap_${String(i + 1).padStart(2,'0')}`,name,order:i+1,subjectId:'subj_comprehensive'})),
    syllabus:chapters.map((name,i)=>({id:`syl_${String(i+1).padStart(2,'0')}`,name,order:i+1,subjectId:'subj_comprehensive'})),
    defaultPaperConfig:{questionCounts:{single_choice:75},durationMinutes:150,excludeRecentPapers:3,allowRepeatWithinPaper:false}};
export const seedKnowledge: KnowledgePoint[] = [{...meta('kp'),id:'kp_architecture',name:'架构与接口',examId:seedExam.id,subjectId:'subj_comprehensive',chapterIds:['chap_01'],syllabusNodeIds:[],importance:5,relatedNotePaths:[],tags:['示例']}];
export function newQuestion(): Question {
    return {...meta('q'),type:'single_choice',stem:'请输入题干',options:[{key:'A',text:'选项 A'},{key:'B',text:'选项 B'}],answer:{kind:'single_choice',optionKey:'A'},
        scoringRule:{points:1,multiSelectPolicy:'all_or_nothing',manualOverrideAllowed:true,fillBlankPolicy:{trim:true,normalizeFullWidth:true,normalizePunctuation:true,caseSensitive:false,perBlankPartial:true}},
        difficulty:2,examId:seedExam.id,subjectId:'subj_comprehensive',chapterIds:['chap_01'],syllabusNodeIds:[],knowledgePointIds:['kp_architecture'],source:{type:'manual',nature:'unknown'},generationMethod:'manual',reviewStatus:'draft',tags:[],version:1};
}
export const sampleQuestions: Question[] = Array.from({length:16},(_,i) => {
    const q = newQuestion(); q.id = `q_sample_${i}`; q.source = {type:'sample',nature:'unknown',title:'ExamFlow 原创示例，非真题'}; q.reviewStatus = 'approved';
    const subjects = ['接口约束','架构元素','质量属性','模块边界'];
    if (i % 4 === 0) { q.stem = `示例 ${i + 1}：${subjects[Math.floor(i/4)]}属于架构设计应考虑的内容吗？`; q.type = 'single_choice'; q.options = [{key:'A',text:'应考虑'},{key:'B',text:'完全无关'}]; }
    if (i % 4 === 1) { q.stem = `示例 ${i + 1}：关于${subjects[Math.floor(i/4)]}，哪些做法合理？`; q.type = 'multiple_choice'; q.options = [{key:'A',text:'明确约束'},{key:'B',text:'记录决策'},{key:'C',text:'忽略质量要求'}]; q.answer = {kind:'multiple_choice',optionKeys:['A','B']}; }
    if (i % 4 === 2) { q.stem = `示例 ${i + 1}：${subjects[Math.floor(i/4)]}需要结合业务目标评估。`; q.type = 'true_false'; q.answer = {kind:'true_false',value:true}; delete q.options; }
    if (i % 4 === 3) { q.stem = `示例 ${i + 1}：应用编程接口简称 {{1}}，统一建模语言简称 {{2}}。`; q.type = 'fill_blank'; q.answer = {kind:'fill_blank',blanks:[{accepted:['API']},{accepted:['UML']}]}; delete q.options; }
    q.explanation = '示例用于练习插件流程，不代表真题难度。'; return q;
});
