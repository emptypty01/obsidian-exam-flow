import { z } from 'zod';
import type { ExamConfig, Question } from '../types/domain';

const strings = z.array(z.string());
const rubric = z.object({id: z.string(), description: z.string().min(1), points: z.number().positive(), requiredPoints: strings.optional()});
const answer = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('single_choice'), optionKey: z.string()}),
    z.object({kind: z.literal('multiple_choice'), optionKeys: strings.min(1)}),
    z.object({kind: z.literal('true_false'), value: z.boolean()}),
    z.object({kind: z.literal('fill_blank'), blanks: z.array(z.object({accepted: z.array(z.string().trim().min(1)).min(1)})).min(1)}),
    z.object({kind: z.literal('subjective'), referenceAnswer: z.string().trim().min(1), rubric: z.array(rubric)})
]);
export const questionSchema = z.object({
    id: z.string().regex(/^q_[\w-]+$/), schemaVersion: z.literal(1), createdAt: z.iso.datetime({offset: true}), updatedAt: z.iso.datetime({offset: true}),
    type: z.enum(['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'case_analysis', 'essay']),
    stem: z.string().trim().min(1), options: z.array(z.object({key: z.string().min(1), text: z.string().min(1)})).optional(), answer,
    explanation: z.string().optional(), scoringRule: z.object({points: z.number().positive(), multiSelectPolicy: z.enum(['all_or_nothing', 'partial']),
        fillBlankPolicy: z.object({trim: z.boolean(), normalizeFullWidth: z.boolean(), normalizePunctuation: z.boolean(), caseSensitive: z.boolean(), perBlankPartial: z.boolean()}), manualOverrideAllowed: z.boolean()}),
    difficulty: z.number().int().min(1).max(5), examId: z.string().min(1), subjectId: z.string().min(1),
    chapterIds: strings, syllabusNodeIds: strings, knowledgePointIds: strings,
    source: z.object({type: z.enum(['real_exam','manual','sample','ai_generated','wrong_derived','knowledge_point_drill']), nature: z.enum(['official','institution','recall','community','unknown']),
        title: z.string().optional(), examYear: z.number().int().optional(), examSession: z.string().optional(), paperName: z.string().optional(), questionNo: z.string().optional(), page: z.number().int().positive().optional(), url: z.string().optional(), notePath: z.string().optional(), note: z.string().optional()}),
    generationMethod: z.enum(['manual','rule','ai','import','derived']), reviewStatus: z.enum(['draft','pending_review','approved','rejected']), tags: strings, version: z.number().int().positive(), duplicateOf: z.string().optional(), extra: z.record(z.string(), z.unknown()).optional()
}).superRefine((q, ctx) => {
    const fail = (message: string) => ctx.addIssue({code: 'custom', message});
    const a = q.answer;
    if (['single_choice','multiple_choice'].includes(q.type)) {
        const keys = q.options?.map(o => o.key) ?? [];
        if (keys.length < 2 || new Set(keys).size !== keys.length) fail('选项至少两个且 key 唯一');
        if (a.kind !== q.type) fail('答案类型不匹配');
        if (a.kind === 'single_choice' && !keys.includes(a.optionKey)) fail('答案不在选项中');
        if (a.kind === 'multiple_choice' && (new Set(a.optionKeys).size !== a.optionKeys.length || a.optionKeys.some(k => !keys.includes(k)))) fail('多选答案重复或不存在');
    } else if (q.type === 'true_false' && a.kind !== 'true_false') fail('判断题答案类型错误');
    else if (q.type === 'fill_blank') {
        const blanks = [...q.stem.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
        if (a.kind !== 'fill_blank' || blanks.length !== a.blanks.length || blanks.some((n, i) => n !== i + 1)) fail('填空标记应连续且与答案数量一致');
    } else if (['short_answer','case_analysis','essay'].includes(q.type)) {
        if (a.kind !== 'subjective') fail('主观题需要参考答案');
        else if (q.type !== 'short_answer' && (!a.rubric.length || Math.abs(a.rubric.reduce((n,r) => n + r.points, 0) - q.scoringRule.points) > 0.001)) fail('评分维度分值不等于总分');
    }
    if (q.source.type === 'sample' && q.source.examYear) fail('示例题不得带真实考试年份');
    if (q.generationMethod === 'ai' && !['ai_generated','wrong_derived'].includes(q.source.type)) fail('AI 题不得冒充真题');
});
export function validateQuestion(value: unknown, exam?: ExamConfig, knowledgeIds?: string[]): Question {
    const q = questionSchema.parse(value) as Question;
    if (exam && (q.examId !== exam.id || !exam.subjects.some(s => s.id === q.subjectId) || q.chapterIds.some(c => !exam.chapters.some(n => n.id === c)) || q.syllabusNodeIds.some(c => !exam.syllabus.some(n => n.id === c)))) throw new Error('考试、科目、章节或考纲引用不存在');
    if (knowledgeIds && q.knowledgePointIds.some(k => !knowledgeIds.includes(k))) throw new Error('知识点引用不存在');
    return q;
}
export const normalizeStem=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export async function questionFingerprint(q:Question):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizeStem(q.stem)))),b=>b.toString(16).padStart(2,'0')).join('');}
export function duplicateSimilarity(a: Question, b: Question): number {
    const x = normalizeStem(a.stem), y = normalizeStem(b.stem);
    if (x === y) return 1;
    const grams = (s: string) => new Set(Array.from({length: Math.max(0, s.length - 2)}, (_, i) => s.slice(i, i + 3)));
    const p = grams(x), q = grams(y);
    const intersection=[...p].filter(t => q.has(t)).length;
    const stemScore=intersection / (p.size + q.size - intersection || 1);
    const optionsA=new Set((a.options??[]).map(o=>normalizeStem(o.text))),optionsB=new Set((b.options??[]).map(o=>normalizeStem(o.text)));
    const common=[...optionsA].filter(o=>optionsB.has(o)).length;
    return Math.max(stemScore,optionsA.size>=2&&optionsB.size>=2?0.99*common/(optionsA.size+optionsB.size-common):0);
}
