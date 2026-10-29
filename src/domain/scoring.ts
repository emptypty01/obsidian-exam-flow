import type { Question, UserAnswer, QuestionScore } from '../types/domain';
import { round } from '../core';

export function gradeQuestion(q: Question, user: UserAnswer | null, index = 0): QuestionScore {
    const max = q.scoringRule.points, a = q.answer;
    let ratio = 0;
    if (user?.kind === a.kind) {
        if (a.kind === 'single_choice') ratio = Number(user.optionKey === a.optionKey);
        if (a.kind === 'true_false') ratio = Number(user.value === a.value);
        if (a.kind === 'multiple_choice') {
            const selected = new Set(user.optionKeys ?? []);
            ratio = Number(selected.size === a.optionKeys.length && a.optionKeys.every(k => selected.has(k)));
        }
        if (a.kind === 'fill_blank') {
            const p = q.scoringRule.fillBlankPolicy;
            const normalize = (s: string) => {
                if (p.normalizeFullWidth) s = s.normalize('NFKC');
                if (p.trim) s = s.trim();
                if (!p.caseSensitive) s = s.toLowerCase();
                if (p.normalizePunctuation) s = s.replace(/[，。；：！？“”‘’]/g, c => ({'，':',','。':'.','；':';','：':':','！':'!','？':'?','“':'"','”':'"','‘':"'",'’':"'"}[c] ?? c));
                if (p.normalizePunctuation) s = s.replace(/[.!?;]+$/g,'');
                return s.replace(/\s+/g,' ');
            };
            const correct = a.blanks.filter((blank, i) => blank.accepted.some(v => normalize(v) === normalize(user.blanks?.[i] ?? ''))).length;
            ratio = p.perBlankPartial ? correct / a.blanks.length : Number(correct === a.blanks.length);
        }
    }
    return {questionId: q.id, index, points: max, earnedPoints: round(max * ratio), correct: ratio === 1 ? true : ratio > 0 ? 'partial' : false,
        detail: a.kind === 'subjective' ? '等待人工或 AI 辅助评分确认' : ratio === 1 ? '正确' : ratio > 0 ? '部分正确' : '错误或未作答'};
}
