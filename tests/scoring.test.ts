import { expect, test } from 'vitest';
import { gradeQuestion } from '../src/domain/scoring';
import { sampleQuestions } from '../src/seed';

test('多选漏选零分，填空逐空归一化独立计分', () => {
  const multi = sampleQuestions.find(q => q.type === 'multiple_choice')!;
  expect(gradeQuestion(multi, {kind: 'multiple_choice', optionKeys: ['A']}).earnedPoints).toBe(0);
  const fill = sampleQuestions.find(q => q.type === 'fill_blank')!;
  expect(gradeQuestion(fill, {kind: 'fill_blank', blanks: [' ＡＰＩ ', '错误']}).earnedPoints).toBe(0.5);
});
