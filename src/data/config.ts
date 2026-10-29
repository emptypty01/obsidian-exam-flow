import {z} from 'zod';
import type {ExamConfig} from '../types/domain';
const subject=z.object({id:z.string().regex(/^subj_[\w-]+$/),name:z.string().min(1),questionTypes:z.array(z.enum(['single_choice','multiple_choice','true_false','fill_blank','short_answer','case_analysis','essay'])).min(1),defaultDurationMinutes:z.number().positive(),defaultTotalPoints:z.number().positive(),order:z.number()});
export const examSchema=z.object({id:z.string().regex(/^exam_[\w-]+$/),schemaVersion:z.literal(1),createdAt:z.string(),updatedAt:z.string(),name:z.string().min(1),description:z.string().optional(),subjects:z.array(subject).min(1),chapters:z.array(z.object({id:z.string().regex(/^chap_[\w-]+$/),name:z.string().min(1),subjectId:z.string(),order:z.number(),parentId:z.string().optional(),sourceNotePath:z.string().optional()})),syllabus:z.array(z.object({id:z.string().min(1),name:z.string().min(1),subjectId:z.string(),order:z.number(),parentId:z.string().optional(),description:z.string().optional()}))}).passthrough();
export function validateExam(raw:unknown):ExamConfig{
    const exam=examSchema.parse(raw) as ExamConfig;
    const ids=[...exam.subjects,...exam.chapters,...exam.syllabus].map(e=>e.id);
    if(new Set(ids).size!==ids.length)throw new Error('考试配置包含重复 ID');
    if([...exam.chapters,...exam.syllabus].some(n=>!exam.subjects.some(s=>s.id===n.subjectId)))throw new Error('章节或考纲科目不存在');
    return exam;
}
