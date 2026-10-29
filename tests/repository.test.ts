import {expect,test} from 'vitest';
import {Repository} from '../src/data/repository';
import {Storage} from '../src/data/storage';
import {memoryAdapter} from './fixtures/memory';
import {newQuestion} from '../src/seed';
import {exportBundle,previewBundle,restoreBundle,writeBackup,recoverFile} from '../src/data/backup';
import {ExamService} from '../src/services';
import {generatePaper} from '../src/domain/generator';
import {startAttempt} from '../src/domain/attempt';
test('编辑题目保持题库与题目顺序，版本递增且重载后内容一致',async()=>{
    const adapter=memoryAdapter(),repo=new Repository(new Storage(adapter,'one'),'ExamFlow');await repo.load();
    const bankIds=repo.banks.map(b=>b.id),questionIds=repo.questions.map(q=>q.id),original=repo.questions[0]!;
    await repo.saveQuestion({...original,stem:'修改后的题干'});
    expect(repo.banks.map(b=>b.id)).toEqual(bankIds);expect(repo.questions.map(q=>q.id)).toEqual(questionIds);
    expect(repo.questions[0]!.version).toBe(original.version+1);expect(repo.questions[0]!.createdAt).toBe(original.createdAt);
    const reloaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await reloaded.load();
    expect(reloaded.questions.map(q=>q.id)).toEqual(questionIds);expect(reloaded.questions[0]!.stem).toBe('修改后的题干');
    const fresh=newQuestion();await repo.saveQuestion(fresh);
    expect(repo.questions.at(-1)!.id).toBe(fresh.id);
});
test('同时保存两题都可重新加载；跨科目修改被拒绝',async()=>{
    const adapter=memoryAdapter(),repo=new Repository(new Storage(adapter,'one'),'ExamFlow');await repo.load();
    const a=newQuestion(),b=newQuestion();a.stem='独立新增题 A';b.stem='独立新增题 B';
    await Promise.all([repo.saveQuestion(a),repo.saveQuestion(b)]);
    const reloaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await reloaded.load();
    expect(reloaded.questions.some(q=>q.id===a.id)).toBe(true);expect(reloaded.questions.some(q=>q.id===b.id)).toBe(true);
    await expect(repo.saveQuestion({...a,subjectId:'subj_case'})).rejects.toThrow('不可直接迁移');
});
test('新安装已有种子库时，可显式合并备份而不覆盖本地题目',async()=>{
    const adapter=memoryAdapter(),source=new Repository(new Storage(adapter,'one'),'Source');await source.load();
    const q=newQuestion();q.stem='备份独有的题目';await source.saveQuestion(q);
    const target=new Repository(new Storage(adapter,'two'),'Target');await target.load();
    await restoreBundle(target,exportBundle(source),'keep_local');
    expect(target.questions).toHaveLength(17);expect(target.banks).toHaveLength(3);
});
test('损坏文件可从有效备份加载，损坏原文保留',async()=>{
    const adapter=memoryAdapter(),repo=new Repository(new Storage(adapter,'one'),'ExamFlow');await repo.load();await writeBackup(repo);
    const index=JSON.parse(await adapter.read(repo.path('banks/index.json'))),path=repo.path('banks/'+index.banks.find((b:{bank:{subjectId:string}})=>b.bank.subjectId==='subj_comprehensive').files[0]);await adapter.write(path,'{损坏');
    const storage=new Storage(adapter,'two');storage.recoverJson=path=>recoverFile(repo,path);
    const reloaded=new Repository(storage,'ExamFlow');await reloaded.load();
    expect(reloaded.questions).toHaveLength(16);expect(await adapter.read(path)).toBe('{损坏');
});
test('非当前进行中答卷超时也会自动评分',async()=>{
    const repo=new Repository(new Storage(memoryAdapter(),'one'),'ExamFlow');await repo.load();
    const config={examId:repo.exams[0]!.id,subjectIds:['subj_comprehensive'],mode:'syllabus_mock' as const,questionCounts:{true_false:1},durationMinutes:1,excludeRecentPapers:0,allowRepeatWithinPaper:false};
    const first=generatePaper(config,repo.questions).paper!,second=generatePaper(config,repo.questions).paper!;await repo.savePaper(first);await repo.savePaper(second);
    const expired=startAttempt(first,[],new Date(Date.now()-120000)),active=startAttempt(second,[]);await repo.saveAttempt(expired);await repo.saveAttempt(active);
    const service=new ExamService(repo,()=>{},e=>{throw e;});service.current=active;await service.checkDeadline();
    expect(repo.attempts.find(a=>a.id===expired.id)!.status).toBe('graded');expect(service.current.status).toBe('in_progress');
});
test('重新加载进行中答卷后，结构校验不改变试卷校验值并能继续交卷',async()=>{
    const adapter=memoryAdapter(),repo=new Repository(new Storage(adapter,'one'),'ExamFlow');await repo.load();
    const paper=generatePaper({examId:repo.exams[0]!.id,subjectIds:['subj_comprehensive'],mode:'syllabus_mock',questionCounts:{true_false:1},durationMinutes:10,excludeRecentPapers:0,allowRepeatWithinPaper:false},repo.questions).paper!;
    await repo.savePaper(paper);const first=new ExamService(repo,()=>{},e=>{throw e;});await first.begin(paper);first.answer(paper.items[0]!.questionId,{kind:'true_false',value:true});await first.flush();
    const loaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await loaded.load();const resumed=new ExamService(loaded,()=>{},e=>{throw e;});await resumed.resume(loaded.attempts[0]!);await resumed.finish();
    expect(resumed.current!.score!.earnedPoints).toBe(1);
});
test('不同题库 ID 相同科目不能在恢复时覆盖现有题目',async()=>{
    const repo=new Repository(new Storage(memoryAdapter(),'one'),'ExamFlow');await repo.load();
    const bundle=exportBundle(repo);bundle.banks[0]!.id='bank_different';bundle.banks[0]!.questions=[];
    expect(previewBundle(repo,bundle)).toContain('科目题库:subj_comprehensive');
    await expect(restoreBundle(repo,bundle)).rejects.toThrow('冲突');expect(repo.questions).toHaveLength(16);
});
test('完整闭环交卷与状态更新幂等，重启后保留作答与复习',async()=>{
    const adapter=memoryAdapter(),repo=new Repository(new Storage(adapter,'one'),'ExamFlow');await repo.load();
    const paper=generatePaper({examId:repo.exams[0]!.id,subjectIds:['subj_comprehensive'],mode:'syllabus_mock',questionCounts:{true_false:1},durationMinutes:10,excludeRecentPapers:0,allowRepeatWithinPaper:false},repo.questions).paper!;
    await repo.savePaper(paper);const service=new ExamService(repo,()=>{},e=>{throw e;});await service.begin(paper);
    service.answer(paper.items[0]!.questionId,{kind:'true_false',value:true});await service.flush();
    await Promise.all([service.finish(),service.finish()]);
    const reloaded=new Repository(new Storage(adapter,'two'),'ExamFlow');await reloaded.load();
    expect(reloaded.attempts[0]!.score!.earnedPoints).toBe(1);expect(reloaded.state.progress['kp_architecture']!.recentOutcomes).toHaveLength(1);
    expect(reloaded.state.appliedAttemptIds).toHaveLength(1);
    await expect(reloaded.saveAttempt({...reloaded.attempts[0]!,status:'in_progress'})).rejects.toThrow('不能回退');
});
