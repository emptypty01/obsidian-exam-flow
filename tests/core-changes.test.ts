import {expect,test} from 'vitest';
import {Repository} from '../src/data/repository';
import {Storage} from '../src/data/storage';
import {memoryAdapter} from './fixtures/memory';
import {newQuestion,seedExam} from '../src/seed';
import {clone,meta} from '../src/core';
import {buildCorePaper} from '../src/domain/core-paper';
import {ExamService} from '../src/services';
import {generatePaperQuestions} from '../src/ai/paper-questions';
import type {Question,PaperConfig,LLMProvider,ChatRequest} from '../src/types/domain';

const real=(no:number,session='上'):Question=>({...newQuestion(),id:`q_split_${no}`,stem:`真题 ${no} 的独立题干`,knowledgePointIds:[],chapterIds:[],tags:['回忆版'],reviewStatus:'approved',source:{type:'real_exam',nature:'recall',examYear:2026,examSession:session,questionNo:String(no),page:no},generationMethod:'import',extra:{audit:'原始解析审计不可丢失，应存入迁移备份'}});
async function legacy(){
    const adapter=memoryAdapter(),questions=[real(1),real(2,'下')],bank={...meta('bank'),name:'综合知识',examId:seedExam.id,subjectId:'subj_comprehensive',questions};
    await adapter.write('ExamFlow/config/exams.json',JSON.stringify({schemaVersion:1,exams:[seedExam]}));await adapter.write('ExamFlow/banks/subj_comprehensive.json',JSON.stringify(bank));
    const repo=new Repository(new Storage(adapter,'one'),'ExamFlow');await repo.load();return {adapter,repo,bank};
}
test('分片迁移按上下半年科目命名，精简字段且保留答案来源和审计备份',async()=>{
    const {adapter,repo,bank}=await legacy();await repo.migrateBanks();
    const listing=await adapter.list('ExamFlow/banks');expect(listing.files.map(f=>f.split('/').at(-1)).sort()).toEqual(['2026上-综合知识.json','2026下-综合知识.json','index.json']);
    const raw=JSON.parse(await adapter.read('ExamFlow/banks/2026上-综合知识.json'));
    expect(raw.questions[0].answer).toBe('A');expect(raw.questions[0].createdAt).toBeUndefined();expect(raw.questions[0].extra).toBeUndefined();expect(raw.questions[0].scoringRule).toBeUndefined();expect(raw.questions[0].examId).toBeUndefined();
    const backups=(await adapter.list('ExamFlow/_backup/banks')).folders;expect(backups.length).toBeGreaterThan(0);
    const backup=JSON.parse(await adapter.read(`${backups[0]}/original.json`));expect(backup.banks[0].questions[0].extra.audit).toContain('审计');
    const loaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await loaded.load();
    expect(loaded.questions.map(q=>q.id)).toEqual(bank.questions.map(q=>q.id));expect(loaded.questions[1]!.source.examSession).toBe('下');expect(loaded.questions[0]!.answer).toEqual(bank.questions[0]!.answer);
    expect((await loaded.importQuestions(raw)).skipped).toBe(1);
});
test('分片跨批次编辑和删除不会重复、丢题或遗留空分片',async()=>{
    const {adapter,repo}=await legacy();await repo.migrateBanks();
    await repo.saveQuestion({...repo.questions[0]!,source:{...repo.questions[0]!.source,examSession:'下'}});
    const loaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await loaded.load();expect(loaded.questions).toHaveLength(2);
    expect(await adapter.exists('ExamFlow/banks/2026上-综合知识.json')).toBe(false);
    await loaded.removeQuestion('q_split_1');const again=new Repository(new Storage(adapter,'three'),'ExamFlow');await again.load();expect(again.questions.map(q=>q.id)).toEqual(['q_split_2']);
});
test('分片精简保留 AI 补答标记，公共补充字段只存文件层',async()=>{
    const {adapter,repo}=await legacy();
    await repo.saveBank({...repo.banks[0]!,questions:repo.questions.map(q=>({...q,extra:{examflowImport:{answerOrigin:'ai',supplementedFields:['answer','explanation'],model:'完整审计留备份'}}}))});
    const raw=JSON.parse(await adapter.read('ExamFlow/banks/2026上-综合知识.json'));expect(raw.ai).toEqual(['answer','explanation']);expect(raw.questions[0].extra).toBeUndefined();
    const loaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await loaded.load();expect(loaded.questions[0]!.extra?.examflowImport).toEqual({answerOrigin:'ai',supplementedFields:['answer','explanation']});
});
test('分片写入失败回滚且旧格式仍可重载',async()=>{
    const {adapter,repo}=await legacy(),write=adapter.rename;
    adapter.rename=async(a,b)=>{if(b.endsWith('2026下-综合知识.json'))throw new Error('模拟磁盘失败');await write(a,b);};
    await expect(repo.migrateBanks()).rejects.toThrow();expect(await adapter.exists('ExamFlow/banks/subj_comprehensive.json')).toBe(true);
    const loaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await loaded.load();expect(loaded.questions).toHaveLength(2);expect(loaded.questions[0]!.extra).toBeDefined();
});
test('分片原位更新失败时以独立提交标识回滚，不把旧索引误认成已提交',async()=>{
    const {adapter,repo}=await legacy();await repo.migrateBanks();const process=adapter.process!;
    adapter.process=async(file,change)=>{if(file.endsWith('2026下-综合知识.json'))throw new Error('持续写入失败');return process(file,change);};
    await expect(repo.saveBank({...repo.banks[0]!,questions:repo.questions.map(q=>({...q,stem:q.stem+'修改'}))})).rejects.toThrow();
    const loaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await loaded.load();expect(loaded.questions.map(q=>q.stem)).toEqual([real(1).stem,real(2,'下').stem]);
});
const config:PaperConfig={examId:seedExam.id,subjectIds:['subj_comprehensive'],mode:'real',questionCounts:{single_choice:1},durationMinutes:30,excludeRecentPapers:0,allowRepeatWithinPaper:false,seed:42};
test('三种组卷来源数量严格隔离，批次筛选且试卷快照独立',()=>{
    const pool=[real(1),real(2,'下')],ai={...real(3),source:{type:'ai_generated' as const,nature:'unknown' as const},generationMethod:'ai' as const};
    const paper=buildCorePaper({...config,examSessions:['下']},seedExam,pool);expect(paper.items[0]!.questionId).toBe('q_split_2');
    expect(buildCorePaper({...config,mode:'ai'},seedExam,pool,[ai]).items.every(i=>i.snapshot.source.type==='ai_generated')).toBe(true);
    const mixed=buildCorePaper({...config,mode:'mixed',questionCounts:{single_choice:2},aiQuestionCount:1},seedExam,pool,[ai]);
    expect(mixed.items.filter(i=>i.snapshot.source.type==='real_exam')).toHaveLength(1);expect(mixed.items.filter(i=>i.snapshot.source.type==='ai_generated')).toHaveLength(1);
    pool[1]!.stem='后来编辑';expect(paper.items[0]!.snapshot.stem).not.toBe('后来编辑');
    expect(()=>buildCorePaper({...config,questionCounts:{single_choice:3}},seedExam,pool)).toThrow('真题需要');
    expect(()=>buildCorePaper({...config,mode:'mixed',aiQuestionCount:1},seedExam,pool,[ai])).toThrow('同时包含');
});
test('科目确定题型，旧案例题可作为简答题，论文独立生成',()=>{
    const original={...real(1),subjectId:'subj_case',type:'case_analysis' as const,options:undefined,answer:{kind:'subjective' as const,referenceAnswer:'参考答案',rubric:[{id:'r1',description:'要点',points:1}]}};
    const paper=buildCorePaper({...config,subjectIds:['subj_case'],questionCounts:{short_answer:1}},seedExam,[original]);expect(paper.items[0]!.snapshot.type).toBe('short_answer');expect(original.type).toBe('case_analysis');
    const essay={...original,id:'q_essay',subjectId:'subj_essay',type:'essay' as const};expect(buildCorePaper({...config,subjectIds:['subj_essay'],questionCounts:{essay:1}},seedExam,[essay]).items[0]!.snapshot.type).toBe('essay');
});
test('AI 题逐批校验，格式错误不返回半份试卷',async()=>{
    const response={questions:[{type:'single_choice',stem:'AI 编写的新题：哪个选项表示顺序执行？',options:[{key:'A',text:'依次执行指令'},{key:'B',text:'忽略全部指令'}],answer:{kind:'single_choice',optionKey:'A'},explanation:'A 明确表达顺序执行。'}]};
    const requests:ChatRequest[]=[],provider={chat:async(request:ChatRequest)=>{requests.push(request);return {content:JSON.stringify(response)};}} as unknown as LLMProvider;
    const original=real(1),result=await generatePaperQuestions(provider,{...config,mode:'ai'},seedExam,[original]);expect(result[0]!.source.type).toBe('ai_generated');
    expect(JSON.stringify(requests)).not.toContain(original.stem);
    response.questions[0]!.answer.optionKey='Z';await expect(generatePaperQuestions(provider,{...config,mode:'ai'},seedExam,[])).rejects.toThrow();
});
test('每次组卷保留历史，未作答可删，进行中禁止删，放弃后连答卷备份删除',async()=>{
    const {adapter,repo}=await legacy(),service=new ExamService(repo,()=>{},error=>{throw error;});
    const a=await service.generateCore(config),b=await service.generateCore(config);expect(repo.papers).toHaveLength(2);expect(a.id).not.toBe(b.id);
    await service.deletePaper(a.id);expect(repo.papers).toHaveLength(1);
    await service.begin(b);await expect(service.deletePaper(b.id)).rejects.toThrow('进行中');
    await service.abandon(service.current!);await service.deletePaper(b.id);expect(repo.papers).toHaveLength(0);expect(repo.attempts).toHaveLength(0);
    expect((await adapter.list('ExamFlow/_backup/deleted-papers')).folders).toHaveLength(2);
});
