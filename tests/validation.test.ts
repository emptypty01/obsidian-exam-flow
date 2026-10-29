import {expect,test} from 'vitest';
import {newQuestion} from '../src/seed';
import {validateQuestion,questionFingerprint} from '../src/domain/validation';
import {parseSettings,defaults} from '../src/settings';
import {exportBundle} from '../src/data/backup';
import {Repository} from '../src/data/repository';
import {Storage} from '../src/data/storage';
import {memoryAdapter} from './fixtures/memory';
test('拒绝不存在选项、填空缺失及伪装真题的 AI 数据',()=>{
    const q=newQuestion();expect(()=>validateQuestion({...q,answer:{kind:'single_choice',optionKey:'Z'}})).toThrow();
    expect(()=>validateQuestion({...q,type:'fill_blank',answer:{kind:'fill_blank',blanks:[{accepted:['x']}]}})).toThrow();
    expect(()=>validateQuestion({...q,generationMethod:'ai',source:{type:'real_exam',nature:'official'}})).toThrow();
});
test('归一化题干 SHA-256 相同；设置与备份白名单剔除额外密钥字段',async()=>{
    const q=newQuestion();expect(await questionFingerprint({...q,stem:' API！ '})).toBe(await questionFingerprint({...q,stem:'ａｐｉ'}));
    const settings=parseSettings({...defaults,apiKey:'secret',llm:{...defaults.llm,apiKey:'secret'}});
    expect(JSON.stringify(settings)).not.toContain('secret');
    const repo=new Repository(new Storage(memoryAdapter(),'one'),'ExamFlow');await repo.load();
    const bundle=exportBundle(repo,settings);expect(bundle.settings?.review.dailyQuestionLimit).toBe(20);expect(JSON.stringify(bundle)).not.toContain('secret');
});
