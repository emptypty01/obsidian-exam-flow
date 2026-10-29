import {expect,test} from 'vitest';
import {sm2,initialReview,mastery,risk} from '../src/domain/review';
test('SM-2 正常间隔 1/6 天，失败重置，未知风险为 50', () => {
    const at = new Date('2026-10-29T01:00:00Z');
    const first = sm2(initialReview(at),5,at); expect(first.intervalDays).toBe(1);
    const second = sm2(first,5,at); expect(second.intervalDays).toBe(6);
    expect(sm2(second,2,at)).toMatchObject({intervalDays:1,repetitions:0,lapses:1});
    expect(mastery([],undefined,at)).toBe(0); expect(risk([],initialReview(at),at)).toBe(50);
    expect(mastery([{at:at.toISOString(),scoreRatio:1,difficulty:3}],1,at)).toBe(76);
});
