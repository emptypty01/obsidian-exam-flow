import type { PaperConfig, PaperGenerationResult, Question, Paper, KnowledgePoint, KnowledgePointProgress } from '../types/domain';
import { clone, meta, random, round } from '../core';

export interface GenerationContext {
    papers?: Paper[];
    wrong?: Record<string, number>;
    knowledge?: KnowledgePoint[];
    progress?: Record<string, KnowledgePointProgress>;
    risk?: Record<string, number>;
    today?: string;
}
export function generatePaper(config: PaperConfig, questions: Question[], context: GenerationContext = {}): PaperGenerationResult {
    const seed = config.seed ?? crypto.getRandomValues(new Uint32Array(1))[0]!;
    const rng = random(seed);
    const result: PaperGenerationResult = {ok:false,shortage:[],warnings:[],seed,usedAiSupplement:false};
    if (!Number.isFinite(config.durationMinutes)||!(config.durationMinutes > 0) || !Object.values(config.questionCounts).some(n => n && n > 0) || Object.values(config.questionCounts).some(n => !Number.isInteger(n) || n! < 0)) throw new Error('时长、题量必须为正；题量为整数');
    if(Object.values(config.difficultyCounts??{}).some(n=>!Number.isInteger(n)||n!<0)||!Number.isInteger(config.excludeRecentPapers)||config.excludeRecentPapers<0)throw new Error('难度配额与最近试卷数必须为非负整数');
    if (config.mode === 'chapter_drill' && !config.chapterIds?.length) throw new Error('章节练习必须选择章节');
    if (config.mode === 'real_exam_mock' && !config.examYears?.length) throw new Error('真题模拟必须选择年份');
    const overlaps = (filter: string[] | undefined, values: string[]) => !filter?.length || filter.some(id => values.includes(id));
    const recent = (context.papers ?? []).filter(p => p.examId === config.examId && overlaps(config.subjectIds,p.subjectIds)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,Math.max(0,config.excludeRecentPapers));
    const excluded = new Set(recent.flatMap(p => p.items.map(i => i.questionId)));
    const pool = questions.filter(q => q.examId === config.examId && config.subjectIds.includes(q.subjectId)
        && (config.reviewStatuses ?? ['approved']).includes(q.reviewStatus) && !q.duplicateOf && !excluded.has(q.id)
        && overlaps(config.chapterIds,q.chapterIds) && overlaps(config.syllabusNodeIds,q.syllabusNodeIds) && overlaps(config.knowledgePointIds,q.knowledgePointIds)
        && (!config.sourceTypes?.length || config.sourceTypes.includes(q.source.type))
        && (!config.sourceNatures?.length || config.sourceNatures.includes(q.source.nature))
        && (!config.examYears?.length || config.examYears.includes(q.source.examYear ?? -1))
        && (config.mode !== 'real_exam_mock' || q.source.type === 'real_exam')
        && (config.mode !== 'wrong_question_drill' || (context.wrong?.[q.id] ?? 0) > 0)
        && (config.mode !== 'important_kp_drill' || q.knowledgePointIds.some(id => (context.knowledge ?? []).some(k => k.id === id && k.importance >= 4)))
        && (config.mode !== 'forgotten_kp_review' || q.knowledgePointIds.some(id => (context.risk?.[id] ?? 0) >= 60 || (context.progress?.[id]?.review.dueAt ?? context.today ?? '0000') <= (context.today ?? '0000'))));
    const weight = (q: Question) => {
        if (config.mode === 'wrong_question_drill') return 1 + (context.wrong?.[q.id] ?? 0);
        if (config.mode === 'forgotten_kp_review') return 1 + Math.max(0,...q.knowledgePointIds.map(k => context.risk?.[k] ?? 50));
        if (config.mode === 'important_kp_drill') return Math.max(1,...q.knowledgePointIds.map(k => context.knowledge?.find(p => p.id === k)?.importance ?? 1));
        if (config.mode !== 'adaptive') return 1;
        return Math.max(1,...q.knowledgePointIds.map(k => 0.35 * (context.risk?.[k] ?? 50) + 0.3 * (100 - (context.progress?.[k]?.mastery ?? 0)) + 4 * (context.knowledge?.find(p => p.id === k)?.importance ?? 3) + 15 * Math.min(1,context.wrong?.[q.id] ?? 0)));
    };
    const ranked = pool.map(q => ({q,key:-Math.log(Math.max(Number.EPSILON,rng())) / weight(q)})).sort((a,b) => a.key - b.key).map(v => v.q);
    const selected: Question[] = [];
    const typeRemaining = {...config.questionCounts};
    const difficulties = config.difficultyCounts;
    // Bipartite capacity matching satisfies type and difficulty quotas together.
    if (difficulties && Object.values(difficulties).reduce((n,v) => n + (v ?? 0),0) !== Object.values(typeRemaining).reduce((n,v) => n + (v ?? 0),0)) throw new Error('难度配额之和必须等于题量');
    if (difficulties) {
        const slots = Object.entries(difficulties).flatMap(([d,n]) => Array.from({length:n ?? 0},() => Number(d)));
        const assignments = new Map<Question,number>();
        const place = (slot: number, visited: Set<Question>): boolean => {
            for (const q of ranked) {
                if (q.difficulty !== slots[slot] || visited.has(q) || !(config.questionCounts[q.type] ?? 0)) continue;
                visited.add(q);
                const previous = assignments.get(q);
                if (previous !== undefined) { if (place(previous,visited)) { assignments.set(q,slot); return true; } }
                else {
                    const count = [...assignments.keys()].filter(x => x.type === q.type).length;
                    if (count < (config.questionCounts[q.type] ?? 0)) { assignments.set(q,slot); return true; }
                    for (const [other,oldSlot] of assignments) {
                        if (other.type !== q.type || visited.has(other)) continue;
                        assignments.delete(other); assignments.set(q,slot);
                        if (place(oldSlot,visited)) return true;
                        assignments.delete(q); assignments.set(other,oldSlot);
                    }
                }
            }
            return false;
        };
        for (let i=0;i<slots.length;i++) if (!place(i,new Set())) result.shortage.push({dimension:'difficulty',key:String(slots[i]),requested:1,available:0,message:`难度 ${slots[i]} 的组合配额不足`});
        selected.push(...assignments.keys());
    } else {
        for (const [type,count] of Object.entries(typeRemaining)) {
            const candidates = ranked.filter(q => q.type === type);
            if (candidates.length < count!) result.shortage.push({dimension:'question_type',key:type,requested:count!,available:candidates.length,message:`${type} 需要 ${count}，可用 ${candidates.length}；请调整数量或范围`});
            selected.push(...candidates.slice(0,count));
        }
    }
    const totalPoints = round(selected.reduce((n,q) => n + q.scoringRule.points,0));
    if (config.totalPointsTarget !== undefined && Math.abs(totalPoints - config.totalPointsTarget) > 0.001) result.shortage.push({dimension:'total_points',key:'total',requested:config.totalPointsTarget,available:totalPoints,message:'总分不匹配，请调整题量或分值'});
    if (result.shortage.length) return result;
    result.ok = true;
    result.paper = {...meta('paper'),title:`练习 ${new Date().toLocaleString()}`,examId:config.examId,subjectIds:[...config.subjectIds],mode:config.mode,config:clone(config),seed,
        items:selected.map((q,index) => ({index,questionId:q.id,questionVersion:q.version,snapshot:clone(q),points:q.scoringRule.points})),totalPoints,durationMinutes:config.durationMinutes,generationMethod:'rule'};
    return result;
}
